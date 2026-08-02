/**
 * Stage 3C — SEARCH-01..10 live case contracts + behavior.
 *
 * Every handler drives the REAL production core
 * `searchSocietyOpenBillsWithClient` (exported from
 * `src/lib/offline-payments.functions.ts`) through the acting user's
 * Supabase client. No handler re-implements the RPC name, argument
 * names, pagination defaults or payload acceptance.
 *
 * All assertions target the fixture's dedicated SEARCH resources
 * (`fixture.search`): a Society A flat that no other matrix group
 * touches, plus five bills whose financial state is established once at
 * fixture setup. Consequently SEARCH cases are order-independent with
 * respect to every other group.
 *
 * Error messages never interpolate ids, amounts, references or raw
 * provider text.
 */

import {
  searchSocietyOpenBillsWithClient,
  SEARCH_OPEN_BILLS_CANONICAL_ERRORS,
  type OpenBillForPayment,
} from "@/lib/offline-payments.functions";
import type { BillingRpcClient } from "@/lib/billing-config.functions";
import {
  STAGE3C_SEARCH_AMOUNTS,
  STAGE3C_SEARCH_TOTALS,
  type Stage3CFixture,
  type SyntheticUser,
} from "./stage3c-runtime-fixtures";
import { requireFixture } from "./stage3c-live-core-context";
import type { Stage3CMatrixLiveHandler } from "./stage3c-live-matrix-registry";

// ---------------------------------------------------------------------------
// Canonical case-id union + ordered list
// ---------------------------------------------------------------------------

export type Stage3CSearchCaseId =
  | "SEARCH-01"
  | "SEARCH-02"
  | "SEARCH-03"
  | "SEARCH-04"
  | "SEARCH-05"
  | "SEARCH-06"
  | "SEARCH-07"
  | "SEARCH-08"
  | "SEARCH-09"
  | "SEARCH-10";

export const STAGE3C_SEARCH_CASE_IDS: readonly Stage3CSearchCaseId[] = Object.freeze([
  "SEARCH-01",
  "SEARCH-02",
  "SEARCH-03",
  "SEARCH-04",
  "SEARCH-05",
  "SEARCH-06",
  "SEARCH-07",
  "SEARCH-08",
  "SEARCH-09",
  "SEARCH-10",
] as const);

// ---------------------------------------------------------------------------
// Local failure helper — static text only
// ---------------------------------------------------------------------------

export function searchFail(caseId: string, reason: string): never {
  throw new Error(`[stage3c:${caseId}] ${reason}`);
}

// ---------------------------------------------------------------------------
// Expected figures, derived from the fixture constants (never literals)
// ---------------------------------------------------------------------------

export interface ExpectedSearchFigures {
  readonly total_payable: number;
  readonly verified_amount: number;
  readonly pending_amount: number;
  readonly remaining_verified_balance: number;
  readonly available_to_submit: number;
}

/**
 * The exact figures the SQL body must report for each dedicated bill.
 * `remaining_verified_balance = total - verified`;
 * `available_to_submit = total - verified - pending`.
 */
export function expectedSearchFigures(): Readonly<{
  available: ExpectedSearchFigures;
  pending: ExpectedSearchFigures;
  verified: ExpectedSearchFigures;
  noHeadroom: ExpectedSearchFigures;
}> {
  const derive = (
    total: number,
    verified: number,
    pending: number,
  ): ExpectedSearchFigures => ({
    total_payable: total,
    verified_amount: verified,
    pending_amount: pending,
    remaining_verified_balance: total - verified,
    available_to_submit: total - verified - pending,
  });
  return Object.freeze({
    available: derive(STAGE3C_SEARCH_TOTALS.available, 0, 0),
    pending: derive(
      STAGE3C_SEARCH_TOTALS.pending,
      0,
      STAGE3C_SEARCH_AMOUNTS.pendingOnPendingBill,
    ),
    verified: derive(
      STAGE3C_SEARCH_TOTALS.verified,
      STAGE3C_SEARCH_AMOUNTS.verifiedOnVerifiedBill,
      0,
    ),
    noHeadroom: derive(
      STAGE3C_SEARCH_TOTALS.noHeadroom,
      STAGE3C_SEARCH_AMOUNTS.verifiedOnNoHeadroomBill,
      STAGE3C_SEARCH_AMOUNTS.pendingOnNoHeadroomBill,
    ),
  });
}

