/**
 * Records AI usage metadata for Super Admin monitoring (server only).
 * Stores feature, society, outcome, latency and token counts — never prompts, outputs or documents.
 * Logging failures are swallowed so AI features never break because of monitoring.
 */
export type AiUsageStatus = "ok" | "failed" | "refused" | "rate_limited" | "blocked";
export type AiUsageMeta = { feature: string; societyId?: string | null };

export async function logAiUsage(
  meta: AiUsageMeta,
  status: AiUsageStatus,
  startedAt?: number,
  tokens?: { input?: number | null; output?: number | null },
): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("ai_usage_events").insert({
      feature: meta.feature,
      society_id: meta.societyId ?? null,
      status,
      latency_ms: startedAt ? Math.max(0, Math.round(Date.now() - startedAt)) : null,
      input_tokens: tokens?.input ?? null,
      output_tokens: tokens?.output ?? null,
    });
  } catch {
    /* monitoring must never break the feature */
  }
}

/** Runs one AI call and records its outcome. Re-throws the original error. */
export async function trackAi<T>(meta: AiUsageMeta, fn: () => Promise<T>, tokensOf?: (r: T) => { input?: number | null; output?: number | null }): Promise<T> {
  const t0 = Date.now();
  try {
    const r = await fn();
    await logAiUsage(meta, "ok", t0, tokensOf?.(r));
    return r;
  } catch (e) {
    await logAiUsage(meta, "failed", t0);
    throw e;
  }
}
