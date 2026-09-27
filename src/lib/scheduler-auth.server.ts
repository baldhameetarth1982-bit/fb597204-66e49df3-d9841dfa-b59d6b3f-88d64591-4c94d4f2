/**
 * Shared caller check for scheduler hooks. Accepts either the CRON_SECRET
 * worker secret (Bearer / X-Cron-Secret) or the DB-held scheduler token that
 * pg_cron sends as X-Scheduler-Token. Fails closed.
 */
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function isAuthorizedScheduler(request: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  const provided = bearer || (request.headers.get("x-cron-secret") ?? "");
  if (secret && provided && safeEqual(provided, secret)) return true;

  const token = (request.headers.get("x-scheduler-token") ?? "").trim();
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("verify_scheduler_token", { _token: token });
  return !error && data === true;
}
