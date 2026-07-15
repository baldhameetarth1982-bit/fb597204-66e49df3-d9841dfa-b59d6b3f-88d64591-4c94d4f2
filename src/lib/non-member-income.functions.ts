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
    .select("plan_id,plan_status,trial_ends_at")
    .eq("id", societyId)
    .maybeSingle();
  if (error || !data) throw new ForbiddenSocietyError();
  const row = data as {
    plan_id: string | null;
    plan_status: string | null;
    trial_ends_at: string | null;
  };
  const plan = normalizePlan(row.plan_id, row.plan_status, row.trial_ends_at);
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
  .handler(async ({ data, context }): Promise<{
    items: import("@/lib/non-member-income.server").IncomeRecordListItem[];
    total: number | null;
    limit: number;
    offset: number;
  }> => {
    const ctx = context as Ctx;
    await requireAdminAndPlan(ctx, data.societyId);
    const limit = Math.min(data.limit ?? 25, 200);
    let q = ctx.supabase
      .from("society_income_records")
      .select(
        "id, society_id, category_id, non_member_payer_id, payer_kind, amount, payment_method, payment_status, verification_status, reconciliation_status, payment_date, reference_number",
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

    type Row = {
      id: string;
      category_id: string;
      non_member_payer_id: string | null;
      payer_kind: string;
      amount: number | string;
      payment_method: string;
      payment_status: string;
      verification_status: string;
      reconciliation_status: string;
      payment_date: string;
      reference_number: string | null;
    };
    const typedRows = (rows ?? []) as Row[];

    // Batched, authorized lookups for display labels only.
    const categoryIds = Array.from(new Set(typedRows.map((r) => r.category_id)));
    const payerIds = Array.from(
      new Set(
        typedRows
          .map((r) => r.non_member_payer_id)
          .filter((x): x is string => typeof x === "string" && x.length > 0),
      ),
    );

    const catLabels = new Map<string, string>();
    if (categoryIds.length > 0) {
      const catsRes = await ctx.supabase
        .from("society_income_categories")
        .select("id, display_name")
        .in("id", categoryIds);
      if (catsRes.error) throw new Error("list_failed");
      for (const c of (catsRes.data ?? []) as Array<{ id: string; display_name: string }>) {
        catLabels.set(c.id, c.display_name);
      }
    }
    const payerLabels = new Map<string, string>();
    if (payerIds.length > 0) {
      const payersRes = await ctx.supabase
        .from("non_member_payers")
        .select("id, display_name")
        .in("id", payerIds);
      if (payersRes.error) throw new Error("list_failed");
      for (const p of (payersRes.data ?? []) as Array<{ id: string; display_name: string }>) {
        payerLabels.set(p.id, p.display_name);
      }
    }

    const { parseFinancialAmount } = await import("@/lib/non-member-income.server");
    const items: import("@/lib/non-member-income.server").IncomeRecordListItem[] = [];
    for (const r of typedRows) {
      const amt = parseFinancialAmount(r.amount, { allowZero: true });
      if (amt === null) {
        // Never surface an invalid amount as ₹0. Surface a safe list error
        // so the admin knows the underlying data needs attention.
        throw new Error("list_failed");
      }
      const ref = typeof r.reference_number === "string" ? r.reference_number.trim() : "";
      const reference_suffix =
        ref.length === 0
          ? null
          : ref.length <= 4
            ? "•".repeat(ref.length)
            : `••••${ref.slice(-4)}`;
      const payer_display_name =
        r.payer_kind === "anonymous"
          ? null
          : r.non_member_payer_id
            ? payerLabels.get(r.non_member_payer_id) ?? null
            : null;
      items.push({
        id: r.id,
        category_id: r.category_id,
        category_display_name: catLabels.get(r.category_id) ?? null,
        payer_kind: r.payer_kind as import("@/lib/non-member-income.server").IncomePayerKind,
        payer_display_name,
        amount: amt,
        payment_method: r.payment_method as import("@/lib/non-member-income.server").IncomePaymentMethod,
        payment_status: r.payment_status,
        verification_status: r.verification_status as import("@/lib/non-member-income.server").IncomeVerificationStatus,
        reconciliation_status: r.reconciliation_status as import("@/lib/non-member-income.server").IncomeReconciliationStatus,
        payment_date: r.payment_date,
        reference_suffix,
      });
    }

    return {
      items,
      total: count ?? null,
      limit,
      offset,
    };
  });


const DASHBOARD_SCAN_CAP = 5000;

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
  .handler(
    async ({
      data,
      context,
    }): Promise<import("@/lib/non-member-income.server").IncomeDashboardResult> => {
      const ctx = context as Ctx;
      await requireAdminAndPlan(ctx, data.societyId);
      let q = ctx.supabase
        .from("society_income_records")
        .select(
          "id, category_id, payer_kind, amount, payment_method, verification_status, reconciliation_status, payment_date",
        )
        .eq("society_id", data.societyId)
        .limit(DASHBOARD_SCAN_CAP);
      if (data.from_date) q = q.gte("payment_date", data.from_date);
      if (data.to_date) q = q.lte("payment_date", data.to_date);
      const { data: rows, error } = await q;
      if (error) throw new Error("dashboard_failed");

      type Row = {
        category_id: string;
        payer_kind: string;
        amount: number | string;
        payment_method: string;
        verification_status: string;
        reconciliation_status: string;
      };
      const typedRows = (rows ?? []) as Row[];

      let verifiedTotal = 0;
      let pendingCount = 0;
      let rejectedCount = 0;
      let reversedCount = 0;
      let unreconciled = 0;
      let needsReview = 0;
      const byCategory = new Map<string, number>();
      const byMethod = new Map<string, number>();
      const byReconciliation = new Map<string, number>();
      const { parseFinancialAmount } = await import("@/lib/non-member-income.server");
      for (const row of typedRows) {
        const v = row.verification_status;
        const rec = row.reconciliation_status;
        byReconciliation.set(rec, (byReconciliation.get(rec) ?? 0) + 1);
        if (v === "verified") {
          const amt = parseFinancialAmount(row.amount, { allowZero: true });
          if (amt === null) throw new Error("dashboard_failed");
          verifiedTotal += amt;
          byCategory.set(row.category_id, (byCategory.get(row.category_id) ?? 0) + amt);
          byMethod.set(row.payment_method, (byMethod.get(row.payment_method) ?? 0) + amt);
        } else if (v === "pending") pendingCount += 1;
        else if (v === "rejected") rejectedCount += 1;
        else if (v === "reversed") reversedCount += 1;
        if (rec === "unreconciled") unreconciled += 1;
        if (rec === "needs_review") needsReview += 1;
      }

      // Honest MetricState for the active payer count. A DB error must NOT
      // silently render as zero.
      let activePayerCount: import("@/lib/non-member-income.server").MetricState<number>;
      const payerRes = await ctx.supabase
        .from("non_member_payers")
        .select("id", { count: "exact", head: true })
        .eq("society_id", data.societyId)
        .eq("is_active", true);
      if (payerRes.error) {
        activePayerCount = {
          status: "error",
          message: "Active payer count is temporarily unavailable.",
        };
      } else {
        activePayerCount = { status: "available", value: payerRes.count ?? 0 };
      }

      return {
        verifiedTotal,
        pendingCount,
        rejectedCount,
        reversedCount,
        unreconciled,
        needsReview,
        activePayerCount,
        byCategory: Array.from(byCategory.entries()).map(([id, total]) => ({
          category_id: id,
          total,
        })),
        byMethod: Array.from(byMethod.entries()).map(([method, total]) => ({
          method:
            method as import("@/lib/non-member-income.server").IncomePaymentMethod,
          total,
        })),
        byReconciliation: Array.from(byReconciliation.entries()).map(
          ([status, count]) => ({
            status:
              status as import("@/lib/non-member-income.server").IncomeReconciliationStatus,
            count,
          }),
        ),
        recordCount: typedRows.length,
        truncated: typedRows.length >= DASHBOARD_SCAN_CAP,
        aggregateSource: "javascript_scan",
      };
    },
  );

export const getIncomeRecordDetailFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z.object({ societyId: z.string().uuid(), id: z.string().uuid() }).parse(raw),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<import("@/lib/non-member-income.server").IncomeRecordDetailResult> => {
      const ctx = context as Ctx;
      await requireAdminAndPlan(ctx, data.societyId);
      const { data: row, error } = await ctx.supabase
        .from("society_income_records")
        .select(
          "id, society_id, category_id, payer_kind, non_member_payer_id, amount, payment_method, payment_status, verification_status, reconciliation_status, payment_date, reference_number, description, created_at, verified_at, reversed_at, reversal_reason",
        )
        .eq("id", data.id)
        .maybeSingle();
      if (error) {
        return { status: "error", message: "record_fetch_failed" };
      }
      type Row = {
        id: string;
        society_id: string;
        category_id: string;
        payer_kind: string;
        non_member_payer_id: string | null;
        amount: number | string;
        payment_method: string;
        payment_status: string;
        verification_status: string;
        reconciliation_status: string;
        payment_date: string;
        reference_number: string | null;
        description: string | null;
        created_at: string;
        verified_at: string | null;
        reversed_at: string | null;
        reversal_reason: string | null;
      };
      const r = row as Row | null;
      // Same not-found shape for missing rows and for cross-society lookups.
      if (!r || r.society_id !== data.societyId) {
        return { status: "not_found" };
      }
      const [catRes, payerRes] = await Promise.all([
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
          : Promise.resolve({ data: null, error: null }),
      ]);
      // If either lookup errored (not merely absent), surface honestly instead
      // of silently rendering a record with missing labels.
      if (catRes.error || (payerRes as { error?: unknown }).error) {
        return { status: "error", message: "record_related_lookup_failed" };
      }
      const cat = catRes.data as
        | { display_name: string; category_group: string | null }
        | null;
      const payer = (payerRes as { data: unknown }).data as
        | { display_name: string; payer_type: string; organization_name: string | null }
        | null;

      const ref = typeof r.reference_number === "string" ? r.reference_number.trim() : "";
      const reference_suffix =
        ref.length === 0
          ? null
          : ref.length <= 4
            ? "•".repeat(ref.length)
            : `••••${ref.slice(-4)}`;

      const { parseFinancialAmount } = await import("@/lib/non-member-income.server");
      const parsedAmount = parseFinancialAmount(r.amount, { allowZero: true });
      if (parsedAmount === null) {
        return { status: "error", message: "record_amount_invalid" };
      }

      return {
        status: "available",
        record: {
          id: r.id,
          amount: parsedAmount,
          payer_kind: r.payer_kind as import("@/lib/non-member-income.server").IncomePayerKind,
          payment_method: r.payment_method as import("@/lib/non-member-income.server").IncomePaymentMethod,
          payment_status: r.payment_status,
          verification_status: r.verification_status as import("@/lib/non-member-income.server").IncomeVerificationStatus,
          reconciliation_status: r.reconciliation_status as import("@/lib/non-member-income.server").IncomeReconciliationStatus,
          payment_date: r.payment_date,
          reference_suffix,
          description:
            typeof r.description === "string" ? r.description.slice(0, 500) : null,
          created_at: r.created_at,
          verified_at: r.verified_at,
          reversed_at: r.reversed_at,
          reversal_reason:
            typeof r.reversal_reason === "string"
              ? r.reversal_reason.slice(0, 500)
              : null,
          category: cat ? { display_name: cat.display_name, group: cat.category_group } : null,
          payer: payer
            ? {
                display_name: payer.display_name,
                payer_type: payer.payer_type,
                organization_name: payer.organization_name,
              }
            : null,
        },
      };
    },
  );

