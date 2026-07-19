/**
 * Stage 3C — Offline Payments, Verification and Receipts.
 *
 * Live multi-user database integration test.
 *
 * Gating
 * ------
 * The suite is opt-in via `ALLOW_SOCIOHUB_LIVE_STAGE3C=true`. When that env
 * flag is set, the isolated project variables are REQUIRED and the suite
 * hard-fails in `beforeAll` if any are missing or point at a shared/prod
 * URL — it does NOT silently skip. When the flag is unset (local `vitest`
 * runs from a developer machine or the Lovable sandbox) the entire
 * describe is skipped via `describe.skip` — with no fake "gated" passing
 * test.
 *
 *   ALLOW_SOCIOHUB_LIVE_STAGE3C=true
 *   SOCIOHUB_TEST_SUPABASE_URL=<isolated project url>
 *   SOCIOHUB_TEST_SUPABASE_SERVICE_ROLE_KEY=<isolated service role>
 *   SOCIOHUB_TEST_SUPABASE_PUBLISHABLE_KEY=<isolated publishable/anon>
 *
 * The suite runs against a DISPOSABLE local/isolated Supabase stack
 * only — GitHub Actions boots `supabase start` on the runner and exports
 * the values above from `supabase status -o env`. It NEVER runs against
 * the shared production project.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parsePaymentDetailResponse } from "@/lib/offline-payments.functions";

const RUN_LIVE = process.env.ALLOW_SOCIOHUB_LIVE_STAGE3C === "true";
const TEST_URL = process.env.SOCIOHUB_TEST_SUPABASE_URL ?? "";
const TEST_SRK = process.env.SOCIOHUB_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
const TEST_PUB = process.env.SOCIOHUB_TEST_SUPABASE_PUBLISHABLE_KEY ?? "";
const SHARED_URL = process.env.SUPABASE_URL ?? "";

type User = { id: string; email: string; password: string; client: SupabaseClient };

// Track fixture IDs for teardown.
const created = {
  auth_users: [] as string[],
  societies: [] as string[],
  blocks: [] as string[],
  flats: [] as string[],
  bills: [] as string[],
};

let admin: SupabaseClient;
let societyA = "";
let societyB = "";
let blockA = "";
let flatA = "";
let openBillId = "";
let cancelledBillId = "";
let A1!: User;
let A2!: User;
let BAdmin!: User;
let resActive!: User;
let resMovedOut!: User;
let resUnrelated!: User;
let pendingPaymentId = "";

async function mkUser(prefix: string): Promise<User> {
  const email = `stage3c-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const password = `Aa1!${Math.random().toString(36).slice(2, 12)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  created.auth_users.push(data.user.id);
  const client = createClient(TEST_URL, TEST_PUB, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, email, password, client };
}

const gate = RUN_LIVE ? describe : describe.skip;

gate("Stage 3C — live multi-user integration", () => {
  beforeAll(async () => {
    // Hard preflight — never silent.
    if (!TEST_URL || !TEST_SRK || !TEST_PUB) {
      throw new Error(
        "Stage 3C live suite requires SOCIOHUB_TEST_SUPABASE_URL / _SERVICE_ROLE_KEY / _PUBLISHABLE_KEY when ALLOW_SOCIOHUB_LIVE_STAGE3C=true.",
      );
    }
    if (SHARED_URL && TEST_URL === SHARED_URL) {
      throw new Error(
        "Stage 3C live suite refuses to run against the shared SUPABASE_URL. Use a disposable isolated project.",
      );
    }
    if (!/^https?:\/\/(localhost|127\.0\.0\.1|host\.docker\.internal|.+\.supabase\.internal)/i.test(TEST_URL)
        && !TEST_URL.includes("kong")) {
      // Best-effort: local Supabase URLs from `supabase status -o env` use
      // localhost / 127.0.0.1 / kong. If someone points this at a hosted
      // project, allow it but ensure it isn't the shared URL (checked above).
    }

    admin = createClient(TEST_URL, TEST_SRK, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const sA = await admin
      .from("societies")
      .insert({ name: `Stage3C-A-${Date.now()}`, status: "active", plan: "basic" })
      .select("id")
      .single();
    if (sA.error) throw sA.error;
    societyA = sA.data.id;
    created.societies.push(societyA);

    const sB = await admin
      .from("societies")
      .insert({ name: `Stage3C-B-${Date.now()}`, status: "active", plan: "basic" })
      .select("id")
      .single();
    if (sB.error) throw sB.error;
    societyB = sB.data.id;
    created.societies.push(societyB);

    const bk = await admin
      .from("blocks")
      .insert({ society_id: societyA, name: "A", structure_kind: "block" })
      .select("id")
      .single();
    if (bk.error) throw bk.error;
    blockA = bk.data.id;
    created.blocks.push(blockA);

    const fl = await admin
      .from("flats")
      .insert({ society_id: societyA, block_id: blockA, flat_number: "101", status: "occupied" })
      .select("id")
      .single();
    if (fl.error) throw fl.error;
    flatA = fl.data.id;
    created.flats.push(flatA);

    A1 = await mkUser("a1");
    A2 = await mkUser("a2");
    BAdmin = await mkUser("badmin");
    resActive = await mkUser("res");
    resMovedOut = await mkUser("resmo");
    resUnrelated = await mkUser("resu");

    const roles = await admin.from("user_roles").insert([
      { user_id: A1.id, role: "society_admin", society_id: societyA, is_active: true },
      { user_id: A2.id, role: "society_admin", society_id: societyA, is_active: true },
      { user_id: BAdmin.id, role: "society_admin", society_id: societyB, is_active: true },
      { user_id: resActive.id, role: "resident", society_id: societyA, is_active: true },
      { user_id: resMovedOut.id, role: "resident", society_id: societyA, is_active: true },
      { user_id: resUnrelated.id, role: "resident", society_id: societyA, is_active: true },
    ]);
    if (roles.error) throw roles.error;

    const links = await admin.from("flat_residents").insert([
      { flat_id: flatA, user_id: resActive.id, relationship: "owner", is_primary: true, is_active: true },
      {
        flat_id: flatA,
        user_id: resMovedOut.id,
        relationship: "tenant",
        is_active: false,
        moved_out_at: "2024-01-01",
      },
    ]);
    if (links.error) throw links.error;

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
    created.bills.push(openBillId);

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
    created.bills.push(cancelledBillId);
  }, 120_000);

  afterAll(async () => {
    if (!admin) return;
    const errors: unknown[] = [];
    const run = async <T>(label: string, p: PromiseLike<T>) => {
      try {
        await p;
      } catch (e) {
        errors.push({ label, e });
      }
    };
    if (created.bills.length) {
      await run("receipts", admin.from("payment_receipts").delete().in("bill_id", created.bills));
      await run("payments", admin.from("payments").delete().in("bill_id", created.bills));
      await run("bills", admin.from("bills").delete().in("id", created.bills));
    }
    if (created.flats.length) {
      await run("residents", admin.from("flat_residents").delete().in("flat_id", created.flats));
      await run("flats", admin.from("flats").delete().in("id", created.flats));
    }
    if (created.blocks.length)
      await run("blocks", admin.from("blocks").delete().in("id", created.blocks));
    if (created.societies.length) {
      await run("user_roles", admin.from("user_roles").delete().in("society_id", created.societies));
      await run("societies", admin.from("societies").delete().in("id", created.societies));
    }
    for (const uid of created.auth_users) {
      await run(`auth:${uid}`, admin.auth.admin.deleteUser(uid) as unknown as PromiseLike<unknown>);
    }
    if (errors.length) {
      // eslint-disable-next-line no-console
      console.error("[stage3c-live] teardown errors:", errors);
      throw new Error(`Stage 3C teardown had ${errors.length} error(s)`);
    }
  }, 120_000);

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

  it("Cross-society: Admin B is denied Society A search with a real error", async () => {
    const { error } = await BAdmin.client.rpc("search_society_open_bills", {
      _society_id: societyA,
      _query: "",
      _limit: 20,
      _offset: 0,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not_authorized|permission|forbidden/i);
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
    pendingPaymentId = pid as string;

    const rc = await admin.from("payment_receipts").select("id").eq("payment_id", pendingPaymentId);
    expect(rc.error).toBeNull();
    expect((rc.data ?? []).length).toBe(0);

    const summary = await A1.client.rpc("get_bill_payment_summary", { _bill_id: openBillId });
    expect(summary.error).toBeNull();
    const s = summary.data as { pending_amount: number; available_to_submit: number };
    expect(Number(s.pending_amount)).toBe(400);
    expect(Number(s.available_to_submit)).toBe(600);
  });

  it("Self-verification denied for the submitting admin", async () => {
    const { error } = await A1.client.rpc("verify_offline_payment", {
      _payment_id: pendingPaymentId,
      _notes: null,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/self_verification_not_allowed/);
  });

  it("Admin A2 verifies; exactly one RCPT/YYYYMM/#### receipt is issued", async () => {
    const { error } = await A2.client.rpc("verify_offline_payment", {
      _payment_id: pendingPaymentId,
      _notes: null,
    });
    expect(error).toBeNull();
    const rc = await admin
      .from("payment_receipts")
      .select("receipt_number,status")
      .eq("payment_id", pendingPaymentId);
    expect(rc.error).toBeNull();
    expect(rc.data?.length).toBe(1);
    expect(rc.data![0].receipt_number).toMatch(/^RCPT\/\d{6}\/\d{4}$/);
    expect(rc.data![0].status).toBe("valid");
  });

  it("Moved-out resident cannot submit a payment", async () => {
    const { error } = await resMovedOut.client.rpc("submit_offline_payment", {
      _bill_id: openBillId,
      _method: "bank_transfer",
      _amount: 100,
      _payment_date: "2026-02-05",
      _reference_no: `MO-${Date.now()}`,
      _notes: null,
      _idempotency_key: `k-mo-${Date.now()}`,
      _actor_role: "resident",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not_authorized|resident_not_active|moved_out/i);
  });

  it("Unrelated resident cannot read the payment detail", async () => {
    const { error } = await resUnrelated.client.rpc("get_payment_detail", {
      _payment_id: pendingPaymentId,
    });
    expect(error).not.toBeNull();
  });

  it("Resident payment detail hides admin-only fields and passes the production parser", async () => {
    const { data, error } = await resActive.client.rpc("get_payment_detail", {
      _payment_id: pendingPaymentId,
    });
    expect(error).toBeNull();
    const parsed = parsePaymentDetailResponse(data);
    expect(parsed.audience).toBe("resident");
    const flat = JSON.stringify(parsed);
    for (const forbidden of [
      "proof_url",
      "idempotency_key",
      "submitted_by",
      "verified_by",
      "reversed_by",
      "verification_notes",
      "voided_by",
    ]) {
      expect(flat).not.toContain(`"${forbidden}"`);
    }
  });

  it("Reversal marks the receipt VOID and restores available balance", async () => {
    const { error } = await A2.client.rpc("reverse_offline_payment", {
      _payment_id: pendingPaymentId,
      _reason: "test reversal",
    });
    expect(error).toBeNull();
    const rc = await admin
      .from("payment_receipts")
      .select("status,voided_at")
      .eq("payment_id", pendingPaymentId)
      .single();
    expect(rc.error).toBeNull();
    expect(rc.data?.status).toBe("void");
    expect(rc.data?.voided_at).not.toBeNull();

    const summary = await A1.client.rpc("get_bill_payment_summary", { _bill_id: openBillId });
    expect(summary.error).toBeNull();
    const s = summary.data as { available_to_submit: number };
    expect(Number(s.available_to_submit)).toBe(1000);
  });

  it("Cancelled bill is absent from open-bill search", async () => {
    const { data, error } = await A1.client.rpc("search_society_open_bills", {
      _society_id: societyA,
      _query: "",
      _limit: 50,
      _offset: 0,
    });
    expect(error).toBeNull();
    expect((data ?? []).some((r: { bill_id: string }) => r.bill_id === cancelledBillId)).toBe(false);
  });
});
