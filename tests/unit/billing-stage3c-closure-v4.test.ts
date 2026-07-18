/**
 * Stage 3C v4 — final closure.
 *
 * Behavioral guards:
 *  - Server functions expose an explicit split between resident and admin
 *    submission, and the browser never picks the actor role.
 *  - Resident-facing RPCs consider only ACTIVE flat_residents rows
 *    (is_active = true AND moved_out_at IS NULL). Moved-out residents
 *    cannot read history, receipts, or submit new payments.
 *  - `get_payment_detail` exists as a server-authoritative payment read.
 *  - The retired `submitOfflinePayment` server function is marked
 *    @deprecated in favor of the split.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const fnSrc = readFileSync("src/lib/offline-payments.functions.ts", "utf8");
const submitCard = readFileSync(
  "src/components/billing/OfflinePaymentSubmitCard.tsx",
  "utf8",
);

function readLatestMigration(pattern: RegExp): string {
  const dir = "supabase/migrations";
  const files = readdirSync(dir).filter((f) => pattern.test(f));
  if (!files.length) return "";
  files.sort();
  return readFileSync(join(dir, files[files.length - 1]!), "utf8");
}

const activeAuthMigration = (() => {
  const dir = "supabase/migrations";
  const files = readdirSync(dir);
  // Pick the most recent migration that touches submit_offline_payment AND active-resident check.
  const relevant = files
    .sort()
    .reverse()
    .map((f) => ({ f, text: readFileSync(join(dir, f), "utf8") }))
    .find(
      ({ text }) =>
        /submit_offline_payment/.test(text) &&
        /moved_out_at IS NULL/.test(text) &&
        /is_active = true/.test(text),
    );
  return relevant?.text ?? "";
})();

describe("Stage 3C v4 — split resident/admin submission server functions", () => {
  it("exports submitResidentBankTransfer and recordAdminOfflinePayment", () => {
    expect(fnSrc).toMatch(/export const submitResidentBankTransfer\b/);
    expect(fnSrc).toMatch(/export const recordAdminOfflinePayment\b/);
  });

  it("resident schema has NO method and NO actorRole fields", () => {
    const block =
      fnSrc.match(/const residentSubmitInput = z\.object\({[\s\S]*?}\)/)?.[0] ??
      "";
    expect(block).not.toMatch(/method:/);
    expect(block).not.toMatch(/actorRole/);
    expect(block).toMatch(/referenceNo: z\.string\(\)\.trim\(\)\.min\(1\)/);
  });

  it("admin-record schema has NO actorRole field", () => {
    const block =
      fnSrc.match(/const adminRecordInput = z\.object\({[\s\S]*?}\)/)?.[0] ?? "";
    expect(block).not.toMatch(/actorRole/);
    expect(block).toMatch(/method: z\.enum\(\["cash", "bank_transfer"\]\)/);
  });

  it("resident server fn sends _actor_role: 'resident' (server-fixed)", () => {
    const block =
      fnSrc.match(/submitResidentBankTransfer[\s\S]{0,1400}/)?.[0] ?? "";
    expect(block).toMatch(/_actor_role: "resident"/);
    expect(block).toMatch(/_method: "bank_transfer"/);
  });

  it("admin server fn sends _actor_role: 'admin' (server-fixed)", () => {
    const block =
      fnSrc.match(/recordAdminOfflinePayment[\s\S]{0,1400}/)?.[0] ?? "";
    expect(block).toMatch(/_actor_role: "admin"/);
  });

  it("legacy submitOfflinePayment is marked @deprecated", () => {
    expect(fnSrc).toMatch(/@deprecated[\s\S]{0,200}submitResidentBankTransfer/);
  });
});

describe("Stage 3C v4 — resident submission card contract", () => {
  it("uses submitResidentBankTransfer and never sends actorRole", () => {
    expect(submitCard).toMatch(/useServerFn\(submitResidentBankTransfer\)/);
    expect(submitCard).not.toMatch(/actorRole/);
  });

  it("does not send a browser-chosen method to the server", () => {
    // The `method` variable is fixed to 'bank_transfer' locally; the
    // resident schema does not accept `method`, so we don't send it.
    const dataBlock =
      submitCard.match(/data:\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(dataBlock).not.toMatch(/\bmethod\b\s*[,:]/);
  });
});

describe("Stage 3C v4 — server payment detail RPC", () => {
  it("server function getPaymentDetail exists and calls get_payment_detail", () => {
    expect(fnSrc).toMatch(/export const getPaymentDetail\b/);
    expect(fnSrc).toContain('"get_payment_detail"');
  });
});

describe("Stage 3C v4 — active resident authorization enforced in migration", () => {
  it("finds a migration that scopes flat_residents to active rows", () => {
    expect(activeAuthMigration).not.toBe("");
  });

  const rpcs = [
    "get_bill_payment_summary",
    "get_resident_payments_v1",
    "get_payment_receipt_lifecycle",
    "submit_offline_payment",
    "get_payment_detail",
  ];

  for (const rpc of rpcs) {
    it(`${rpc} filters flat_residents by is_active AND moved_out_at IS NULL`, () => {
      // Each RPC body should contain both predicates in proximity to
      // flat_residents. We check that both conditions appear inside the
      // function body (defined below).
      const bodyMatch = new RegExp(
        `FUNCTION public\\.${rpc}[\\s\\S]*?\\$function\\$`,
        "i",
      ).exec(activeAuthMigration);
      const body = bodyMatch?.[0] ?? "";
      expect(body).not.toBe("");
      expect(body).toMatch(/flat_residents/);
      expect(body).toMatch(/is_active\s*=\s*true/);
      expect(body).toMatch(/moved_out_at\s+IS\s+NULL/);
    });
  }

  it("get_payment_detail is granted only to authenticated", () => {
    expect(activeAuthMigration).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_payment_detail\(uuid\) FROM PUBLIC/,
    );
    expect(activeAuthMigration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_payment_detail\(uuid\) TO authenticated/,
    );
  });
});

describe("Stage 3C v4 — protected society is never referenced", () => {
  const protectedUuid = "1907a918-c4b8-4f43-a837-450530cc7c34";
  const paths = [
    "src/lib/offline-payments.functions.ts",
    "src/components/billing/OfflinePaymentSubmitCard.tsx",
  ];
  for (const p of paths) {
    it(`${p} has no protected society UUID`, () => {
      expect(readFileSync(p, "utf8")).not.toContain(protectedUuid);
    });
  }
});

// Suppress unused-var lint from the helper import.
void readLatestMigration;