/** Assert a returned row carries exactly the expected balance figures. */
export function assertSearchFigures(
  caseId: string,
  row: OpenBillForPayment,
  expected: ExpectedSearchFigures,
): void {
  if (row.total_payable !== expected.total_payable)
    searchFail(caseId, "total_payable mismatch");
  if (row.verified_amount !== expected.verified_amount)
    searchFail(caseId, "verified_amount mismatch");
  if (row.pending_amount !== expected.pending_amount)
    searchFail(caseId, "pending_amount mismatch");
  if (row.remaining_verified_balance !== expected.remaining_verified_balance)
    searchFail(caseId, "remaining_verified_balance mismatch");
  if (row.available_to_submit !== expected.available_to_submit)
    searchFail(caseId, "available_to_submit mismatch");
}

// ---------------------------------------------------------------------------
// Row-set helpers
// ---------------------------------------------------------------------------

export function findSearchRow(
  rows: readonly OpenBillForPayment[],
  billId: string,
): OpenBillForPayment | null {
  return rows.find((r) => r.bill_id === billId) ?? null;
}

export function requireSearchRow(
  caseId: string,
  rows: readonly OpenBillForPayment[],
  billId: string,
  label: string,
): OpenBillForPayment {
  const row = findSearchRow(rows, billId);
  if (row === null) searchFail(caseId, `expected the ${label} bill in the result set`);
  return row;
}

export function assertSearchRowAbsent(
  caseId: string,
  rows: readonly OpenBillForPayment[],
  billId: string,
  label: string,
): void {
  if (findSearchRow(rows, billId) !== null)
    searchFail(caseId, `the ${label} bill must not appear in the result set`);
}

/** Ordered bill-id projection — the unit of every pagination assertion. */
export function searchRowIds(rows: readonly OpenBillForPayment[]): readonly string[] {
  return rows.map((r) => r.bill_id);
}

export function assertIdSequenceEqual(
  caseId: string,
  actual: readonly string[],
  expected: readonly string[],
  label: string,
): void {
  if (actual.length !== expected.length)
    searchFail(caseId, `${label}: unexpected row count`);
  for (let i = 0; i < expected.length; i += 1) {
    if (actual[i] !== expected[i]) searchFail(caseId, `${label}: row order mismatch`);
  }
}

// ---------------------------------------------------------------------------
// Actor client adapter
// ---------------------------------------------------------------------------

