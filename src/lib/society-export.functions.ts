import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EXPORT_SECTION_KEYS } from "@/lib/society-export";

const input = z.object({
  societyId: z.string().uuid(),
  section: z.enum(EXPORT_SECTION_KEYS),
  offset: z.number().int().min(0).max(100000).multipleOf(1000),
}).strict();

const out = z.object({
  section: z.string(),
  offset: z.number().int(),
  page_size: z.number().int(),
  rows: z.array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]).catch((c) => JSON.stringify(c.input)))),
  has_more: z.boolean(),
});
export type ExportPage = z.infer<typeof out>;

const MESSAGES: Record<string, string> = {
  not_authorized: "Only society admins can export this society's data.",
  rate_limited: "Too many exports in the last hour. Please try again later.",
  error: "This part of the export couldn't be loaded. Please retry.",
};

/**
 * One page of one section. Authorization (society admin of that society),
 * column whitelists, paging limits, rate limiting and the audit row are all
 * enforced by get_society_export_section in the database, as the caller.
 */
export const getSocietyExportPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }): Promise<ExportPage> => {
    const client = context.supabase as unknown as {
      rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data: raw, error } = await client.rpc("get_society_export_section", {
      _society_id: data.societyId, _section: data.section, _offset: data.offset,
    });
    if (error) {
      const m = error.message.toLowerCase();
      const reason = m.includes("rate_limited") ? "rate_limited"
        : m.includes("not_authorized") || m.includes("unauthenticated") ? "not_authorized" : "error";
      console.error("[society-export] failed", data.section, reason);
      throw new Error(MESSAGES[reason]);
    }
    const parsed = out.safeParse(raw);
    if (!parsed.success) throw new Error(MESSAGES.error);
    return parsed.data;
  });
