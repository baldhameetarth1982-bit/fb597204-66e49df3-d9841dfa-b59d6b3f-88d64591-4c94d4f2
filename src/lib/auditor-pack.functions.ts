import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const row = z.record(z.string(), z.unknown());
const section = z.object({ total: z.coerce.number().int(), rows: z.array(row) });

export const auditorPackSchema = z.object({
  society: z.object({ name: z.string(), registration_no: z.string().nullable(), city: z.string().nullable(), state: z.string().nullable() }).nullable(),
  period: z.object({ from: date, to: date }),
  generated_at: z.string(),
  format: z.enum(["view", "csv", "pdf"]),
  row_cap: z.number().int(),
  position: z.object({
    opening_cash: z.coerce.number(), opening_bank: z.coerce.number(),
    closing_cash: z.coerce.number(), closing_bank: z.coerce.number(),
    income: z.coerce.number(), expense: z.coerce.number(), net_movement: z.coerce.number(),
  }),
  ageing: z.array(z.object({ bucket: z.string(), amount: z.coerce.number(), bill_count: z.coerce.number().int() })),
  journal: section, bills: section, payments: section, income: section,
  expenses: section, bank: section, no_dues: section, activity: section,
});
export type AuditorPack = z.infer<typeof auditorPackSchema>;

const input = z.object({
  societyId: z.string().uuid(),
  from: date,
  to: date,
  format: z.enum(["view", "csv", "pdf"]),
}).strict();

const REASONS = ["invalid_period", "plan_required", "rate_limited", "not_authorized", "invalid_format"] as const;

function reasonOf(message: string) {
  const m = message.toLowerCase();
  return REASONS.find((r) => m.includes(r)) ?? (m.includes("permission denied") || m.includes("unauthenticated") ? "not_authorized" : "error");
}

const MESSAGES: Record<string, string> = {
  invalid_period: "Choose a valid period of up to two years, not in the future.",
  plan_required: "The Auditor Pack is part of the Growth and Pro plans.",
  rate_limited: "Too many packs generated in the last hour. Please try again later.",
  not_authorized: "Only finance admins of this society can generate the Auditor Pack.",
  invalid_format: "That export type isn't supported.",
  error: "The Auditor Pack couldn't be generated. Please try again.",
};

type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

/** Society, role and entitlement are resolved in the database; the browser only proposes a period. */
export const generateAuditorPack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => input.parse(d))
  .handler(async ({ data, context }) => {
    const client = context.supabase as unknown as RpcClient;
    const args = { _society_id: data.societyId, _from: data.from, _to: data.to, _format: data.format };
    const { data: raw, error } = await client.rpc("get_auditor_pack", args);
    if (error) {
      const reason = reasonOf(error.message);
      console.error("[auditor-pack] generation failed", reason);
      await client.rpc("record_auditor_pack_failure", { ...args, _reason: reason }).catch(() => undefined);
      throw new Error(MESSAGES[reason]);
    }
    const parsed = auditorPackSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("[auditor-pack] unexpected shape");
      throw new Error(MESSAGES.error);
    }
    return parsed.data;
  });
