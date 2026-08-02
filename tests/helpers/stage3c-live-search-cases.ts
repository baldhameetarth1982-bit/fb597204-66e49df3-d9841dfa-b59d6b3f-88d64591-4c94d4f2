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
  SEARCH_OPEN_BILLS_INPUT_BOUNDS,
  SEARCH_OPEN_BILL_ALLOWED_STATUSES,
  buildSearchLikePattern,
  escapeSearchLikeLiteral,
  type OpenBillForPayment,
  type SearchOpenBillsCanonicalError,
} from "@/lib/offline-payments.functions";
import type { BillingRpcClient } from "@/lib/billing-config.functions";
import {
  STAGE3C_SEARCH_AMOUNTS,
  STAGE3C_SEARCH_TOTALS,
  MatrixBillSummarySchema,
  createMatrixBillSummaryReader,
  type MatrixBillSummary,
  type Stage3CFixture,
  type SyntheticUser,
} from "./stage3c-runtime-fixtures";
import {
  buildStage3CDenialActors,
  createStage3CAnonRpcClient,
  type Stage3CDenialActorId,
} from "./stage3c-live-rejection-reversal-cases";
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
// PART 5 — canonical backend monetary truth
// ---------------------------------------------------------------------------

/**
 * Read the canonical backend summary for a bill through
 * `get_bill_payment_summary` as the Society A administrator (never the
 * service role — the summary contract is an admin-readable one). Fails
 * closed on provider error or malformed payload; the raw provider text
 * is never interpolated.
 */
export async function readSearchBackendSummary(
  fixture: Stage3CFixture,
  caseId: string,
  billId: string,
): Promise<MatrixBillSummary> {
  const reader = createMatrixBillSummaryReader(fixture.users.adminA1.client);
  const res = await reader.getBillSummary(billId);
  if (res.error) searchFail(caseId, "backend bill summary could not be read");
  const parsed = MatrixBillSummarySchema.safeParse(res.data);
  if (!parsed.success) searchFail(caseId, "backend bill summary payload is malformed");
  return parsed.data;
}

/**
 * Every monetary field the search row reports must equal the canonical
 * backend summary EXACTLY. The search RPC is not permitted to compute
 * its own view of money: it must agree, field for field, with
 * `get_bill_payment_summary`.
 */
export function assertSearchRowMatchesBackend(
  caseId: string,
  row: OpenBillForPayment,
  summary: MatrixBillSummary,
): void {
  if (row.bill_id !== summary.bill_id) searchFail(caseId, "backend summary is for another bill");
  if (row.society_id !== summary.society_id)
    searchFail(caseId, "backend summary society mismatch");
  if (summary.cancelled) searchFail(caseId, "a cancelled bill was returned by search");
  if (row.total_payable !== summary.total_payable)
    searchFail(caseId, "total_payable disagrees with the backend summary");
  if (row.verified_amount !== summary.verified_amount)
    searchFail(caseId, "verified_amount disagrees with the backend summary");
  if (row.pending_amount !== summary.pending_amount)
    searchFail(caseId, "pending_amount disagrees with the backend summary");
  if (row.remaining_verified_balance !== summary.remaining_verified_balance)
    searchFail(caseId, "remaining_verified_balance disagrees with the backend summary");
  if (row.available_to_submit !== summary.available_to_submit)
    searchFail(caseId, "available_to_submit disagrees with the backend summary");
}

/** Convenience: fixture-expected figures AND backend equality in one step. */
export async function assertSearchRowFullyGrounded(
  fixture: Stage3CFixture,
  caseId: string,
  row: OpenBillForPayment,
  expected: ExpectedSearchFigures,
): Promise<void> {
  assertSearchFigures(caseId, row, expected);
  const summary = await readSearchBackendSummary(fixture, caseId, row.bill_id);
  assertSearchRowMatchesBackend(caseId, row, summary);
}

/** Structural guard applied to every returned row on every case. */
export function assertSearchRowStructurallySound(
  caseId: string,
  row: OpenBillForPayment,
): void {
  if (!SEARCH_OPEN_BILL_ALLOWED_STATUSES.includes(row.status))
    searchFail(caseId, "row carries a status outside the open-bill vocabulary");
  if (!(row.available_to_submit > 0))
    searchFail(caseId, "row without headroom escaped the SQL predicate");
  if (Object.isFrozen(row) !== true) searchFail(caseId, "returned row is not frozen");
}

export function assertSearchResultFrozen(
  caseId: string,
  rows: readonly OpenBillForPayment[],
): void {
  if (!Object.isFrozen(rows)) searchFail(caseId, "result array is not frozen");
  for (const row of rows) assertSearchRowStructurallySound(caseId, row);
}

// ---------------------------------------------------------------------------
// PART 3 — input-bound denials (no silent clamping)
// ---------------------------------------------------------------------------

