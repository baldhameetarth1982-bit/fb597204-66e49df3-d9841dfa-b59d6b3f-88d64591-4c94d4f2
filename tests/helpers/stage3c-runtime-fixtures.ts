/**
 * Stage 3C — shared runtime fixture module.
 *
 * Consumed by:
 *   - tests/integration/billing-stage3c-live.test.ts (vitest live matrix)
 *   - tests/e2e/stage3c-fixtures.ts (Playwright browser scenarios)
 *
 * The module is transport-agnostic: it constructs an authoritative Supabase
 * service-role client against the isolated (local `supabase start`) stack
 * whose URL and keys are injected by the GitHub Actions workflow. It never
 * touches the shared production project and refuses to run when the
 * caller has not opted in via `ALLOW_SOCIOHUB_LIVE_STAGE3C=true`.
 *
 * This module intentionally does NOT contain any protected-society
 * literal — the workflow's mandatory scan asserts that.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type SyntheticUser = {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

export type Stage3CFixture = {
  prefix: string;
  admin: SupabaseClient;
  societyA: string;
  societyB: string;
  blockA: string;
  flatA: string;
  unrelatedFlat: string;
  openBillId: string;
  openBillId2: string;
  cancelledBillId: string;
  users: {
    adminA1: SyntheticUser;
    adminA2: SyntheticUser;
    adminB: SyntheticUser;
    blockAdmin: SyntheticUser;
    guard: SyntheticUser;
    activeResident: SyntheticUser;
    movedOutResident: SyntheticUser;
    unrelatedResident: SyntheticUser;
  };
  cleanup: () => Promise<void>;
};

export type Stage3CEnv = {
  url: string;
  serviceRoleKey: string;
  publishableKey: string;
};

/**
 * Read and validate the isolated-Supabase environment. Throws when
 * caller has not opted in, when required values are missing, or when
 * the URL points at the shared production project.
 */
export function requireStage3CEnv(): Stage3CEnv {
  if (process.env.ALLOW_SOCIOHUB_LIVE_STAGE3C !== "true") {
    throw new Error(
      "Stage 3C live fixtures require ALLOW_SOCIOHUB_LIVE_STAGE3C=true. Refusing to run.",
    );
  }
  const url = process.env.SOCIOHUB_TEST_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SOCIOHUB_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
  const publishableKey = process.env.SOCIOHUB_TEST_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !serviceRoleKey || !publishableKey) {
    throw new Error(
      "Stage 3C fixtures require SOCIOHUB_TEST_SUPABASE_URL / _SERVICE_ROLE_KEY / _PUBLISHABLE_KEY.",
    );
  }
  const shared = process.env.SUPABASE_URL ?? "";
  if (shared && shared === url) {
    throw new Error(
      "Stage 3C fixtures refuse to run against the shared SUPABASE_URL. Use a disposable isolated project.",
    );
  }
  return { url, serviceRoleKey, publishableKey };
}

