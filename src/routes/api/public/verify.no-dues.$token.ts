import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";

export const Route = createFileRoute("/api/public/verify/no-dues/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const raw = String(params.token ?? "");
        // Format check — silent generic response for anything malformed
        const genericInvalid = () =>
          new Response(
            JSON.stringify({ valid: false, reason: "Invalid or expired certificate" }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        if (!raw || raw.length < 20 || raw.length > 128 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
          return genericInvalid();
        }

        const tokenHash = createHash("sha256").update(raw).digest("hex");
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: cert } = await supabaseAdmin
          .from("no_dues_certificates")
          .select(
            "id,certificate_number,issued_at,valid_until,revoked_at,revoke_reason,society_id,flat_id",
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
