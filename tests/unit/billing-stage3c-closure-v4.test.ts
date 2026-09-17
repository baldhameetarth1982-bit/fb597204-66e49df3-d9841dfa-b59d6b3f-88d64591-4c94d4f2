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
// The resident bank-transfer server function delegates to the neutral
// shared core module. Method + actor role are pinned there.
const residentCoreSrc = readFileSync(
  "src/lib/offline-payment-resident-submit.ts",
  "utf8",
);
const submitCard = readFileSync(
  "src/components/billing/OfflinePaymentSubmitCard.tsx",
  "utf8",
);

// Migration sources in deterministic lexical/version order. Each RPC is
// validated against its own latest effective definition and permission
// statements because corrective migrations may replace only one function.
const migrationSources = (() => {
  const dir = "supabase/migrations";
  return readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => ({ file, sql: readFileSync(join(dir, file), "utf8") }));
})();

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function latestDefinitionOf(rpc: string) {
  const escapedRpc = escapeRegExp(rpc);
  const pattern = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${escapedRpc}\\s*\\([\\s\\S]*?\\bAS\\s+(\\$[A-Za-z_]*\\$)[\\s\\S]*?\\1\\s*;`,
    "gi",
  );
  for (const migration of [...migrationSources].reverse()) {
    const definition = [...migration.sql.matchAll(pattern)].at(-1)?.[0];
    if (definition) return { ...migration, definition };
  }
  throw new Error(`No CREATE OR REPLACE FUNCTION found for public.${rpc}`);
}

function latestPermissionSource(
  rpc: string,
  signature: string,
  permission: "authenticated grant" | "public revoke" | "anon revoke",
) {
  const functionPattern = `public\\.${escapeRegExp(rpc)}\\s*\\(${signature}\\)`;
  const patterns = {
    "authenticated grant": new RegExp(
      `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${functionPattern}\\s+TO\\s+authenticated`,
      "i",
    ),
    "public revoke": new RegExp(
      `REVOKE\\s+(?:ALL|EXECUTE)\\s+ON\\s+FUNCTION\\s+${functionPattern}\\s+FROM\\s+(?:PUBLIC(?:\\s*,\\s*anon)?|anon\\s*,\\s*PUBLIC)`,
      "i",
    ),
    "anon revoke": new RegExp(
      `REVOKE\\s+(?:ALL|EXECUTE)\\s+ON\\s+FUNCTION\\s+${functionPattern}\\s+FROM\\s+(?:anon|PUBLIC\\s*,\\s*anon|anon\\s*,\\s*PUBLIC)`,
      "i",
    ),
  } as const;
  const source = [...migrationSources]
    .reverse()
    .find(({ sql }) => patterns[permission].test(sql));
  if (!source) throw new Error(`No ${permission} found for public.${rpc}`);
  return source;
}

const residentScopedRpcs = [
  { name: "get_bill_payment_summary", signature: "uuid" },
  {
    name: "get_resident_payments_v1",
    signature: "(?:int|integer)\\s*,\\s*(?:int|integer)",
  },
  { name: "get_payment_receipt_lifecycle", signature: "uuid" },
  {
    name: "submit_offline_payment",
    signature:
      "uuid\\s*,\\s*text\\s*,\\s*numeric\\s*,\\s*date\\s*,\\s*text\\s*,\\s*text\\s*,\\s*text\\s*,\\s*text",
  },
  { name: "get_payment_detail", signature: "uuid" },
] as const;

describe("Stage 3C v4 — split resident/admin submission server functions", () => {
  it("exports submitResidentBankTransfer and recordAdminOfflinePayment", () => {
    expect(fnSrc).toMatch(/export const submitResidentBankTransfer\b/);
    expect(fnSrc).toMatch(/export const recordAdminOfflinePayment\b/);
  });

  it("resident schema has NO method and NO actorRole fields", () => {
    // Stage 3C 40-case foundation extracted the schema to the shared
    // contracts module. Verify it there.
    const contractSrc = readFileSync(
      "src/lib/offline-payment-contracts.ts",
      "utf8",
    );
    const block =
      contractSrc.match(
        /export const residentSubmitInputSchema = z[\s\S]*?\.strict\(\);/,
      )?.[0] ?? "";
    expect(block).not.toMatch(/method:/);
    expect(block).not.toMatch(/actorRole/);
    expect(block).toMatch(/referenceNo: z\.string\(\)\.trim\(\)\.min\(1\)/);
    // Production file still imports & uses the schema.
    expect(fnSrc).toMatch(/residentSubmitInputSchema/);
  });

  it("admin-record schema has NO actorRole field", () => {
    const block =
      fnSrc.match(/const adminRecordInput = z\.object\({[\s\S]*?}\)/)?.[0] ?? "";
    expect(block).not.toMatch(/actorRole/);
    expect(block).toMatch(/method: z\.enum\(\["cash", "bank_transfer"\]\)/);
  });

  it("resident server fn sends _actor_role: 'resident' (server-fixed)", () => {
    // Wrapper must delegate to the shared core.
    expect(fnSrc).toMatch(/submitResidentBankTransferWithClient/);
    // Pins live in the shared core module (single source of truth).
    expect(residentCoreSrc).toMatch(/_actor_role:\s*"resident"/);
    expect(residentCoreSrc).toMatch(/_method:\s*"bank_transfer"/);
  });

  it("admin server fn sends _actor_role: 'admin' (server-fixed)", () => {
    const block =
      fnSrc.match(/export const recordAdminOfflinePayment[\s\S]{0,1400}/)?.[0] ??
      "";
    expect(block).toMatch(/_actor_role: "admin"/);
  });

  it("legacy submitOfflinePayment has been removed (Stage 3C v5)", () => {
    expect(fnSrc).not.toMatch(/export const submitOfflinePayment\b/);
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
  for (const rpc of residentScopedRpcs) {
    it(`${rpc.name} filters flat_residents by is_active AND moved_out_at IS NULL`, () => {
      // Each RPC body should contain both predicates in proximity to
      // flat_residents. We check that both conditions appear inside the
      // function body (defined below).
      const { definition: body, file } = latestDefinitionOf(rpc.name);
      expect(file).toMatch(/^\d+_.+\.sql$/);
      expect(body).toMatch(/flat_residents/);
      expect(body).toMatch(/is_active\s*=\s*true/);
      expect(body).toMatch(/moved_out_at\s+IS\s+NULL/);
    });

    it(`${rpc.name} has authenticated execution and no public or anonymous execution`, () => {
      expect(latestPermissionSource(rpc.name, rpc.signature, "authenticated grant").file).toMatch(/^\d+_.+\.sql$/);
      expect(latestPermissionSource(rpc.name, rpc.signature, "public revoke").file).toMatch(/^\d+_.+\.sql$/);
      expect(latestPermissionSource(rpc.name, rpc.signature, "anon revoke").file).toMatch(/^\d+_.+\.sql$/);
    });
  }
});

describe("Stage 3C v4 — protected society is never referenced", () => {
  const protectedUuid = (process.env.SOCIOHUB_PROTECTED_SOCIETY_ID?.trim() || "__unset_protected_society_id__");
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

