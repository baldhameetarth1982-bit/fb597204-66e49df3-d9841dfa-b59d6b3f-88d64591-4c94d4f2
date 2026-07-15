/**
 * Flat 360 — typed server data service (ADMIN surface only).
 *
 * Server-side authoritative behaviour:
 *   - authorization: society-scoped admin via `is_society_admin_for_internal`
 *     (service-role trusted-actor helper) or `is_super_admin_internal`;
 *     residents are denied.
 *   - plan derivation: society's `plan_id + plan_status` normalised on the
 *     server (never trusted from the client); Basic gets `locked` for all
 *     advanced sections and Pro queries are NOT executed.
 *   - PII minimization: default projections exclude phone, email, DOB,
 *     government IDs, bank details, and private storage URLs.
 *   - certificate secrets (token / token_hash / ciphertext / iv /
 *     key_version / QR payload / storage path) are NEVER included.
 *
 * NOTE on block-admin scope: the `user_roles` table today has no `block_id`
 * column, so `is_society_admin_for_internal` only enforces society scope.
 * Tightening to block scope requires a schema addition and is tracked in
 * docs/NEXT_STAGES.md — this file does not fabricate a scope check the DB
 * cannot enforce.
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
  type BasicFinancialSection,
  type Flat360Snapshot,
  type Flat360Viewer,
  type Flat360ViewerRole,
  type SafeNoDuesSection,
  type SectionState,
} from "@/lib/flat360-types";

const inputSchema = z.object({ flatId: z.string().uuid() });

/* ------------------------------------------------------------------ */
/*  Server function                                                    */
/* ------------------------------------------------------------------ */

