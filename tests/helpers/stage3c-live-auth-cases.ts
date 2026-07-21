/**
 * Stage 3C — Live AUTH-01..AUTH-07 case handlers.
 *
 * Every handler performs a real authenticated (or anonymous) RPC call
 * against the isolated Supabase stack via the shared fixture. Denial
 * assertions require a real Postgres error containing a canonical
 * denial token — never accept "no error and empty data".
 */
import { expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Stage3CFixture } from "./stage3c-runtime-fixtures";
import { requireStage3CEnv } from "./stage3c-runtime-fixtures";

const DENIAL = /not_authorized|not_authenticated|permission denied|forbidden|42501/i;

type BillRow = { bill_id: string };

async function adminSearch(fixture: Stage3CFixture, actor: Stage3CFixture["users"]["adminA1"]) {
  return actor.client.rpc("search_society_open_bills", {
    _society_id: fixture.societyA,
    _query: "",
    _limit: 20,
    _offset: 0,
  });
}

export async function auth01_adminA1SearchesSocietyA(fixture: Stage3CFixture): Promise<void> {
  const { data, error } = await adminSearch(fixture, fixture.users.adminA1);
  expect(error, "AUTH-01: admin A1 must not receive an error").toBeNull();
  expect(Array.isArray(data), "AUTH-01: data must be an array").toBe(true);
  const rows = (data ?? []) as BillRow[];
  expect(
    rows.some((r) => r.bill_id === fixture.openBillId),
    "AUTH-01: admin A1 must see the fixture openBill",
  ).toBe(true);
}

export async function auth02_adminA2SearchesSocietyA(fixture: Stage3CFixture): Promise<void> {
  const { data, error } = await adminSearch(fixture, fixture.users.adminA2);
  expect(error, "AUTH-02: admin A2 must not receive an error").toBeNull();
  const rows = (data ?? []) as BillRow[];
  expect(
    rows.some((r) => r.bill_id === fixture.openBillId),
    "AUTH-02: admin A2 must see the fixture openBill",
  ).toBe(true);
}

export async function auth03_adminBCannotSearchSocietyA(fixture: Stage3CFixture): Promise<void> {
  const { data, error } = await adminSearch(fixture, fixture.users.adminB);
  expect(error, "AUTH-03: admin B must receive a real Postgres error").not.toBeNull();
  expect(error!.message, "AUTH-03: canonical denial token").toMatch(DENIAL);
  const rows = (data ?? []) as BillRow[] | null;
  if (rows) {
    expect(
      rows.some((r) => r.bill_id === fixture.openBillId),
      "AUTH-03: cross-society leakage of Society A bill",
    ).toBe(false);
  }
}

export async function auth04_residentCannotUseAdminSearch(fixture: Stage3CFixture): Promise<void> {
  const { data, error } = await adminSearch(fixture, fixture.users.activeResident);
  expect(error, "AUTH-04: resident must be denied").not.toBeNull();
  expect(error!.message).toMatch(DENIAL);
  expect(data, "AUTH-04: no data leaked to resident").toBeNull();
}

export async function auth05_guardCannotUseAdminSearch(fixture: Stage3CFixture): Promise<void> {
  const { data, error } = await adminSearch(fixture, fixture.users.guard);
  expect(error, "AUTH-05: guard must be denied").not.toBeNull();
  expect(error!.message).toMatch(DENIAL);
  expect(data, "AUTH-05: no data leaked to guard").toBeNull();
}

export async function auth06_blockAdminCannotUseAdminSearch(
  fixture: Stage3CFixture,
): Promise<void> {
  const { data, error } = await adminSearch(fixture, fixture.users.blockAdmin);
  expect(error, "AUTH-06: block admin must be denied society-wide search").not.toBeNull();
  expect(error!.message).toMatch(DENIAL);
  expect(data, "AUTH-06: no data leaked to block admin").toBeNull();
}

export async function auth07_anonymousDenied(fixture: Stage3CFixture): Promise<void> {
  const env = requireStage3CEnv();
  const anon = createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.rpc("search_society_open_bills", {
    _society_id: fixture.societyA,
    _query: "",
    _limit: 20,
    _offset: 0,
  });
  expect(error, "AUTH-07: anonymous must be denied").not.toBeNull();
  expect(error!.message).toMatch(DENIAL);
  expect(data, "AUTH-07: no data leaked to anonymous").toBeNull();
}
