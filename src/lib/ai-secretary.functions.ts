import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hasFeature, normalizePlan } from "@/lib/plan-features";

const Input = z.object({
  question: z.string().trim().min(3).max(1000),
  history: z.array(z.string().max(1000)).max(6).optional(),
});

export type AskSecretaryResult =
  | { ok: true; data: import("./ai-secretary.server").SecretaryAnswer }
  | { ok: false; code: "not_member" | "plan_locked" | "rate_limited" | "ai_unavailable" | "retrieval_failed"; message: string };

async function callResponses(system: string, user: string) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("ai_config");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      stream: true,
      store: false,
      reasoning: { effort: "low" },
      instructions: system,
      input: user,
      text: {
        format: {
          type: "json_schema",
          name: "secretary_answer",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["found", "conflict", "answer", "cited"],
            properties: {
              found: { type: "boolean" },
              conflict: { type: "boolean" },
              answer: { type: "string" },
              cited: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    }),
  });
  if (!res.ok || !res.body) throw Object.assign(new Error("ai_http"), { status: res.status });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "";
  let refused = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const d = line.slice(5).trim();
        if (!d || d === "[DONE]") continue;
        try {
          const ev = JSON.parse(d);
          if (ev.type === "response.output_text.delta") out += ev.delta ?? "";
          if (ev.type === "response.refusal.delta") refused = true;
          if (ev.type === "response.failed" || ev.type === "error") throw new Error("ai_failed");
        } catch (e) {
          if ((e as Error).message === "ai_failed") throw e;
        }
      }
    }
  }
  if (refused) return "";
  return out;
}

export const askSecretary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<AskSecretaryResult> => {
    const supabase = context.supabase as any;
    const userId = context.userId as string;

    // Society is derived server-side only; never from the request.
    const { data: profile } = await supabase.from("profiles").select("society_id").eq("id", userId).maybeSingle();
    const societyId = profile?.society_id as string | undefined;
    if (!societyId) return { ok: false, code: "not_member", message: "Join a society to use AI Secretary." };

    const { data: soc } = await supabase.from("societies").select("plan_id,plan_status,trial_ends_at").eq("id", societyId).maybeSingle();
    if (!soc) return { ok: false, code: "not_member", message: "Join a society to use AI Secretary." };
    if (!hasFeature(normalizePlan(soc.plan_id, soc.plan_status, soc.trial_ends_at), "ai_secretary")) {
      return { ok: false, code: "plan_locked", message: "AI Secretary is available on the Pro plan." };
    }

    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    try {
      await checkRateLimit({ bucket: "ai_secretary_user", subject: userId, limit: 15, windowSec: 300 });
      await checkRateLimit({ bucket: "ai_secretary_society", subject: societyId, limit: 300, windowSec: 3600 });
    } catch {
      return { ok: false, code: "rate_limited", message: "Too many questions right now. Please wait a few minutes and try again." };
    }

    const { answerQuestion, parseModelJson } = await import("@/lib/ai-secretary.server");
    let retrievalFailed = false;
    try {
      const result = await answerQuestion(data.question, {
        retrieve: async () => {
          // RLS-scoped reads as the signed-in user.
          const nowIso = new Date().toISOString();
          const [settings, contacts, notices, knowledge] = await Promise.all([
            supabase.from("society_settings").select("bylaws_html,updated_at").eq("society_id", societyId).maybeSingle(),
            supabase.from("society_contacts").select("role_label,name,phone,category").eq("society_id", societyId).order("sort_order").limit(50),
            // RLS limits notices to those addressed to this user's home/block.
            supabase.from("notices").select("title,body,category,publish_at,published_at")
              .eq("society_id", societyId).eq("status", "published").lte("publish_at", nowIso)
              .order("publish_at", { ascending: false }).limit(40),
            // RLS: residents see only ready, resident-audience items; archived/processing never included.
            supabase.from("society_knowledge_sources").select("kind,title,extracted_text,updated_at")
              .eq("society_id", societyId).eq("status", "ready")
              .order("updated_at", { ascending: false }).limit(60),
          ]);
          if (settings.error && contacts.error && notices.error && knowledge.error) { retrievalFailed = true; throw new Error("retrieval"); }
          const out: import("./ai-secretary.server").SecretarySource[] = [];
          if (settings.data?.bylaws_html) {
            out.push({ kind: "bylaws", title: "Society by-laws", text: settings.data.bylaws_html, date: settings.data.updated_at?.slice(0, 10) ?? null, href: "/app/bylaws" });
          }
          if (contacts.data?.length) {
            out.push({
              kind: "contacts",
              title: "Society contacts",
              text: contacts.data.map((c: any) => `${c.role_label ?? c.category ?? "Contact"}: ${c.name}${c.phone ? ` (${c.phone})` : ""}`).join("\n"),
              href: "/app/contacts",
            });
          }
          for (const n of (notices.data ?? []) as any[]) {
            if (!n.title && !n.body) continue;
            const d = (n.publish_at ?? n.published_at ?? "").slice(0, 10) || null;
            out.push({ kind: "notice", title: `Notice: ${String(n.title ?? "Untitled").slice(0, 120)}`, text: `${n.title ?? ""}\n\n${n.body ?? ""}`, date: d, href: "/app/notices" });
          }
          for (const k of (knowledge.data ?? []) as any[]) {
            if (!k.extracted_text) continue;
            const title = String(k.title ?? "Document").slice(0, 120);
            out.push({
              kind: k.kind === "faq" ? "faq" : "document",
              title: k.kind === "faq" ? `FAQ: ${title}` : title,
              text: k.kind === "faq" ? `Q: ${title}\nA: ${k.extracted_text}` : k.extracted_text,
              date: k.updated_at?.slice(0, 10) ?? null,
              href: "/app/documents",
            });
          }
          return out;
        },
        callModel: async (system, user) => parseModelJson(await callResponses(system, user)),
      }, data.history ?? []);
      return { ok: true, data: result };
    } catch (e) {
      if (retrievalFailed) return { ok: false, code: "retrieval_failed", message: "Couldn't read your society's sources. Please try again." };
      const status = (e as any)?.status;
      console.error("ai_secretary_failed", status ?? (e as Error).message);
      if (status === 429) return { ok: false, code: "rate_limited", message: "AI Secretary is busy right now. Please wait a minute and try again." };
      return { ok: false, code: "ai_unavailable", message: "AI Secretary is unavailable right now. Your question is kept — try again shortly." };
    }
  });
