import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * Self-hosted client error logger.
 * Writes a sanitized row into public.audit_log — no third-party DSN needed.
 * Bucketed via authorize_membership-friendly fields so super admins can
 * inspect via existing RLS policies.
 */
const schema = z.object({
  message: z.string().trim().min(1).max(1000),
  stack: z.string().max(8000).optional(),
  url: z.string().max(500).optional(),
  kind: z.enum(["error", "unhandledrejection", "boundary"]).default("error"),
});

export const logClientError = createServerFn({ method: "POST" })
  .inputValidator((d) => schema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("audit_log").insert({
      action: `client_error:${data.kind}`,
      metadata: {
        message: data.message,
        stack: data.stack?.slice(0, 8000),
        url: data.url,
      },
    });
    return { ok: true as const };
  });
