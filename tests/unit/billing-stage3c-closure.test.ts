/**
 * Stage 3C — closure hardening.
 *
 * Behavioral guards that the hardening pass actually landed:
 *   1. proof_url is fully removed from the resident submission surface
 *      (Option B — deferred until a secure signed-upload flow exists).
 *   2. Residents can only pick Bank Transfer; Cash is admin-only.
 *   3. Actor role is explicit in the server-fn contract and forwarded
 *      to the SECURITY DEFINER RPC as _actor_role.
 *   4. New error codes (overpayment, duplicate reference, idempotency
 *      conflict, self-verification, resident cash block) all have safe
 *      user-facing messages, never raw DB text.
 *   5. get_bill_payment_summary is wired and exports a typed shape.
 *   6. Admin verify / reject / reverse open an AlertDialog before
 *      committing (irreversible-action confirmation).
 *   7. Corrective migration exists and rewrites the RPCs with locking,
 *      SoD, monthly receipt sequence (RCPT/YYYYMM/####), and receipt
 *      voiding on reversal.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const fnSrc = readFileSync("src/lib/offline-payments.functions.ts", "utf8");
const submitCard = readFileSync(
  "src/components/billing/OfflinePaymentSubmitCard.tsx",
  "utf8",
);
const adminRoute = readFileSync(
  "src/routes/_society/society.payments.tsx",
  "utf8",
);

function allMigrationsText(): string {
  const dir = "supabase/migrations";
  return readdirSync(dir)
    .sort()
    .map((f) => readFileSync(path.join(dir, f), "utf8"))
    .join("\n\n");
}

describe("Stage 3C closure — proof_url removed from the client contract", () => {
  it("submit schema no longer accepts proofUrl", () => {
    expect(fnSrc).not.toMatch(/proofUrl:/);
    expect(fnSrc).not.toMatch(/_proof_url/);
  });
  it("resident submit card sends no proof URL", () => {
    expect(submitCard).not.toMatch(/proofUrl/);
    expect(submitCard).not.toMatch(/proof_url/i);
  });
});

describe("Stage 3C closure — separation of duties in the client contract", () => {
  it("submit schema requires an explicit actorRole (resident | admin)", () => {
    expect(fnSrc).toMatch(/actorRole: z\.enum\(\["resident", "admin"\]\)/);
    expect(fnSrc).toMatch(/_actor_role: data\.actorRole/);
  });
  it("resident submit card always sends actorRole: 'resident'", () => {
    expect(submitCard).toMatch(/actorRole:\s*["']resident["']/);
  });
  it("resident submit card removes the Cash method toggle", () => {
    // Card variant that made 'cash' selectable must be gone; only the
    // fixed 'Bank Transfer' method label remains.
    expect(submitCard).not.toMatch(/setMethod\("cash"\)/);
    expect(submitCard).toMatch(/Method:\s*Bank Transfer/);
  });
});

describe("Stage 3C closure — safe error mapping for hardened codes", () => {
  const cases: Array<[string, RegExp]> = [
    ["amount_exceeds_outstanding", /exceeds the remaining bill balance/i],
    ["duplicate_reference", /already been used/i],
    ["idempotency_conflict", /conflicts with an earlier one/i],
    ["self_verification_not_allowed", /cannot also verify it/i],
    ["resident_cash_not_allowed", /Bank Transfer/i],
    ["payment_not_pending", /Only pending payments/i],
  ];
  for (const [code, message] of cases) {
    it(`maps ${code} to a user-safe message`, () => {
      expect(fnSrc).toContain(code);
      expect(fnSrc).toMatch(message);
    });
  }
});

describe("Stage 3C closure — canonical bill payment summary is wired", () => {
  it("exports getBillPaymentSummary and BillPaymentSummary type", () => {
    expect(fnSrc).toMatch(/export const getBillPaymentSummary\b/);
    expect(fnSrc).toMatch(/export interface BillPaymentSummary\b/);
    expect(fnSrc).toContain('"get_bill_payment_summary"');
  });
});

describe("Stage 3C closure — admin confirmation dialogs are present", () => {
  it("admin route imports AlertDialog primitives", () => {
    expect(adminRoute).toMatch(/AlertDialog[\s\S]*from ["']@\/components\/ui\/alert-dialog["']/);
  });
  it("admin verify/reject/reverse route through a single executeConfirm gate", () => {
    expect(adminRoute).toMatch(/setConfirm\(\{\s*kind:\s*["']verify["']/);
    expect(adminRoute).toMatch(/setConfirm\(\{\s*kind:\s*["']reject["']/);
    expect(adminRoute).toMatch(/setConfirm\(\{\s*kind:\s*["']reverse["']/);
    expect(adminRoute).toMatch(/async function executeConfirm\b/);
  });
  it("reverse copy tells the admin the receipt will be voided", () => {
    expect(adminRoute).toMatch(/voids the receipt/i);
  });
});

describe("Stage 3C closure — corrective migration hardens the RPCs", () => {
  const sql = allMigrationsText();
  it("adds a receipt lifecycle status column", () => {
    expect(sql).toMatch(/status text NOT NULL DEFAULT 'valid'/);
    expect(sql).toMatch(/CHECK \(status IN \('valid','void'\)\)/);
  });
  it("introduces the monthly receipt sequence with the RCPT format", () => {
    expect(sql).toMatch(/payment_receipt_month_sequences/);
    expect(sql).toMatch(/'RCPT\/'/);
  });
  it("submit_offline_payment locks the bill and checks pending+verified", () => {
    expect(sql).toMatch(/FROM public\.bills WHERE id = _bill_id FOR UPDATE/);
    expect(sql).toMatch(/amount_exceeds_outstanding/);
    expect(sql).toMatch(/duplicate_reference/);
    expect(sql).toMatch(/idempotency_conflict/);
    expect(sql).toMatch(/resident_cash_not_allowed/);
  });
  it("verify_offline_payment enforces separation of duties and re-checks balance", () => {
    expect(sql).toMatch(/self_verification_not_allowed/);
    expect(sql).toMatch(/_allocate_receipt_number_monthly/);
  });
  it("reverse_offline_payment voids the receipt atomically", () => {
    expect(sql).toMatch(
      /UPDATE public\.payment_receipts\s+SET status='void'/,
    );
    expect(sql).toMatch(/receipt\.voided/);
  });
  it("get_bill_payment_summary is defined and granted to authenticated", () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.get_bill_payment_summary/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_bill_payment_summary\(uuid\) TO authenticated/);
  });
});

describe("Stage 3C closure — protected society is still untouched", () => {
  const protectedUuid = "1907a918-c4b8-4f43-a837-450530cc7c34";
  for (const p of [
    "src/lib/offline-payments.functions.ts",
    "src/components/billing/OfflinePaymentSubmitCard.tsx",
    "src/routes/_society/society.payments.tsx",
  ]) {
    it(`${p} contains no protected society reference`, () => {
      expect(readFileSync(p, "utf8")).not.toContain(protectedUuid);
    });
  }
});
