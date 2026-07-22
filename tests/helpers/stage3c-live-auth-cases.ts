/**
 * Stage 3C — Live AUTH-01..AUTH-07 case handlers.
 *
 * Every handler performs a real authenticated (or anonymous) RPC call
 * against the isolated Supabase stack via the shared fixture. Denial
 * assertions match the exact canonical Postgres error token — no
 * broad regex fallback.
 */
import { expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { Stage3CFixture } from "./stage3c-runtime-fixtures";
import { requireStage3CEnv } from "./stage3c-runtime-fixtures";
import { STAGE3C_ERRORS, matchesCanonicalError } from "./stage3c-live-errors";

type BillRow = { bill_id: string };

async function adminSearch(fixture: Stage3CFixture, actor: Stage3CFixture["users"]["adminA1"]) {
  return actor.client.rpc("search_society_open_bills", {
    _society_id: fixture.societyA,
    _query: "",
    _limit: 20,
    _offset: 0,
  });
}

function expectCanonical(err: unknown, token: string, label: string): void {
  expect(err, `${label}: must receive a real error`).not.toBeNull();
  const message = String((err as { message?: unknown } | null)?.message ?? "");
  expect(
    matchesCanonicalError(message, token as (typeof STAGE3C_ERRORS)[keyof typeof STAGE3C_ERRORS]),
    `${label}: expected canonical "${token}", got: ${message}`,
  ).toBe(true);
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
  expectCanonical(error, STAGE3C_ERRORS.NOT_AUTHORIZED, "AUTH-03");
  const rows = (data ?? []) as BillRow[] | null;
  if (rows) {
    expect(
      rows.some((r) => r.bill_id === fixture.openBillId),
      "AUTH-03: no cross-society leakage of Society A bill",
    ).toBe(false);
  }
}

export async function auth04_residentCannotUseAdminSearch(fixture: Stage3CFixture): Promise<void> {
  const { data, error } = await adminSearch(fixture, fixture.users.activeResident);
  expectCanonical(error, STAGE3C_ERRORS.NOT_AUTHORIZED, "AUTH-04");
  expect(data, "AUTH-04: no data leaked to resident").toBeNull();
}

export async function auth05_guardCannotUseAdminSearch(fixture: Stage3CFixture): Promise<void> {
  const { data, error } = await adminSearch(fixture, fixture.users.guard);
  expectCanonical(error, STAGE3C_ERRORS.NOT_AUTHORIZED, "AUTH-05");
  expect(data, "AUTH-05: no data leaked to guard").toBeNull();
}

export async function auth06_blockAdminCannotUseAdminSearch(
  fixture: Stage3CFixture,
): Promise<void> {
  const { data, error } = await adminSearch(fixture, fixture.users.blockAdmin);
  expectCanonical(error, STAGE3C_ERRORS.NOT_AUTHORIZED, "AUTH-06");
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
  expectCanonical(error, STAGE3C_ERRORS.NOT_AUTHENTICATED, "AUTH-07");
  expect(data, "AUTH-07: no data leaked to anonymous").toBeNull();
}
