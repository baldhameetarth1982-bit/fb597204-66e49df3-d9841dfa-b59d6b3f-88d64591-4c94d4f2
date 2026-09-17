/**
 * Stage 3C v4 — final closure.
 *
 * Behavioral guards:
 *  - Server functions expose an explicit split between resident and admin
 *    submission, and the browser never picks the actor role.
 *  - Resident-facing RPCs consider only ACTIVE flat_residents rows
 *    (is_active = true AND moved_out_at IS NULL). Moved-out residents
 *    cannot read history, receipts, or submit new payments.
 *  - Every resident-facing RPC is executable by authenticated users only.
 *  - `get_payment_detail` exists as a server-authoritative payment read.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const fnSrc = readFileSync("src/lib/offline-payments.functions.ts", "utf8");
const residentCoreSrc = readFileSync(
  "src/lib/offline-payment-resident-submit.ts",
  "utf8",
);
const submitCard = readFileSync(
  "src/components/billing/OfflinePaymentSubmitCard.tsx",
  "utf8",
);

type Migration = { file: string; sql: string };
type Principal = "authenticated" | "PUBLIC" | "anon";
type Permission = "grant" | "revoke";

type ResidentScopedRpc = {
  name: string;
  signaturePattern: string;
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadMigrations(): Migration[] {
  const directory = join(process.cwd(), "supabase/migrations");
  return readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => ({
      file,
      sql: readFileSync(join(directory, file), "utf8"),
    }));
}

const migrations = loadMigrations();

function functionDefinitions(sql: string, rpc: string) {
  const pattern = new RegExp(
    `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${escapeRegExp(rpc)}\\s*\\([\\s\\S]*?\\bAS\\s+(\\$[A-Za-z_]*\\$)[\\s\\S]*?\\1\\s*;`,
    "gi",
  );
  return [...sql.matchAll(pattern)].map((match) => match[0]);
}

function latestFunctionDefinition(rpc: string) {
  for (const migration of [...migrations].reverse()) {
    const definition = functionDefinitions(migration.sql, rpc).at(-1);
    if (definition) return { ...migration, definition };
  }
  throw new Error(
    `No CREATE OR REPLACE FUNCTION definition found for public.${rpc}`,
  );
}

function permissionStatements(
  migration: Migration,
  rpc: ResidentScopedRpc,
  principal: Principal,
) {
  const functionPattern = `public\\.${escapeRegExp(rpc.name)}\\s*\\(${rpc.signaturePattern}\\)`;
  const statementPattern = new RegExp(
    `(GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+${functionPattern}\\s+TO\\s+[^;]+|REVOKE\\s+(?:ALL|EXECUTE)\\s+ON\\s+FUNCTION\\s+${functionPattern}\\s+FROM\\s+[^;]+);`,
    "gi",
  );

  return [...migration.sql.matchAll(statementPattern)]
    .filter((match) => {
      const roles = match[0].match(/\b(?:TO|FROM)\s+([^;]+);/i)?.[1] ?? "";
      return roles
        .split(",")
        .map((role) => role.trim().toLowerCase())
        .includes(principal.toLowerCase());
    })
    .map((match) => ({
      file: migration.file,
      index: match.index ?? -1,
      permission: /^GRANT\b/i.test(match[0])
        ? ("grant" as const)
        : ("revoke" as const),
      statement: match[0],
    }));
}

function latestPermissionStatement(
  rpc: ResidentScopedRpc,
  principal: Principal,
) {
  for (const migration of [...migrations].reverse()) {
    const statement = permissionStatements(migration, rpc, principal).at(-1);
    if (statement) return statement;
  }
  throw new Error(
    `No permission statement found for public.${rpc.name} and ${principal}`,
  );
}

function expectLatestPermission(
  rpc: ResidentScopedRpc,
  principal: Principal,
  expected: Permission,
) {
  const permission = latestPermissionStatement(rpc, principal);
  expect(permission.file).toMatch(/^\d+_.+\.sql$/);
  expect(permission.permission, permission.statement).toBe(expected);
}

const residentScopedRpcs: readonly ResidentScopedRpc[] = [
  { name: "get_bill_payment_summary", signaturePattern: "uuid" },
  {
    name: "get_resident_payments_v1",
    signaturePattern: "(?:int|integer)\\s*,\\s*(?:int|integer)",
  },
  { name: "get_payment_receipt_lifecycle", signaturePattern: "uuid" },
  {
    name: "submit_offline_payment",
    signaturePattern:
      "uuid\\s*,\\s*text\\s*,\\s*numeric\\s*,\\s*date\\s*,\\s*text\\s*,\\s*text\\s*,\\s*text\\s*,\\s*text",
  },
  { name: "get_payment_detail", signaturePattern: "uuid" },
];

describe("Stage 3C v4 — split resident/admin submission server functions", () => {
  it("exports submitResidentBankTransfer and recordAdminOfflinePayment", () => {
    expect(fnSrc).toMatch(/export const submitResidentBankTransfer\b/);
    expect(fnSrc).toMatch(/export const recordAdminOfflinePayment\b/);
  });

  it("resident schema has NO method and NO actorRole fields", () => {
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
    expect(fnSrc).toMatch(/residentSubmitInputSchema/);
  });

  it("admin-record schema has NO actorRole field", () => {
    const block =
      fnSrc.match(/const adminRecordInput = z\.object\({[\s\S]*?}\)/)?.[0] ??
      "";
    expect(block).not.toMatch(/actorRole/);
    expect(block).toMatch(/method: z\.enum\(\["cash", "bank_transfer"\]\)/);
  });

  it("resident server fn fixes the actor role and payment method", () => {
    expect(fnSrc).toMatch(/submitResidentBankTransferWithClient/);
    expect(residentCoreSrc).toMatch(/_actor_role:\s*"resident"/);
    expect(residentCoreSrc).toMatch(/_method:\s*"bank_transfer"/);
  });

  it("admin server fn fixes the actor role", () => {
    const block =
      fnSrc.match(/export const recordAdminOfflinePayment[\s\S]{0,1400}/)?.[0] ??
      "";
    expect(block).toMatch(/_actor_role: "admin"/);
  });

  it("legacy submitOfflinePayment remains removed", () => {
    expect(fnSrc).not.toMatch(/export const submitOfflinePayment\b/);
  });
});

describe("Stage 3C v4 — resident submission card contract", () => {
  it("uses submitResidentBankTransfer and never sends actorRole", () => {
    expect(submitCard).toMatch(/useServerFn\(submitResidentBankTransfer\)/);
    expect(submitCard).not.toMatch(/actorRole/);
  });

  it("does not send a browser-chosen method to the server", () => {
    const dataBlock = submitCard.match(/data:\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(dataBlock).not.toMatch(/\bmethod\b\s*[,:]/);
  });
});

describe("Stage 3C v4 — server payment detail RPC", () => {
  it("server function getPaymentDetail exists and calls get_payment_detail", () => {
    expect(fnSrc).toMatch(/export const getPaymentDetail\b/);
    expect(fnSrc).toContain('"get_payment_detail"');
  });
});

describe("Stage 3C v4 — resident RPC authorization", () => {
  for (const rpc of residentScopedRpcs) {
    it(`${rpc.name} has a latest concrete function definition`, () => {
      const { definition, file } = latestFunctionDefinition(rpc.name);
      expect(file).toMatch(/^\d+_.+\.sql$/);
      expect(definition).toMatch(
        new RegExp(
          `CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${escapeRegExp(rpc.name)}\\s*\\(`,
          "i",
        ),
      );
    });

    it(`${rpc.name} enforces active, non-moved-out occupancy`, () => {
      const { definition } = latestFunctionDefinition(rpc.name);
      expect(definition).toMatch(/flat_residents/);
      expect(definition).toMatch(/is_active\s*=\s*true/);
      expect(definition).toMatch(/moved_out_at\s+IS\s+NULL/);
    });

    it(`${rpc.name} latest permissions allow authenticated users only`, () => {
      expectLatestPermission(rpc, "authenticated", "grant");
      expectLatestPermission(rpc, "PUBLIC", "revoke");
      expectLatestPermission(rpc, "anon", "revoke");
    });
  }
});

describe("Stage 3C v4 — protected society is never referenced", () => {
  const protectedUuid =
    process.env.SOCIOHUB_PROTECTED_SOCIETY_ID?.trim() ||
    "__unset_protected_society_id__";
  const paths = [
    "src/lib/offline-payments.functions.ts",
    "src/components/billing/OfflinePaymentSubmitCard.tsx",
  ];

  for (const path of paths) {
    it(`${path} has no protected society UUID`, () => {
      expect(readFileSync(path, "utf8")).not.toContain(protectedUuid);
    });
  }
});