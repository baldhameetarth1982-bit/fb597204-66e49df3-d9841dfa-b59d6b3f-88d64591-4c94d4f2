import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { getRequestIP } from "@tanstack/react-start/server";

const GENERIC_BODY = JSON.stringify({
  valid: false,
  reason: "Invalid or expired certificate",
});
const RATE_BODY = JSON.stringify({
  valid: false,
  reason: "Too many requests. Please try again shortly.",
});

/**
 * Public verification.
 * Rate limit: 30 requests / IP / 60s (all outcomes counted the same to avoid
 * timing-based token enumeration). Invalid-format hits burn the same slot.
 * Storage: DB-backed `rate_limits` table via checkRateLimit (works across
 * Cloudflare Worker instances).
 */
export const Route = createFileRoute("/api/public/verify/no-dues/$token")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const genericInvalid = (extraHeaders?: Record<string, string>) =>
          new Response(GENERIC_BODY, {
            status: 200,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
              ...(extraHeaders ?? {}),
            },
          });

        // --- Rate limit ---------------------------------------------------
        let ip = "anon";
        try {
          ip = getRequestIP({ xForwardedFor: true }) ?? "anon";
        } catch {
          /* ignore */
        }
        try {
          const { checkRateLimit } = await import("@/lib/rate-limit.server");
          await checkRateLimit({
            bucket: "verify-no-dues",
            subject: ip,
            limit: 30,
            windowSec: 60,
          });
        } catch {
          return new Response(RATE_BODY, {
            status: 429,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
              "retry-after": "60",
            },
          });
        }

        const raw = String(params.token ?? "");
        if (!raw || raw.length < 20 || raw.length > 128 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
          return genericInvalid();
        }

        const tokenHash = createHash("sha256").update(raw).digest("hex");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: cert } = await supabaseAdmin
          .from("no_dues_certificates")
          .select(
            "id,certificate_number,issued_at,valid_until,revoked_at,society_id,flat_id",
          )
          .eq("verification_token_hash", tokenHash)
          .maybeSingle();
        if (!cert) return genericInvalid();

        const [{ data: society }, { data: flat }] = await Promise.all([
          supabaseAdmin.from("societies").select("name,city").eq("id", cert.society_id).single(),
          supabaseAdmin
            .from("flats")
            .select("flat_number")
            .eq("id", cert.flat_id)
            .single(),
        ]);

        const now = Date.now();
        const isRevoked = !!cert.revoked_at;
        const isExpired = cert.valid_until && new Date(cert.valid_until).getTime() < now;
        const valid = !isRevoked && !isExpired;

        return new Response(
          JSON.stringify({
            valid,
            status: isRevoked ? "revoked" : isExpired ? "expired" : "active",
            certificate_number: cert.certificate_number,
            issued_at: cert.issued_at,
            valid_until: cert.valid_until,
            society_name: society?.name ?? null,
            society_city: society?.city ?? null,
            unit_label: flat?.flat_number ?? null,
          }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "cache-control": "no-store",
            },
          },
        );
      },
    },
  },
});