// ---------------------------------------------------------------------------
// Turn 18B.2 — Atomic transition mutations (minimal input, RPC-backed)
// ---------------------------------------------------------------------------

import {
  IncomeTransitionReason,
  IncomeTransitionResultSchema,
  type IncomeTransitionResult,
} from "@/lib/non-member-income.server";

const RecordIdOnly = z.object({ recordId: z.string().uuid() });
const RecordIdWithReason = z.object({
  recordId: z.string().uuid(),
  reason: IncomeTransitionReason,
});

/**
 * Turn 18B.2A — server-side pre-authorization.
 *
 * We keep the wrapper's admin+plan check as *defense in depth* — the RPC now
 * independently enforces the same rules at the database layer — but any
 * failure returns the same non-enumerating `not_found` shape used by the
 * RPC, so callers cannot distinguish missing records from records they
 * simply cannot access. Basic / expired plan collapses to `plan_required`
 * only *after* society membership is established, matching the RPC.
 */
async function authorizeMutation(
  ctx: Ctx,
  recordId: string,
): Promise<
  | { ok: true; societyId: string }
  | { ok: false; result: IncomeTransitionResult }
> {
  const { data: row, error } = await ctx.supabase
    .from("society_income_records")
    .select("id, society_id")
    .eq("id", recordId)
    .maybeSingle();
  if (error) return { ok: false, result: { status: "error" } };
  const r = row as { society_id: string } | null;
  if (!r) return { ok: false, result: { status: "not_found" } };
  try {
    await assertSocietyAdmin(ctx, r.society_id);
  } catch {
    // Do not distinguish "exists but you can't see it" from "doesn't exist".
    return { ok: false, result: { status: "not_found" } };
  }
  try {
    await assertProPlan(ctx, r.society_id);
  } catch {
    return { ok: false, result: { status: "plan_required" } };
  }
  return { ok: true, societyId: r.society_id };
}

