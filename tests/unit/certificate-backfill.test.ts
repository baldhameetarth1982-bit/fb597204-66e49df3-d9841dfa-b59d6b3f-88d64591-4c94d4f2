/**
 * Tests for the shared certificate-backfill classifier + keyset pagination.
 * Exercises the SAME module the CLI script imports.
 */
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  classifyBackfillRow,
  runBackfillDryRun,
  type BackfillRow,
} from "../../src/lib/certificate-backfill";

const good = "a".repeat(43);
const goodHash = createHash("sha256").update(good).digest("hex");

describe("classifyBackfillRow", () => {
  it("already-encrypted rows", () => {
    expect(
      classifyBackfillRow({
        id: "1",
        verification_token: good,
        verification_token_hash: goodHash,
        verification_token_ciphertext: "xyz",
      }),
    ).toBe("already_encrypted");
  });
  it("malformed", () => {
    expect(
      classifyBackfillRow({
        id: "2",
        verification_token: "short",
        verification_token_hash: null,
        verification_token_ciphertext: null,
      }),
    ).toBe("malformed");
    expect(
      classifyBackfillRow({
        id: "3",
        verification_token: null,
        verification_token_hash: null,
        verification_token_ciphertext: null,
      }),
    ).toBe("malformed");
  });
  it("hash mismatch counted once", () => {
    expect(
      classifyBackfillRow({
        id: "4",
        verification_token: good,
        verification_token_hash: "deadbeef".repeat(8),
        verification_token_ciphertext: null,
      }),
    ).toBe("hash_mismatch");
  });
  it("eligible", () => {
    expect(
      classifyBackfillRow({
        id: "5",
        verification_token: good,
        verification_token_hash: goodHash,
        verification_token_ciphertext: null,
      }),
    ).toBe("eligible");
    expect(
      classifyBackfillRow({
        id: "6",
        verification_token: good,
        verification_token_hash: null,
        verification_token_ciphertext: null,
      }),
    ).toBe("eligible");
  });
});

describe("runBackfillDryRun keyset pagination", () => {
  function makeRows(n: number): BackfillRow[] {
    return Array.from({ length: n }, (_, i) => ({
      // zero-padded id so lexicographic order matches numeric order
      id: `id-${String(i + 1).padStart(4, "0")}`,
      verification_token: good,
      verification_token_hash: goodHash,
      verification_token_ciphertext: null,
    }));
  }

  function makeFetcher(rows: BackfillRow[]) {
    return async (afterId: string | null, limit: number) => {
      const start = afterId == null ? 0 : rows.findIndex((r) => r.id === afterId) + 1;
      return rows.slice(start, start + limit);
    };
  }

  it("60 rows, batchSize 25 => 25 + 25 + 10, no duplicates", async () => {
    const rows = makeRows(60);
    const stats = await runBackfillDryRun({
      fetchBatch: makeFetcher(rows),
      batchSize: 25,
      maxBatches: 100,
    });
    expect(stats.scanned).toBe(60);
    expect(stats.eligible).toBe(60);
    // deterministic order, each id seen exactly once
    expect(stats.processed_ids).toEqual(rows.map((r) => r.id));
    expect(new Set(stats.processed_ids).size).toBe(60);
  });

  it("dry-run does not repeat first batch (would-be OFFSET bug)", async () => {
    const rows = makeRows(30);
    const stats = await runBackfillDryRun({
      fetchBatch: makeFetcher(rows),
      batchSize: 10,
      maxBatches: 10,
    });
    // Every id present exactly once — no duplication of batch 1.
    expect(stats.processed_ids.length).toBe(30);
    expect(new Set(stats.processed_ids).size).toBe(30);
  });

  it("restart from cursor is deterministic", async () => {
    const rows = makeRows(20);
    // Simulate a fetcher that starts from a given cursor by wrapping.
    const halfCursor = rows[9].id;
    const fetcher = async (afterId: string | null, limit: number) => {
      const cur = afterId ?? halfCursor;
      const start = rows.findIndex((r) => r.id === cur) + 1;
      return rows.slice(start, start + limit);
    };
    const stats = await runBackfillDryRun({ fetchBatch: fetcher, batchSize: 5, maxBatches: 10 });
    expect(stats.processed_ids).toEqual(rows.slice(10).map((r) => r.id));
  });

  it("mixed classes counted correctly", async () => {
    const rows: BackfillRow[] = [
      { id: "a1", verification_token: good, verification_token_hash: goodHash, verification_token_ciphertext: "enc" },
      { id: "a2", verification_token: "bad", verification_token_hash: null, verification_token_ciphertext: null },
      { id: "a3", verification_token: good, verification_token_hash: "deadbeef".repeat(8), verification_token_ciphertext: null },
      { id: "a4", verification_token: good, verification_token_hash: goodHash, verification_token_ciphertext: null },
    ];
    const stats = await runBackfillDryRun({
      fetchBatch: makeFetcher(rows),
      batchSize: 10,
      maxBatches: 5,
    });
    expect(stats.already_encrypted).toBe(1);
    expect(stats.malformed).toBe(1);
    expect(stats.hash_mismatch).toBe(1);
    expect(stats.eligible).toBe(1);
    expect(stats.scanned).toBe(4);
  });
});
