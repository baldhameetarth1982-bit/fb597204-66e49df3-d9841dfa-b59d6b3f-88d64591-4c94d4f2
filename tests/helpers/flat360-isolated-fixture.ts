import {
  attachAuthorizationRpcs,
  loadFlat360Snapshot,
  type EligibilityRow,
  type Flat360Deps,
  type FlatRow,
} from "../../src/lib/flat360.functions";

export const IDS = Object.freeze({
  societyA: "00000000-0000-4000-8000-00000000000a",
  societyB: "00000000-0000-4000-8000-00000000000b",
  flatA: "10000000-0000-4000-8000-00000000000a",
  flatA2: "10000000-0000-4000-8000-00000000001a",
  flatB: "10000000-0000-4000-8000-00000000000b",
  adminA: "20000000-0000-4000-8000-00000000000a",
  adminB: "20000000-0000-4000-8000-00000000000b",
  blockAdminA: "30000000-0000-4000-8000-00000000000a",
  residentA: "40000000-0000-4000-8000-00000000000a",
  residentB: "40000000-0000-4000-8000-00000000000b",
  guardA: "50000000-0000-4000-8000-00000000000a",
  blockA: "60000000-0000-4000-8000-00000000000a",
  blockA2: "60000000-0000-4000-8000-00000000001a",
  familyA: "70000000-0000-4000-8000-00000000000a",
  familyB: "70000000-0000-4000-8000-00000000000b",
  billA: "80000000-0000-4000-8000-00000000000a",
  billB: "80000000-0000-4000-8000-00000000000b",
  paymentA: "90000000-0000-4000-8000-00000000000a",
  paymentB: "90000000-0000-4000-8000-00000000000b",
  vehicleA: "a0000000-0000-4000-8000-00000000000a",
  vehicleB: "a0000000-0000-4000-8000-00000000000b",
});

type Role = "society_admin" | "block_admin" | "resident" | "guard";
type Actor = { societyId: string; role: Role; blockIds: string[] };

const actors = new Map<string, Actor>([
  [IDS.adminA, { societyId: IDS.societyA, role: "society_admin", blockIds: [] }],
  [IDS.adminB, { societyId: IDS.societyB, role: "society_admin", blockIds: [] }],
  [IDS.blockAdminA, { societyId: IDS.societyA, role: "block_admin", blockIds: [IDS.blockA] }],
  [IDS.residentA, { societyId: IDS.societyA, role: "resident", blockIds: [] }],
  [IDS.residentB, { societyId: IDS.societyB, role: "resident", blockIds: [] }],
  [IDS.guardA, { societyId: IDS.societyA, role: "guard", blockIds: [] }],
]);

const flats = new Map<string, FlatRow>([
  [IDS.flatA, {
    id: IDS.flatA, society_id: IDS.societyA, flat_number: "A-101", floor: 1,
    block_id: IDS.blockA, tenancy_type: "owner", block_name: "Synthetic Tower A",
    society_name: "Synthetic Society A", society_plan_id: "pro", society_plan_status: "active",
    society_trial_ends_at: null, society_status: "active",
  }],
  [IDS.flatA2, {
    id: IDS.flatA2, society_id: IDS.societyA, flat_number: "B-201", floor: 2,
    block_id: IDS.blockA2, tenancy_type: "tenant", block_name: "Synthetic Tower B",
    society_name: "Synthetic Society A", society_plan_id: "basic", society_plan_status: "active",
    society_trial_ends_at: null, society_status: "active",
  }],
  [IDS.flatB, {
    id: IDS.flatB, society_id: IDS.societyB, flat_number: "12", floor: null,
    block_id: null, tenancy_type: "owner", block_name: null,
    society_name: "Synthetic Society B", society_plan_id: "pro", society_plan_status: "active",
    society_trial_ends_at: null, society_status: "active",
  }],
]);

const eligibility = (outstanding: number): EligibilityRow => ({
  eligible: outstanding === 0,
  total_outstanding: outstanding,
  pending_payment_total: 0,
  counts: { overdue: outstanding ? 1 : 0, partial: 0, unpaid: outstanding ? 1 : 0, pending_offline: 0, unknown_status: 0, inconsistent: 0 },
  blockers: outstanding ? [{ type: "unpaid", label: "Outstanding maintenance" }] : [],
});

export type SyntheticFlat360Fixture = ReturnType<typeof createSyntheticFlat360Fixture>;

