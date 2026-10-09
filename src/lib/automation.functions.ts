/**
 * Advanced Automation — read/write via SECURITY DEFINER RPCs that enforce
 * auth, billing.manage permission, Premium entitlement and audit server-side.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KNOWN = ["forbidden", "plan_required", "schedule_missing", "invalid_config", "unknown_automation", "unauthenticated"];
function safeError(e: unknown): Error {
  const msg = (e as { message?: string } | null)?.message ?? "";
  for (const k of KNOWN) if (msg.includes(k)) return new Error(k);
  return new Error("operation_failed");
}

const BillRun = z.object({
  enabled: z.boolean(),
  cycle: z.string(),
  anchor_day: z.number().nullable(),
  due_offset_days: z.number(),
  mode: z.string(),
  last_run_at: z.string().nullable(),
  last_run_count: z.number().nullable(),
  next_run_at: z.string().nullable(),
});
const Snapshot = z.object({
  entitled: z.boolean(),
  bill_run: BillRun.nullable(),
  paid_bill_cycle: z.object({
    enabled: z.boolean(),
    last_run_at: z.string().nullable(),
    next_run_at: z.string().nullable(),
  }).default({ enabled: false, last_run_at: null, next_run_at: null }),
  reminders: z.object({
    enabled: z.boolean(),
    min_days_overdue: z.number(),
    repeat_days: z.number(),
    configured: z.boolean(),
    last_run_at: z.string().nullable(),
    sent_7d: z.number(),
  }),
});
export type AutomationSnapshot = z.infer<typeof Snapshot>;

export const getAutomations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ societyId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("get_society_automations", { _society_id: data.societyId });
    if (error) throw safeError(error);
    const parsed = Snapshot.safeParse(row);
    if (!parsed.success) throw new Error("operation_failed");
    return parsed.data;
  });

const SetInput = z.discriminatedUnion("key", [
  z.object({
    societyId: z.string().uuid(), key: z.literal("paid_bill_cycle"), enabled: z.boolean(),
    config: z.object({}).strict().default({}),
  }),
  z.object({
    societyId: z.string().uuid(), key: z.literal("bill_run"), enabled: z.boolean(),
    config: z.object({ due_offset_days: z.number().int().min(0).max(60) }),
  }),
  z.object({
    societyId: z.string().uuid(), key: z.literal("reminders"), enabled: z.boolean(),
    config: z.object({
      min_days_overdue: z.number().int().min(0).max(60),
      repeat_days: z.number().int().min(1).max(30),
    }),
  }),
]);

export const setAutomation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SetInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("admin_set_society_automation", {
      _society_id: data.societyId, _key: data.key, _enabled: data.enabled, _config: data.config,
    });
    if (error) throw safeError(error);
    return { ok: true as const };
  });
