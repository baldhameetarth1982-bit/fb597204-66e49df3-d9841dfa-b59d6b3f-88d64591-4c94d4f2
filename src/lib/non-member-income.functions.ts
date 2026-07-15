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

const ListFilters = z.object({
  societyId: z.string().uuid(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(10000).optional(),
  verification_status: z.enum(["pending", "verified", "rejected", "reversed"]).optional(),
  reconciliation_status: z
    .enum(["unreconciled", "matched", "partially_matched", "needs_review", "reversed"])
    .optional(),
  payment_method: z.enum(["cash", "bank_transfer", "other_offline"]).optional(),
  payer_kind: z.enum(["resident", "non_member", "anonymous"]).optional(),
  category_id: z.string().uuid().optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  sort: z.enum(["newest", "oldest", "amount_desc", "amount_asc"]).optional(),
});

export const listIncomeRecordsFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => ListFilters.parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    const limit = Math.min(data.limit ?? 50, 200);
    let q = ctx.supabase
      .from("society_income_records")
      .select(
        "id, society_id, category_id, payer_kind, amount, payment_method, payment_status, verification_status, reconciliation_status, payment_date, reference_number",
        { count: "exact" },
      )
      .eq("society_id", data.societyId);
    if (data.verification_status) q = q.eq("verification_status", data.verification_status);
    if (data.reconciliation_status) q = q.eq("reconciliation_status", data.reconciliation_status);
    if (data.payment_method) q = q.eq("payment_method", data.payment_method);
    if (data.payer_kind) q = q.eq("payer_kind", data.payer_kind);
    if (data.category_id) q = q.eq("category_id", data.category_id);
    if (data.from_date) q = q.gte("payment_date", data.from_date);
    if (data.to_date) q = q.lte("payment_date", data.to_date);
    const sort = data.sort ?? "newest";
    if (sort === "newest") q = q.order("payment_date", { ascending: false });
    else if (sort === "oldest") q = q.order("payment_date", { ascending: true });
    else if (sort === "amount_desc") q = q.order("amount", { ascending: false });
    else q = q.order("amount", { ascending: true });
    const offset = data.offset ?? 0;
    q = q.range(offset, offset + limit - 1);
    const { data: rows, error, count } = await q;
    if (error) throw new Error("list_failed");
    return {
      items: toPublicIncomeList((rows ?? []) as any),
      total: count ?? null,
      limit,
      offset,
    };
  });

export const getIncomeDashboardFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        societyId: z.string().uuid(),
        from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
        to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    let q = ctx.supabase
      .from("society_income_records")
      .select(
        "id, category_id, payer_kind, amount, payment_method, verification_status, reconciliation_status, payment_date",
      )
      .eq("society_id", data.societyId)
      .limit(5000);
    if (data.from_date) q = q.gte("payment_date", data.from_date);
    if (data.to_date) q = q.lte("payment_date", data.to_date);
    const { data: rows, error } = await q;
    if (error) throw new Error("dashboard_failed");

    let verifiedTotal = 0;
    let pendingCount = 0;
    let rejectedCount = 0;
    let reversedCount = 0;
    let unreconciled = 0;
    let needsReview = 0;
    const byCategory = new Map<string, number>();
    const byMethod = new Map<string, number>();
    const byReconciliation = new Map<string, number>();
    for (const r of rows ?? []) {
      const row = r as any;
      const amt = Number(row.amount) || 0;
      const v = row.verification_status as string;
      const rec = row.reconciliation_status as string;
      byReconciliation.set(rec, (byReconciliation.get(rec) ?? 0) + 1);
      if (v === "verified") {
        verifiedTotal += amt;
        byCategory.set(row.category_id, (byCategory.get(row.category_id) ?? 0) + amt);
        byMethod.set(row.payment_method, (byMethod.get(row.payment_method) ?? 0) + amt);
      } else if (v === "pending") pendingCount += 1;
      else if (v === "rejected") rejectedCount += 1;
      else if (v === "reversed") reversedCount += 1;
      if (rec === "unreconciled") unreconciled += 1;
      if (rec === "needs_review") needsReview += 1;
    }

    // Active payer count (only when the policy allows the caller to read them).
    const { count: activePayerCount } = await ctx.supabase
      .from("non_member_payers")
      .select("id", { count: "exact", head: true })
      .eq("society_id", data.societyId)
      .eq("is_active", true);

    return {
      verifiedTotal,
      pendingCount,
      rejectedCount,
      reversedCount,
      unreconciled,
      needsReview,
      activePayerCount: activePayerCount ?? 0,
      byCategory: Array.from(byCategory.entries()).map(([id, total]) => ({ category_id: id, total })),
      byMethod: Array.from(byMethod.entries()).map(([method, total]) => ({ method, total })),
      byReconciliation: Array.from(byReconciliation.entries()).map(([status, count]) => ({ status, count })),
      recordCount: rows?.length ?? 0,
    };
  });

export const getIncomeRecordDetailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ societyId: z.string().uuid(), id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    const { data: row, error } = await ctx.supabase
      .from("society_income_records")
      .select(
        "id, society_id, category_id, payer_kind, non_member_payer_id, amount, payment_method, payment_status, verification_status, reconciliation_status, payment_date, reference_number, description, created_at, verified_at, reversed_at, reversal_reason",
      )
      .eq("id", data.id)
      .maybeSingle();
    // Never confirm existence in another society — same safe not-found shape.
    if (error || !row || (row as any).society_id !== data.societyId) {
      return { found: false as const };
    }
    const r = row as any;
    // Fetch related labels via joined lookups (RLS scopes them).
    const [{ data: cat }, { data: payer }] = await Promise.all([
      ctx.supabase
        .from("society_income_categories")
        .select("display_name, category_group")
        .eq("id", r.category_id)
        .maybeSingle(),
      r.non_member_payer_id
        ? ctx.supabase
            .from("non_member_payers")
            .select("display_name, payer_type, organization_name")
            .eq("id", r.non_member_payer_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const ref = typeof r.reference_number === "string" ? r.reference_number.trim() : "";
    const reference_suffix = ref.length === 0 ? null : ref.length <= 4 ? "•".repeat(ref.length) : `••••${ref.slice(-4)}`;
    return {
      found: true as const,
      record: {
        id: r.id,
        amount: Number(r.amount) || 0,
        payer_kind: r.payer_kind,
        payment_method: r.payment_method,
        payment_status: r.payment_status,
        verification_status: r.verification_status,
        reconciliation_status: r.reconciliation_status,
        payment_date: r.payment_date,
        reference_suffix,
        description: typeof r.description === "string" ? r.description.slice(0, 500) : null,
        created_at: r.created_at,
        verified_at: r.verified_at,
        reversed_at: r.reversed_at,
        reversal_reason: typeof r.reversal_reason === "string" ? r.reversal_reason.slice(0, 500) : null,
        category: cat ? { display_name: (cat as any).display_name, group: (cat as any).category_group } : null,
        payer: payer
          ? {
              display_name: (payer as any).display_name,
              payer_type: (payer as any).payer_type,
              organization_name: (payer as any).organization_name,
            }
          : null,
      },
    };
  });

