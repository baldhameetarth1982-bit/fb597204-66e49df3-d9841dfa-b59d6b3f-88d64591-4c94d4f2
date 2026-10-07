import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { getRequestIP } from "@tanstack/react-start/server";
import { verifyNoDuesToken } from "@/lib/no-dues-verify";

/**
 * Public verification.
 * Rate limit: 30 requests / IP / 60s (all outcomes counted the same to avoid
 * timing-based token enumeration). Malformed or unknown tokens also burn a
 * tighter 10 / 60s invalid-attempt bucket.
 * Storage: DB-backed `rate_limits` table via checkRateLimit (works across
 * Cloudflare Worker instances).
 * Decision rules live in src/lib/no-dues-verify.ts (shared with tests).
 */
export const Route = createFileRoute("/api/public/verify/no-dues/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        let ip = "anon";
        try {
          ip = getRequestIP({ xForwardedFor: true }) ?? "anon";
        } catch {
          /* ignore */
        }
        const { checkRateLimit, fingerprintSubject } = await import("@/lib/rate-limit.server");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const result = await verifyNoDuesToken(params.token, {
          checkGeneral: async () => {
            await checkRateLimit({
              bucket: "verify-no-dues",
              subject: fingerprintSubject(ip, "verify-no-dues"),
              limit: 30,
              windowSec: 60,
            });
          },
          checkInvalid: async () => {
            await checkRateLimit({
              bucket: "verify-no-dues-invalid",
              subject: fingerprintSubject(ip, "verify-no-dues-invalid"),
              limit: 10,
              windowSec: 60,
            });
          },
          hash: (raw) => createHash("sha256").update(raw).digest("hex"),
          findByHash: async (hash) => {
            const { data } = await supabaseAdmin
              .from("no_dues_certificates")
              .select("id,certificate_number,issued_at,valid_until,revoked_at,society_id,flat_id")
              .eq("verification_token_hash", hash)
              .maybeSingle();
            return (data as any) ?? null;
          },
          loadSociety: async (id) => {
            const { data } = await supabaseAdmin.from("societies").select("name,city").eq("id", id).single();
            return data ?? null;
          },
          loadFlat: async (id) => {
            const { data } = await supabaseAdmin.from("flats").select("flat_number").eq("id", id).single();
            return data ?? null;
          },
        });

        const headers: Record<string, string> = {
          "content-type": "application/json",
          "cache-control": "no-store",
        };
        if (result.status === 429) headers["retry-after"] = String(result.retryAfter);
        return new Response(JSON.stringify(result.body), { status: result.status, headers });
      },
    },
  },
});
