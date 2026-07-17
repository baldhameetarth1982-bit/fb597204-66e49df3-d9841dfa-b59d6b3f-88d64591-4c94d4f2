/**
 * Stage 2D closure — behavioral tests for the commit RPC adapter.
 *
 * Exercises the real `_commitMigrationJobViaRpc` against a mocked supabase
 * client so we assert the observable contract (status parsing, result
 * shape, idempotency handoff, error surfacing) — not source strings.
 */
import { describe, expect, it, vi } from "vitest";
import { _commitMigrationJobViaRpc } from "@/lib/migration.functions";

const validInput = {
  job_id: "00000000-0000-0000-0000-000000000001",
  creation_request_id: "req-abcdef123456",
  expected_checksum: "checksum-value",
  confirm: true as const,
};

function client(rpcImpl: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>) {
  return { rpc: vi.fn(rpcImpl) };
}

describe("Stage 2D — commit RPC adapter behavior", () => {
  it("dispatches to commit_migration_job with correct arguments", async () => {
    const c = client(async () => ({
      data: { status: "completed", result: { total_committed: 3 } },
      error: null,
    }));
    await _commitMigrationJobViaRpc(c, validInput);
    expect(c.rpc).toHaveBeenCalledWith("commit_migration_job", {
      _job_id: validInput.job_id,
      _request_id: validInput.creation_request_id,
      _expected_checksum: validInput.expected_checksum,
    });
  });

  it("returns full people counts on completed", async () => {
    const c = client(async () => ({
      data: {
        status: "completed",
        result: {
          structures_created: 1,
          structures_matched: 0,
          units_created: 4,
          units_matched: 0,
          residents_created: 5,
          residents_matched: 2,
          occupancies_created: 7,
          family_created: 3,
          vehicles_created: 2,
          skipped: 0,
          total_committed: 24,
        },
      },
      error: null,
    }));
    const res = await _commitMigrationJobViaRpc(c, validInput);
    expect(res.status).toBe("completed");
    expect(res.result).not.toBeNull();
    expect(res.result?.residents_created).toBe(5);
    expect(res.result?.occupancies_created).toBe(7);
    expect(res.result?.family_created).toBe(3);
    expect(res.result?.vehicles_created).toBe(2);
    expect(res.result?.total_committed).toBe(24);
  });

  it("replays idempotently and preserves result", async () => {
    const c = client(async () => ({
      data: {
        status: "idempotent_replay",
        result: {
          residents_created: 1,
          occupancies_created: 1,
          total_committed: 1,
        },
      },
      error: null,
    }));
    const res = await _commitMigrationJobViaRpc(c, validInput);
    expect(res.status).toBe("idempotent_replay");
    expect(res.result?.residents_created).toBe(1);
  });

  it("returns unresolved_conflicts with null result when the job blocks", async () => {
    const c = client(async () => ({
      data: { status: "unresolved_conflicts" },
      error: null,
    }));
    const res = await _commitMigrationJobViaRpc(c, validInput);
    expect(res.status).toBe("unresolved_conflicts");
    expect(res.result).toBeNull();
  });

  it.each([
    "idempotency_conflict",
    "job_not_ready",
    "job_already_committing",
    "unavailable",
    "operation_failed",
  ] as const)("passes through %s without a result", async (status) => {
    const c = client(async () => ({ data: { status }, error: null }));
    const res = await _commitMigrationJobViaRpc(c, validInput);
    expect(res.status).toBe(status);
    expect(res.result).toBeNull();
  });

  it("maps transport errors to operation_failed", async () => {
    const c = client(async () => ({ data: null, error: { message: "boom" } }));
    const res = await _commitMigrationJobViaRpc(c, validInput);
    expect(res.status).toBe("operation_failed");
    expect(res.result).toBeNull();
  });

  it("rejects unknown status values as operation_failed", async () => {
    const c = client(async () => ({ data: { status: "made_up" }, error: null }));
    const res = await _commitMigrationJobViaRpc(c, validInput);
    expect(res.status).toBe("operation_failed");
  });

  it("guards result shape — invalid negative counters produce null result", async () => {
    const c = client(async () => ({
      data: { status: "completed", result: { total_committed: -1 } },
      error: null,
    }));
    const res = await _commitMigrationJobViaRpc(c, validInput);
    // Status is still completed but the malformed result yields null.
    expect(res.status).toBe("completed");
    expect(res.result).toBeNull();
  });
});
