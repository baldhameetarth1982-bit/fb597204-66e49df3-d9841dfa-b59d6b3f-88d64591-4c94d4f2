/**
 * Flat 360 — typed server data service (ADMIN surface).
 *
 * Server-side authoritative behaviour:
 *   - authorization: society-scoped admin (`is_society_admin_for_internal`),
 *     block-scoped admin (`is_block_admin_for_flat_internal`), or super
 *     admin (`is_super_admin_internal`). Residents/guards denied.
 *   - plan derivation: society's `plan_id + plan_status` normalised on the
 *     server via `normalizePlan` (inactive → basic). Basic returns `locked`
 *     for all advanced sections and Pro queries are NOT executed.
 *   - PII minimization: default projections exclude phone, email, DOB,
 *     government IDs, bank details, and private storage URLs.
 *   - certificate secrets (token / token_hash / ciphertext / iv /
 *     key_version / QR payload / storage path) are NEVER included; the
 *     No-Dues section never touches the `no_dues_certificates` base table.
 *
 * The internal `loadFlat360Snapshot()` function is dependency-injected so
 * tests can exercise authorization, plan gating, and query-suppression
 * without a live database.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizePlan, type PlanKey } from "@/lib/plan-features";
import { buildUnitLabel } from "@/lib/unit-label";
import { buildUnitSummary, type Flat360SummaryInput } from "@/lib/unit-summary";
import {
  canViewAdvanced,
  deriveOccupancyKind,
  errorState,
  lockAdvancedForBasic,
  safeMethodLabel,
  safePaymentStatus,
  unsupported,
  type AdvancedFinancialSection,
  type ApprovalSummary,
  type BasicFinancialSection,
  type ComplaintSummary,
  type DocumentSummary,
  type FamilyMember,
  type Flat360Snapshot,
  type Flat360Viewer,
  type Flat360ViewerRole,
  type NoticeItem,
  type OccupancyHistoryItem,
  type SafeNoDuesSection,
  type SafePaymentItem,
  type SectionState,
  type VehicleItem,
  type VisitorSummary,
} from "@/lib/flat360-types";

const inputSchema = z.object({ flatId: z.string().uuid() });

/* ================================================================== */
/*  Row shapes and dependency contract (typed, no `any`)               */
/* ================================================================== */

export type FlatRow = {
  id: string;
  society_id: string;
  flat_number: string | null;
  floor: number | null;
  block_id: string | null;
  tenancy_type: string | null;
  block_name: string | null;
  society_name: string | null;
  society_plan_id: string | null;
  society_plan_status: string | null;
};

export type OccupantRow = {
  user_id: string;
  relationship: string | null;
  is_primary: boolean;
  is_active: boolean;
  moved_in_at: string | null;
  moved_out_at: string | null;
  display_name: string | null;
};

export type FamilyRow = {
  id: string;
  name: string;
  relationship: string | null;
};

export type BillRow = {
  id: string;
  bill_number: string | null;
  period_label: string | null;
  amount: number;
  due_date: string;
  status: string;
};

export type PaymentRow = {
  id: string;
  amount: number;
  method: string | null;
  status: string | null;
  paid_at: string | null;
};

export type VehicleRow = {
  id: string;
  number_plate: string | null;
  type: string | null;
  is_active: boolean | null;
};

export type EligibilityRow = {
  eligible: boolean;
  total_outstanding: number;
  pending_payment_total: number;
  counts: {
    overdue: number;
    partial: number;
    unpaid: number;
    pending_offline: number;
    unknown_status: number;
    inconsistent: number;
  };
  blockers: Array<{ type?: string; label?: string; message?: string; bill_number?: string | null }>;
};