interface ActorRpcLike {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/**
 * Convert a Supabase-shaped client into the strict `BillingRpcClient`
 * the production core expects. Confined to one closure; no broad casts.
 */
export function toSearchRpcClient(actor: SyntheticUser): BillingRpcClient {
  const client: ActorRpcLike = actor.client;
  return {
    async rpc(name, args) {
      const result = await client["rpc"](name, args);
      return {
        data: result.data,
        error: result.error ? { message: result.error.message } : null,
      };
    },
  };
}

/** Run the production search core as `actor`. */
export async function runSearch(
  actor: SyntheticUser,
  input: { societyId: string; query?: string; limit?: number; offset?: number },
): Promise<readonly OpenBillForPayment[]> {
  const { bills } = await searchSocietyOpenBillsWithClient(toSearchRpcClient(actor), {
    societyId: input.societyId,
    ...(input.query === undefined ? {} : { query: input.query }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.offset === undefined ? {} : { offset: input.offset }),
  });
  return bills;
}

/** Every returned row must belong to the requested society. */
export function assertSocietyScoped(
  caseId: string,
  rows: readonly OpenBillForPayment[],
  societyId: string,
): void {
  for (const row of rows) {
    if (row.society_id !== societyId) searchFail(caseId, "row escaped the society scope");
  }
}

/** Convenience: the full ordered page for the dedicated SEARCH flat. */
async function searchFlatPage(
  fixture: Stage3CFixture,
  limit = 50,
  offset = 0,
): Promise<readonly OpenBillForPayment[]> {
  return runSearch(fixture.users.adminA1, {
    societyId: fixture.societyA,
    query: fixture.search.flatNumber,
    limit,
    offset,
  });
}

// ---------------------------------------------------------------------------
// SEARCH handlers
// ---------------------------------------------------------------------------

export const search01_listsAvailableOpenBill: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const rows = await searchFlatPage(fixture);
  assertSocietyScoped("SEARCH-01", rows, fixture.societyA);
  const row = requireSearchRow("SEARCH-01", rows, fixture.search.availableBillId, "available");
  if (row.flat_id !== fixture.search.flatId) searchFail("SEARCH-01", "flat_id mismatch");
  if (row.flat_label !== fixture.search.flatNumber)
    searchFail("SEARCH-01", "flat_label mismatch");
  if (row.bill_number !== fixture.search.availableBillNumber)
    searchFail("SEARCH-01", "bill_number mismatch");
  if (row.status === "paid" || row.status === "cancelled")
    searchFail("SEARCH-01", "a closed bill was returned as open");
  assertSearchFigures("SEARCH-01", row, expectedSearchFigures().available);
};

export const search02_pendingAmountsReflected: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const rows = await searchFlatPage(fixture);
  const row = requireSearchRow("SEARCH-02", rows, fixture.search.pendingBillId, "pending");
  assertSearchFigures("SEARCH-02", row, expectedSearchFigures().pending);
  // A pending payment reserves headroom but never counts as paid.
  if (row.remaining_verified_balance !== row.total_payable)
    searchFail("SEARCH-02", "a pending payment must not reduce the verified balance");
  if (row.available_to_submit >= row.remaining_verified_balance)
    searchFail("SEARCH-02", "a pending payment must reduce available headroom");
};

export const search03_verifiedAmountsReflected: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const rows = await searchFlatPage(fixture);
  const row = requireSearchRow("SEARCH-03", rows, fixture.search.verifiedBillId, "verified");
  assertSearchFigures("SEARCH-03", row, expectedSearchFigures().verified);
  // With no pending payments, headroom equals the verified balance.
  if (row.available_to_submit !== row.remaining_verified_balance)
    searchFail("SEARCH-03", "headroom must equal the verified balance with no pending rows");
};

export const search04_cancelledExcluded: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const flatRows = await searchFlatPage(fixture);
  assertSearchRowAbsent("SEARCH-04", flatRows, fixture.search.cancelledBillId, "cancelled");
  // Also absent from an unfiltered society-wide page.
  const wideRows = await runSearch(fixture.users.adminA1, {
    societyId: fixture.societyA,
    limit: 50,
  });
  assertSearchRowAbsent("SEARCH-04", wideRows, fixture.search.cancelledBillId, "cancelled");
  // The cancelled bill still exists and still carries headroom on paper —
  // exclusion is driven by cancellation, not by a zero balance.
  const { data, error } = await fixture.admin
    .from("bills")
    .select("status, cancelled_at, total_payable")
    .eq("id", fixture.search.cancelledBillId)
    .single();
  if (error) searchFail("SEARCH-04", "could not observe the cancelled bill");
  const bill = data as { status: string; cancelled_at: string | null; total_payable: number };
  if (bill.status !== "cancelled") searchFail("SEARCH-04", "fixture bill is not cancelled");
  if (bill.cancelled_at === null) searchFail("SEARCH-04", "cancelled_at is not set");
  if (Number(bill.total_payable) !== STAGE3C_SEARCH_TOTALS.cancelled)
    searchFail("SEARCH-04", "cancelled bill total drifted");
};

