/**
 * Provider-independent external messaging (Email / SMS / WhatsApp). Server only.
 * Credentials come only from server env; a channel without credentials reports
 * "not_connected" and its queued messages are marked so — never a fake success.
 * In-app notifications remain the primary channel and are unaffected.
 */
export type Channel = "email" | "sms" | "whatsapp";
type SendResult = { ok: true; id?: string } | { ok: false; error: string; permanent?: boolean };

const env = (k: string) => (process.env[k] ?? "").trim();

export function channelConnected(ch: Channel): boolean {
  if (ch === "email") return !!(env("RESEND_API_KEY") && env("MESSAGING_EMAIL_FROM"));
  const base = !!(env("TWILIO_ACCOUNT_SID") && env("TWILIO_AUTH_TOKEN"));
  return ch === "sms" ? base && !!env("TWILIO_SMS_FROM") : base && !!env("TWILIO_WHATSAPP_FROM");
}

const short = (s: string) => s.replace(/\s+/g, " ").slice(0, 300);

/** Stable per-delivery key: every attempt for one logical message carries the same key. */
export const emailIdempotencyKey = (deliveryId: string) => `sociyohub-delivery-${deliveryId}`;

/** Resend keeps idempotency keys for 24h; stay inside that window with a margin. */
const EMAIL_IDEMPOTENCY_WINDOW_MS = 23 * 3600_000;

export type RecoveryAction = "resend_idempotent" | "reconcile_with_provider" | "unconfirmed";

/**
 * What to do with a row a crashed run left in "sending". Never blindly resend:
 * email resends only while the provider will de-duplicate on our key; SMS/WhatsApp
 * have no send-side idempotency, so we look the message up at the provider first.
 */
export function recoveryAction(ch: Channel, sendStartedAt: string | null, now = Date.now()): RecoveryAction {
  if (ch === "email") {
    const started = sendStartedAt ? Date.parse(sendStartedAt) : NaN;
    return Number.isFinite(started) && now - started < EMAIL_IDEMPOTENCY_WINDOW_MS ? "resend_idempotent" : "unconfirmed";
  }
  return "reconcile_with_provider";
}

/** Provider 4xx responses that will never succeed on retry (409 = idempotent request still in progress → retry). */
export const isPermanentHttpFailure = (status: number) => status >= 400 && status < 500 && status !== 429 && status !== 409;

async function withAppLinks(body: string): Promise<string> {
  const { expandAppLinks, APP_URL_PLACEHOLDER } = await import("@/lib/custom-plan-links");
  if (!body.includes(APP_URL_PLACEHOLDER)) return body;
  const { getPublicAppOrigin } = await import("@/lib/public-origin.server");
  return expandAppLinks(body, getPublicAppOrigin());
}

async function sendEmail(to: string, subject: string, body: string, deliveryId: string): Promise<SendResult> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json", "Idempotency-Key": emailIdempotencyKey(deliveryId) },
    body: JSON.stringify({ from: env("MESSAGING_EMAIL_FROM"), to: [to], subject, text: await withAppLinks(body) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.ok) return { ok: true, id: ((await r.json().catch(() => ({}))) as any).id };
  return { ok: false, error: `email_http_${r.status}`, permanent: isPermanentHttpFailure(r.status) };
}

async function sendTwilio(ch: "sms" | "whatsapp", to: string, body: string): Promise<SendResult> {
  const sid = env("TWILIO_ACCOUNT_SID");
  const from = ch === "sms" ? env("TWILIO_SMS_FROM") : `whatsapp:${env("TWILIO_WHATSAPP_FROM")}`;
  const params = new URLSearchParams({ From: from, To: ch === "sms" ? to : `whatsapp:${to}`, Body: body });
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${sid}:${env("TWILIO_AUTH_TOKEN")}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.ok) return { ok: true, id: ((await r.json().catch(() => ({}))) as any).sid };
  return { ok: false, error: `${ch}_http_${r.status}`, permanent: isPermanentHttpFailure(r.status) };
}

const twilioTo = (ch: "sms" | "whatsapp", to: string) => (ch === "sms" ? to : `whatsapp:${to}`);
const twilioBody = (subject: string, body: string) => `${subject}\n${body}`.slice(0, 1000);

/**
 * Looks up whether Twilio already accepted this exact message after the crashed attempt began.
 * Returns the provider id if found, null if confirmed absent, or "unknown" if the lookup failed.
 */
