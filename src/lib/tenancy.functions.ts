/**
 * Workstream 2 — tenant lifecycle adapters. Every call runs as the signed-in
 * user; the database derives the society from the row and enforces
 * residents.manage, locking, rate limits and audit.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CODES: Record<string, string> = {
  not_authorized: "You don't have permission to manage tenancies here.",
  not_tenant: "This person is not a tenant.",
  tenancy_ended: "This tenancy has already ended.",
  invalid_lease_dates: "Choose a new end date later than the current one.",
  already_moved_out: "This person has already moved out.",
  invalid_move_out_date: "Choose a valid move-out date.",
  reason_too_long: "Keep the reason under 300 characters.",
  still_active: "Only ended tenancies can be archived.",
  invalid_window: "Choose between 1 and 180 days.",
  invalid_filter: "Invalid filter.",
  rate_limited: "Too many changes. Please wait a few minutes.",
};
function fail(e: { message?: string } | null): never {
  const m = e?.message ?? "";
  const key = Object.keys(CODES).find((k) => m.includes(k));
  throw new Error(key ? CODES[key] : "Could not complete the change. Please try again.");
}

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export type TenancyState =
  | "invited" | "pending" | "active" | "expiring" | "terminating"
  | "expired" | "terminated" | "moved_out" | "archived";

const relSchema = z.object({
  id: z.string(), user_id: z.string().nullable(), name: z.string().nullable(),
  relationship: z.string().nullable(), is_primary: z.boolean().nullable(),
  moved_in_at: z.string().nullable(), moved_out_at: z.string().nullable(),
  lease_starts_on: z.string().nullable(), lease_ends_on: z.string().nullable(),
  notice_given_on: z.string().nullable(), renewal_count: z.number().nullable(),
  ended_reason: z.string().nullable(), state: z.string(),
});
const occSchema = z.object({
  society_id: z.string(), warning_days: z.number(),
  relationships: z.array(relSchema),
  no_dues: z.object({
    eligible: z.boolean().nullable(),
    total_outstanding: z.number().nullable(),
    pending_payment_total: z.number().nullable(),
  }),
});
export type FlatOccupancy = z.infer<typeof occSchema>;

export const getFlatOccupancy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { flatId: string }) => z.object({ flatId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("get_flat_occupancy", { _flat_id: data.flatId });
    if (error) fail(error);
    return occSchema.parse(r);
  });

export const listTenancies = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { societyId: string; filter: "current" | "expiring" | "expired" | "all" }) =>
    z.object({ societyId: uuid, filter: z.enum(["current", "expiring", "expired", "all"]) }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("list_tenancies", { _society_id: data.societyId, _filter: data.filter });
    if (error) fail(error);
    return r ?? [];
  });

export const renewTenancy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { flatResidentId: string; newEndsOn: string }) =>
    z.object({ flatResidentId: uuid, newEndsOn: date }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("admin_renew_tenancy", {
      _flat_resident_id: data.flatResidentId, _new_lease_ends_on: data.newEndsOn,
    });
    if (error) fail(error);
    return { ok: true };
  });

export const moveOutResident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { flatResidentId: string; movedOutOn: string; reason?: string; overrideReason?: string; early?: boolean }) =>
    z.object({
      flatResidentId: uuid, movedOutOn: date,
      reason: z.string().max(300).optional(), overrideReason: z.string().max(300).optional(),
      early: z.boolean().optional(),
    }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: r, error } = await context.supabase.rpc("admin_move_out_resident", {
      _flat_resident_id: data.flatResidentId, _moved_out_on: data.movedOutOn,
      _reason: data.reason ?? "", _override_reason: data.overrideReason ?? undefined,
      _early_termination: data.early ?? false,
    });
    if (error) fail(error);
    return z.object({
      ok: z.boolean(), scheduled: z.boolean().optional(), blocked: z.string().optional(),
      total_outstanding: z.number().nullable().optional(), pending_payment_total: z.number().nullable().optional(),
    }).parse(r);
  });

export const archiveTenancy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { flatResidentId: string }) => z.object({ flatResidentId: uuid }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("admin_archive_tenancy", { _flat_resident_id: data.flatResidentId });
    if (error) fail(error);
    return { ok: true };
  });

export const setTenancyWarningDays = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { societyId: string; days: number }) =>
    z.object({ societyId: uuid, days: z.number().int().min(1).max(180) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("admin_set_tenancy_warning_days", { _society_id: data.societyId, _days: data.days });
    if (error) fail(error);
    return { ok: true };
  });
