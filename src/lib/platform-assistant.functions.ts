/**
 * Super Admin product assistant. Read-only: no tools, no mutations.
 * Super Admin role is verified server-side; society diagnosis is aggregate-only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AssistantResult =
  | { ok: true; answer: string; refused: boolean }
  | { ok: false; code: "not_authorized" | "rate_limited" | "ai_unavailable"; message: string };

const Input = z.object({
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().min(1).max(2000) })).min(1).max(12),
  societyId: z.string().uuid().nullable().optional(),
});

export const askPlatformAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<AssistantResult> => {
    const supabase = context.supabase as any;
    const userId = context.userId as string;
    const { data: isSuper } = await supabase.rpc("is_super_admin", { _user_id: userId });
    if (isSuper !== true) return { ok: false, code: "not_authorized", message: "Only Super Admins can use this assistant." };

    const { PRODUCT_MAP, SYSTEM_PROMPT, isBlockedRequest, REFUSAL, scrubOutput } = await import("@/lib/platform-assistant.server");
    const { logAiUsage } = await import("@/lib/ai-usage.server");
    const meta = { feature: "platform_assistant", societyId: data.societyId ?? null };

    // Every user turn is screened, so a dangerous ask can't be split across messages.
    if (data.messages.some((m) => m.role === "user" && isBlockedRequest(m.text))) {
      await logAiUsage(meta, "blocked");
      return { ok: true, answer: REFUSAL, refused: true };
    }

    try {
      const { checkRateLimit } = await import("@/lib/rate-limit.server");
      await checkRateLimit({ bucket: "platform_assistant", subject: userId, limit: 60, windowSec: 3600 });
    } catch {
      await logAiUsage(meta, "rate_limited");
      return { ok: false, code: "rate_limited", message: "Too many questions right now. Try again in a few minutes." };
    }

    let diagnosis = "";
    if (data.societyId) {
      const [{ data: diag }, { data: ov }] = await Promise.all([
        supabase.rpc("admin_society_diagnose", { _society_id: data.societyId }),
        supabase.rpc("admin_society_overview", { _society_id: data.societyId }),
      ]);
      if (diag?.status === "ok" && ov?.status === "ok") {
        const s = ov.society;
        diagnosis = JSON.stringify({
          society: { name: s.name, city: s.city, lifecycle: s.lifecycle, plan_id: s.plan_id, plan_status: s.plan_status, plan_expires_at: s.plan_expires_at, trial_ends_at: s.trial_ends_at },
          counts: ov.counts, role_counts: diag.role_counts, last_activity_at: diag.last_activity_at,
          issues: (diag.issues ?? []).map((i: any) => ({ title: i.title, owner: i.owner, severity: i.severity, detail: i.detail, steps: i.steps })),
        });
      }
    }

    const key = process.env.LOVABLE_API_KEY;
    if (!key) return { ok: false, code: "ai_unavailable", message: "The assistant is unavailable right now." };
    const t0 = Date.now();
    try {
      const { generateText } = await import("ai");
      const { createLovableAiGatewayProvider } = await import("@/lib/ai-gateway.server");
      const gateway = createLovableAiGatewayProvider(key);
      const r = await generateText({
        model: gateway("google/gemini-3-flash-preview"),
        system: `${SYSTEM_PROMPT}\n\n${PRODUCT_MAP}${diagnosis ? `\n\n<society_diagnosis>\n${diagnosis}\n</society_diagnosis>` : ""}`,
        messages: data.messages.map((m) => ({ role: m.role, content: m.text })),
        temperature: 0.2,
        abortSignal: AbortSignal.timeout(30_000),
      });
      await logAiUsage(meta, "ok", t0, { input: r.usage?.inputTokens, output: r.usage?.outputTokens });
      const answer = scrubOutput(r.text.trim()) || "I'm not sure. Try asking in a different way.";
      return { ok: true, answer, refused: false };
    } catch {
      await logAiUsage(meta, "failed", t0);
      return { ok: false, code: "ai_unavailable", message: "The assistant couldn't answer right now. Please try again." };
    }
  });