async function findTwilioMessage(ch: "sms" | "whatsapp", to: string, body: string, startedAt: string): Promise<string | null | "unknown"> {
  try {
    const sid = env("TWILIO_ACCOUNT_SID");
    const since = new Date(Date.parse(startedAt) - 60_000);
    const qs = new URLSearchParams({ To: twilioTo(ch, to), "DateSent>": since.toISOString().slice(0, 10), PageSize: "50" });
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json?${qs}`, {
      headers: { Authorization: "Basic " + btoa(`${sid}:${env("TWILIO_AUTH_TOKEN")}`) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return "unknown";
    const j = (await r.json()) as { messages?: { sid: string; body: string; date_created: string; status: string }[] };
    const hit = (j.messages ?? []).find((m) => m.body === body && Date.parse(m.date_created) >= since.getTime() && !["failed", "undelivered", "canceled"].includes(m.status));
    return hit ? hit.sid : null;
  } catch {
    return "unknown";
  }
}

function normalisePhone(p: string | null): string | null {
  if (!p) return null;
  const d = p.replace(/[^\d+]/g, "");
  if (/^\+\d{10,15}$/.test(d)) return d;
  if (/^\d{10}$/.test(d)) return "+91" + d;
  return null;
}

/** Processes due queued deliveries. Idempotent per row via the 'sending' claim. */
export async function dispatchMessages(limit = 50) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as any;
  // Recover rows a crashed run left in "sending" without risking a blind duplicate send.
  await recoverInterruptedSends(db);
  const { data: chans } = await db.from("messaging_channels").select("channel, enabled");
  const enabled = new Map<string, boolean>((chans ?? []).map((c: any) => [c.channel, c.enabled]));
  const { data: due } = await db.from("message_deliveries").select("id, user_id, channel, subject, body, attempts")
    .eq("status", "queued").lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(limit);
  const stats = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  const health = new Map<Channel, { ok: boolean; error: string | null }>();
  for (const m of due ?? []) {
    const ch = m.channel as Channel;
    const claimAt = new Date().toISOString();
    const { data: claimed } = await db.from("message_deliveries").update({ status: "sending", send_started_at: claimAt, updated_at: claimAt })
      .eq("id", m.id).eq("status", "queued").select("id");
    if (!claimed?.length) continue;
    stats.processed++;
    const finish = (patch: Record<string, unknown>) => db.from("message_deliveries").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", m.id);
    if (!enabled.get(ch)) { await finish({ status: "disabled" }); stats.skipped++; continue; }
    if (!channelConnected(ch)) { await finish({ status: "not_connected", last_error: "Provider not connected" }); stats.skipped++; continue; }
    const { data: p } = await db.from("profiles").select("email, phone").eq("id", m.user_id).maybeSingle();
    const to = ch === "email" ? (p?.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email) ? p.email : null) : normalisePhone(p?.phone ?? null);
    if (!to) { await finish({ status: "no_address" }); stats.skipped++; continue; }
    let res: SendResult;
    try {
      res = ch === "email" ? await sendEmail(to, m.subject, m.body, m.id) : await sendTwilio(ch, to, twilioBody(m.subject, m.body));
    } catch (e) {
      res = { ok: false, error: short(e instanceof Error ? e.name : "network_error") };
    }
    if (res.ok) {
      await finish({ status: "sent", attempts: m.attempts + 1, provider_message_id: res.id ?? null, last_error: null });
      stats.sent++; health.set(ch, { ok: true, error: null });
    } else {
      const attempts = m.attempts + 1;
      const giveUp = res.permanent || attempts >= 5;
      await finish({ status: giveUp ? "failed" : "queued", attempts, last_error: short(res.error),
        next_attempt_at: new Date(Date.now() + 2 ** attempts * 60_000).toISOString() });
      stats.failed++; if (!health.get(ch)?.ok) health.set(ch, { ok: false, error: short(res.error) });
    }
  }
  for (const [ch, h] of health) {
    await db.from("messaging_channels").update({ last_health_at: new Date().toISOString(), last_health_ok: h.ok, last_error: h.error }).eq("channel", ch);
  }
  return stats;
}

async function addressFor(db: any, ch: Channel, userId: string): Promise<string | null> {
  const { data: p } = await db.from("profiles").select("email, phone").eq("id", userId).maybeSingle();
  return ch === "email" ? (p?.email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email) ? p.email : null) : normalisePhone(p?.phone ?? null);
}

/**
 * Crash recovery for rows stuck in "sending" > 15 min. Each row is re-claimed atomically
 * (status still "sending" and same send_started_at) so two recovering runs cannot both act.
 * - email inside the provider idempotency window → requeue (resend reuses the same key, so the provider de-duplicates)
 * - SMS/WhatsApp → ask the provider; found → Sent with its id; confirmed absent → requeue; lookup failed → Unconfirmed
 * - anything else → Unconfirmed (never auto-resent; a Super Admin may resend with a reason)
 */
async function recoverInterruptedSends(db: any) {
  const cutoff = new Date(Date.now() - 15 * 60_000).toISOString();
  const { data: stuck } = await db.from("message_deliveries").select("id, user_id, channel, subject, body, send_started_at, updated_at")
    .eq("status", "sending").lt("updated_at", cutoff).limit(50);
  for (const m of stuck ?? []) {
    const ch = m.channel as Channel;
    const startedAt: string | null = m.send_started_at ?? m.updated_at ?? null;
    const action = recoveryAction(ch, m.send_started_at ?? null);
    let patch: Record<string, unknown>;
    if (action === "resend_idempotent") {
      patch = { status: "queued", last_error: "Recovered after an interrupted send; resend is de-duplicated by the provider" };
    } else if (action === "reconcile_with_provider" && startedAt && channelConnected(ch) && ch !== "email") {
      const to = await addressFor(db, ch, m.user_id);
      const found = to ? await findTwilioMessage(ch, to, twilioBody(m.subject, m.body), startedAt) : "unknown";
      patch = found === "unknown" ? { status: "unconfirmed", last_error: "Send was interrupted and the provider could not confirm it" }
        : found ? { status: "sent", provider_message_id: found, last_error: null }
        : { status: "queued", send_started_at: null, last_error: "Recovered after an interrupted send; provider had no record of it" };
    } else {
      patch = { status: "unconfirmed", last_error: "Send was interrupted and could not be confirmed" };
    }
    let q = db.from("message_deliveries").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", m.id).eq("status", "sending");
    q = m.send_started_at ? q.eq("send_started_at", m.send_started_at) : q.is("send_started_at", null);
    await q;
  }
}
