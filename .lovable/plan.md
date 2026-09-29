# Workstream 5 — Procurement & Budgets

## Goal
Add a purchase workflow and yearly budgets that sit on top of the existing Expenses, Ledger, Vendors and Auditor Pack. There is no second accounting, payment, expense or vendor system. A purchase record never proves money was paid. Only a linked, existing Expense does that.

## What users get
- **Purchases** (a new tab in Operations): raise a request, add vendor quotations, compare them side by side, approve or reject, record the order number, record the vendor invoice, note a payment reference, then link the existing Expense. Status chips: Draft, Submitted, Quotation pending, Awaiting approval, Approved, Rejected, Ordered, Invoice received, Payment reference recorded, Completed, Cancelled, Overdue and Over budget.
- **Budgets** (a new tab in Accounts): set an approved amount per financial year and expense category. Actual spending, remaining amount and variance are calculated live from existing Expenses. Revisions need a reason and keep the full history.
- **Auditor Pack**: new read-only sections for budget vs actual, purchases by status, invoice references and linked expense references.

## Rules
- Approval: the requester cannot approve their own request. Only society admins with finance permission can approve. After approval, the vendor, amount and chosen quotation are locked. A rejected or cancelled request cannot move forward.
- Money: amounts must be positive with up to 2 decimals, capped at the existing finance maximum. Text that is not a plain number is rejected, including values like NaN or scientific notation.
- Linking an expense only records a reference; the expense itself stays unchanged. Each expense can link to only one purchase. Its society and amount must match, or the difference must be flagged.
- Budget edits never change expenses. Past revisions can't be edited.
- Attachments for quotations and invoices use a private bucket with the existing 5 MB limit and allowed file types. Only authorized people can view them.

## Technical details
- Migration `0110_workstream5_procurement_budgets.sql`:
  - New tables: `procurement_requests` (status enum, requester, vendor_id → `finance_vendors`, selected_quotation_id, order_ref, invoice_ref, invoice_amount, payment_ref, linked expense_id with a unique index, budget category, fy), `procurement_quotations`, `procurement_events` (append-only), `society_budgets` (society, fy, category, amount, unique), `society_budget_revisions` (append-only: old, new, reason, actor).
  - Every table gets GRANTs, RLS SELECT for society admins only (`is_society_admin_for`), and no direct write policies.
  - Writes happen only through SECURITY DEFINER RPCs: `proc_create`, `proc_add_quotation`, `proc_submit`, `proc_decide`, `proc_mark_ordered`, `proc_record_invoice`, `proc_record_payment_ref`, `proc_link_expense`, `proc_cancel`, `budget_upsert`, `budget_revise`. Each RPC gets the society from the record on the server, checks the permission via `_finance_require_admin`, checks the transition against a `procurement_transition_allowed` table plus a trigger, uses `_rate_hit`, and writes `audit_log`. Repeated transitions are idempotent.
  - `get_budget_vs_actual(fy)` adds up canonical `expenses` on the server. `get_auditor_pack` gains procurement and budget sections.
- Frontend: `src/features/procurement/*` (api, hooks, `PurchasesTab`, `QuotationCompare`, `BudgetsTab`). Tabs are added to the existing Operations and Accounts pages. React Query mutations use networkMode `always` with retry turned off.
- Plan gating follows existing finance: Growth and above, the same as Expenses and Ledger.
- Record the architecture rule in `AGENTS.md`.

## Validation
- Rollback-only SQL tests on QA Demo Society cover:
  - every valid and invalid transition
  - self-approval denial
  - resident-role and cross-society denial
  - vendor from another society rejected
  - duplicate expense link and replays
  - money input abuse
  - budget actual equal to the Expenses sum
  - revision history kept
  - expenses unchanged
- The Auditor Pack totals must match.
- Preview Purchases, Budgets and the Auditor Pack at phone and desktop width using the verified demo admin.
- The protected society, real payments and `utils.ts` are not touched. No test accounts are created.
- Resident and staff role previews stay unavailable, as in earlier workstreams.
