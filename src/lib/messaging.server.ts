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

async function sendEmail(to: string, subject: string, body: string): Promise<SendResult> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env("MESSAGING_EMAIL_FROM"), to: [to], subject, text: body }),
    signal: AbortSignal.timeout(15_000),
  });
  if (r.ok) return { ok: true, id: ((await r.json().catch(() => ({}))) as any).id };
  return { ok: false, error: `email_http_${r.status}`, permanent: r.status >= 400 && r.status < 500 && r.status !== 429 };
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
  return { ok: false, error: `${ch}_http_${r.status}`, permanent: r.status >= 400 && r.status < 500 && r.status !== 429 };
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
  const { data: chans } = await db.from("messaging_channels").select("channel, enabled");
  const enabled = new Map<string, boolean>((chans ?? []).map((c: any) => [c.channel, c.enabled]));
  const { data: due } = await db.from("message_deliveries").select("id, user_id, channel, subject, body, attempts")
    .eq("status", "queued").lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(limit);
  const stats = { processed: 0, sent: 0, failed: 0, skipped: 0 };
  const health = new Map<Channel, { ok: boolean; error: string | null }>();
  for (const m of due ?? []) {
    const ch = m.channel as Channel;
    const { data: claimed } = await db.from("message_deliveries").update({ status: "sending", updated_at: new Date().toISOString() })
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
      res = ch === "email" ? await sendEmail(to, m.subject, m.body) : await sendTwilio(ch, to, `${m.subject}\n${m.body}`.slice(0, 1000));
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
