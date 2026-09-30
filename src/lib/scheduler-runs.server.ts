import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Wraps an existing scheduler hook body with the shared run log (public.scheduler_job_runs).
 * A window that already succeeded, or is still running (< 30 min), is skipped; failed or stale
 * runs are retried. Only call after the scheduler caller is authenticated.
 */
export async function recordSchedulerRun(
  admin: SupabaseClient,
  job: string,
  runKey: string,
  body: () => Promise<Response>,
): Promise<Response> {
  const { data: runId, error } = await admin.rpc("scheduler_run_begin", { _job: job, _run_key: runKey.slice(0, 120) });
  if (error) return new Response("Internal error", { status: 500 });
  if (!runId) return Response.json({ ok: true, skipped: "already_ran_or_running" });
  let res: Response;
  try {
    res = await body();
  } catch (e) {
    await admin.rpc("scheduler_run_finish", { _id: runId, _status: "failed", _processed: 0, _failed: 0, _error: "unhandled_error" });
    throw e;
  }
  let processed = 0;
  try {
    const j = (await res.clone().json()) as Record<string, unknown>;
    processed = Number(j.reminded ?? j.generated ?? j.inserted ?? j.count ?? 0) || 0;
  } catch { /* non-JSON response */ }
  await admin.rpc("scheduler_run_finish", {
    _id: runId,
    _status: res.ok ? "succeeded" : "failed",
    _processed: processed,
    _failed: 0,
    _error: res.ok ? null : `http_${res.status}`,
  });
  return res;
}