const EligibilitySchema = z.object({
  eligible: z.boolean(),
  total_outstanding: z.coerce.number(),
  pending_payment_total: z.coerce.number(),
  counts: z.object({
    overdue: z.coerce.number().default(0),
    partial: z.coerce.number().default(0),
    unpaid: z.coerce.number().default(0),
    pending_offline: z.coerce.number().default(0),
    unknown_status: z.coerce.number().default(0),
    inconsistent: z.coerce.number().default(0),
  }),
  blockers: z
    .array(
      z.object({
        type: z.string().optional(),
        label: z.string().optional(),
        message: z.string().optional(),
        bill_number: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

export type QueryResult<T> = { data: T; error: null } | { data: null; error: string };

export type Flat360Deps = {
  fetchFlat(flatId: string): Promise<FlatRow | null>;
  fetchOccupants(flatId: string): Promise<QueryResult<OccupantRow[]>>;
  fetchFamily(flatId: string): Promise<QueryResult<FamilyRow[]>>;
  fetchBills(societyId: string, flatId: string): Promise<QueryResult<BillRow[]>>;
  fetchPayments(societyId: string, flatId: string): Promise<QueryResult<PaymentRow[]>>;
  fetchVehicles(flatId: string): Promise<QueryResult<VehicleRow[]>>;
  fetchHistory(flatId: string): Promise<QueryResult<OccupantRow[]>>;
  isSocietyAdmin(actorId: string, societyId: string): Promise<boolean>;
  isBlockAdminForFlat(actorId: string, flatId: string): Promise<boolean>;
  isSuperAdmin(actorId: string): Promise<boolean>;
  eligibility(
    societyId: string,
    flatId: string,
  ): Promise<{ data: EligibilityRow; error: null } | { data: null; error: string }>;
};

/* ================================================================== */
/*  Internal service — dependency-injected, test-first                 */
/* ================================================================== */

export async function loadFlat360Snapshot(input: {
  actorId: string;
  flatId: string;
  deps: Flat360Deps;
}): Promise<Flat360Snapshot> {
  const { actorId, flatId, deps } = input;

  /* 1. Identity ---------------------------------------------------- */
  const flatRow = await deps.fetchFlat(flatId);
  if (!flatRow) throw new Error("FLAT_NOT_FOUND");
  const societyId = flatRow.society_id;

  /* 2. Authorize --------------------------------------------------- */
  const [isSuper, isSocietyAdmin, isBlockAdmin] = await Promise.all([
    deps.isSuperAdmin(actorId),
    deps.isSocietyAdmin(actorId, societyId),
    deps.isBlockAdminForFlat(actorId, flatId),
  ]);
  if (!isSuper && !isSocietyAdmin && !isBlockAdmin) {
    throw new Error("NOT_AUTHORIZED");
  }
  const role: Flat360ViewerRole = isSuper
    ? "super_admin"
    : isSocietyAdmin
      ? "society_admin"
      : "block_admin";

  /* 3. Plan (server-derived, never client) ------------------------- */
  const plan: PlanKey = normalizePlan(flatRow.society_plan_id, flatRow.society_plan_status);
  const advanced = canViewAdvanced(plan);
  const viewer: Flat360Viewer = { role, plan, canViewAdvanced: advanced };

  /* 4. Identity + unit label -------------------------------------- */
  const unitLabel = buildUnitLabel({
    flat_number: flatRow.flat_number,
    floor: flatRow.floor,
    block_name: flatRow.block_name,
  });
  const isSerial = !flatRow.block_name && flatRow.floor == null;
  const identity = {
    id: flatRow.id,
    society_id: societyId,
    society_name: flatRow.society_name,
    block_id: flatRow.block_id,
    block_name: flatRow.block_name,
    flat_number: flatRow.flat_number,
    floor: flatRow.floor,
    tenancy_type: flatRow.tenancy_type,
    is_serial: isSerial,
    unit_label: unitLabel,
  };

  /* 5. Basic-tier reads (always) ---------------------------------- */
  const [occRes, famRes, billsRes, paymentsRes] = await Promise.all([
    deps.fetchOccupants(flatId),
    deps.fetchFamily(flatId),
    deps.fetchBills(societyId, flatId),
    deps.fetchPayments(societyId, flatId),
  ]);

  const occupants: OccupantRow[] = occRes.data ?? [];
  const residents = occupants.map((r) => ({
    display_name: r.display_name,
    relationship: r.relationship,
    is_primary: !!r.is_primary,
    is_active: !!r.is_active,
    moved_in_at: r.moved_in_at,
  }));
  const activeResidents = residents.filter((r) => r.is_active);
  const occupancy = {
    kind: deriveOccupancyKind(residents),
    active_count: activeResidents.length,
    residents,
  };

  const family: SectionState<FamilyMember[]> = famRes.error
    ? errorState<FamilyMember[]>(famRes.error)
    : (famRes.data ?? []).length === 0
      ? { status: "empty" }
      : {
          status: "available",
          data: (famRes.data ?? []).map((f) => ({
            id: f.id,
            name: f.name,
            relationship: f.relationship,
          })),
        };

  // Eligibility (canonical source for outstanding + counts).
  const eligRes = await deps.eligibility(societyId, flatId);
  const elig: EligibilityRow | null = eligRes.data;
  const eligError: string | null = eligRes.error;
  // Validate shape with Zod when present.
  const eligParsed = elig ? EligibilitySchema.safeParse(elig) : null;
  const eligOk = eligParsed?.success ? eligParsed.data : null;

  const bills: BillRow[] = billsRes.data ?? [];
  const payments: PaymentRow[] = paymentsRes.data ?? [];
  const now = new Date();
  const unpaidBills = bills.filter((b) => b.status === "unpaid");
  const overdueBills = unpaidBills.filter((b) => new Date(b.due_date) < now);

  const basicFinancial: BasicFinancialSection = {
    current_outstanding: eligOk ? eligOk.total_outstanding : 0,
    overdue_count: eligOk ? eligOk.counts.overdue : overdueBills.length,
    unpaid_count: eligOk ? eligOk.counts.unpaid : unpaidBills.length,
    latest_bill: bills[0]
      ? {
          id: bills[0].id,
          bill_number: bills[0].bill_number,
          period_label: bills[0].period_label,
          amount: Number(bills[0].amount ?? 0),
          due_date: bills[0].due_date,
          status: bills[0].status,
        }
      : null,
    recent_successful_payments: payments
      .filter((p) => safePaymentStatus(p.status) === "success")
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        amount: Number(p.amount ?? 0),
        paid_at: p.paid_at,
        method_label: safeMethodLabel(p.method),
      })),
  };

  /* 6. Advanced-tier reads — Pro/Premium only --------------------- */
  const [vehiclesRes, historyRes] = advanced
    ? await Promise.all([deps.fetchVehicles(flatId), deps.fetchHistory(flatId)])
    : [null, null];

  const advancedFinancial: SectionState<AdvancedFinancialSection> =
    lockAdvancedForBasic<AdvancedFinancialSection>(plan, () => {
      if (eligError && !eligOk) return errorState<AdvancedFinancialSection>(eligError);
      if (!eligOk) return unsupported<AdvancedFinancialSection>("Financial engine unavailable.");
      return {
        status: "available",
        data: {
          total_outstanding: eligOk.total_outstanding,
          pending_payment_total: eligOk.pending_payment_total,
          overdue_count: eligOk.counts.overdue,
          unpaid_count: eligOk.counts.unpaid,
          partial_count: eligOk.counts.partial,
          pending_verification_count: eligOk.counts.pending_offline,
          inconsistency_count: eligOk.counts.inconsistent + eligOk.counts.unknown_status,
          recent_bills: bills.slice(0, 10).map((b) => ({
            id: b.id,
            bill_number: b.bill_number,
            period_label: b.period_label,
            amount: Number(b.amount ?? 0),
            due_date: b.due_date,
            status: b.status,
          })),
          reconciliation_warnings:
            eligOk.counts.inconsistent > 0
              ? [`${eligOk.counts.inconsistent} bill(s) marked paid but with unpaid remainder.`]
              : [],
        },
      };
    });

  const paymentsSection: SectionState<SafePaymentItem[]> =
    lockAdvancedForBasic<SafePaymentItem[]>(plan, () => {
      if (paymentsRes.error) return errorState<SafePaymentItem[]>(paymentsRes.error);
      if (payments.length === 0) return { status: "empty" };
      return {
        status: "available",
        data: payments.map((p) => ({
          id: p.id,
          amount: Number(p.amount ?? 0),
          method_label: safeMethodLabel(p.method),
          status: safePaymentStatus(p.status),
          paid_at: p.paid_at,
        })),
      };
    });

  const vehicles: SectionState<VehicleItem[]> = lockAdvancedForBasic<VehicleItem[]>(plan, () => {
    if (!vehiclesRes) return unsupported<VehicleItem[]>("Vehicles unavailable.");
    if (vehiclesRes.error) return errorState<VehicleItem[]>(vehiclesRes.error);
    const rows = vehiclesRes.data ?? [];
    if (rows.length === 0) return { status: "empty" };
    return {
      status: "available",
      data: rows.map((v) => ({
        id: v.id,
        display_plate: String(v.number_plate ?? "").toUpperCase(),
        type: v.type,
        is_active: v.is_active ?? true,
      })),
    };
  });

  const occupancyHistory: SectionState<OccupancyHistoryItem[]> =
    lockAdvancedForBasic<OccupancyHistoryItem[]>(plan, () => {
      if (!historyRes) return unsupported<OccupancyHistoryItem[]>("Occupancy history unavailable.");
      if (historyRes.error) return errorState<OccupancyHistoryItem[]>(historyRes.error);
      const rows = historyRes.data ?? [];
      if (rows.length === 0) return { status: "empty" };
      return {
        status: "available",
        data: rows.map((r) => ({
          user_id: r.user_id,
          display_name: r.display_name,
          relationship: r.relationship,
          moved_in_at: r.moved_in_at,
          moved_out_at: r.moved_out_at,
          is_active: !!r.is_active,
        })),
      };
    });

  /* 7. Operational sections without stable backing → unsupported -- */
  const visitors: SectionState<VisitorSummary> = lockAdvancedForBasic<VisitorSummary>(plan, () =>
    unsupported<VisitorSummary>("Visitors section not backed yet."),
  );
  const complaints: SectionState<ComplaintSummary> = lockAdvancedForBasic<ComplaintSummary>(
    plan,
    () => unsupported<ComplaintSummary>("Complaints section not backed yet."),
  );
  const documents: SectionState<DocumentSummary> = lockAdvancedForBasic<DocumentSummary>(
    plan,
    () => unsupported<DocumentSummary>("Documents section not backed yet."),
  );
  const approvals: SectionState<ApprovalSummary> = lockAdvancedForBasic<ApprovalSummary>(
    plan,
    () => unsupported<ApprovalSummary>("Approvals section not backed yet."),
  );
  const notices: SectionState<NoticeItem[]> = lockAdvancedForBasic<NoticeItem[]>(plan, () =>
    unsupported<NoticeItem[]>("Notices section not backed yet."),
  );

  /* 8. Safe No-Dues — advanced only, never touches base table ----- */
  const noDues: SectionState<SafeNoDuesSection> = lockAdvancedForBasic<SafeNoDuesSection>(
    plan,
    () => {
      if (eligError && !eligOk) return errorState<SafeNoDuesSection>(eligError);
      if (!eligOk) return unsupported<SafeNoDuesSection>("No-Dues eligibility unavailable.");
      const blockerLabels = eligOk.blockers
        .map((b) =>
          typeof b.label === "string"
            ? b.label
            : typeof b.message === "string"
              ? b.message
              : typeof b.type === "string"
                ? b.type
                : null,
        )
        .filter((s): s is string => !!s && s.length < 160)
        .slice(0, 10);
      return {
        status: "available",
        data: {
          eligible: eligOk.eligible,
          total_outstanding: eligOk.total_outstanding,
          pending_payment_total: eligOk.pending_payment_total,
          blocker_count: eligOk.blockers.length,
          blocker_labels: blockerLabels,
          latest_request: null, // request/certificate metadata deferred to a dedicated safe RPC
          latest_certificate: null,
        },
      };
    },
  );

  /* 9. Deterministic summary — Pro/Premium only ------------------- */
  const financialStatus: "available" | "error" | "unsupported" = eligOk
    ? "available"
    : eligError
      ? "error"
      : "unsupported";
  const financialAvailability =
    financialStatus === "available"
      ? { status: "available" as const }
      : financialStatus === "error"
        ? { status: "error" as const, message: eligError ?? "Financial engine unavailable." }
        : { status: "unsupported" as const, message: "Financial engine unavailable." };

  const deterministicSummary: SectionState<ReturnType<typeof buildUnitSummary>> = advanced
    ? (() => {
        const summaryInput: Flat360SummaryInput = {
          unit_label: unitLabel,
          is_serial: isSerial,
          occupancy: { kind: occupancy.kind, active_count: occupancy.active_count },
          financial: {
            status: financialStatus,
            total_outstanding: eligOk ? eligOk.total_outstanding : 0,
            overdue_count: eligOk ? eligOk.counts.overdue : 0,
            partial_count: eligOk ? eligOk.counts.partial : 0,
            unpaid_count: eligOk ? eligOk.counts.unpaid : 0,
            pending_verification_count: eligOk ? eligOk.counts.pending_offline : 0,
            inconsistency_count: eligOk ? eligOk.counts.inconsistent + eligOk.counts.unknown_status : 0,
          },
          complaints: { status: "unsupported" },
          approvals: { status: "unsupported" },
          no_dues: eligOk
            ? {
                status: "available",
                eligible: eligOk.eligible,
                blocker_count: eligOk.blockers.length,
                latest_request_id: null,
              }
            : { status: "unavailable" },
          errors: eligError && !eligOk ? [eligError] : [],
        };
        return { status: "available", data: buildUnitSummary(summaryInput) };
      })()
    : { status: "locked", requiredPlan: "pro" };

  return {
    viewer,
    identity,
    occupancy,
    family,
    occupancyHistory,
    financialAvailability,
    basicFinancial,
    advancedFinancial,
    payments: paymentsSection,
    vehicles,
    visitors,
    complaints,
    documents,
    approvals,
    notices,
    noDues,
    deterministicSummary,
    aiSummary: { entitlement: advanced ? "available" : "locked" },
  };
}

/* ================================================================== */
/*  Real Supabase-backed deps                                          */
/* ================================================================== */

// Narrow Supabase-client shape we need — kept local so the module carries
// no `any` beyond a single typed cast at construction.
type SupabaseLike = {
  from(table: string): {
    select(query: string): {
      eq(col: string, val: string): {
        order?: (col: string, opts: { ascending: boolean; nullsFirst?: boolean }) => unknown;
        eq?: (col: string, val: string) => unknown;
        maybeSingle?: () => Promise<{ data: unknown; error: unknown }>;
        limit?: (n: number) => Promise<{ data: unknown; error: unknown }>;
      };
    };
  };
};

type RpcClient = {
  rpc(
    fn: string,
    args: Record<string, string>,
  ): Promise<{ data: unknown; error: unknown }>;
};

function errMsg(e: unknown): string {
  if (!e) return "Query failed";
  if (typeof e === "object" && e !== null && "message" in e) {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Query failed";
}

export function buildRealDeps(supabase: unknown): Flat360Deps {
  // Runtime narrows via method calls; typed as `unknown` and cast at use.
  const db = supabase as {
    from: (t: string) => {
      select: (q: string) => Record<string, (...a: unknown[]) => unknown>;
    };
  };

  const q = <T>(chain: unknown): Promise<QueryResult<T>> =>
    (chain as Promise<{ data: unknown; error: unknown }>).then((r) => {
      if (r.error) return { data: null, error: errMsg(r.error) } as const;
      return { data: (r.data ?? []) as T, error: null } as const;
    });

  return {
    async fetchFlat(flatId) {
      const chain = db
        .from("flats")
        .select(
          "id, society_id, flat_number, floor, block_id, tenancy_type, blocks(name), societies(name, plan_id, plan_status)",
        );
      const eq = (chain as unknown as { eq: (c: string, v: string) => unknown }).eq(
        "id",
        flatId,
      );
      const single = (eq as { maybeSingle: () => Promise<{ data: unknown; error: unknown }> })
        .maybeSingle;
      const { data, error } = await single.call(eq);
      if (error || !data) return null;
      const row = data as {
        id: string;
        society_id: string;
        flat_number: string | null;
        floor: number | null;
        block_id: string | null;
        tenancy_type: string | null;
        blocks: { name: string | null } | null;
        societies: { name: string | null; plan_id: string | null; plan_status: string | null } | null;
      };
      return {
        id: row.id,
        society_id: row.society_id,
        flat_number: row.flat_number,
        floor: row.floor,
        block_id: row.block_id,
        tenancy_type: row.tenancy_type,
        block_name: row.blocks?.name ?? null,
        society_name: row.societies?.name ?? null,
        society_plan_id: row.societies?.plan_id ?? null,
        society_plan_status: row.societies?.plan_status ?? null,
      };
    },
    async fetchOccupants(flatId) {
      const chain = db
        .from("flat_residents")
        .select(
          "user_id, relationship, is_primary, is_active, moved_in_at, moved_out_at, profiles:profiles(full_name)",
        );
      const eq = (chain as unknown as { eq: (c: string, v: string) => unknown }).eq(
        "flat_id",
        flatId,
      );
      const ordered = (
        eq as { order: (c: string, o: { ascending: boolean }) => unknown }
      ).order("is_active", { ascending: false });
      const ordered2 = (
        ordered as { order: (c: string, o: { ascending: boolean }) => unknown }
      ).order("moved_in_at", { ascending: false });
      const limited = (
        ordered2 as { limit: (n: number) => Promise<{ data: unknown; error: unknown }> }
      ).limit(20);
      const res = await limited;
      if (res.error) return { data: null, error: errMsg(res.error) };
      const rows = (res.data ?? []) as Array<{
        user_id: string;
        relationship: string | null;
        is_primary: boolean | null;
        is_active: boolean | null;
        moved_in_at: string | null;
        moved_out_at: string | null;
        profiles: { full_name: string | null } | null;
      }>;
      return {
        data: rows.map((r) => ({
          user_id: r.user_id,
          relationship: r.relationship,
          is_primary: !!r.is_primary,
          is_active: !!r.is_active,
          moved_in_at: r.moved_in_at,
          moved_out_at: r.moved_out_at,
          display_name: r.profiles?.full_name ?? null,
        })),
        error: null,
      };
    },
    async fetchFamily(flatId) {
      const chain = db.from("family_members").select("id, name, relationship");
      const eq = (chain as unknown as { eq: (c: string, v: string) => unknown }).eq(
        "flat_id",
        flatId,
      );
      const limited = (
        eq as { limit: (n: number) => Promise<{ data: unknown; error: unknown }> }
      ).limit(50);
      return q<FamilyRow[]>(limited);
    },
    async fetchBills(societyId, flatId) {
      const chain = db
        .from("bills")
        .select("id, bill_number, period_label, amount, due_date, status");
      const eq1 = (chain as unknown as { eq: (c: string, v: string) => unknown }).eq(
        "society_id",
        societyId,
      );
      const eq2 = (eq1 as { eq: (c: string, v: string) => unknown }).eq("flat_id", flatId);
      const ordered = (
        eq2 as { order: (c: string, o: { ascending: boolean }) => unknown }
      ).order("due_date", { ascending: false });
      const limited = (
        ordered as { limit: (n: number) => Promise<{ data: unknown; error: unknown }> }
      ).limit(10);
      return q<BillRow[]>(limited);
    },
    async fetchPayments(societyId, flatId) {
      const chain = db.from("payments").select("id, amount, method, status, paid_at");
      const eq1 = (chain as unknown as { eq: (c: string, v: string) => unknown }).eq(
        "society_id",
        societyId,
      );
      const eq2 = (eq1 as { eq: (c: string, v: string) => unknown }).eq("flat_id", flatId);
      const ordered = (
        eq2 as {
          order: (c: string, o: { ascending: boolean; nullsFirst?: boolean }) => unknown;
        }
      ).order("paid_at", { ascending: false, nullsFirst: false });
      const limited = (
        ordered as { limit: (n: number) => Promise<{ data: unknown; error: unknown }> }
      ).limit(10);
      return q<PaymentRow[]>(limited);
    },
    async fetchVehicles(flatId) {
      const chain = db.from("vehicles").select("id, number_plate, type, is_active");
      const eq = (chain as unknown as { eq: (c: string, v: string) => unknown }).eq(
        "flat_id",
        flatId,
      );
      const limited = (
        eq as { limit: (n: number) => Promise<{ data: unknown; error: unknown }> }
      ).limit(20);
      return q<VehicleRow[]>(limited);
    },
    async fetchHistory(flatId) {
      const chain = db
        .from("flat_residents")
        .select(
          "user_id, relationship, is_primary, is_active, moved_in_at, moved_out_at, profiles:profiles(full_name)",
        );
      const eq = (chain as unknown as { eq: (c: string, v: string) => unknown }).eq(
        "flat_id",
        flatId,
      );
      const ordered = (
        eq as { order: (c: string, o: { ascending: boolean }) => unknown }
      ).order("moved_in_at", { ascending: false });
      const limited = (
        ordered as { limit: (n: number) => Promise<{ data: unknown; error: unknown }> }
      ).limit(30);
      const res = await limited;
      if (res.error) return { data: null, error: errMsg(res.error) };
      const rows = (res.data ?? []) as Array<{
        user_id: string;
        relationship: string | null;
        is_primary: boolean | null;
        is_active: boolean | null;
        moved_in_at: string | null;
        moved_out_at: string | null;
        profiles: { full_name: string | null } | null;
      }>;
      return {
        data: rows.map((r) => ({
          user_id: r.user_id,
          relationship: r.relationship,
          is_primary: !!r.is_primary,
          is_active: !!r.is_active,
          moved_in_at: r.moved_in_at,
          moved_out_at: r.moved_out_at,
          display_name: r.profiles?.full_name ?? null,
        })),
        error: null,
      };
    },
    async isSocietyAdmin() {
      return false;
    },
    async isBlockAdminForFlat() {
      return false;
    },
    async isSuperAdmin() {
      return false;
    },
    async eligibility() {
      return { data: null, error: "eligibility not wired" };
    },
  };
}

export function attachAdminRpcs(deps: Flat360Deps, admin: RpcClient): Flat360Deps {
  const callBool = async (fn: string, args: Record<string, string>): Promise<boolean> => {
    try {
      const { data, error } = await admin.rpc(fn, args);
      if (error) return false;
      return !!data;
    } catch {
      return false;
    }
  };
  return {
    ...deps,
    isSocietyAdmin(actorId, societyId) {
      return callBool("is_society_admin_for_internal", {
        _actor_id: actorId,
        _society_id: societyId,
      });
    },
    isBlockAdminForFlat(actorId, flatId) {
      return callBool("is_block_admin_for_flat_internal", {
        _actor_id: actorId,
        _flat_id: flatId,
      });
    },
    isSuperAdmin(actorId) {
      return callBool("is_super_admin_internal", { _actor_id: actorId });
    },
    async eligibility(societyId, flatId) {
      try {
        const { data, error } = await admin.rpc("compute_no_dues_eligibility_internal", {
          _society_id: societyId,
          _flat_id: flatId,
        });
        if (error) return { data: null, error: errMsg(error) };
        const parsed = EligibilitySchema.safeParse(data);
        if (!parsed.success) {
          return { data: null, error: "Invalid eligibility payload" };
        }
        return { data: parsed.data as EligibilityRow, error: null };
      } catch (e) {
        return { data: null, error: errMsg(e) };
      }
    },
  };
}

/* ================================================================== */
/*  Exported server function                                           */
/* ================================================================== */

export const getFlat360 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => inputSchema.parse(raw))
  .handler(async ({ data, context }): Promise<Flat360Snapshot> => {
    const { supabase, userId } = context as { supabase: unknown; userId: string };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const deps = attachAdminRpcs(
      buildRealDeps(supabase),
      supabaseAdmin as unknown as RpcClient,
    );
    return loadFlat360Snapshot({ actorId: userId, flatId: data.flatId, deps });
  });

// Suppress noUnusedLocals for helper type kept for future use.
export type { SupabaseLike };
