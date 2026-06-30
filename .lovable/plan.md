## Master overhaul plan

### 1. Dynamic billing + 100% cashless

- Read `society_settings.billing_day` and `due_day` (and `grace_days`) instead of hardcoded 1st-of-month inside `src/lib/billing.functions.ts` and the `/api/public/hooks/run-billing` cron route. The cron will run daily and only generate for societies whose `billing_day = today`.
- Bill row starts `status = 'due'`.
- Strip every "Mark Paid (Cash)" / cash UI from `society.billing.tsx`, `society.bill-studio.tsx`, `app.bills.tsx`, `app.dues.tsx`. Remove cash-fallback copy when payouts not active — instead show "Society admin must finish bank setup to accept payments".
- Migration: drop/ignore `method='cash'` writes via a CHECK constraint on `payments.method IN ('razorpay')`.

### 2. Gamification engine

- New trigger `award_points_on_bill_paid` on `bills` (AFTER UPDATE when status → paid):
  - If `paid_at <= due_date` → +10 points to resident in `user_points`.
  - Else → −1 point × `(paid_at::date − due_date::date)` days.
- Daily pg_cron `apply_overdue_point_decay`: for every still-`due` bill past `due_date`, subtract 1 point per resident per day (idempotent via `last_decay_date` column on `bills`).
- `society.leaderboard.tsx` already reads `user_points` — no UI change needed beyond a "How points work" tooltip.

### 3. Razorpay settlement + receipts

- `payment.captured` webhook (`/api/public/hooks/razorpay`) already flips bill to paid; add: send invoice email via Lovable Emails (`bill-paid-receipt` template) with PDF link, and stamp `bills.paid_at = now()`.
- Resident bills page: if a `payments` row exists for the bill with `status='success'` but the bill is still `due` after 60 s, render a red micro-banner: "Payment processing? Contact SocioHub Support for instant reconciliation." Link → `/support`.
- New email template `src/lib/email-templates/bill-paid-receipt.tsx` + trigger from webhook via `sendTransactionalEmail`.

### 4. Bill Studio — image share to WhatsApp

- New `src/components/billing/BillCanvas.tsx`: renders the bill onto an HTML canvas (society logo, resident, period, line items, total, due date, admin signature image from `societies.signature_url`, optional background from a small theme picker: 4 presets).
- Use `html-to-image` (`bun add html-to-image`) to export a PNG blob.
- "Share to WhatsApp" button:
  - Mobile: `navigator.share({ files: [pngBlob] })` so the image goes directly into the chat.
  - Desktop fallback: download PNG + open `https://wa.me/?text=...` with a short caption + a hosted image URL (uploaded to public `bill-cards` storage bucket).
- Remove plain-text WhatsApp share.
- Migration: add `societies.signature_url`, `societies.bill_theme` (text); new public storage bucket `bill-cards` (read-only public, write via signed upload from server fn).

### 5. Super Admin custom plans + metrics

- New `admin.custom-plans.tsx`: form to create a one-off plan row tied to a specific `society_id` — fields: name, price, duration_days, platform_fee_percent, notes. Stored in new `custom_plans` table; `admin_grant_society_plan` extended to accept a `custom_plan_id`.
- Fix global metrics in `admin.dashboard.tsx`: replace per-society aggregates with `SELECT count(*) FROM ...` queries via a single `admin_global_metrics` RPC (users, societies, active visitors today, MRR, paid bills 30d).
- Visitor dashboard fix: `app.visitors.tsx` / `society.visitors.tsx` — repair status filters (`pending/approved/checked_in/checked_out`), live refresh every 30 s, fix the broken QR-approve action.

### 6. Mobile UI refactor

- Make `ResidentBottomNav` and `SocietyBottomNav` truly fixed: `fixed bottom-0 inset-x-0 h-16 bg-[#1E1E1E] text-white` with 5 slots (Home, Bills, Feed, Visitors, More). Hide on `md+`.
- Reduce card padding project-wide to `p-4` max on mobile (Tailwind: change `p-6`→`p-4 md:p-6` across `PageShell` and main cards).
- Add safe-area bottom padding `pb-[calc(4rem+env(safe-area-inset-bottom))]` to `ResidentLayout` and society shell so content isn't hidden behind the nav.
- Drop hamburger as the only entry on mobile — keep it secondary inside "More".

### Technical notes

