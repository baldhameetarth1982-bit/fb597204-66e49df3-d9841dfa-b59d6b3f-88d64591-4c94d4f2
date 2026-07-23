/**
 * Stage 3C — IDEMPOTENCY + REFERENCE focused behavioral tests.
 *
 * These tests never require the live Supabase stack — they execute the
 * real 40-case source validator, the exported handler map, the matrix
 * context guards, and the Zod snapshot schemas that pin the lifecycle
 * shape. Runtime live behavior is enforced by the live matrix suite
 * gated on `ALLOW_SOCIOHUB_LIVE_STAGE3C`.
 */
import { describe, expect, it } from "vitest";
import {
  runAll40CaseChecks,
  checkCasesModule,
  checkMatrixRegistry,
  checkMatrixContextSlots,
  checkFixtureBills,
  checkLiveSuite,
  checkDocs,
  checkWorkflow,
  checkManifest,
} from "../../scripts/verify-stage3c-live-matrix-40-source";

import {
  STAGE3C_IDEMPOTENCY_REFERENCE_CASE_IDS,
  STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS,
  IDEMPOTENCY_AMOUNT,
  IDEMPOTENCY_CONFLICT_AMOUNT,
  REFERENCE_PRIMARY_AMOUNT,
  REFERENCE_DUPLICATE_AMOUNT,
  IdempotencyLifecycleSnapshotSchema,
  ReferenceLifecycleSnapshotSchema,
  type Stage3CIdempotencyReferenceCaseId,
} from "../helpers/stage3c-live-idempotency-reference-cases";
import {
  createStage3CLiveMatrixContext,
  requireIdempotencyPaymentId,
  requireIdempotencyReference,
  requireReferencePrimaryPaymentId,
  requireReferenceValue,
  requireReferenceAmount,
  requireReferencePrimaryKey,
  requireReferenceDuplicateKey,
  requireReferenceOtherSocietyKey,
} from "../helpers/stage3c-live-matrix-context";
import {
  STAGE3C_MATRIX_LIVE_CASE_HANDLERS,
  STAGE3C_MATRIX_LIVE_HANDLERS,
} from "../helpers/stage3c-live-matrix-registry";
import { STAGE3C_REQUIRED_LIVE_CASES } from "../helpers/stage3c-live-case-manifest";

describe("Stage 3C 40-case source validator", () => {
  it("passes end-to-end", () => {
    const outcome = runAll40CaseChecks();
    expect(outcome.failures, outcome.failures.join("\n")).toEqual([]);
    expect(outcome.ok).toBe(true);
  });

  it("cases module keeps `unexpected success` outside try/catch", () => {
    const src = `try { doWork(); } catch (e) { record(e); }\nif (ok) throw new Error("unexpected success");`;
    expect(checkCasesModule(src)).toEqual(
      expect.not.arrayContaining([
        expect.stringContaining("`unexpected success` error must be thrown OUTSIDE"),
      ]),
    );
    const bad = `try { const v = doWork(); if (v) throw new Error("unexpected success"); } catch (e) {}`;
    expect(checkCasesModule(bad)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("`unexpected success` error must be thrown OUTSIDE"),
      ]),
    );
  });

  it("matrix registry validator counts exactly 40 unique ids", () => {
    const failures = checkMatrixRegistry(
      Array.from({ length: 39 }, (_, i) => `"XX-${String(i).padStart(2, "0")}":`).join(" "),
    );
    expect(failures.join("|")).toMatch(/40 unique ids/);
  });

  it("context validator flags missing lifecycle slots", () => {
    expect(checkMatrixContextSlots("nothing").length).toBeGreaterThan(0);
  });

  it("fixture validator requires both dedicated bills", () => {
    expect(checkFixtureBills("").join("|")).toMatch(
      /referenceSecondarySameSocietyBillId not exposed/,
    );
    expect(checkFixtureBills("referenceSecondarySameSocietyBillId 700 referenceOtherSocietyBillId 600")).toEqual([]);
  });

  it("live suite validator requires 40/93 title", () => {
    expect(checkLiveSuite("32/93")).not.toEqual([]);
    expect(checkLiveSuite("40/93")).toEqual([]);
  });

  it("docs validator enforces IDEMPOTENCY and REFERENCE progress lines", () => {
    const good = "40/93 IDEMPOTENCY 4/4 REFERENCE 4/4";
    expect(checkDocs(good)).toEqual([]);
    expect(checkDocs("40/93 REFERENCE 4/4").join("|")).toMatch(/IDEMPOTENCY 4\/4/);
    expect(checkDocs("40/93 IDEMPOTENCY 4/4").join("|")).toMatch(/REFERENCE 4\/4/);
    expect(
      checkDocs("40/93 IDEMPOTENCY 4/4 REFERENCE 4/4 Stage 3D started").join("|"),
    ).toMatch(/Stage 3D started/);
  });

  it("workflow validator requires the 40-source step", () => {
    expect(checkWorkflow("nothing here")).not.toEqual([]);
    expect(checkWorkflow("bun scripts/verify-stage3c-live-matrix-40-source.ts")).toEqual([]);
  });

  it("manifest validator flags missing ids", () => {
    expect(checkManifest("").length).toBe(8);
  });
});

