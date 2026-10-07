import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hasFeature, normalizePlan, planFromSocietyRow } from "@/lib/plan-features";

const Input = z.object({
  question: z.string().trim().min(3).max(1000),
  history: z.array(z.string().max(1000)).max(6).optional(),
  // Stable ids of built-in suggested questions (language-independent actions).
  suggestion: z.enum(["q1", "q2", "q3", "q4"]).optional(),
  priorSuggestion: z.enum(["q1", "q2", "q3", "q4"]).optional(),
});

export type AskSecretaryResult =
  | { ok: true; data: import("./ai-secretary.server").SecretaryAnswer }
  | { ok: false; code: "not_member" | "plan_locked" | "rate_limited" | "ai_unavailable" | "retrieval_failed" | "refused"; message: string };

const SECRETARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "conflict", "answer", "cited"],
  properties: {
    found: { type: "boolean" },
    conflict: { type: "boolean" },
    answer: { type: "string" },
    cited: { type: "array", items: { type: "string" } },
  },
};

async function callResponses(system: string, user: string, societyId: string) {
  const { callResponsesJson } = await import("@/lib/ai-responses.server");
  return callResponsesJson(system, user, "secretary_answer", SECRETARY_SCHEMA, { feature: "ai_secretary", societyId });
}

export const askSecretary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data, context }): Promise<AskSecretaryResult> => {
    const supabase = context.supabase as any;
    const userId = context.userId as string;

    // Society is derived server-side only; never from the request.
    const { resolveCallerSociety } = await import("@/lib/ai-retrieval.server");
    const societyId = await resolveCallerSociety(supabase, userId);
    if (!societyId) return { ok: false, code: "not_member", message: "Join a society to use AI Secretary." };

    const { data: soc } = await supabase.from("societies").select("plan_id,plan_status,trial_ends_at,plan_expires_at,status").eq("id", societyId).maybeSingle();
    if (!soc) return { ok: false, code: "not_member", message: "Join a society to use AI Secretary." };
    if (!hasFeature(planFromSocietyRow(soc as any), "ai_secretary")) {
      return { ok: false, code: "plan_locked", message: "AI Secretary is available on the Pro plan." };
    }

    // Shared pre-model guard: bypass/secret/impersonation requests never reach the model.
    const { isBlockedRequest } = await import("@/lib/platform-assistant.server");
    if (isBlockedRequest(data.question) || (data.history ?? []).some(isBlockedRequest)) {
      return { ok: false, code: "refused", message: "I can't help with getting around SociyoHub's security, logins or other people's data. Ask about your society's rules, notices or documents instead." };
    }

    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    try {
      await checkRateLimit({ bucket: "ai_secretary_user", subject: userId, limit: 15, windowSec: 300 });
      await checkRateLimit({ bucket: "ai_secretary_society", subject: societyId, limit: 300, windowSec: 3600 });
    } catch {
      return { ok: false, code: "rate_limited", message: "Too many questions right now. Please wait a few minutes and try again." };
    }

    const { answerQuestion, parseModelJson } = await import("@/lib/ai-secretary.server");
    const { retrieveSocietySources, RetrievalFailed } = await import("@/lib/ai-retrieval.server");
    let retrievalFailed = false;
    try {
      const result = await answerQuestion(data.question, {
        retrieve: async () => {
          try {
            return await retrieveSocietySources(supabase, societyId);
          } catch (e) {
            if (e instanceof RetrievalFailed) retrievalFailed = true;
            throw e;
          }
        },
        callModel: async (system, user) => parseModelJson(await callResponses(system, user, societyId)),
      }, data.history ?? [], { suggestion: data.suggestion, priorSuggestion: data.priorSuggestion });
      return { ok: true, data: result };
    } catch (e) {
      if (retrievalFailed) return { ok: false, code: "retrieval_failed", message: "Couldn't read your society's sources. Please try again." };
      const status = (e as any)?.status;
      console.error("ai_secretary_failed", status ?? (e as Error).message);
      if (status === 429) return { ok: false, code: "rate_limited", message: "AI Secretary is busy right now. Please wait a minute and try again." };
      return { ok: false, code: "ai_unavailable", message: "AI Secretary is unavailable right now. Your question is kept — try again shortly." };
    }
  });
