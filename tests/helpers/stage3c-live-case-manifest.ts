/**
 * Stage 3C — machine-readable live acceptance case manifest.
 *
 * Every entry in this array must be exercised by
 * `tests/integration/billing-stage3c-live.test.ts` (one Vitest `it` per id)
 * and validated post-run by the workflow's live-report validator. The
 * manifest is the single source of truth for which cases the runtime
 * matrix must cover — do not add descriptions that do not correspond to
 * a real behavior, and do not remove ids without matching test removal.
 *
 * Group counts (total 93):
 *   AUTH-01..07              (7)   admin/resident/guard/block-admin/anon authorization
 *   PENDING-01..08           (8)   admin Cash submission + reservation math
 *   VERIFY-01..09            (9)   separation-of-duties + verification effects + receipt
 *   RESIDENT-SUBMIT-01..08   (8)   resident Bank Transfer contract + denials
 *   IDEMPOTENCY-01..04       (4)   idempotency-key replay/conflict semantics
 *   REFERENCE-01..04         (4)   bank reference normalization + duplicate denials
 *   READ-01..10              (10)  history/detail reads + audience/parser + denials
 *   PRIVACY-01..16           (16)  forbidden fields (payment + receipt) + parser rejection
 *   REJECTION-01..05         (5)   reject flow + reservation release + terminal state
 *   REVERSAL-01..09          (9)   reversal + VOID receipt + audience omissions + terminal
 *   SEARCH-01..10            (10)  search_society_open_bills coverage + isolation
 *   CLEANUP-01..03           (3)   post-teardown tracked-row/user/prefix absence
 */

export interface Stage3CLiveCase {
  readonly id: string;
  readonly category:
    | "AUTH"
    | "PENDING"
    | "VERIFY"
    | "RESIDENT-SUBMIT"
    | "IDEMPOTENCY"
    | "REFERENCE"
    | "READ"
    | "PRIVACY"
    | "REJECTION"
    | "REVERSAL"
    | "SEARCH"
    | "CLEANUP";
  readonly description: string;
}