export function createSyntheticFlat360Fixture(options: { queryError?: boolean } = {}) {
  const calls: Array<{ operation: string; actorId?: string; societyId?: string; flatId?: string }> = [];
  const byFlat = <T>(flatId: string, a: T[], b: T[]) => flatId === IDS.flatA ? a : flatId === IDS.flatB ? b : [];
  const success = <T>(data: T) => ({ data, error: null } as const);
  const failed = <T>() => ({ data: null, error: "synthetic_query_failure" } as const satisfies { data: T | null; error: string | null });

  const deps: Flat360Deps = {
    async fetchFlat(flatId) {
      calls.push({ operation: "fetchFlat", flatId });
      return flats.get(flatId) ?? null;
    },
    async fetchOccupants(flatId) {
      calls.push({ operation: "fetchOccupants", flatId });
      return success(byFlat(flatId,
        [{ user_id: IDS.residentA, relationship: "owner", is_primary: true, is_active: true, moved_in_at: "2026-01-01", moved_out_at: null, display_name: "Synthetic Resident A" }],
        [{ user_id: IDS.residentB, relationship: "owner", is_primary: true, is_active: true, moved_in_at: "2026-01-01", moved_out_at: null, display_name: "Synthetic Resident B" }],
      ));
    },
    async fetchFamily(flatId) {
      calls.push({ operation: "fetchFamily", flatId });
      if (options.queryError) return failed();
      return success(byFlat(flatId,
        [{ id: IDS.familyA, name: "Synthetic Family A", relationship: "family" }],
        [{ id: IDS.familyB, name: "Synthetic Family B", relationship: "family" }],
      ));
    },
    async fetchBills(societyId, flatId) {
      calls.push({ operation: "fetchBills", societyId, flatId });
      if (societyId !== flats.get(flatId)?.society_id) return success([]);
      return success(byFlat(flatId,
        [{ id: IDS.billA, bill_number: "SYN-A-1", period_label: "Synthetic A", amount: 1100, due_date: "2026-01-01", status: "unpaid" }],
        [{ id: IDS.billB, bill_number: "SYN-B-1", period_label: "Synthetic B", amount: 2200, due_date: "2026-01-01", status: "unpaid" }],
      ));
    },
    async fetchPayments(societyId, flatId) {
      calls.push({ operation: "fetchPayments", societyId, flatId });
      if (societyId !== flats.get(flatId)?.society_id) return success([]);
      return success(byFlat(flatId,
        [{ id: IDS.paymentA, amount: 500, method: "bank_transfer", status: "success", paid_at: "2026-01-02" }],
        [{ id: IDS.paymentB, amount: 700, method: "cash", status: "success", paid_at: "2026-01-02" }],
      ));
    },
    async fetchVehicles(flatId) {
      calls.push({ operation: "fetchVehicles", flatId });
      return success(byFlat(flatId,
        [{ id: IDS.vehicleA, number_plate: "SYN-A-01", type: "car", is_active: true }],
        [{ id: IDS.vehicleB, number_plate: "SYN-B-01", type: "car", is_active: true }],
      ));
    },
    async fetchHistory(flatId) {
      calls.push({ operation: "fetchHistory", flatId });
      return success(byFlat(flatId,
        [{ user_id: IDS.residentA, relationship: "owner", is_primary: true, is_active: true, moved_in_at: "2026-01-01", moved_out_at: null, display_name: "Synthetic Resident A" }],
        [{ user_id: IDS.residentB, relationship: "owner", is_primary: true, is_active: true, moved_in_at: "2026-01-01", moved_out_at: null, display_name: "Synthetic Resident B" }],
      ));
    },
    async isSocietyAdmin(actorId, societyId) {
      calls.push({ operation: "isSocietyAdmin", actorId, societyId });
      const actor = actors.get(actorId);
      return actor?.role === "society_admin" && actor.societyId === societyId;
    },
    async isBlockAdminForFlat(actorId, flatId) {
      calls.push({ operation: "isBlockAdminForFlat", actorId, flatId });
      const actor = actors.get(actorId);
      const flat = flats.get(flatId);
      return actor?.role === "block_admin" && !!flat?.block_id && actor.societyId === flat.society_id && actor.blockIds.includes(flat.block_id);
    },
    async isSuperAdmin() { return false; },
    async eligibility(societyId, flatId) {
      calls.push({ operation: "eligibility", societyId, flatId });
      if (societyId !== flats.get(flatId)?.society_id) return { data: null, error: "tenant_mismatch" };
      return success(eligibility(flatId === IDS.flatA ? 600 : flatId === IDS.flatB ? 1500 : 0));
    },
  };

  return {
    calls,
    deps,
    load(actorId: string, flatId: string) {
      return loadFlat360Snapshot({ actorId, flatId, deps });
    },
    attachRpcProbe(actorId: string, allowedSocietyId: string, allowedFlatId: string) {
      const invocations: Array<{ fn: string; args: Record<string, string> }> = [];
      const probed = attachAuthorizationRpcs(deps, {
        async rpc(fn, args) {
          invocations.push({ fn, args });
          if (fn === "current_user_is_society_admin_for") return { data: actors.get(actorId)?.role === "society_admin" && args._society_id === allowedSocietyId, error: null };
          if (fn === "current_user_can_manage_flat") return { data: actors.get(actorId)?.role === "block_admin" && args._flat_id === allowedFlatId, error: null };
          if (fn === "current_user_is_super_admin") return { data: false, error: null };
          return { data: false, error: null };
        },
      }, {
        async rpc() {
          return { data: eligibility(0), error: null };
        },
      });
      return { probed, invocations };
    },
  };
}