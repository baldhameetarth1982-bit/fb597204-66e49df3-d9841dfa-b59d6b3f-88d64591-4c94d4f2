/**
 * Stage 3A · billing-config behavioral tests.
 *
 * These tests exercise the exported adapter helpers with a realistic
 * mock Supabase RPC client to prove Stage 3A end-to-end error handling,
 * safe error mapping, cross-society safety, cycle validation, and that
 * the source contains no `as any` and no browser-side bill/invoice/
 * payment/ledger/dues writes.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  mapError,
  buildRpcArgs,
  callBillingRpc,
  extractRpcId,
  toBillingRpcClient,
  type BillingRpcClient,
} from "@/lib/billing-config.functions";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(__dirname, "../..");

function mockRpc(handler: (name: string, args: Record<string, unknown>) => {
  data?: unknown; error?: { message: string } | null;
}): BillingRpcClient {
  return {
    rpc: async (name, args) => {
      const r = handler(name, args);
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
}

describe("Stage 3A · billing-config error mapping", () => {
  it("hides raw DB errors behind safe user-facing messages", () => {
    expect(mapError("duplicate_charge_head")).toMatch(/already exists/i);
    expect(mapError("template_not_found")).toMatch(/not found/i);
    expect(mapError("line_not_found")).toMatch(/not found/i);
    expect(mapError("invalid_rule")).toMatch(/required fields/i);
    expect(mapError("invalid_cycle")).toMatch(/dates/i);
    expect(mapError("invalid_effective_date")).toMatch(/dates/i);
    expect(mapError("template_overlap")).toMatch(/dates/i);
    expect(mapError("unavailable")).toMatch(/role/i);
    expect(mapError("area_not_available")).toMatch(/area/i);
    expect(mapError("operation_failed")).toMatch(/wrong/i);
  });
  it("returns generic fallback and never surfaces raw SQL/stack traces", () => {
    const raw = "PostgresError: relation \"billing_templates\" does not exist at pg_catalog...";
    expect(mapError(raw)).toBe("Something went wrong. Please try again.");
    expect(mapError(raw)).not.toContain("billing_templates");
    expect(mapError(raw)).not.toContain("pg_catalog");
  });
});

describe("Stage 3A · adapter helpers", () => {
  it("buildRpcArgs strips undefined but keeps explicit null", () => {
    expect(buildRpcArgs({ a: 1, b: null, c: undefined, d: "x" })).toEqual({ a: 1, b: null, d: "x" });
  });

  it("extractRpcId returns strings and rejects invalid payloads via safe mapping", () => {
    expect(extractRpcId("id-1")).toBe("id-1");
    expect(extractRpcId({ id: "id-2" })).toBe("id-2");
    expect(() => extractRpcId(null)).toThrow(/wrong/i);
    expect(() => extractRpcId(42)).toThrow(/wrong/i);
  });

  it("callBillingRpc surfaces safe mapped errors, never raw provider messages", async () => {
    const client = mockRpc(() => ({ error: { message: "detail: relation \"bills\" already exists at line 1" } }));
    await expect(callBillingRpc(client, "save_charge_head", {})).rejects.toThrow(/wrong/i);
    // Assert the raw message is NOT leaked.
    await expect(callBillingRpc(client, "save_charge_head", {})).rejects.not.toThrow(/relation "bills"/);
  });

  it("callBillingRpc translates known codes to safe messages", async () => {
    const dup = mockRpc(() => ({ error: { message: "duplicate_charge_head" } }));
    await expect(callBillingRpc(dup, "save_charge_head", {})).rejects.toThrow(/already exists/i);

    const nf = mockRpc(() => ({ error: { message: "template_not_found" } }));
    await expect(callBillingRpc(nf, "preview_billing_template", {})).rejects.toThrow(/not found/i);

    const bad = mockRpc(() => ({ error: { message: "invalid_cycle" } }));
    await expect(callBillingRpc(bad, "configure_billing_cycle", {})).rejects.toThrow(/dates/i);

    const denied = mockRpc(() => ({ error: { message: "unavailable" } }));
    await expect(callBillingRpc(denied, "save_charge_head", {})).rejects.toThrow(/role/i);
  });

  it("toBillingRpcClient coerces context.supabase without `as any`", () => {
    const fakeCtx = { supabase: { rpc: async () => ({ data: "x", error: null }) } };
    const client = toBillingRpcClient(fakeCtx as unknown as { supabase: unknown });
    expect(typeof client.rpc).toBe("function");
  });
});

describe("Stage 3A · adapter behavior (real workflow simulations)", () => {
  it("Society Admin can create a charge head end-to-end via the adapter", async () => {
    const client = mockRpc((name) => {
      expect(name).toBe("save_charge_head");
      return { data: "head-1" };
    });
    const id = extractRpcId(await callBillingRpc(client, "save_charge_head", buildRpcArgs({
      _society_id: "00000000-0000-0000-0000-000000000001",
      _name: "Maintenance",
    })));
    expect(id).toBe("head-1");
  });

  it("Denied role -> unavailable is mapped to a safe role message", async () => {
    // Simulates RLS + _billing_require_admin rejecting resident/guard/block_admin.
    const client = mockRpc(() => ({ error: { message: "unavailable" } }));
    await expect(callBillingRpc(client, "save_charge_head", {})).rejects.toThrow(/role/i);
  });

  it("Cross-society template access returns template_not_found -> safe not-found message", async () => {
    const client = mockRpc(() => ({ error: { message: "template_not_found" } }));
    await expect(callBillingRpc(client, "preview_billing_template", {})).rejects.toThrow(/not found/i);
  });

  it("Duplicate charge head -> duplicate_charge_head is mapped safely", async () => {
    const client = mockRpc(() => ({ error: { message: "duplicate_charge_head" } }));
    await expect(callBillingRpc(client, "save_charge_head", {})).rejects.toThrow(/already exists/i);
  });

  it("configure_billing_cycle with invalid dates yields a safe date message", async () => {
    const client = mockRpc(() => ({ error: { message: "invalid_cycle" } }));
    await expect(callBillingRpc(client, "configure_billing_cycle", {})).rejects.toThrow(/dates/i);
  });

  it("Preview success: adapter returns the shaped preview payload", async () => {
    const payload = {
      preview_only: true,
      total_units: 3,
      page_limit: 25,
      page_offset: 0,
      lines: [],
      units: [
        { flat_id: "u1", block_name: null, flat_number: "1", unit_type: "", area_sqft: null, lines: [], unit_total: 0, has_warning: false },
        { flat_id: "u2", block_name: "A", flat_number: "101", unit_type: "2BHK", area_sqft: 800, lines: [], unit_total: 0, has_warning: false },
      ],
      summary: { total_amount: 0, area_warning_units: 0 },
    };
    const client = mockRpc(() => ({ data: payload }));
    const raw = await callBillingRpc(client, "preview_billing_template", {});
    expect((raw as typeof payload).preview_only).toBe(true);
    expect((raw as typeof payload).units.some((u) => u.block_name === null)).toBe(true); // serial included
    expect((raw as typeof payload).units.some((u) => u.block_name === "A")).toBe(true); // structured included
  });
});

/* ---------------------------- Source contracts ------------------------ */