export const search05_noHeadroomExcluded: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const flatRows = await searchFlatPage(fixture);
  assertSearchRowAbsent("SEARCH-05", flatRows, fixture.search.noHeadroomBillId, "no-headroom");
  const wideRows = await runSearch(fixture.users.adminA1, {
    societyId: fixture.societyA,
    limit: 50,
  });
  assertSearchRowAbsent("SEARCH-05", wideRows, fixture.search.noHeadroomBillId, "no-headroom");
  // Prove the exclusion is the headroom predicate, not the status filter:
  // the bill is still `unpaid` and not cancelled.
  const { data, error } = await fixture.admin
    .from("bills")
    .select("status, cancelled_at")
    .eq("id", fixture.search.noHeadroomBillId)
    .single();
  if (error) searchFail("SEARCH-05", "could not observe the no-headroom bill");
  const bill = data as { status: string; cancelled_at: string | null };
  if (bill.status === "cancelled" || bill.cancelled_at !== null)
    searchFail("SEARCH-05", "no-headroom bill must not be cancelled");
  if (bill.status === "paid")
    searchFail("SEARCH-05", "no-headroom bill must not be fully paid");
  const expected = expectedSearchFigures().noHeadroom;
  if (expected.available_to_submit !== 0)
    searchFail("SEARCH-05", "fixture no-headroom bill still has headroom");
};

export const search06_matchesBillNumberSubstring: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const full = fixture.search.availableBillNumber;
  const rows = await runSearch(fixture.users.adminA1, {
    societyId: fixture.societyA,
    query: full,
    limit: 50,
  });
  if (rows.length !== 1) searchFail("SEARCH-06", "bill-number query did not isolate one bill");
  const [row] = rows;
  if (!row || row.bill_id !== fixture.search.availableBillId)
    searchFail("SEARCH-06", "bill-number query returned the wrong bill");

  // A strict substring of the same bill number must still match.
  const substring = full.slice(Math.max(0, full.length - 8));
  const partial = await runSearch(fixture.users.adminA1, {
    societyId: fixture.societyA,
    query: substring,
    limit: 50,
  });
  if (findSearchRow(partial, fixture.search.availableBillId) === null)
    searchFail("SEARCH-06", "substring bill-number query missed the bill");
};

export const search07_matchesFlatNumberSubstring: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const rows = await searchFlatPage(fixture);
  if (rows.length === 0) searchFail("SEARCH-07", "flat-number query returned nothing");
  for (const row of rows) {
    if (row.flat_label !== fixture.search.flatNumber)
      searchFail("SEARCH-07", "flat-number query leaked another flat");
    if (row.flat_id !== fixture.search.flatId)
      searchFail("SEARCH-07", "flat-number query leaked another flat id");
  }
  requireSearchRow("SEARCH-07", rows, fixture.search.availableBillId, "available");
  requireSearchRow("SEARCH-07", rows, fixture.search.pendingBillId, "pending");
  requireSearchRow("SEARCH-07", rows, fixture.search.verifiedBillId, "verified");
  assertSearchRowAbsent("SEARCH-07", rows, fixture.search.cancelledBillId, "cancelled");
  assertSearchRowAbsent("SEARCH-07", rows, fixture.search.noHeadroomBillId, "no-headroom");
};

export const search08_limitCapsRows: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const full = await searchFlatPage(fixture);
  const fullIds = searchRowIds(full);
  if (fullIds.length < 2) searchFail("SEARCH-08", "not enough rows to prove limiting");

  const one = await searchFlatPage(fixture, 1, 0);
  if (one.length !== 1) searchFail("SEARCH-08", "limit=1 did not return exactly one row");
  assertIdSequenceEqual("SEARCH-08", searchRowIds(one), fullIds.slice(0, 1), "limit=1");

  const two = await searchFlatPage(fixture, 2, 0);
  if (two.length !== Math.min(2, fullIds.length))
    searchFail("SEARCH-08", "limit=2 returned the wrong row count");
  assertIdSequenceEqual("SEARCH-08", searchRowIds(two), fullIds.slice(0, 2), "limit=2");

  // Ordering must be repeatable across identical calls.
  const repeat = await searchFlatPage(fixture);
  assertIdSequenceEqual("SEARCH-08", searchRowIds(repeat), fullIds, "repeat");
};

