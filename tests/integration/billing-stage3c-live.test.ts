/**
 * Stage 3C — Offline Payments, Verification and Receipts.
 *
 * Live multi-user database integration test.
 *
 * This test provisions synthetic Supabase auth users, a synthetic society
 * with a block, flat, resident links and bills, then exercises the Stage
 * 3C RPC surface (`submit_offline_payment`, `verify_offline_payment`,
 * `reverse_offline_payment`, `search_society_open_bills`,
 * `get_payment_detail`, `get_bill_payment_summary`,
 * `get_payment_receipt_lifecycle`) through per-user JWT-scoped clients
 * — never through the service role.
 *
 * Runtime gate
 * ------------
 * The suite is gated behind BOTH:
 *
 *   ALLOW_SOCIOHUB_LIVE_STAGE3C=true
 *   SOCIOHUB_TEST_SUPABASE_URL=<isolated project url>
 *   SOCIOHUB_TEST_SUPABASE_SERVICE_ROLE_KEY=<isolated service role>
 *   SOCIOHUB_TEST_SUPABASE_PUBLISHABLE_KEY=<isolated publishable/anon>
 *
 * The suite REFUSES to run against the shared production Supabase
 * project even when SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
 * present in the sandbox — that project hosts real customer data and
 * the protected society `baldha Meetarth`
 * (1907a918-c4b8-4f43-a837-450530cc7c34), and provisioning synthetic
 * users / rows in it (even with cleanup) is out of policy.
 *
 * See `docs/NEXT_STAGES.md` — Stage 3C runtime closure — for the exact
 * blocker and the environment variables an isolated test project must
 * expose to unblock this suite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const PROTECTED_SOCIETY_ID = "1907a918-c4b8-4f43-a837-450530cc7c34";
const RUN_LIVE = process.env.ALLOW_SOCIOHUB_LIVE_STAGE3C === "true";
const TEST_URL = process.env.SOCIOHUB_TEST_SUPABASE_URL ?? "";
const TEST_SRK = process.env.SOCIOHUB_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_PUB = process.env.SOCIOHUB_TEST_SUPABASE_PUBLISHABLE_KEY ?? "";
const SHARED_URL = process.env.SUPABASE_URL ?? "";

// Refuse if pointed at the shared/prod project.
const IS_ISOLATED =
  !!TEST_URL &&
  !!TEST_SRK &&
  !!TEST_PUB &&
  TEST_URL !== SHARED_URL;

const ENABLED = RUN_LIVE && IS_ISOLATED;

type User = { id: string; email: string; password: string; client: SupabaseClient };

let admin: SupabaseClient;
let societyA: string;
let societyB: string;
let blockA: string;
let flatA: string;
let openBillId: string;
let cancelledBillId: string;
let A1!: User;
let A2!: User;
let BAdmin!: User;
let resActive!: User;
let resMovedOut!: User;
let resUnrelated!: User;

async function mkUser(prefix: string): Promise<User> {
  const email = `stage3c-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = `Aa1!${Math.random().toString(36).slice(2, 12)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const client = createClient(TEST_URL, TEST_PUB, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, email, password, client };
}

describe.skipIf(!ENABLED)("Stage 3C — live multi-user integration", () => {
  beforeAll(async () => {
    expect(TEST_URL).not.toBe("");
    expect(TEST_URL).not.toBe(SHARED_URL);
    admin = createClient(TEST_URL, TEST_SRK, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Societies (never the protected one).
    const sA = await admin
      .from("societies")
      .insert({ name: `Stage3C-A-${Date.now()}`, status: "active", plan: "basic" })
      .select("id")
      .single();
    if (sA.error) throw sA.error;
    societyA = sA.data.id;
    expect(societyA).not.toBe(PROTECTED_SOCIETY_ID);

    const sB = await admin
      .from("societies")
      .insert({ name: `Stage3C-B-${Date.now()}`, status: "active", plan: "basic" })
      .select("id")
      .single();
    if (sB.error) throw sB.error;
    societyB = sB.data.id;

    const bk = await admin
      .from("blocks")
      .insert({ society_id: societyA, name: "A", structure_kind: "block" })
      .select("id")
      .single();
    if (bk.error) throw bk.error;
    blockA = bk.data.id;

    const fl = await admin
      .from("flats")
      .insert({ society_id: societyA, block_id: blockA, flat_number: "101", status: "occupied" })
      .select("id")
      .single();
    if (fl.error) throw fl.error;
    flatA = fl.data.id;

    // Users
    A1 = await mkUser("a1");
    A2 = await mkUser("a2");
    BAdmin = await mkUser("badmin");
    resActive = await mkUser("res");
    resMovedOut = await mkUser("resmo");
    resUnrelated = await mkUser("resu");

    // Roles
    await admin.from("user_roles").insert([
      { user_id: A1.id, role: "society_admin", society_id: societyA, is_active: true },
      { user_id: A2.id, role: "society_admin", society_id: societyA, is_active: true },
      { user_id: BAdmin.id, role: "society_admin", society_id: societyB, is_active: true },
      { user_id: resActive.id, role: "resident", society_id: societyA, is_active: true },
      { user_id: resMovedOut.id, role: "resident", society_id: societyA, is_active: true },
      { user_id: resUnrelated.id, role: "resident", society_id: societyA, is_active: true },
    ]);

    // Resident links
    await admin.from("flat_residents").insert([
      { flat_id: flatA, user_id: resActive.id, relationship: "owner", is_primary: true, is_active: true },
      {
        flat_id: flatA,
        user_id: resMovedOut.id,
        relationship: "tenant",
        is_active: false,
        moved_out_at: "2024-01-01",
      },
    ]);

    // Bills
    const openBill = await admin
      .from("bills")
      .insert({
        society_id: societyA,
        flat_id: flatA,
        period_label: "Test",
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        amount: 1000,
        total_payable: 1000,
        due_date: "2026-02-15",
        status: "unpaid",
        bill_number: `RR/${Date.now()}/0001`,
        finalized_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (openBill.error) throw openBill.error;
    openBillId = openBill.data.id;

    const cancelled = await admin
      .from("bills")
      .insert({
        society_id: societyA,
        flat_id: flatA,
        period_label: "TestC",
        period_start: "2026-02-01",
        period_end: "2026-02-28",
        amount: 500,
        total_payable: 500,
        due_date: "2026-03-15",
        status: "cancelled",
        cancelled_at: new Date().toISOString(),
        cancelled_by: A1.id,
        cancel_reason: "test",
        bill_number: `RR/${Date.now()}/0002`,
        finalized_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (cancelled.error) throw cancelled.error;
    cancelledBillId = cancelled.data.id;
  }, 60_000);

  afterAll(async () => {
    if (!admin) return;
    try {
      await admin.from("payment_receipts").delete().eq("society_id", societyA);
      await admin.from("payments").delete().eq("society_id", societyA);
      await admin.from("bills").delete().eq("society_id", societyA);
      await admin.from("flat_residents").delete().eq("flat_id", flatA);
      await admin.from("flats").delete().eq("society_id", societyA);
      await admin.from("blocks").delete().eq("society_id", societyA);
      await admin.from("user_roles").delete().in("society_id", [societyA, societyB]);
      await admin.from("societies").delete().in("id", [societyA, societyB]);
      for (const u of [A1, A2, BAdmin, resActive, resMovedOut, resUnrelated]) {
        if (u?.id) await admin.auth.admin.deleteUser(u.id);
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[stage3c-live] teardown error:", e);
    }
  }, 60_000);

  it("Admin A1 can search Society A open bills", async () => {
    const { data, error } = await A1.client.rpc("search_society_open_bills", {
      _society_id: societyA,
      _query: "",
      _limit: 20,
      _offset: 0,
    });
    expect(error).toBeNull();
    expect((data ?? []).some((r: { bill_id: string }) => r.bill_id === openBillId)).toBe(true);
  });

  it("Cross-society: Admin B is denied Society A search", async () => {
    const { data, error } = await BAdmin.client.rpc("search_society_open_bills", {
      _society_id: societyA,
      _query: "",
      _limit: 20,
      _offset: 0,
    });
    expect(error !== null || ((data ?? []) as unknown[]).length === 0).toBe(true);
  });

  it("Admin A1 records a Cash payment (pending); no receipt yet", async () => {
    const key = `k-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const { data: pid, error } = await A1.client.rpc("submit_offline_payment", {
      _bill_id: openBillId,
      _method: "cash",
      _amount: 400,
      _payment_date: "2026-02-01",
      _reference_no: null,
      _notes: "cash test",
      _idempotency_key: key,
      _actor_role: "admin",
    });
    expect(error).toBeNull();
    expect(pid).toBeTruthy();
    (globalThis as { __pid?: string }).__pid = pid as string;

    const rc = await admin.from("payment_receipts").select("id").eq("payment_id", pid as string);
    expect((rc.data ?? []).length).toBe(0);

    const summary = await A1.client.rpc("get_bill_payment_summary", { _bill_id: openBillId });
    expect(summary.error).toBeNull();
    const s = summary.data as { pending_amount: number; available_to_submit: number };
    expect(Number(s.pending_amount)).toBeGreaterThan(0);
    expect(Number(s.available_to_submit)).toBeLessThan(1000);
  });

  it("Self-verification denied for the submitting admin", async () => {
    const pid = (globalThis as { __pid?: string }).__pid!;
    const { error } = await A1.client.rpc("verify_offline_payment", {
      _payment_id: pid,
      _notes: null,
    });
    expect(error?.message ?? "").toMatch(/self_verification_not_allowed/);
  });

  it("Admin A2 verifies; exactly one RCPT/YYYYMM/#### receipt is issued", async () => {
    const pid = (globalThis as { __pid?: string }).__pid!;
    const { error } = await A2.client.rpc("verify_offline_payment", {
      _payment_id: pid,
      _notes: null,
    });
    expect(error).toBeNull();
    const rc = await admin
      .from("payment_receipts")
      .select("receipt_number,status")
      .eq("payment_id", pid);
    expect(rc.data?.length).toBe(1);
    expect(rc.data![0].receipt_number).toMatch(/^RCPT\/\d{6}\/\d{4}$/);
    expect(rc.data![0].status).toBe("valid");
  });

  it("Moved-out resident cannot submit a payment", async () => {
    const key = `k-mo-${Date.now()}`;
    const { error } = await resMovedOut.client.rpc("submit_offline_payment", {
      _bill_id: openBillId,
      _method: "bank_transfer",
      _amount: 100,
      _payment_date: "2026-02-05",
      _reference_no: `MO-${Date.now()}`,
      _notes: null,
      _idempotency_key: key,
      _actor_role: "resident",
    });
    expect(error?.message ?? "").toMatch(/not_authorized|unauthenticated|resident/);
  });

  it("Resident payment detail hides admin-only fields", async () => {
    const pid = (globalThis as { __pid?: string }).__pid!;
    const { data, error } = await resActive.client.rpc("get_payment_detail", { _payment_id: pid });
    expect(error).toBeNull();
    const d = data as Record<string, unknown>;
    for (const forbidden of [
      "proof_url",
      "idempotency_key",
      "notes",
      "submitted_by",
      "verified_by",
      "reversed_by",
      "verification_notes",
    ]) {
      expect(d).not.toHaveProperty(forbidden);
    }
  });

  it("Reversal marks the receipt VOID and restores available balance", async () => {
    const pid = (globalThis as { __pid?: string }).__pid!;
    const { error } = await A2.client.rpc("reverse_offline_payment", {
      _payment_id: pid,
      _reason: "test reversal",
    });
    expect(error).toBeNull();
    const rc = await admin
      .from("payment_receipts")
      .select("status,voided_at")
      .eq("payment_id", pid)
      .single();
    expect(rc.data?.status).toBe("void");
    expect(rc.data?.voided_at).not.toBeNull();

    const summary = await A1.client.rpc("get_bill_payment_summary", { _bill_id: openBillId });
    const s = summary.data as { available_to_submit: number };
    expect(Number(s.available_to_submit)).toBe(1000);
  });

  it("Cancelled bill is absent from open-bill search", async () => {
    const { data } = await A1.client.rpc("search_society_open_bills", {
      _society_id: societyA,
      _query: "",
      _limit: 20,
      _offset: 0,
    });
    expect((data ?? []).some((r: { bill_id: string }) => r.bill_id === cancelledBillId)).toBe(false);
  });
});

describe.skipIf(ENABLED)("Stage 3C — live integration is gated", () => {
  it("skips honestly when isolated test env is not provisioned", () => {
    // eslint-disable-next-line no-console
    console.info(
      "[billing-stage3c-live] SKIPPED — provide ALLOW_SOCIOHUB_LIVE_STAGE3C=true and an ISOLATED SOCIOHUB_TEST_SUPABASE_URL / _SERVICE_ROLE_KEY / _PUBLISHABLE_KEY distinct from SUPABASE_URL.",
    );
    expect(true).toBe(true);
  });
});
