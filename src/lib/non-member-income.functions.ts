/**
 * Stage 3B — Turn 18A
 *
 * Server functions for Non-Member Payments / society income.
 * Every function:
 *   - Is authenticated via requireSupabaseAuth
 *   - Verifies society membership as admin server-side
 *   - Enforces Pro/Premium entitlement server-side
 *   - Uses strict Zod validation
 *   - Emits audit_log entries for state transitions
 *
 * UI wiring is deferred to Turn 18B.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizePlan } from "@/lib/plan-features";
import {
  CreateCategoryInput,
  UpdateCategoryInput,
  CreatePayerInput,
  UpdatePayerInput,
  CreateIncomeRecordInput,
  VerifyRecordInput,
  RejectRecordInput,
  ReverseRecordInput,
  ForbiddenPlanError,
  ForbiddenSocietyError,
  InvalidTransitionError,
  canTransitionVerification,
  isNonMemberIncomeAllowed,
  toPublicPayerList,
  toPublicIncomeList,
  type VerificationState,
} from "@/lib/non-member-income.server";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

type Ctx = { supabase: any; userId: string };

async function assertSocietyAdmin(ctx: Ctx, societyId: string): Promise<void> {
  const { data, error } = await ctx.supabase.rpc("is_society_admin_for", {
    _user_id: ctx.userId,
    _society_id: societyId,
  });
  if (error || !data) throw new ForbiddenSocietyError();
}

async function assertProPlan(ctx: Ctx, societyId: string): Promise<void> {
  const { data, error } = await ctx.supabase
    .from("societies")
    .select("plan_id,plan_status")
    .eq("id", societyId)
    .maybeSingle();
  if (error || !data) throw new ForbiddenSocietyError();
  const plan = normalizePlan(
    (data as { plan_id: string | null }).plan_id,
    (data as { plan_status: string | null }).plan_status,
  );
  if (!isNonMemberIncomeAllowed(plan)) throw new ForbiddenPlanError(plan);
}

async function requireAdminAndPlan(ctx: Ctx, societyId: string): Promise<void> {
  await assertSocietyAdmin(ctx, societyId);
  await assertProPlan(ctx, societyId);
}

async function auditLog(
  ctx: Ctx,
  action: string,
  societyId: string,
  targetId: string,
  metadata: Record<string, unknown>,
) {
  try {
    await ctx.supabase.from("audit_log").insert({
      actor_id: ctx.userId,
      action,
      target_table: "society_income_records",
      target_id: targetId,
      society_id: societyId,
      metadata,
    });
  } catch {
    // audit log is best-effort but never blocks user-visible responses
  }
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const listIncomeCategoriesFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ societyId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    const { data: rows, error } = await ctx.supabase
      .from("society_income_categories")
      .select("id, key, display_name, description, category_group, is_active, is_system, created_at")
      .eq("society_id", data.societyId)
      .order("display_name", { ascending: true });
    if (error) throw new Error("list_failed");
    return { items: rows ?? [] };
  });

export const createIncomeCategoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => CreateCategoryInput.parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    const { data: row, error } = await ctx.supabase
      .from("society_income_categories")
      .insert({
        society_id: data.societyId,
        key: data.key,
        display_name: data.display_name,
        description: data.description ?? null,
        category_group: data.category_group ?? null,
        is_system: false,
        is_active: true,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) {
      if ((error as { code?: string }).code === "23505")
        throw new Error("duplicate_category_key");
      throw new Error("create_failed");
    }
    return { id: (row as { id: string }).id };
  });

export const updateIncomeCategoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => UpdateCategoryInput.parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    const patch: Record<string, unknown> = {};
    if (data.display_name !== undefined) patch.display_name = data.display_name;
    if (data.description !== undefined) patch.description = data.description ?? null;
    if (data.category_group !== undefined) patch.category_group = data.category_group ?? null;
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    const { error } = await ctx.supabase
      .from("society_income_categories")
      .update(patch)
      .eq("id", data.id)
      .eq("society_id", data.societyId);
    if (error) throw new Error("update_failed");
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Non-member payers
// ---------------------------------------------------------------------------

export const listNonMemberPayersFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ societyId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    const { data: rows, error } = await ctx.supabase
      .from("non_member_payers")
      .select(
        "id, society_id, payer_type, display_name, organization_name, phone, email, reference_code, notes, is_active, created_at",
      )
      .eq("society_id", data.societyId)
      .order("display_name", { ascending: true });
    if (error) throw new Error("list_failed");
    return { items: toPublicPayerList((rows ?? []) as any) };
  });

export const createNonMemberPayerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => CreatePayerInput.parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    const { data: row, error } = await ctx.supabase
      .from("non_member_payers")
      .insert({
        society_id: data.societyId,
        payer_type: data.payer_type,
        display_name: data.display_name,
        organization_name: data.organization_name ?? null,
        phone: data.phone ?? null,
        email: data.email ?? null,
        reference_code: data.reference_code ?? null,
        notes: data.notes ?? null,
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error("create_failed");
    return { id: (row as { id: string }).id };
  });

export const updateNonMemberPayerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => UpdatePayerInput.parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    const patch: Record<string, unknown> = {};
    for (const k of [
      "payer_type",
      "display_name",
      "organization_name",
      "phone",
      "email",
      "reference_code",
      "notes",
      "is_active",
    ] as const) {
      const v = (data as Record<string, unknown>)[k];
      if (v !== undefined) patch[k] = v === "" ? null : v;
    }
    const { error } = await ctx.supabase
      .from("non_member_payers")
      .update(patch)
      .eq("id", data.id)
      .eq("society_id", data.societyId);
    if (error) throw new Error("update_failed");
    return { ok: true };
  });

// ---------------------------------------------------------------------------
// Income records
// ---------------------------------------------------------------------------

export const createNonMemberIncomeRecordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => CreateIncomeRecordInput.parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);

    // Verify category active + belongs to society.
    const { data: cat } = await ctx.supabase
      .from("society_income_categories")
      .select("id, society_id, is_active")
      .eq("id", data.category_id)
      .maybeSingle();
    if (!cat || (cat as any).society_id !== data.societyId)
      throw new Error("category_society_mismatch");
    if (!(cat as any).is_active) throw new Error("category_inactive");

    if (data.payer_kind === "non_member" && data.non_member_payer_id) {
      const { data: p } = await ctx.supabase
        .from("non_member_payers")
        .select("id, society_id, is_active")
        .eq("id", data.non_member_payer_id)
        .maybeSingle();
      if (!p || (p as any).society_id !== data.societyId)
        throw new Error("payer_society_mismatch");
      if (!(p as any).is_active) throw new Error("payer_inactive");
    }

    const { data: row, error } = await ctx.supabase
      .from("society_income_records")
      .insert({
        society_id: data.societyId,
        category_id: data.category_id,
        payer_kind: data.payer_kind,
        resident_user_id: data.resident_user_id ?? null,
        non_member_payer_id: data.non_member_payer_id ?? null,
        amount: data.amount,
        payment_method: data.payment_method,
        payment_status: "received",
        payment_date: data.payment_date ?? new Date().toISOString(),
        reference_number: data.reference_number ?? null,
        description: data.description ?? null,
        verification_status: "pending",
        reconciliation_status: "unreconciled",
        source: "manual",
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error("create_failed");
    const id = (row as { id: string }).id;
    await auditLog(ctx, "income_record.created", data.societyId, id, {
      amount: data.amount,
      method: data.payment_method,
      payer_kind: data.payer_kind,
    });
    return { id };
  });

async function transitionVerification(
  ctx: Ctx,
  societyId: string,
  id: string,
  next: VerificationState,
  extraPatch: Record<string, unknown>,
  meta: Record<string, unknown>,
) {
  const { data: existing } = await ctx.supabase
    .from("society_income_records")
    .select("id, society_id, verification_status")
    .eq("id", id)
    .maybeSingle();
  if (!existing || (existing as any).society_id !== societyId)
    throw new ForbiddenSocietyError();
  const current = (existing as any).verification_status as VerificationState;
  if (!canTransitionVerification(current, next))
    throw new InvalidTransitionError(current, next);
  const { error } = await ctx.supabase
    .from("society_income_records")
    .update({ verification_status: next, ...extraPatch })
    .eq("id", id)
    .eq("society_id", societyId);
  if (error) throw new Error("update_failed");
  await auditLog(ctx, `income_record.${next}`, societyId, id, {
    from: current,
    to: next,
    ...meta,
  });
}

export const verifyNonMemberIncomeRecordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => VerifyRecordInput.parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    await transitionVerification(
      ctx,
      data.societyId,
      data.id,
      "verified",
      { verified_at: new Date().toISOString(), verified_by: ctx.userId },
      {},
    );
    return { ok: true };
  });

export const rejectNonMemberIncomeRecordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => RejectRecordInput.parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    await transitionVerification(
      ctx,
      data.societyId,
      data.id,
      "rejected",
      { reversal_reason: data.reason },
      { reason: data.reason },
    );
    return { ok: true };
  });

export const reverseIncomeRecordFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => ReverseRecordInput.parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    await transitionVerification(
      ctx,
      data.societyId,
      data.id,
      "reversed",
      {
        reversed_at: new Date().toISOString(),
        reversed_by: ctx.userId,
        reversal_reason: data.reason,
        reconciliation_status: "reversed",
      },
      { reason: data.reason },
    );
    return { ok: true };
  });

export const listIncomeRecordsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        societyId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    const { data: rows, error } = await ctx.supabase
      .from("society_income_records")
      .select(
        "id, society_id, category_id, payer_kind, amount, payment_method, payment_status, verification_status, reconciliation_status, payment_date, reference_number",
      )
      .eq("society_id", data.societyId)
      .order("payment_date", { ascending: false })
      .limit(data.limit ?? 100);
    if (error) throw new Error("list_failed");
    return { items: toPublicIncomeList((rows ?? []) as any) };
  });