export interface SearchBoundAttempt {
  readonly label: string;
  readonly input: { societyId: string; query?: string; limit?: number; offset?: number };
}

/**
 * The exhaustive set of out-of-bound inputs. Each MUST be refused with
 * the canonical `invalid_search_input` token — never clamped into range
 * and silently executed.
 */
export function buildSearchBoundAttempts(societyId: string): readonly SearchBoundAttempt[] {
  const b = SEARCH_OPEN_BILLS_INPUT_BOUNDS;
  return Object.freeze([
    { label: "limit below minimum", input: { societyId, limit: b.limitMin - 1 } },
    { label: "limit above maximum", input: { societyId, limit: b.limitMax + 1 } },
    { label: "limit not an integer", input: { societyId, limit: 1.5 } },
    { label: "offset below minimum", input: { societyId, offset: b.offsetMin - 1 } },
    { label: "offset not an integer", input: { societyId, offset: 0.5 } },
    {
      label: "query longer than the maximum",
      input: { societyId, query: "a".repeat(b.queryMaxLength + 1) },
    },
  ] as const);
}

/**
 * Prove every out-of-bound input is refused, and that the two boundary
 * values immediately INSIDE the range are accepted — so the bound is
 * exact rather than merely restrictive.
 */
export async function proveSearchInputBounds(
  fixture: Stage3CFixture,
  caseId: string,
): Promise<void> {
  const actor = fixture.users.adminA1;
  for (const attempt of buildSearchBoundAttempts(fixture.societyA)) {
    let caught: unknown = null;
    try {
      await runSearch(actor, attempt.input);
    } catch (e) {
      caught = e;
    }
    if (caught === null) searchFail(caseId, `out-of-bound input was accepted: ${attempt.label}`);
    if (!(caught instanceof Error)) searchFail(caseId, "bound denial threw a non-error");
    if (caught.message !== SEARCH_OPEN_BILLS_CANONICAL_ERRORS.invalid_search_input)
      searchFail(caseId, `bound denial token mismatch: ${attempt.label}`);
  }
  // Inclusive boundaries must succeed.
  const b = SEARCH_OPEN_BILLS_INPUT_BOUNDS;
  await runSearch(actor, { societyId: fixture.societyA, limit: b.limitMin, offset: b.offsetMin });
  await runSearch(actor, { societyId: fixture.societyA, limit: b.limitMax });
  await runSearch(actor, {
    societyId: fixture.societyA,
    query: "a".repeat(b.queryMaxLength),
    limit: b.limitMax,
  });
}

// ---------------------------------------------------------------------------
// PART 2 — literal wildcard safety
// ---------------------------------------------------------------------------

/**
 * A LIKE metacharacter typed by a user is DATA, not a pattern. Proves
 * the SQL body escapes `%` and `_` (and the escape character itself)
 * rather than letting them widen the match.
 */
export async function proveSearchWildcardsAreLiteral(
  fixture: Stage3CFixture,
  caseId: string,
): Promise<void> {
  const baseline = await searchFlatPage(fixture);
  if (baseline.length === 0) searchFail(caseId, "baseline flat page is empty");

  for (const meta of ["%", "_", "\\", "%%", "_%"] as const) {
    const rows = await runSearch(fixture.users.adminA1, {
      societyId: fixture.societyA,
      query: meta,
      limit: 50,
    });
    // The fixture's flat/bill identifiers contain no LIKE metacharacters,
    // so a literal search for one must never return the SEARCH bills.
    for (const billId of [
      fixture.search.availableBillId,
      fixture.search.pendingBillId,
      fixture.search.verifiedBillId,
    ]) {
      if (findSearchRow(rows, billId) !== null)
        searchFail(caseId, "a LIKE metacharacter was treated as a wildcard");
    }
  }

  // A metacharacter appended to a real flat number must narrow to nothing.
  const poisoned = await runSearch(fixture.users.adminA1, {
    societyId: fixture.societyA,
    query: `${fixture.search.flatNumber}%`,
    limit: 50,
  });
  if (poisoned.length !== 0)
    searchFail(caseId, "a trailing wildcard still matched the flat number");

  // The escaping helper mirrors the SQL body exactly.
  if (escapeSearchLikeLiteral("100%_a\\b") !== "100\\%\\_a\\\\b")
    searchFail(caseId, "literal escaping helper drifted from the SQL contract");
  if (buildSearchLikePattern("   ") !== null)
    searchFail(caseId, "a blank query must produce no text predicate");
  if (buildSearchLikePattern(` ${fixture.search.flatNumber} `) === null)
    searchFail(caseId, "a padded query must still produce a predicate");
}

// ---------------------------------------------------------------------------
// PART 6 — authorization actor matrix
// ---------------------------------------------------------------------------