function makePrefix(): string {
  return `s3c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function mkUser(
  admin: SupabaseClient,
  env: Stage3CEnv,
  prefix: string,
  slug: string,
  tracked: string[],
): Promise<SyntheticUser> {
  const email = `${prefix}-${slug}@example.test`;
  const password = `Aa1!${Math.random().toString(36).slice(2, 12)}`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error(`createUser(${slug}) failed`);
  tracked.push(data.user.id);
  const client = createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { id: data.user.id, email, password, client };
}

/**
 * Provision a full Stage 3C fixture graph. Every mutation checks `.error`
 * and every created row is tracked for strict teardown.
 */
export async function setupStage3CFixture(): Promise<Stage3CFixture> {
  const env = requireStage3CEnv();
  const prefix = makePrefix();
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const tracked = {
    auth_users: [] as string[],
    societies: [] as string[],
    blocks: [] as string[],
    flats: [] as string[],
    bills: [] as string[],
  };

  const sA = await admin
    .from("societies")
    .insert({ name: `${prefix}-A`, status: "active", plan: "basic" })
    .select("id")
    .single();
  if (sA.error) throw sA.error;
  const societyA = sA.data.id as string;
  tracked.societies.push(societyA);

  const sB = await admin
    .from("societies")
    .insert({ name: `${prefix}-B`, status: "active", plan: "basic" })
    .select("id")
    .single();
  if (sB.error) throw sB.error;
  const societyB = sB.data.id as string;
  tracked.societies.push(societyB);

  const bk = await admin
    .from("blocks")
    .insert({ society_id: societyA, name: "A", structure_kind: "block" })
    .select("id")
    .single();
  if (bk.error) throw bk.error;
  const blockA = bk.data.id as string;
  tracked.blocks.push(blockA);

  const fl = await admin
    .from("flats")
    .insert({
      society_id: societyA,
      block_id: blockA,
      flat_number: "101",
      status: "occupied",
    })
    .select("id")
    .single();
  if (fl.error) throw fl.error;
  const flatA = fl.data.id as string;
  tracked.flats.push(flatA);

  const unrelated = await admin
    .from("flats")
    .insert({
      society_id: societyA,
      block_id: blockA,
      flat_number: "202",
      status: "occupied",
    })
    .select("id")
    .single();
  if (unrelated.error) throw unrelated.error;
  const unrelatedFlat = unrelated.data.id as string;
  tracked.flats.push(unrelatedFlat);

  const adminA1 = await mkUser(admin, env, prefix, "a1", tracked.auth_users);
  const adminA2 = await mkUser(admin, env, prefix, "a2", tracked.auth_users);
  const adminB = await mkUser(admin, env, prefix, "badmin", tracked.auth_users);
  const blockAdmin = await mkUser(admin, env, prefix, "ba", tracked.auth_users);
  const guard = await mkUser(admin, env, prefix, "guard", tracked.auth_users);
  const activeResident = await mkUser(admin, env, prefix, "res", tracked.auth_users);
  const movedOutResident = await mkUser(admin, env, prefix, "resmo", tracked.auth_users);
  const unrelatedResident = await mkUser(admin, env, prefix, "resu", tracked.auth_users);

  const roles = await admin.from("user_roles").insert([
    { user_id: adminA1.id, role: "society_admin", society_id: societyA, is_active: true },
    { user_id: adminA2.id, role: "society_admin", society_id: societyA, is_active: true },
    { user_id: adminB.id, role: "society_admin", society_id: societyB, is_active: true },
    { user_id: blockAdmin.id, role: "block_admin", society_id: societyA, is_active: true },
    { user_id: guard.id, role: "guard", society_id: societyA, is_active: true },
    { user_id: activeResident.id, role: "resident", society_id: societyA, is_active: true },
    { user_id: movedOutResident.id, role: "resident", society_id: societyA, is_active: true },
    { user_id: unrelatedResident.id, role: "resident", society_id: societyA, is_active: true },
  ]);
  if (roles.error) throw roles.error;

  const links = await admin.from("flat_residents").insert([
    {
      flat_id: flatA,
      user_id: activeResident.id,
      relationship: "owner",
      is_primary: true,
      is_active: true,
    },
    {
      flat_id: flatA,
      user_id: movedOutResident.id,
      relationship: "tenant",
      is_active: false,
      moved_out_at: "2024-01-01",
    },
  ]);
  if (links.error) throw links.error;

  async function addBill(
    label: string,
    amount: number,
    status: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const bill = await admin
      .from("bills")
      .insert({
        society_id: societyA,
        flat_id: flatA,
        period_label: label,
        period_start: "2026-01-01",
        period_end: "2026-01-31",
        amount,
        total_payable: amount,
        due_date: "2026-02-15",
        status,
        bill_number: `RR/${prefix}/${label}`,
        finalized_at: new Date().toISOString(),
        ...extra,
      })
      .select("id")
      .single();
    if (bill.error) throw bill.error;
    tracked.bills.push(bill.data.id as string);
    return bill.data.id as string;
  }

  const openBillId = await addBill("open1", 1000, "unpaid");
  const openBillId2 = await addBill("open2", 750, "unpaid");
  const cancelledBillId = await addBill("canc", 500, "cancelled", {
    cancelled_at: new Date().toISOString(),
    cancelled_by: adminA1.id,
    cancel_reason: "test",
  });

  async function cleanup(): Promise<void> {
    const errors: unknown[] = [];
    const run = async <T>(label: string, p: PromiseLike<T>) => {
      try {
        await p;
      } catch (e) {
        errors.push({ label, e });
      }
    };
    if (tracked.bills.length) {
      await run(
        "receipts",
        admin.from("payment_receipts").delete().in("bill_id", tracked.bills),
      );
      await run("payments", admin.from("payments").delete().in("bill_id", tracked.bills));
      await run("bills", admin.from("bills").delete().in("id", tracked.bills));
    }
    if (tracked.flats.length) {
      await run(
        "residents",
        admin.from("flat_residents").delete().in("flat_id", tracked.flats),
      );
      await run("flats", admin.from("flats").delete().in("id", tracked.flats));
    }
    if (tracked.blocks.length)
      await run("blocks", admin.from("blocks").delete().in("id", tracked.blocks));
    if (tracked.societies.length) {
      await run(
        "user_roles",
        admin.from("user_roles").delete().in("society_id", tracked.societies),
      );
      await run("societies", admin.from("societies").delete().in("id", tracked.societies));
    }
    for (const uid of tracked.auth_users) {
      await run(`auth:${uid}`, admin.auth.admin.deleteUser(uid) as unknown as PromiseLike<unknown>);
    }
    // Prefix verification — remaining societies matching this fixture.
    const remaining = await admin
      .from("societies")
      .select("id")
      .like("name", `${prefix}-%`);
    if (remaining.error) errors.push({ label: "verify-remaining", e: remaining.error });
    else if ((remaining.data ?? []).length > 0)
      errors.push({
        label: "verify-remaining",
        e: new Error(`fixture prefix ${prefix} still has societies`),
      });
    if (errors.length) {
      throw new Error(
        `Stage 3C fixture teardown had ${errors.length} error(s): ${JSON.stringify(errors)}`,
      );
    }
  }

  return {
    prefix,
    admin,
    societyA,
    societyB,
    blockA,
    flatA,
    unrelatedFlat,
    openBillId,
    openBillId2,
    cancelledBillId,
    users: {
      adminA1,
      adminA2,
      adminB,
      blockAdmin,
      guard,
      activeResident,
      movedOutResident,
      unrelatedResident,
    },
    cleanup,
  };
}