export const STAGE3C_REQUIRED_LIVE_CASES: readonly Stage3CLiveCase[] = [
  // ── AUTH ──────────────────────────────────────────────────────────────
  { id: "AUTH-01", category: "AUTH", description: "Admin A1 can search open bills in Society A" },
  { id: "AUTH-02", category: "AUTH", description: "Admin A2 can search open bills in Society A" },
  { id: "AUTH-03", category: "AUTH", description: "Admin B cannot search or verify in Society A" },
  { id: "AUTH-04", category: "AUTH", description: "Resident cannot invoke admin bill search" },
  { id: "AUTH-05", category: "AUTH", description: "Guard cannot invoke admin bill search or verification" },
  { id: "AUTH-06", category: "AUTH", description: "Block Admin cannot invoke society-wide admin actions" },
  { id: "AUTH-07", category: "AUTH", description: "Anonymous client is denied every Stage 3C RPC" },

  // ── PENDING ───────────────────────────────────────────────────────────
  { id: "PENDING-01", category: "PENDING", description: "Admin A1 submits a Cash offline payment successfully" },
  { id: "PENDING-02", category: "PENDING", description: "Submitted payment records correct actor/society/bill/method ownership" },
  { id: "PENDING-03", category: "PENDING", description: "Newly submitted payment has status = pending" },
  { id: "PENDING-04", category: "PENDING", description: "No receipt is issued at submission time" },
  { id: "PENDING-05", category: "PENDING", description: "Bill balance_paid does not change from a pending payment" },
  { id: "PENDING-06", category: "PENDING", description: "Bill pending_verification_amount increases by exactly the submitted amount" },
  { id: "PENDING-07", category: "PENDING", description: "Bill available_for_new_payment decreases by exactly the submitted amount" },
  { id: "PENDING-08", category: "PENDING", description: "Over-allocation beyond available amount is rejected with the canonical error" },

  // ── VERIFY ────────────────────────────────────────────────────────────
  { id: "VERIFY-01", category: "VERIFY", description: "Submitting admin cannot self-verify their own payment" },
  { id: "VERIFY-02", category: "VERIFY", description: "Admin A2 can verify a payment submitted by Admin A1" },
  { id: "VERIFY-03", category: "VERIFY", description: "Verified payment transitions to status = verified" },
  { id: "VERIFY-04", category: "VERIFY", description: "Bill pending_verification_amount decreases by exactly the verified amount" },
  { id: "VERIFY-05", category: "VERIFY", description: "Bill balance_paid increases by exactly the verified amount" },
  { id: "VERIFY-06", category: "VERIFY", description: "Exactly one payment_receipt row is created on verification" },
  { id: "VERIFY-07", category: "VERIFY", description: "Issued receipt number matches RCPT/YYYYMM/#### format" },
  { id: "VERIFY-08", category: "VERIFY", description: "Repeated verification of an already-verified payment is denied" },
  { id: "VERIFY-09", category: "VERIFY", description: "Receipt number remains unique across concurrent verifications" },

  // ── RESIDENT-SUBMIT ───────────────────────────────────────────────────
  { id: "RESIDENT-SUBMIT-01", category: "RESIDENT-SUBMIT", description: "Active resident submits a Bank Transfer against their own bill" },
  { id: "RESIDENT-SUBMIT-02", category: "RESIDENT-SUBMIT", description: "Resident submission has method pinned to bank_transfer server-side" },
  { id: "RESIDENT-SUBMIT-03", category: "RESIDENT-SUBMIT", description: "Resident submission lands in status = pending" },
  { id: "RESIDENT-SUBMIT-04", category: "RESIDENT-SUBMIT", description: "Cash method is unavailable through the resident public boundary" },
  { id: "RESIDENT-SUBMIT-05", category: "RESIDENT-SUBMIT", description: "Resident cannot submit against another flat's bill" },
  { id: "RESIDENT-SUBMIT-06", category: "RESIDENT-SUBMIT", description: "Moved-out resident cannot submit an offline payment" },
  { id: "RESIDENT-SUBMIT-07", category: "RESIDENT-SUBMIT", description: "Unrelated resident (different society) is denied" },
  { id: "RESIDENT-SUBMIT-08", category: "RESIDENT-SUBMIT", description: "Bill reservation totals update exactly by the resident's submitted amount" },

  // ── IDEMPOTENCY ───────────────────────────────────────────────────────
  { id: "IDEMPOTENCY-01", category: "IDEMPOTENCY", description: "Identical payload with same idempotency key replays and returns the original id" },
  { id: "IDEMPOTENCY-02", category: "IDEMPOTENCY", description: "Same idempotency key with a changed amount raises the canonical conflict error" },
  { id: "IDEMPOTENCY-03", category: "IDEMPOTENCY", description: "Same idempotency key with a changed bill id raises the canonical conflict error" },
  { id: "IDEMPOTENCY-04", category: "IDEMPOTENCY", description: "Only one payment row exists after any number of replay attempts" },

  // ── REFERENCE ─────────────────────────────────────────────────────────
  { id: "REFERENCE-01", category: "REFERENCE", description: "Unique bank reference in Society A succeeds" },
  { id: "REFERENCE-02", category: "REFERENCE", description: "Same-bill duplicate reference (whitespace/case variant) is denied with duplicate_reference" },
  { id: "REFERENCE-03", category: "REFERENCE", description: "Same-society different-bill duplicate reference is denied with duplicate_reference" },
  { id: "REFERENCE-04", category: "REFERENCE", description: "Cross-society isolation: same normalized reference succeeds in a different society" },


  // ── READ ──────────────────────────────────────────────────────────────
  { id: "READ-01", category: "READ", description: "Active resident sees their own payment history" },
  { id: "READ-02", category: "READ", description: "Active resident sees their own payment detail" },
  { id: "READ-03", category: "READ", description: "Resident payment detail carries audience = resident" },
  { id: "READ-04", category: "READ", description: "Production parsePaymentDetailResponse accepts the live resident payload" },
  { id: "READ-05", category: "READ", description: "Moved-out resident cannot fetch payment history" },
  { id: "READ-06", category: "READ", description: "Moved-out resident cannot fetch payment detail" },
  { id: "READ-07", category: "READ", description: "Unrelated resident cannot fetch another society's payment detail" },
  { id: "READ-08", category: "READ", description: "Admin B (other society) cannot fetch Society A payment detail" },
  { id: "READ-09", category: "READ", description: "Guard cannot fetch payment detail" },
  { id: "READ-10", category: "READ", description: "Block Admin cannot fetch payment detail outside their scope" },

  // ── PRIVACY ───────────────────────────────────────────────────────────
  { id: "PRIVACY-01", category: "PRIVACY", description: "Resident payment payload omits proof_url" },
  { id: "PRIVACY-02", category: "PRIVACY", description: "Resident payment payload omits idempotency_key" },
  { id: "PRIVACY-03", category: "PRIVACY", description: "Resident payment payload omits submitted_by user id" },
  { id: "PRIVACY-04", category: "PRIVACY", description: "Resident payment payload omits verified_by user id" },
  { id: "PRIVACY-05", category: "PRIVACY", description: "Resident payment payload omits rejected_by user id" },
  { id: "PRIVACY-06", category: "PRIVACY", description: "Resident payment payload omits reversed_by user id" },
  { id: "PRIVACY-07", category: "PRIVACY", description: "Resident payment payload omits internal notes / rejection_reason actor" },
  { id: "PRIVACY-08", category: "PRIVACY", description: "Resident receipt payload omits internal receipt id" },
  { id: "PRIVACY-09", category: "PRIVACY", description: "Resident receipt payload omits issued_by user id" },
  { id: "PRIVACY-10", category: "PRIVACY", description: "Resident receipt payload omits voided_by user id" },
  { id: "PRIVACY-11", category: "PRIVACY", description: "Resident receipt payload omits sequence key/row identifiers" },
  { id: "PRIVACY-12", category: "PRIVACY", description: "Resident receipt payload omits raw payer_snapshot uuid fields" },
  { id: "PRIVACY-13", category: "PRIVACY", description: "Recursive scan of the resident payload finds no forbidden keys at any depth" },
  { id: "PRIVACY-14", category: "PRIVACY", description: "parsePaymentDetailResponse rejects an injected proof_url on the resident branch" },
  { id: "PRIVACY-15", category: "PRIVACY", description: "parsePaymentDetailResponse rejects an injected receipt.issued_by on the resident branch" },
  { id: "PRIVACY-16", category: "PRIVACY", description: "parsePaymentDetailResponse rejects an injected receipt.voided_by on the resident branch" },

  // ── REJECTION ─────────────────────────────────────────────────────────
  { id: "REJECTION-01", category: "REJECTION", description: "Authorized admin (non-submitter) can reject a pending payment" },
  { id: "REJECTION-02", category: "REJECTION", description: "Rejected payment transitions to status = rejected" },
  { id: "REJECTION-03", category: "REJECTION", description: "No receipt is created for a rejected payment" },
  { id: "REJECTION-04", category: "REJECTION", description: "Bill reservation is released back to available on rejection" },
  { id: "REJECTION-05", category: "REJECTION", description: "A rejected payment cannot subsequently be verified" },

  // ── REVERSAL ──────────────────────────────────────────────────────────
  { id: "REVERSAL-01", category: "REVERSAL", description: "Authorized admin can reverse a verified payment" },
  { id: "REVERSAL-02", category: "REVERSAL", description: "Reversed payment transitions to status = reversed" },
  { id: "REVERSAL-03", category: "REVERSAL", description: "Associated receipt transitions to VOID" },
  { id: "REVERSAL-04", category: "REVERSAL", description: "Receipt voided_at is populated on reversal" },
  { id: "REVERSAL-05", category: "REVERSAL", description: "Resident sees receipt marked VOID after reversal" },
  { id: "REVERSAL-06", category: "REVERSAL", description: "Resident voided receipt payload omits voided_by user id" },
  { id: "REVERSAL-07", category: "REVERSAL", description: "Bill balance_paid decreases by the reversed amount" },
  { id: "REVERSAL-08", category: "REVERSAL", description: "Bill available_for_new_payment restores by the reversed amount" },
  { id: "REVERSAL-09", category: "REVERSAL", description: "A reversed payment cannot be re-verified" },

  // ── SEARCH ────────────────────────────────────────────────────────────
  { id: "SEARCH-01", category: "SEARCH", description: "search_society_open_bills lists an available open bill" },
  { id: "SEARCH-02", category: "SEARCH", description: "Pending amounts are reflected in returned figures" },
  { id: "SEARCH-03", category: "SEARCH", description: "Verified amounts are reflected in returned figures" },
  { id: "SEARCH-04", category: "SEARCH", description: "Cancelled bills are excluded from search results" },
  { id: "SEARCH-05", category: "SEARCH", description: "Fully unavailable bills (no headroom) are excluded" },
  { id: "SEARCH-06", category: "SEARCH", description: "Search matches by bill number substring" },
  { id: "SEARCH-07", category: "SEARCH", description: "Search matches by flat number substring" },
  { id: "SEARCH-08", category: "SEARCH", description: "Limit parameter caps the number of returned rows" },
  { id: "SEARCH-09", category: "SEARCH", description: "Offset parameter shifts the returned page" },
  { id: "SEARCH-10", category: "SEARCH", description: "Cross-society isolation: Society B admin sees no Society A bills" },

  // ── CLEANUP ───────────────────────────────────────────────────────────
  { id: "CLEANUP-01", category: "CLEANUP", description: "Every tracked payment/receipt/bill/flat/society row is absent after teardown" },
  { id: "CLEANUP-02", category: "CLEANUP", description: "Every synthetic auth user is absent after teardown" },
  { id: "CLEANUP-03", category: "CLEANUP", description: "Fixture-prefix society and user queries return zero rows" },
] as const;

/** Guard: this file must always describe exactly 93 unique case ids. */
export const STAGE3C_REQUIRED_LIVE_CASE_COUNT = 93 as const;

if (STAGE3C_REQUIRED_LIVE_CASES.length !== STAGE3C_REQUIRED_LIVE_CASE_COUNT) {
  throw new Error(
    `Stage 3C manifest length drift: expected ${STAGE3C_REQUIRED_LIVE_CASE_COUNT}, got ${STAGE3C_REQUIRED_LIVE_CASES.length}`,
  );
}

{
  const seen = new Set<string>();
  for (const c of STAGE3C_REQUIRED_LIVE_CASES) {
    if (seen.has(c.id)) {
      throw new Error(`Stage 3C manifest duplicate id: ${c.id}`);
    }
    seen.add(c.id);
  }
}