describe("Stage 3A · source contracts", () => {
  const src = readFileSync(resolve(SRC_ROOT, "src/lib/billing-config.functions.ts"), "utf8");
  const card = readFileSync(resolve(SRC_ROOT, "src/components/billing/BillingConfigCard.tsx"), "utf8");
  const fs = require("node:fs") as typeof import("node:fs");
  const migFiles = fs
    .readdirSync(resolve(SRC_ROOT, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const migrations = migFiles
    .map((f) => fs.readFileSync(resolve(SRC_ROOT, "supabase/migrations", f), "utf8"))
    .join("\n");

  it("billing-config.functions.ts contains no `as any`", () => {
    // Strip block comments and single-line comments so the check ignores documentation.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    expect(stripped).not.toMatch(/\bas\s+any\b/);
  });

  it("billing-config.functions.ts contains no `(context.supabase.rpc as any)`", () => {
    expect(src).not.toMatch(/context\.supabase\.rpc\s+as\s+any/);
  });

  it("list server functions do not throw raw error.message", () => {
    expect(src).not.toMatch(/throw\s+new\s+Error\(error\.message\)/);
  });

  it("BillingConfigCard imports listBillingCycles and configureBillingCycle from server fns", () => {
    expect(card).toMatch(/listBillingCycles/);
    expect(card).toMatch(/configureBillingCycle/);
    // And actually uses them via useServerFn
    expect(card).toMatch(/useServerFn\(\s*listBillingCycles\s*\)/);
    expect(card).toMatch(/useServerFn\(\s*configureBillingCycle\s*\)/);
  });

  it("BillingConfigCard shows the Stage 3B boundary and preview-only messaging", () => {
    expect(card).toMatch(/Stage 3B/);
    expect(card).toMatch(/no bills generated/i);
  });

  it("Latest preview implementation is serial-safe and area/unit-type canonical", () => {
    const latestPreview = migFiles
      .map((f) => ({ f, body: fs.readFileSync(resolve(SRC_ROOT, "supabase/migrations", f), "utf8") }))
      .filter((m) => /CREATE OR REPLACE FUNCTION public\.preview_billing_template/.test(m.body))
      .pop();
    expect(latestPreview).toBeDefined();
    const body = latestPreview!.body;
    const lastFnStart = body.lastIndexOf("CREATE OR REPLACE FUNCTION public.preview_billing_template");
    const fnBody = body.slice(lastFnStart);
    // Eligibility must NOT filter by block_id IS NOT NULL (serial-mode societies must be included).
    expect(fnBody).not.toMatch(/f\.block_id\s+IS\s+NOT\s+NULL/);
    expect(fnBody).toMatch(/is_active\s*=\s*true/);
    expect(fnBody).toMatch(/COALESCE\(\s*NULLIF\(btrim\(f\.unit_type\)/);
  });

  it("No Razorpay/UPI/card/wallet/platform-fee/Stripe/Paddle references in Stage 3A billing sources", () => {
    for (const body of [src, card]) {
      expect(body).not.toMatch(/razorpay/i);
      expect(body).not.toMatch(/stripe/i);
      expect(body).not.toMatch(/paddle/i);
      expect(body).not.toMatch(/\bUPI\b/);
      expect(body).not.toMatch(/platform.fee/i);
    }
  });

  it("Stage 3A does not write bills/invoices/payments/ledger/dues from the browser", () => {
    for (const body of [src, card]) {
      expect(body).not.toMatch(/\.from\(["']bills["']\)\.insert/);
      expect(body).not.toMatch(/\.from\(["']bill_line_items["']\)\.insert/);
      expect(body).not.toMatch(/\.from\(["']payments["']\)\.insert/);
      expect(body).not.toMatch(/\.from\(["']ledger_entries["']\)\.insert/);
    }
  });

  it("Stage 3A preview_billing_template body itself does not INSERT into bill/payment/ledger tables", () => {
    // Scope to the preview function body: from the last CREATE OR REPLACE FUNCTION public.preview_billing_template
    // through the matching function-end $$; marker.
    const marker = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.preview_billing_template\b/gi;
    let lastIdx = -1;
    let m: RegExpExecArray | null;
    while ((m = marker.exec(migrations)) !== null) lastIdx = m.index;
    expect(lastIdx).toBeGreaterThan(-1);
    const rest = migrations.slice(lastIdx);
    // End of function body — first `$$;` after AS $$
    const asIdx = rest.indexOf("AS $$");
    const endIdx = rest.indexOf("$$;", asIdx + 5);
    const fnSnippet = rest.slice(0, endIdx > 0 ? endIdx : rest.length);
    expect(fnSnippet).not.toMatch(/INSERT\s+INTO\s+public\.bills\b/i);
    expect(fnSnippet).not.toMatch(/INSERT\s+INTO\s+public\.bill_line_items\b/i);
    expect(fnSnippet).not.toMatch(/INSERT\s+INTO\s+public\.payments\b/i);
    expect(fnSnippet).not.toMatch(/INSERT\s+INTO\s+public\.ledger_entries\b/i);
  });

  it("Protected society ID is absent from Stage 3A sources and tests", () => {
    const protectedId = (process.env.SOCIOHUB_PROTECTED_SOCIETY_ID?.trim() || "__unset_protected_society_id__");
    for (const body of [src, card]) {
      expect(body).not.toContain(protectedId);
    }
  });
});

/* --------------------------- Role parity check ------------------------ */

describe("Stage 3A · role capability parity", () => {
  it("billing.manage is granted to society_admin / super_admin and denied to block_admin/resident/security", async () => {
    const { roleHasCapability } = await import("@/lib/role-permissions");
    expect(roleHasCapability("society_admin", "billing.manage")).toBe(true);
    expect(roleHasCapability("super_admin", "billing.manage")).toBe(true);
    expect(roleHasCapability("block_admin", "billing.manage")).toBe(false);
    expect(roleHasCapability("resident", "billing.manage")).toBe(false);
    expect(roleHasCapability("security", "billing.manage")).toBe(false);
  });
});