describe("Stage 3C IDEMPOTENCY + REFERENCE case-id registry", () => {
  it("exports exactly 8 canonical ids in order", () => {
    expect(STAGE3C_IDEMPOTENCY_REFERENCE_CASE_IDS).toEqual([
      "IDEMPOTENCY-01",
      "IDEMPOTENCY-02",
      "IDEMPOTENCY-03",
      "IDEMPOTENCY-04",
      "REFERENCE-01",
      "REFERENCE-02",
      "REFERENCE-03",
      "REFERENCE-04",
    ]);
  });

  it("handler map is exhaustive and unique", () => {
    const keys = Object.keys(STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS).sort();
    const expected = [...STAGE3C_IDEMPOTENCY_REFERENCE_CASE_IDS].sort();
    expect(keys).toEqual(expected);
    for (const id of STAGE3C_IDEMPOTENCY_REFERENCE_CASE_IDS as readonly Stage3CIdempotencyReferenceCaseId[]) {
      expect(typeof STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS[id]).toBe("function");
    }
  });

  it("financial literals lock exact amounts", () => {
    expect(IDEMPOTENCY_AMOUNT).toBe(200);
    expect(IDEMPOTENCY_CONFLICT_AMOUNT).toBe(250);
    expect(REFERENCE_PRIMARY_AMOUNT).toBe(100);
    expect(REFERENCE_DUPLICATE_AMOUNT).toBe(50);
    expect(IDEMPOTENCY_AMOUNT).not.toBe(IDEMPOTENCY_CONFLICT_AMOUNT);
    expect(REFERENCE_PRIMARY_AMOUNT).not.toBe(REFERENCE_DUPLICATE_AMOUNT);
  });

  it("matrix registry includes all 8 new ids and totals 40", () => {
    expect(STAGE3C_MATRIX_LIVE_CASE_HANDLERS).toHaveLength(40);
    const ids = STAGE3C_MATRIX_LIVE_CASE_HANDLERS.map((c) => c.id);
    for (const id of STAGE3C_IDEMPOTENCY_REFERENCE_CASE_IDS) {
      expect(ids).toContain(id);
      expect(typeof STAGE3C_MATRIX_LIVE_HANDLERS[id]).toBe("function");
    }
  });

  it("matrix registry descriptions come from the manifest exactly", () => {
    const byId = new Map(STAGE3C_REQUIRED_LIVE_CASES.map((c) => [c.id, c.description]));
    for (const c of STAGE3C_MATRIX_LIVE_CASE_HANDLERS) {
      expect(c.description).toBe(byId.get(c.id));
    }
  });
});

describe("Stage 3C IDEMPOTENCY + REFERENCE snapshot schemas", () => {
  it("IdempotencyLifecycleSnapshotSchema enforces uuid + non-negative integer count", () => {
    expect(
      IdempotencyLifecycleSnapshotSchema.safeParse({
        billId: "11111111-1111-1111-1111-111111111111",
        rowCount: 0,
      }).success,
    ).toBe(true);
    expect(IdempotencyLifecycleSnapshotSchema.safeParse({ billId: "nope", rowCount: 0 }).success).toBe(false);
    expect(
      IdempotencyLifecycleSnapshotSchema.safeParse({
        billId: "11111111-1111-1111-1111-111111111111",
        rowCount: -1,
      }).success,
    ).toBe(false);
    expect(
      IdempotencyLifecycleSnapshotSchema.safeParse({
        billId: "11111111-1111-1111-1111-111111111111",
        rowCount: 1.5,
      }).success,
    ).toBe(false);
  });

  it("ReferenceLifecycleSnapshotSchema mirrors the idempotency snapshot contract", () => {
    expect(
      ReferenceLifecycleSnapshotSchema.safeParse({
        billId: "11111111-1111-1111-1111-111111111111",
        rowCount: 3,
      }).success,
    ).toBe(true);
    expect(ReferenceLifecycleSnapshotSchema.safeParse({ billId: "", rowCount: 0 }).success).toBe(false);
  });
});

describe("Stage 3C matrix context IDEMPOTENCY + REFERENCE guards", () => {
  it("throws with a stable label when lifecycle state is missing", () => {
    const ctx = createStage3CLiveMatrixContext();
    expect(() => requireIdempotencyPaymentId(ctx)).toThrow(/idempotencyPaymentId/);
    expect(() => requireIdempotencyReference(ctx)).toThrow(/idempotencyReference/);
    expect(() => requireReferencePrimaryPaymentId(ctx)).toThrow(/referencePrimaryPaymentId/);
    expect(() => requireReferenceValue(ctx)).toThrow(/referenceValue/);
    expect(() => requireReferenceAmount(ctx)).toThrow(/referenceAmount/);
    expect(() => requireReferencePrimaryKey(ctx)).toThrow(/referencePrimaryKey/);
    expect(() => requireReferenceDuplicateKey(ctx)).toThrow(/referenceDuplicateKey/);
    expect(() => requireReferenceOtherSocietyKey(ctx)).toThrow(/referenceOtherSocietyKey/);
  });

  it("returns the stored value once populated", () => {
    const ctx = createStage3CLiveMatrixContext();
    ctx.idempotencyPaymentId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    ctx.idempotencyReference = "IDEMP-ABC";
    ctx.referencePrimaryPaymentId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    ctx.referenceValue = "REF-ABC";
    ctx.referenceAmount = 100;
    ctx.referencePrimaryKey = "ref-primary-abc";
    ctx.referenceDuplicateKey = "ref-dup-abc";
    ctx.referenceOtherSocietyKey = "ref-cross-abc";
    expect(requireIdempotencyPaymentId(ctx)).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(requireIdempotencyReference(ctx)).toBe("IDEMP-ABC");
    expect(requireReferencePrimaryPaymentId(ctx)).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(requireReferenceValue(ctx)).toBe("REF-ABC");
    expect(requireReferenceAmount(ctx)).toBe(100);
    expect(requireReferencePrimaryKey(ctx)).toBe("ref-primary-abc");
    expect(requireReferenceDuplicateKey(ctx)).toBe("ref-dup-abc");
    expect(requireReferenceOtherSocietyKey(ctx)).toBe("ref-cross-abc");
  });
});
