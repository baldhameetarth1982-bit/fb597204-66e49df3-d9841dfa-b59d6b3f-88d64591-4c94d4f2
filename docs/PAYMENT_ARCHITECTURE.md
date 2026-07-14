# Payment Architecture

## Two separate payment surfaces

### 1. SocioHub subscriptions (Basic / Pro / Premium)
- Provider: **Razorpay only**.
- Route: `src/routes/checkout.$planId.tsx`.
- Server logic: `src/lib/razorpay.ts`, `src/routes/api/public/hooks/razorpay.ts` (webhook).
- No other provider is enabled here.
- Society Admins buying a plan complete Razorpay checkout; on webhook success `societies.plan_id` / `plan_status` update.

### 2. Society maintenance collection
- **Default**: Cash + Bank Transfer.
- Resident submits payment claim (mode = cash or bank_transfer, reference / receipt).
- Society Admin verifies → payment status → `verified`; on verification the bill status flips to `paid` and (Stage 3A) the gamification ledger awards points if the payment was on time.
- **Online gateways** (Razorpay/Cashfree/PayU as configured) are **only** enabled per-society by SocioHub Support. Adapters live in `src/lib/payments/`.
- **No platform fee** exists. No `FeeBreakdown` visible. No 1.5%, 1.7%, 98.5% math anywhere. Do not reintroduce.

## Non-member payments (Stage 3B)

Planned but not implemented. Vendor/advertiser/coach/event-organizer/shop/guest/temporary payer receipts. Feature key = `non_member_payments`, min plan = Pro, status = `planned` until Stage 3B ships.

## Reconciliation (Stage 3B)

Feature key = `reconciliation`, min plan = Pro. Cash / Bank Transfer / Online → pending / verified / rejected + reconciliation history.
