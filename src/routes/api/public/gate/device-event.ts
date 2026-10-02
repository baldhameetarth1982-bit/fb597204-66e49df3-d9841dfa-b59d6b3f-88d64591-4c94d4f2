/**
 * Gate hardware ingress (ANPR cameras, RFID readers, boom barriers).
 *
 * Devices authenticate with their own device id + device key (issued once to the
 * committee, stored only as a SHA-256 hash). The society is taken from the
 * authenticated device row — never from the payload — and the payload schema is
 * strict, so a "society_id" field is rejected outright. Replay protection: each
 * event id is unique per device and must be within a 5-minute clock window.
 * Barriers use a pull model (barrier_poll → commands) so no browser ever holds
 * a hardware secret.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const eventId = z.string().regex(/^[A-Za-z0-9_.:-]{6,80}$/);
const occurredAt = z.string().datetime({ offset: true });
const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("plate_read"), event_id: eventId, occurred_at: occurredAt, plate: z.string().max(20), confidence: z.number().min(0).max(1) }).strict(),
  z.object({ type: z.literal("rfid_scan"), event_id: eventId, occurred_at: occurredAt, credential: z.string().min(6).max(64) }).strict(),
  z.object({ type: z.literal("barrier_result"), event_id: eventId, occurred_at: occurredAt, command_id: z.string().uuid(), success: z.boolean(), message: z.string().max(200).optional() }).strict(),
  z.object({ type: z.literal("barrier_poll") }).strict(),
]);

const json = (b: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

const STATUS: Record<string, number> = { unauthorized: 401, device_inactive: 403, stale_event: 409, unknown_command: 404, type_not_allowed_for_device: 422, invalid_payload: 400 };

export const Route = createFileRoute("/api/public/gate/device-event")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const len = Number(request.headers.get("content-length") ?? "0");
        if (Number.isFinite(len) && len > 4096) return json({ error: "too_large" }, 413);
        const deviceId = request.headers.get("x-device-id") ?? "";
        const auth = request.headers.get("authorization") ?? "";
        const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
        if (!z.string().uuid().safeParse(deviceId).success || !/^gdk_[A-Za-z0-9_-]{40,60}$/.test(key)) return json({ error: "unauthorized" }, 401);

        try {
          const { getRequestIP } = await import("@tanstack/react-start/server");
          let ip = "anon";
          try { ip = getRequestIP({ xForwardedFor: true }) ?? "anon"; } catch { /* ignore */ }
          const { checkRateLimit, fingerprintSubject } = await import("@/lib/rate-limit.server");
          await checkRateLimit({ bucket: "gate-device-ingress", subject: fingerprintSubject(ip, "gate-device-ingress"), limit: 600, windowSec: 60 });
        } catch {
          return json({ error: "rate_limited" }, 429, { "retry-after": "60" });
        }

        let parsed: z.infer<typeof Body>;
        try {
          const r = Body.safeParse(await request.json());
          if (!r.success) return json({ error: "invalid_payload" }, 400);
          parsed = r.data;
        } catch {
          return json({ error: "invalid_payload" }, 400);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data, error } = await supabaseAdmin.rpc("device_ingest_event", { _device_id: deviceId, _key: key, _event: parsed });
        if (error) {
          console.error("[gate-device] ingest failed", error.code);
          return json({ error: /rate_limited/.test(error.message) ? "rate_limited" : "unavailable" }, /rate_limited/.test(error.message) ? 429 : 503);
        }
        const out = (data ?? {}) as { error?: string };
        if (out.error) return json({ error: out.error }, STATUS[out.error] ?? 400);
        return json(out);
      },
    },
  },
});