async function callTransitionRpc(
  ctx: Ctx,
  recordId: string,
  target: "verified" | "rejected" | "reversed",
  reason: string | null,
): Promise<IncomeTransitionResult> {
  const { data, error } = await ctx.supabase.rpc("transition_income_record", {
    _record_id: recordId,
    _target_status: target,
    _reason: reason,
  });
  if (error) return { status: "error" };
  const parsed = IncomeTransitionResultSchema.safeParse(data);
  if (!parsed.success) return { status: "error" };
  return parsed.data;
}

export const verifyIncomeRecordByIdFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => RecordIdOnly.parse(raw))
  .handler(async ({ data, context }): Promise<IncomeTransitionResult> => {
    const ctx = context as Ctx;
    const auth = await authorizeMutation(ctx, data.recordId);
    if (!auth.ok) return auth.result;
    return callTransitionRpc(ctx, data.recordId, "verified", null);
  });

export const rejectIncomeRecordByIdFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => RecordIdWithReason.parse(raw))
  .handler(async ({ data, context }): Promise<IncomeTransitionResult> => {
    const ctx = context as Ctx;
    const auth = await authorizeMutation(ctx, data.recordId);
    if (!auth.ok) return auth.result;
    return callTransitionRpc(ctx, data.recordId, "rejected", data.reason);
  });

export const reverseIncomeRecordByIdFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => RecordIdWithReason.parse(raw))
  .handler(async ({ data, context }): Promise<IncomeTransitionResult> => {
    const ctx = context as Ctx;
    const auth = await authorizeMutation(ctx, data.recordId);
    if (!auth.ok) return auth.result;
    return callTransitionRpc(ctx, data.recordId, "reversed", data.reason);
  });