export const search09_offsetShiftsPage: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const full = await searchFlatPage(fixture);
  const fullIds = searchRowIds(full);
  if (fullIds.length < 2) searchFail("SEARCH-09", "not enough rows to prove offsetting");

  const shifted = await searchFlatPage(fixture, 50, 1);
  assertIdSequenceEqual("SEARCH-09", searchRowIds(shifted), fullIds.slice(1), "offset=1");

  const secondPageOfOne = await searchFlatPage(fixture, 1, 1);
  assertIdSequenceEqual(
    "SEARCH-09",
    searchRowIds(secondPageOfOne),
    fullIds.slice(1, 2),
    "limit=1&offset=1",
  );

  // limit=1 pages must partition the full ordered set exactly once.
  const walked: string[] = [];
  for (let i = 0; i < fullIds.length; i += 1) {
    const page = await searchFlatPage(fixture, 1, i);
    if (page.length !== 1) searchFail("SEARCH-09", "single-row page was not returned");
    walked.push(...searchRowIds(page));
  }
  assertIdSequenceEqual("SEARCH-09", walked, fullIds, "walk");

  const beyond = await searchFlatPage(fixture, 50, fullIds.length);
  if (beyond.length !== 0)
    searchFail("SEARCH-09", "offset beyond the result set returned rows");
};

export const search10_crossSocietyIsolation: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);

  // Society B admin is denied outright on Society A.
  let caught: unknown = null;
  try {
    await runSearch(fixture.users.adminB, { societyId: fixture.societyA, limit: 50 });
  } catch (e) {
    caught = e;
  }
  if (caught === null) searchFail("SEARCH-10", "Society B admin was not denied on Society A");
  if (!(caught instanceof Error)) searchFail("SEARCH-10", "denial threw a non-error");
  if (caught.message !== SEARCH_OPEN_BILLS_CANONICAL_ERRORS.not_authorized)
    searchFail("SEARCH-10", "denial did not use the canonical not_authorized token");

  // Society B admin's own society never contains a Society A bill.
  const ownRows = await runSearch(fixture.users.adminB, {
    societyId: fixture.societyB,
    limit: 50,
  });
  assertSocietyScoped("SEARCH-10", ownRows, fixture.societyB);
  const societyABillIds: readonly string[] = [
    fixture.search.availableBillId,
    fixture.search.pendingBillId,
    fixture.search.verifiedBillId,
    fixture.search.cancelledBillId,
    fixture.search.noHeadroomBillId,
    fixture.openBillId,
    fixture.openBillId2,
  ];
  for (const billId of societyABillIds) {
    assertSearchRowAbsent("SEARCH-10", ownRows, billId, "Society A");
  }
};

// ---------------------------------------------------------------------------
// Handler map
// ---------------------------------------------------------------------------

export const STAGE3C_SEARCH_HANDLERS = {
  "SEARCH-01": search01_listsAvailableOpenBill,
  "SEARCH-02": search02_pendingAmountsReflected,
  "SEARCH-03": search03_verifiedAmountsReflected,
  "SEARCH-04": search04_cancelledExcluded,
  "SEARCH-05": search05_noHeadroomExcluded,
  "SEARCH-06": search06_matchesBillNumberSubstring,
  "SEARCH-07": search07_matchesFlatNumberSubstring,
  "SEARCH-08": search08_limitCapsRows,
  "SEARCH-09": search09_offsetShiftsPage,
  "SEARCH-10": search10_crossSocietyIsolation,
} satisfies Record<Stage3CSearchCaseId, Stage3CMatrixLiveHandler>;