/**
 * EXACT expected canonical token per denial actor for the search RPC.
 *
 * Grounding (effective SQL, SECURITY DEFINER, `REVOKE ALL FROM PUBLIC`
 * + `GRANT EXECUTE TO authenticated`):
 *
 *  - `unauthenticated`: the `anon` role holds no EXECUTE privilege, so
 *    PostgreSQL/PostgREST refuses before the body runs. The provider
 *    string carries no canonical token and therefore collapses to
 *    `operation_failed`.
 *  - every authenticated non-authorized actor reaches the in-body
 *    `billing.manage` / `super_admin` check and raises exactly
 *    `not_authorized`. The out-of-scope block admin is included: the
 *    permission helper fails closed for a block-scoped role when no
 *    block id is supplied, which the search RPC never supplies.
 */
export const STAGE3C_SEARCH_DENIAL_MATRIX: Readonly<
  Record<Stage3CDenialActorId, SearchOpenBillsCanonicalError>
> = Object.freeze({
  otherSocietyAdmin: SEARCH_OPEN_BILLS_CANONICAL_ERRORS.not_authorized,
  resident: SEARCH_OPEN_BILLS_CANONICAL_ERRORS.not_authorized,
  guard: SEARCH_OPEN_BILLS_CANONICAL_ERRORS.not_authorized,
  outOfScopeBlockAdmin: SEARCH_OPEN_BILLS_CANONICAL_ERRORS.not_authorized,
  unauthenticated: SEARCH_OPEN_BILLS_CANONICAL_ERRORS.operation_failed,
});

/** Run the production search core through a raw `BillingRpcClient`. */
export async function runSearchWithClient(
  client: BillingRpcClient,
  input: { societyId: string; query?: string; limit?: number; offset?: number },
): Promise<readonly OpenBillForPayment[]> {
  const { bills } = await searchSocietyOpenBillsWithClient(client, {
    societyId: input.societyId,
    ...(input.query === undefined ? {} : { query: input.query }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.offset === undefined ? {} : { offset: input.offset }),
  });
  return bills;
}

/**
 * Drive every denial actor against Society A and assert the exact
 * canonical token. A successful call is always a matrix failure, and a
 * denial must never surface rows or raw provider text.
 */
export async function runStage3CSearchDenialMatrix(
  fixture: Stage3CFixture,
  caseId: string,
): Promise<void> {
  const actors = buildStage3CDenialActors(fixture, createStage3CAnonRpcClient());
  if (actors.length !== Object.keys(STAGE3C_SEARCH_DENIAL_MATRIX).length)
    searchFail(caseId, "denial actor set does not cover the expectation matrix");
  for (const actor of actors) {
    const expected = STAGE3C_SEARCH_DENIAL_MATRIX[actor.id];
    let caught: unknown = null;
    try {
      await runSearchWithClient(actor.client, { societyId: fixture.societyA, limit: 50 });
    } catch (e) {
      caught = e;
    }
    if (caught === null) searchFail(caseId, `actor was not denied: ${actor.id}`);
    if (!(caught instanceof Error)) searchFail(caseId, "denial threw a non-error");
    if (caught.message !== expected)
      searchFail(caseId, `denial token mismatch for actor: ${actor.id}`);
  }
}


// ---------------------------------------------------------------------------
// SEARCH handlers
// ---------------------------------------------------------------------------

export const search01_listsAvailableOpenBill: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const rows = await searchFlatPage(fixture);
  assertSocietyScoped("SEARCH-01", rows, fixture.societyA);
  assertSearchResultFrozen("SEARCH-01", rows);
  const row = requireSearchRow("SEARCH-01", rows, fixture.search.availableBillId, "available");
  if (row.flat_id !== fixture.search.flatId) searchFail("SEARCH-01", "flat_id mismatch");
  if (row.flat_label !== fixture.search.flatNumber)
    searchFail("SEARCH-01", "flat_label mismatch");
  if (row.bill_number !== fixture.search.availableBillNumber)
    searchFail("SEARCH-01", "bill_number mismatch");
  if (row.status === "paid" || row.status === "cancelled")
    searchFail("SEARCH-01", "a closed bill was returned as open");
  await assertSearchRowFullyGrounded(
    fixture,
    "SEARCH-01",
    row,
    expectedSearchFigures().available,
  );
};

export const search02_pendingAmountsReflected: Stage3CMatrixLiveHandler = async (ctx) => {
  const fixture = requireFixture(ctx);
  const rows = await searchFlatPage(fixture);
  const row = requireSearchRow("SEARCH-02", rows, fixture.search.pendingBillId, "pending");
  await assertSearchRowFullyGrounded(fixture, "SEARCH-02", row, expectedSearchFigures().pending);
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