- Migrations: `bills.paid_at`, `bills.last_decay_date`, `societies.signature_url`, `societies.bill_theme`, `payments.method` check constraint, `custom_plans` table + GRANTs + RLS (super admin only), point triggers, pg_cron job for decay.
- New deps: `html-to-image`.
- Files touched (major): `src/lib/billing.functions.ts`, `src/routes/api/public/hooks/run-billing.ts`, `src/routes/api/public/hooks/razorpay.ts`, `src/routes/_society/society.bill-studio.tsx`, `src/routes/_society/society.billing.tsx`, `src/routes/_resident/app.bills.tsx`, `src/routes/_resident/app.dues.tsx`, `src/components/shared/ResidentBottomNav.tsx`, `src/components/shared/SocietyBottomNav.tsx`, `src/layouts/ResidentLayout.tsx`, `src/routes/_admin/admin.dashboard.tsx`, new `src/routes/_admin/admin.custom-plans.tsx`, new `src/components/billing/BillCanvas.tsx`, new `src/lib/email-templates/bill-paid-receipt.tsx`.
- No removal of existing security/RLS; new tables follow standard GRANT + RLS pattern.

Confirm to proceed and I'll execute in build mode.                                            CRITICAL MASTER ARCHITECTURE OVERHAUL: GAMIFIED CASHLESS MAINTENANCE, BILL STUDIO, SUPER ADMIN CUSTOM PLANNING, AND MOBILE UI REFACTOR

Please update the complete maintenance, billing, notification, super admin, and mobile layout engine based on these exact specifications. Completely delete any previous requirements regarding manual privacy locks, manual approvals, or cash overrides. Fix all components in one execution:

### 1. DYNAMIC AUTOMATED BILL GENERATION & 100% CASHLESS SYSTEM

- Generation Timing: Do NOT hardcode the billing cycle to the 1st of the month. Use the existing society maintenance config parameters where the Admin defines the exact 'Billing Date' and 'Due Date' for their society.

- State Gate: When a bill is generated on that specific date, it starts as 'Due' (Unpaid).

- No Cash Allowed: Completely REMOVE the "Pay via Cash" or manual payment clearance option from both the Resident and Society Admin interfaces. The system only accepts online payment tracking.

### 2. GAMIFICATION ENGINE (LEADERBOARD POINTS MECHANISM)

- Reward Upgrades: Modify the points multiplier. If a resident pays their maintenance full amount on or before the designated Due Date, automatically credit +10 points (increased from +2) to their profile standing.

- Penalty Framework: If a resident pays AFTER the Due Date, calculate the delta days (Current Date - Due Date). For every single day the payment is overdue, automatically subtract points sequentially from their profile, dropping their position on the Society Leaderboard.

### 3. RAZORPAY SETTLEMENT & INSTANT RECEIPTS

- Direct Settlement Callback: Once a resident completes the transaction via Razorpay and the full amount settles towards the society account, the system must instantly and automatically switch the database row status from 'Due' to 'Paid'.

- Fail-Safe Support Copy: If a system mismatch happens and a payment remains 'Due' after a successful Razorpay debit, display a clear, high-contrast micro-banner: "Payment processing? Contact SocioHub Support for instant reconciliation."

- Automated Delivery: The exact millisecond the status hits 'Paid', fire a background hook to dispatch a clean invoice copy directly to the resident's registered email.

### 4. THE BILL STUDIO (DYNAMIC IMAGE GENERATION & WHATSAPP INTEGRATION)

- Visual Canvas Framework: Build a 'Bill Studio' rendering component. This component dynamically injects billing data onto a structured template.

- Custom Attributes: The Admin can choose a background image theme/canvas wrapper, and it must digitally print the Society Admin's verified signature placeholder at the bottom layout grid.

- Image Sharing Over Raw Text: When an admin or resident uses the "Share to WhatsApp" action link, the system must NOT generate raw text strings. It must render the compiled Bill Studio card wrapper as a downloadable image blob/media payload file format so a high-resolution visual invoice card is sent directly into WhatsApp chats.

### 5. SUPER ADMIN CUSTOM PLANNING & SPECIAL FUNCTIONS (FROM PREVIOUS SPEC)

- Custom Plan Creator: In the Super Admin panel, build an interface allowing the super admin to create customized ad-hoc subscription tiers for specific societies (setting custom duration, price, transaction fee structures manually).

- Core Metric Fix: Ensure the user logs, visitor logs, and society overview database metrics refresh globally. Fix the core structural flaws inside the Visitor tracking dashboard.

### 6. MOBILE UI STRUCTURE AND RESPONSIVENESS REFACTOR (FROM PREVIOUS SPEC)

- Layout Fix: Enforce a strict mobile-first design system. Maximize screen real estate on phone screens.

- Bottom Navigation Bar: Implement a fixed bottom navigation bar `fixed bottom-0 left-0 right-0 h-16 bg-[#1E1E1E]`) for core modules instead of relying purely on a hidden side hamburger menu. Ensure padding on mobile cards is compressed `p-4` max) to prevent layout overflows.