import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Rpc = { rpc: (fn: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

export const HANDOVER_STATUSES = ["not_started", "in_progress", "ready", "handed_over"] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

const summary = z.object({
  status: z.enum(HANDOVER_STATUSES), note: z.string().nullable(), updated_at: z.string().nullable(),
  blocks: z.number(), flats: z.number(), occupied_flats: z.number(), admins: z.number(), documents: z.number(),
  completed_imports: z.number(), open_imports: z.number(), failed_imports: z.number(), import_conflict_rows: z.number(),
  opening_balance_set: z.boolean(), bills: z.number(), setup_completed: z.boolean(),
  held_import_rows: z.number().default(0), opening_balances_unverified: z.number().default(0),
  opening_balances_confirmed: z.number().default(0), pending_bill_run_approvals: z.number().default(0),
});
export type HandoverSummary = z.infer<typeof summary>;

export const getHandoverSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ societyId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }): Promise<HandoverSummary> => {
    const { data: raw, error } = await (context.supabase as unknown as Rpc).rpc("get_handover_summary", { _society_id: data.societyId });
    if (error) throw new Error(error.message.includes("not_authorized") ? "Only society admins can view handover." : "Handover status couldn't be loaded.");
    const p = summary.safeParse(raw);
    if (!p.success) throw new Error("Handover status couldn't be loaded.");
    return p.data;
  });

export const setHandoverStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    societyId: z.string().uuid(), status: z.enum(HANDOVER_STATUSES), note: z.string().max(1000).optional(),
  }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as unknown as Rpc).rpc("admin_set_handover_status", {
      _society_id: data.societyId, _status: data.status, _note: data.note ?? null,
    });
    if (error) {
      const m = error.message;
      throw new Error(m.includes("note_required") ? "Add a handover note (who received it and when)."
        : m.includes("rate_limited") ? "Too many changes. Try again later."
        : m.includes("not_authorized") ? "Only society admins can change handover status." : "Couldn't save handover status.");
    }
    return { ok: true };
  });
