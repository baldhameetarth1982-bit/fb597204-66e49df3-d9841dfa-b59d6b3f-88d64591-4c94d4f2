/**
 * Stage 3C — IDEMPOTENCY + REFERENCE focused behavioral tests.
 *
 * These tests never require the live Supabase stack — they execute the
 * real 40-case source validator, the exported handler map, the matrix
 * context guards, the Zod snapshot schemas, and the semantic mock-
 * driven behavior of each handler. Runtime live behavior is enforced
 * by the live matrix suite gated on `ALLOW_SOCIOHUB_LIVE_STAGE3C`.
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
  REFERENCE_AMOUNT,
  IdempotencyLifecycleSnapshotSchema,
  ReferenceLifecycleSnapshotSchema,
  type Stage3CIdempotencyReferenceCaseId,
} from "../helpers/stage3c-live-idempotency-reference-cases";
import {
  createStage3CLiveMatrixContext,
  requireIdempotencyBillId,
  requireIdempotencyPaymentId,
  requireIdempotencyReference,
  requireIdempotencyInitialState,
  requireReferencePrimaryBillId,
  requireReferencePrimaryPaymentId,
  requireReferenceValue,
  requireReferenceAmount,
  requireReferencePrimaryKey,
  requireReferenceDuplicateKey,
  requireReferenceOtherSocietyKey,
  requireReferencePrimaryInitialState,
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

  it("cases-module rejects wrong amount literals", () => {
    const goodLiterals = `IDEMPOTENCY_AMOUNT = 250\nIDEMPOTENCY_CONFLICT_AMOUNT = 251\nREFERENCE_AMOUNT = 200`;
    expect(checkCasesModule(goodLiterals).some((m) => /IDEMPOTENCY_AMOUNT/.test(m))).toBe(false);

    expect(checkCasesModule("IDEMPOTENCY_AMOUNT = 200").join("|")).toMatch(
      /IDEMPOTENCY_AMOUNT must be exactly 250/,
    );
    expect(checkCasesModule("IDEMPOTENCY_CONFLICT_AMOUNT = 250").join("|")).toMatch(
      /IDEMPOTENCY_CONFLICT_AMOUNT must be exactly 251/,
    );
    expect(checkCasesModule("REFERENCE_AMOUNT = 100").join("|")).toMatch(
      /REFERENCE_AMOUNT must be exactly 200/,
    );
  });

  it("cases-module rejects vitest import and non-null assertions", () => {
    const bad = `import { expect } from "vitest"; const x = ctx.idempotencyBillId!;`;
    const failures = checkCasesModule(bad).join("|");
    expect(failures).toMatch(/must NOT import from vitest/);
    expect(failures).toMatch(/non-null assertions/);
  });

  it("cases-module rejects admin bank-transfer helpers in this slice", () => {
    const bad = `submitAdminBankTransferPayment({ actor: adminA1 })`;
    const failures = checkCasesModule(bad).join("|");
    expect(failures).toMatch(/admin bank-transfer/);
    expect(failures).toMatch(/no admin helpers/);
  });

  it("cases-module keeps `unexpected success` outside try/catch", () => {
    const bad = `try { const v = doWork(); if (v) throw new Error("unexpected success"); } catch (e) {}`;
    expect(checkCasesModule(bad).some((m) => m.includes("unexpected success"))).toBe(true);
  });

  it("matrix registry validator counts exactly 40 unique ids", () => {
    const failures = checkMatrixRegistry(
      Array.from({ length: 39 }, (_, i) => `"XX-${String(i).padStart(2, "0")}":`).join(" "),
    );
    expect(failures.join("|")).toMatch(/40 unique ids/);
  });

  it("context validator flags missing lifecycle slots and untyped snapshots", () => {
    const failures = checkMatrixContextSlots("nothing here");
    expect(failures.length).toBeGreaterThan(0);
    // Untyped snapshot must be flagged.
    const bad = `idempotencyInitialState: unknown\nreferencePrimaryInitialState: unknown`;
    expect(checkMatrixContextSlots(bad).join("|")).toMatch(/no `unknown`/);
  });

  it("fixture validator requires all four dedicated bills and their totals", () => {
    expect(checkFixtureBills("").join("|")).toMatch(/idempotencyBillId/);
    expect(checkFixtureBills("").join("|")).toMatch(/referencePrimaryBillId/);
    const good =
      "idempotencyBillId 1000 referencePrimaryBillId 800 referenceSecondarySameSocietyBillId 700 referenceOtherSocietyBillId 600";
    expect(checkFixtureBills(good)).toEqual([]);
  });

  it("live-suite / docs / workflow / manifest validators respond to obvious defects", () => {
    expect(checkLiveSuite("32/93")).not.toEqual([]);
    expect(checkLiveSuite("40/93")).toEqual([]);
    const good = "40/93 IDEMPOTENCY 4/4 REFERENCE 4/4";
    expect(checkDocs(good)).toEqual([]);
    expect(checkDocs(`${good} Stage 3D started`).join("|")).toMatch(/Stage 3D started/);
    expect(checkWorkflow("nothing here")).toEqual([]);
    expect(checkWorkflow("Runs live-suite 40/93 acceptance").join("|")).toMatch(/40\/93/);
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

  it("handler map is exhaustive and function-typed", () => {
    const keys = Object.keys(STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS).sort();
    const expected = [...STAGE3C_IDEMPOTENCY_REFERENCE_CASE_IDS].sort();
    expect(keys).toEqual(expected);
    for (const id of STAGE3C_IDEMPOTENCY_REFERENCE_CASE_IDS as readonly Stage3CIdempotencyReferenceCaseId[]) {
      expect(typeof STAGE3C_IDEMPOTENCY_REFERENCE_HANDLERS[id]).toBe("function");
    }
  });

  it("financial literals lock the repaired amounts (250 / 251 / 200)", () => {
    expect(IDEMPOTENCY_AMOUNT).toBe(250);
    expect(IDEMPOTENCY_CONFLICT_AMOUNT).toBe(251);
    expect(REFERENCE_AMOUNT).toBe(200);
    expect(IDEMPOTENCY_AMOUNT).not.toBe(IDEMPOTENCY_CONFLICT_AMOUNT);
    expect(IDEMPOTENCY_CONFLICT_AMOUNT - IDEMPOTENCY_AMOUNT).toBe(1);
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

  it("manifest IDEMPOTENCY-03 is proof-only and IDEMPOTENCY-04 is same-bill amount conflict", () => {
    const byId = new Map(STAGE3C_REQUIRED_LIVE_CASES.map((c) => [c.id, c.description]));
    expect(byId.get("IDEMPOTENCY-03")).toMatch(/proof-only|exactly one payment row/i);
    expect(byId.get("IDEMPOTENCY-04")).toMatch(/same bill/i);
    expect(byId.get("IDEMPOTENCY-04")).toMatch(/conflict/i);
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
    expect(() => requireIdempotencyBillId(ctx)).toThrow(/idempotencyBillId/);
    expect(() => requireIdempotencyPaymentId(ctx)).toThrow(/idempotencyPaymentId/);
    expect(() => requireIdempotencyReference(ctx)).toThrow(/idempotencyReference/);
    expect(() => requireIdempotencyInitialState(ctx)).toThrow(/idempotencyInitialState/);
    expect(() => requireReferencePrimaryBillId(ctx)).toThrow(/referencePrimaryBillId/);
    expect(() => requireReferencePrimaryPaymentId(ctx)).toThrow(/referencePrimaryPaymentId/);
    expect(() => requireReferencePrimaryInitialState(ctx)).toThrow(/referencePrimaryInitialState/);
    expect(() => requireReferenceValue(ctx)).toThrow(/referenceValue/);
    expect(() => requireReferenceAmount(ctx)).toThrow(/referenceAmount/);
    expect(() => requireReferencePrimaryKey(ctx)).toThrow(/referencePrimaryKey/);
    expect(() => requireReferenceDuplicateKey(ctx)).toThrow(/referenceDuplicateKey/);
    expect(() => requireReferenceOtherSocietyKey(ctx)).toThrow(/referenceOtherSocietyKey/);
  });

  it("returns the stored value once populated", () => {
    const ctx = createStage3CLiveMatrixContext();
    ctx.idempotencyBillId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    ctx.idempotencyPaymentId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    ctx.idempotencyReference = "IDEMP-ABC";
    ctx.referencePrimaryBillId = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    ctx.referencePrimaryPaymentId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    ctx.referenceValue = "REF-ABC";
    ctx.referenceAmount = 200;
    ctx.referencePrimaryKey = "ref-primary-abc";
    ctx.referenceDuplicateKey = "ref-dup-abc";
    ctx.referenceOtherSocietyKey = "ref-cross-abc";
    expect(requireIdempotencyBillId(ctx)).toBe("cccccccc-cccc-cccc-cccc-cccccccccccc");
    expect(requireIdempotencyPaymentId(ctx)).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    expect(requireIdempotencyReference(ctx)).toBe("IDEMP-ABC");
    expect(requireReferencePrimaryBillId(ctx)).toBe("dddddddd-dddd-dddd-dddd-dddddddddddd");
    expect(requireReferencePrimaryPaymentId(ctx)).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    expect(requireReferenceValue(ctx)).toBe("REF-ABC");
    expect(requireReferenceAmount(ctx)).toBe(200);
    expect(requireReferencePrimaryKey(ctx)).toBe("ref-primary-abc");
    expect(requireReferenceDuplicateKey(ctx)).toBe("ref-dup-abc");
    expect(requireReferenceOtherSocietyKey(ctx)).toBe("ref-cross-abc");
  });
});