export const getFlat360 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => inputSchema.parse(raw))
  .handler(async ({ data, context }): Promise<Flat360Snapshot> => {
    const { supabase, userId } = context as { supabase: unknown; userId: string };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = supabase as any; // narrow surface used below is checked field-by-field.
    const flatId = data.flatId;

    /* 1. Load identity + derive society ------------------------------ */
    const { data: flatRow, error: flatErr } = await db
      .from("flats")
      .select("id, society_id, flat_number, floor, block_id, tenancy_type, blocks(name), societies(name, plan_id, plan_status)")
      .eq("id", flatId)
      .maybeSingle();
    if (flatErr || !flatRow) throw new Error("FLAT_NOT_FOUND");

    const societyId: string = flatRow.society_id;
    const blockName: string | null = flatRow.blocks?.name ?? null;
    const societyName: string | null = flatRow.societies?.name ?? null;

    /* 2. Authorize (society-scoped admin OR super admin) ------------- */
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const adminRpc = supabaseAdmin.rpc as any;
    const [adminRes, superRes] = await Promise.all([
      adminRpc("is_society_admin_for_internal", { _actor_id: userId, _society_id: societyId }),
      adminRpc("is_super_admin_internal", { _actor_id: userId }),
    ]);
    const isSocietyAdmin = !!adminRes.data;
    const isSuperAdmin = !!superRes.data;
    if (!isSocietyAdmin && !isSuperAdmin) throw new Error("NOT_AUTHORIZED");

    /* 3. Derive plan on the SERVER (never trust client) -------------- */
    const plan: PlanKey = normalizePlan(
      flatRow.societies?.plan_id ?? null,
      flatRow.societies?.plan_status ?? null,
    );
    const advanced = canViewAdvanced(plan);

    // super_admin viewers see the same section shape but are not treated
    // as "block_admin"; role is a display hint only.
    const role: Flat360ViewerRole = isSuperAdmin ? "super_admin" : "society_admin";
    const viewer: Flat360Viewer = { role, plan, canViewAdvanced: advanced };

    /* 4. Identity + unit label --------------------------------------- */
    const unitLabel = buildUnitLabel({
      flat_number: flatRow.flat_number,
      floor: flatRow.floor,
      block_name: blockName,
    });
    const isSerial = !blockName && flatRow.floor == null;
    const identity = {
      id: flatRow.id as string,
      society_id: societyId,
      society_name: societyName,
      block_id: (flatRow.block_id as string | null) ?? null,
      block_name: blockName,
      flat_number: (flatRow.flat_number as string | null) ?? null,
      floor: (flatRow.floor as number | null) ?? null,
      tenancy_type: (flatRow.tenancy_type as string | null) ?? null,
      is_serial: isSerial,
      unit_label: unitLabel,
    };

    /* 5. Basic-tier data (always fetched) ---------------------------- */
    const [occupantsRes, familyRes, billsRes, paymentsRes] = await Promise.all([
      db
        .from("flat_residents")
        .select("user_id, relationship, is_primary, is_active, moved_in_at, moved_out_at, profiles:profiles(full_name)")
        .eq("flat_id", flatId)
        .order("is_active", { ascending: false })
        .order("moved_in_at", { ascending: false })
        .limit(20),
      db.from("family_members").select("id, name, relationship").eq("flat_id", flatId).limit(50),
      db
        .from("bills")
        .select("id, bill_number, period_label, amount, due_date, status")
        .eq("society_id", societyId)
        .eq("flat_id", flatId)
        .order("due_date", { ascending: false })
        .limit(10),
      db
        .from("payments")
        .select("id, amount, method, status, paid_at")
        .eq("society_id", societyId)
        .eq("flat_id", flatId)
        .order("paid_at", { ascending: false, nullsFirst: false })
        .limit(10),
    ]);

    // Occupancy — always PII-minimised (no phone/email).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawOccupants: any[] = occupantsRes.data ?? [];
    const residents = rawOccupants.map((r) => ({
      display_name: r.profiles?.full_name ?? null,
      relationship: r.relationship ?? null,
      is_primary: !!r.is_primary,
      is_active: !!r.is_active,
      moved_in_at: r.moved_in_at ?? null,
    }));
    const activeResidents = residents.filter((r) => r.is_active);
    const occupancy = {
      kind: deriveOccupancyKind(residents),
      active_count: activeResidents.length,
      residents,
    };

    const family: SectionState<Array<{ id: string; name: string; relationship: string | null }>> =
      familyRes.error
        ? errorState("Family list unavailable.")
        : (familyRes.data ?? []).length === 0
          ? { status: "empty" }
          : {
              status: "available",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              data: (familyRes.data as any[]).map((f) => ({
                id: f.id as string,
                name: f.name as string,
                relationship: (f.relationship as string | null) ?? null,
              })),
            };

    // Basic financial (safe subset).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bills: any[] = billsRes.data ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payments: any[] = paymentsRes.data ?? [];
    const now = new Date();
    const unpaidBills = bills.filter((b) => b.status === "unpaid");
    const overdueBills = unpaidBills.filter((b) => new Date(b.due_date) < now);

    // Eligibility via canonical DB function (source of truth for outstanding).
    type EligibilityRow = {
      total_outstanding?: number;
      pending_payment_total?: number;
      eligible?: boolean;
      blockers?: Array<{ label?: string; message?: string }>;
    };
    let elig: EligibilityRow | null = null;
    try {
      const { data: eligData } = await adminRpc("compute_no_dues_eligibility_internal", {
        _society_id: societyId,
        _flat_id: flatId,
      });
      elig = (eligData as EligibilityRow | null) ?? null;
    } catch {
      elig = null;
    }

    const basicFinancial: BasicFinancialSection = {
      current_outstanding: Number(elig?.total_outstanding ?? 0),
      overdue_count: overdueBills.length,
      unpaid_count: unpaidBills.length,
      latest_bill: bills[0]
        ? {
            id: bills[0].id,
            bill_number: bills[0].bill_number ?? null,
            period_label: bills[0].period_label ?? null,
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
          paid_at: p.paid_at ?? null,
          method_label: safeMethodLabel(p.method),
        })),
    };

    /* 6. Advanced-tier data — only when plan allows ------------------ */
    const advancedFinancial = lockAdvancedForBasic<AdvancedFinancialSection>(plan, () => {
      const partialCount = bills.filter((b) => b.status === "partial").length;
      const pendingVerificationCount = payments.filter(
        (p) => safePaymentStatus(p.status) === "pending",
      ).length;
      return {
        status: "available",
        data: {
          total_outstanding: Number(elig?.total_outstanding ?? 0),
          pending_payment_total: Number(elig?.pending_payment_total ?? 0),
          overdue_count: overdueBills.length,
          unpaid_count: unpaidBills.length,
          partial_count: partialCount,
          pending_verification_count: pendingVerificationCount,
          inconsistency_count: 0, // reconciliation engine lands in a later stage
          recent_bills: bills.slice(0, 10).map((b) => ({
            id: b.id,
            bill_number: b.bill_number ?? null,
            period_label: b.period_label ?? null,
            amount: Number(b.amount ?? 0),
            due_date: b.due_date,
            status: b.status,
          })),
          reconciliation_warnings: [],
        },
      };
    });

    const paymentsSection: SectionState<import("@/lib/flat360-types").SafePaymentItem[]> =
      lockAdvancedForBasic<import("@/lib/flat360-types").SafePaymentItem[]>(plan, () => {
        if (payments.length === 0) return { status: "empty" };
        return {
          status: "available",
          data: payments.map((p) => ({
            id: p.id as string,
            amount: Number(p.amount ?? 0),
            method_label: safeMethodLabel(p.method),
            status: safePaymentStatus(p.status),
            paid_at: (p.paid_at as string | null) ?? null,
          })),
        };
      });

    // Vehicles + occupancy history — real queries when Pro.
    const [vehiclesRes, historyRes] = advanced
      ? await Promise.all([
          db
            .from("vehicles")
            .select("id, number_plate, type, is_active")
            .eq("flat_id", flatId)
            .limit(20),
          db
            .from("flat_residents")
            .select("user_id, relationship, is_active, moved_in_at, moved_out_at, profiles:profiles(full_name)")
            .eq("flat_id", flatId)
            .order("moved_in_at", { ascending: false })
            .limit(30),
        ])
      : [null, null];

    const vehicles: SectionState<import("@/lib/flat360-types").VehicleItem[]> =
      lockAdvancedForBasic<import("@/lib/flat360-types").VehicleItem[]>(plan, () => {
        if (!vehiclesRes) return unsupported("Vehicles unavailable.");
        if (vehiclesRes.error) return errorState("Vehicles could not be loaded.");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (vehiclesRes.data ?? []) as any[];
        if (rows.length === 0) return { status: "empty" };
        return {
          status: "available",
          data: rows.map((v) => ({
            id: v.id as string,
            display_plate: String(v.number_plate ?? "").toUpperCase(),
            type: (v.type as string | null) ?? null,
            is_active: v.is_active ?? true,
          })),
        };
      });

    const occupancyHistory: SectionState<import("@/lib/flat360-types").OccupancyHistoryItem[]> =
      lockAdvancedForBasic<import("@/lib/flat360-types").OccupancyHistoryItem[]>(plan, () => {
        if (!historyRes) return unsupported("Occupancy history unavailable.");
        if (historyRes.error) return errorState("Occupancy history could not be loaded.");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows = (historyRes.data ?? []) as any[];
        if (rows.length === 0) return { status: "empty" };
        return {
          status: "available",
          data: rows.map((r) => ({
            user_id: r.user_id as string,
            display_name: (r.profiles?.full_name as string | null) ?? null,
            relationship: (r.relationship as string | null) ?? null,
            moved_in_at: (r.moved_in_at as string | null) ?? null,
            moved_out_at: (r.moved_out_at as string | null) ?? null,
            is_active: !!r.is_active,
          })),
        };
      });

    /* 7. Operational sections without stable backing → unsupported --- */
    const visitors: SectionState<import("@/lib/flat360-types").VisitorSummary> =
      lockAdvancedForBasic<import("@/lib/flat360-types").VisitorSummary>(plan, () =>
        unsupported("Visitors section not backed yet."),
      );
    const complaints: SectionState<import("@/lib/flat360-types").ComplaintSummary> =
      lockAdvancedForBasic<import("@/lib/flat360-types").ComplaintSummary>(plan, () =>
        unsupported("Complaints section not backed yet."),
      );
    const documents: SectionState<import("@/lib/flat360-types").DocumentSummary> =
      lockAdvancedForBasic<import("@/lib/flat360-types").DocumentSummary>(plan, () =>
        unsupported("Documents section not backed yet."),
      );
    const approvals: SectionState<import("@/lib/flat360-types").ApprovalSummary> =
      lockAdvancedForBasic<import("@/lib/flat360-types").ApprovalSummary>(plan, () =>
        unsupported("Approvals section not backed yet."),
      );
    const notices: SectionState<import("@/lib/flat360-types").NoticeItem[]> =
      lockAdvancedForBasic<import("@/lib/flat360-types").NoticeItem[]>(plan, () =>
        unsupported("Notices section not backed yet."),
      );

    /* 8. Safe No-Dues section --------------------------------------- */
    const noDues: SectionState<SafeNoDuesSection> = lockAdvancedForBasic<SafeNoDuesSection>(
      plan,
      () => {
        if (!elig) return unsupported<SafeNoDuesSection>("No-Dues eligibility unavailable.");
        const blockers = Array.isArray(elig.blockers) ? elig.blockers : [];
        const blockerLabels = blockers
          .map((b) => (typeof b?.label === "string" ? b.label : typeof b?.message === "string" ? b.message : null))
          .filter((s): s is string => !!s && s.length < 160)
          .slice(0, 10);
        return {
          status: "available",
          data: {
            eligible: !!elig.eligible,
            total_outstanding: Number(elig.total_outstanding ?? 0),
            pending_payment_total: Number(elig.pending_payment_total ?? 0),
            blocker_count: blockers.length,
            blocker_labels: blockerLabels,
            latest_request: null,
            latest_certificate: null,
          },
        };
      },
    );

    /* 9. Deterministic summary -------------------------------------- */
    const deterministicInput: Flat360SummaryInput = {
      unit_label: unitLabel,
      is_serial: isSerial,
      occupancy: { kind: occupancy.kind, active_count: occupancy.active_count },
      financial: {
        total_outstanding: Number(elig?.total_outstanding ?? 0),
        overdue_count: overdueBills.length,
        partial_count: bills.filter((b) => b.status === "partial").length,
        unpaid_count: unpaidBills.length,
        pending_verification_count: payments.filter((p) => safePaymentStatus(p.status) === "pending").length,
        inconsistency_count: 0,
      },
      complaints: advanced ? { status: "unsupported" } : { status: "locked" },
      approvals: advanced ? { status: "unsupported" } : { status: "locked" },
      no_dues:
        advanced && elig
          ? { status: "available", eligible: !!elig.eligible, blocker_count: (elig.blockers ?? []).length, latest_request_id: null }
          : { status: "unavailable" },
      errors: [],
    };
    const deterministicSummary: SectionState<ReturnType<typeof buildUnitSummary>> = {
      status: "available",
      data: buildUnitSummary(deterministicInput),
    };

    return {
      viewer,
      identity,
      occupancy,
      family,
      occupancyHistory,
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
  });
