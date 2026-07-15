# Payment Architecture

## Two separate payment surfaces

### 1. SociyoHub subscriptions (Basic / Pro / Premium)
- Provider: **Razorpay only**.
- Route: `src/routes/checkout.$planId.tsx`.
- Server logic: `src/lib/razorpay.ts`, `src/routes/api/public/hooks/razorpay.ts` (webhook).
- No other provider is enabled here.
- Society Admins buying a plan complete Razorpay checkout; on webhook success `societies.plan_id` / `plan_status` update.

### 2. Society maintenance collection
- **Default**: Cash + Bank Transfer.
- Resident submits payment claim (mode = cash or bank_transfer, reference / receipt).
- Society Admin verifies → payment status → `verified`; on verification the bill status flips to `paid` and (Stage 3A) the gamification ledger awards points if the payment was on time.
- **Online gateways** (Razorpay/Cashfree/PayU as configured) are **only** enabled per-society by SociyoHub Support. Adapters live in `src/lib/payments/`.
- **No platform fee** exists. No `FeeBreakdown` visible. No 1.5%, 1.7%, 98.5% math anywhere. Do not reintroduce.

## Non-member payments (Stage 3B)

Planned but not implemented. Vendor/advertiser/coach/event-organizer/shop/guest/temporary payer receipts. Feature key = `non_member_payments`, min plan = Pro, status = `planned` until Stage 3B ships.

## Reconciliation (Stage 3B)

Feature key = `reconciliation`, min plan = Pro. Cash / Bank Transfer / Online → pending / verified / rejected + reconciliation history.

---

## Non-member income (Stage 3B, Turn 18A backend)

Tables (additive):

- `society_income_categories` — society-scoped income taxonomy.
- `non_member_payers` — society-scoped external payer directory. Contact fields optional; contact details NEVER included in default list responses.
- `society_income_records` — canonical income record. Method ∈ `cash | bank_transfer | other_offline`. Verification ∈ `pending | verified | rejected | reversed` (reversed is terminal). Reconciliation ∈ `unreconciled | matched | partially_matched | needs_review | reversed` — deliberately independent of verification.

Access: `society_admin` of that society or `super_admin`. Every state transition is audit-logged. No DELETE grant on income records — reversal only. Feature key: `non_member_payments`, min plan **Pro** (Premium inherits). Basic and expired plans are denied server-side, not just in the UI.

Still deferred: online gateway remains at the final payment stage; only Cash + Bank Transfer + other-offline supported for non-member income today.
