# Next Stages

## Stage 3C — Offline Payments, Verification and Receipts (CLOSED 2026-07-18, v7 payment-detail privacy closure 2026-07-18)

**v7 closure additions (2026-07-18)**
- **`get_payment_detail` returns explicitly shaped fields per audience.** The RPC no longer serializes `to_jsonb(p)` / `row_to_json` / `SELECT *`. It builds JSON via `jsonb_build_object` from a fixed list of common safe fields (`id, bill_id, society_id, flat_id, amount, method, status, reference_no, submitted_at, source, payment_date, verified_at, rejected_at, rejection_reason, reversed_at, reversal_reason, created_at`), plus admin-only fields (`notes, submitted_by, verified_by, verification_notes, rejected_by, reversed_by`) merged in **only when `is_admin` is true**. `proof_url`, `idempotency_key`, and every other internal/dormant column are never emitted.
- **Discriminated audience contract.** `paymentDetailSchema` in `src/lib/offline-payments.functions.ts` is now a `z.discriminatedUnion("audience", [...])` of `.strict()` variants. Resident payloads that surface any admin/internal key (e.g. `proof_url`, `submitted_by`) throw at parse time instead of leaking. `PaymentDetail` is a typed union `PaymentDetailAdmin | PaymentDetailResident`; both branches share `CommonDetailPaymentFields`, and only the admin branch carries `AdminOnlyDetailFields`.
- **proof_url non-exposure.** Every active Stage 3C read surface (`get_payment_detail`, `search_society_open_bills`, `list_society_payments_v1`, `get_resident_payments_v1`, `get_payment_receipt_lifecycle`, resident/admin routes and cards) has been re-audited: no `proof_url` / `proofUrl` in runtime code, response types, or projections. The dormant DB column stays out of every response.
- **Regression tests.** `tests/unit/billing-stage3c-privacy-v7.test.ts` proves the migration body avoids `to_jsonb(p)` / `row_to_json` / `proof_url` / `idempotency_key`, gates admin fields behind `IF is_admin THEN`, uses `jsonb_build_object`; the Zod schemas are strict discriminated unions; a synthetic `proof_url` on a resident payload is rejected by the strict schema; and no active Stage 3C surface contains `proof_url`/`proofUrl` at runtime. Existing Stage 3C v3–v6 tests pass unchanged (v5 assertion updated to the new `discriminatedUnion` shape). Total suite: **830 passed / 19 skipped / 11 todo**.

## Stage 3C — Offline Payments, Verification and Receipts (CLOSED 2026-07-18, v3 read-authorization closure 2026-07-18)

**v3 closure additions (2026-07-18)**
- **Proof URL — Option B (deferred).** `proof_url` is removed from every active Stage 3C read/write surface. The dormant DB column stays for future secure signed-upload work. Neither the resident submit card nor the admin payments route reads or writes it, and it is not in the exported `OfflinePaymentRow` type.
- **Server-authorized read RPCs.** New SECURITY DEFINER RPCs (`SET search_path = public`) shape financial reads with explicit authorization instead of relying on RLS alone:
  - `list_society_payments_v1(_society_id, _status, _limit, _offset)` — requires `billing.manage` or `super_admin`; supports limit + offset pagination and `all|pending|verified|rejected|reversed` filter; no `proof_url` in the projection.
  - `get_resident_payments_v1(_limit, _offset)` — scoped by `flat_residents.user_id = auth.uid()` server-side; residents cannot pass an arbitrary flat.
  - `get_payment_receipt_lifecycle(_payment_id)` — checks admin (`billing.manage`/`super_admin`) OR resident-of-flat; returns full lifecycle (`status`, `voided_at/by/reason`, `amount_snapshot`, `method_snapshot`, `reference_snapshot`, `bill_number_snapshot`, `verified_by/at`, `receipt_number`, `issued_at`).
- **Receipt-table read boundary.** `REVOKE SELECT ON public.payment_receipts / payment_receipt_sequences / payment_receipt_month_sequences FROM authenticated`. Every receipt read now goes through `get_payment_receipt_lifecycle`.
- **Type safety.** `src/lib/offline-payments.functions.ts` has no `any` or `as any`. The old `SupabaseRead` adapter is gone; each RPC response is parsed by a Zod schema (`paymentRowSchema`, `residentPaymentSchema`, `receiptLifecycleSchema`) before it crosses the server-fn boundary. The resident submit card now renders a clear VOID state when the linked receipt is voided by a reversal.
- **`get_admin_society_ids` anon grant — audited, kept.** The function is `SECURITY DEFINER STABLE` on `search_path = public` and returns the empty set for `auth.uid() IS NULL`. Anon callers therefore get zero rows and cannot enumerate any admin/society membership. Removing the anon grant would break SSR/anon reads that reference the helper inside public SELECT policies. Decision: keep the grant, no change required.
- **Project monitoring findings.** The 5 pending findings listed at the start of this run (Import button routing on `/society/matrix` and `/society/maintenance`, structure_mode backfill on the Flats page, setup-checklist link to `/society/settings`, trial plan collapse to basic on Flat 360, resident no-dues certificate download) are all pre-Stage-3C UX/regression issues — none touch tenant isolation, RLS, auth, payments, receipts, or the Stage 3C write/read path. They are documented here as classified `earlier-stage non-Stage-3C-blockers`; fixing them is a separate follow-up.
- **Behavioral tests.** New `tests/unit/billing-stage3c-closure-v3.test.ts` proves proof_url removal, no `any`/`as any`, `list_society_payments_v1` limit + offset wiring, `get_resident_payments_v1` server-derived flat ownership, `get_payment_receipt_lifecycle` fields, VOID state in the resident card, and the migration's REVOKE + GRANT shape. Existing `billing-stage3c-closure.test.ts` was migrated from "latest migration" scan to full-migrations-corpus scan. Total suite: **780 passed / 19 skipped / 11 todo**.



**Scope delivered**
- **Canonical offline lifecycle.** Payments live in one workflow: `pending → verified | rejected → reversed`. Cash and Bank Transfer only; no online gateway, UPI, cards, wallets, Razorpay, PayU, or Cashfree. Legacy `success` / `other_offline` rows remain readable but cannot be transitioned by any Stage 3C RPC (`invalid_transition`).
- **Database.** Additive migration extends `payments` with `submitted_at/by`, `source`, `verified_at/by`, `verification_notes`, `rejected_at/by`, `rejection_reason`, `reversed_at/by`, `reversal_reason`, `proof_url`, `payment_date`, and a unique `idempotency_key`. New tables: `payment_receipts` (unique `(society_id, receipt_number)`, unique per payment) and `payment_receipt_sequences` (per-society yearly counter). RLS scopes admin reads via `billing.manage`/`super_admin` and resident reads via `flat_residents`.
- **Server-authoritative RPCs (SECURITY DEFINER, `SET search_path = public`).**
  - `submit_offline_payment(_bill_id, _method, _amount, _payment_date, _reference_no, _notes, _proof_url, _idempotency_key)` — resident-of-flat OR `billing.manage`. Validates method ∈ {cash, bank_transfer}, positive amount, bank_transfer requires reference. Idempotent per (`idempotency_key`, submitter). Writes `payment.submitted` audit row.
  - `verify_offline_payment(_payment_id, _notes)` — `billing.manage`/`super_admin`. Allocates receipt via `_allocate_receipt_number`, syncs bill status via `_sync_bill_payment_state`, writes `payment.verified` audit row. Returns `{payment_id, receipt_number, receipt_id}`.
  - `reject_offline_payment(_payment_id, _reason)` and `reverse_offline_payment(_payment_id, _reason)` — same guard. Reject only from `pending`; reverse only from `verified`. Reversal re-syncs bill status. Reason required. Both audit-logged.
  - `_sync_bill_payment_state` recomputes bill status **only from verified payments** — `paid` when `sum(verified) ≥ total_payable`, `partially_paid` when > 0, else `unpaid`/`overdue` based on due date.
- **Trusted mutation boundary.** `REVOKE INSERT, UPDATE, DELETE ON public.payments FROM authenticated` — every write now goes through the four RPCs. Function `EXECUTE` scoped to `authenticated`; internal helpers (`_allocate_receipt_number`, `_sync_bill_payment_state`) revoked from all non-service roles.
- **Server functions.** `src/lib/offline-payments.functions.ts` exposes `submitOfflinePayment`, `verifyOfflinePayment`, `rejectOfflinePayment`, `reverseOfflinePayment`, `listSocietyPayments`, `getPaymentReceipt`. All go through `requireSupabaseAuth`, the typed `BillingRpcClient` adapter (no `as any`), and `mapPaymentError` (no raw DB messages leak).
- **UI.**
  - Resident: `src/components/billing/OfflinePaymentSubmitCard.tsx` renders on the resident bill detail only when the bill is open (not cancelled, not paid). Two-button method picker (Bank Transfer / Cash), amount, payment date, reference (required for bank), optional notes; client-generated `idempotencyKey`. After submit → "Pending admin verification" state; once the admin verifies, the resident sees the receipt number inline. No gateway CTA, no "coming soon" copy.
  - Admin: `/society/payments` (`src/routes/_society/society.payments.tsx`) with Pending / Verified / Rejected / Reversed tabs, verify (single-click, issues receipt), reject (reason required), reverse (reason required). Direct browser `payments` writes remain revoked.
- **Legacy retirement.** `src/lib/maintenance-pay.functions.ts` `createMaintenanceOrder` is now a deprecation stub that throws — no Razorpay orders, no platform-fee math, no `RAZORPAY_KEY_*` reads.
- **Behavioral tests.** `tests/unit/billing-stage3c-offline-payments.test.ts` (23 cases): server-fn exports + `requireSupabaseAuth`/`callBillingRpc` wiring, `submit_/verify_/reject_/reverse_offline_payment` targeting, method restricted to cash/bank_transfer, non-empty reason for reject/reverse, safe error mapping for `invalid_method`/`invalid_transition`/`reference_required`, no `as any`, resident card wires `submitOfflinePayment`, forbids UPI/Razorpay/wallets/coming-soon/Pay-now, generates an idempotency key, and gates receipt display behind admin verification; admin route wires `useServerFn` for all four write functions, requires reasons before reject/reverse, covers all four status tabs, and never touches the browser Supabase client for `payments`; retired maintenance-pay module no longer touches `api.razorpay.com` / `RAZORPAY_KEY_ID` / `orderPayload` and throws the Stage 3C boundary message. Total suite: **739 passed / 19 skipped / 11 todo**.
- **Protected society safety.** `1907a918-c4b8-4f43-a837-450530cc7c34` is asserted absent from every new Stage 3C source file.

**Explicitly out of scope in Stage 3C (deferred to 3D):** full ledger/accounting reconciliation, online payment gateway enablement for maintenance (Razorpay/UPI/cards/wallets/PayU/Cashfree), reminder/email/SMS automation, penalty automation.

**Exact next position:** Stage 3D — Ledger and reconciliation.



## Stage 3B — Recurring Bills, Bill Numbering, Dues, Bill Lifecycle (CLOSED 2026-07-18)

**Closure run — 2026-07-18**
- **Preview enriched with server-derived totals.** `preview_bill_batch` and `BillBatchPreview` now expose `unit_count`, `current_charges_total`, and `total_payable` (server-computed as `current_charges_total + previous_dues_total`), plus a `no_active_units` warning. The generate UI + confirmation dialog display these figures; finalize is disabled on `no_active_units`, `cycle_not_ready`, `template_not_active`, or existing bills.
- **Audit logging.** `finalize_bill_batch` writes a `billing.batch_finalized` `audit_log` row (metadata: `bills_created`, `total_amount`, `cycle_config_id`, `template_id`, `request_id`). `cancel_bill` writes `billing.bill_cancelled` with the reason.
- **Admin cancel UI.** `society.bills.$id.tsx` now offers a "Cancel bill" affordance with a reason field, wired to `cancelBill`. Hidden when the bill has a verified payment (with an inline explanation) or is already cancelled. Confirmation dialog spells out audit + no-undo semantics.
- **Resident read-only bills.** `getResidentBills` + `getResidentBillDetail` server fns derive owning flats from `flat_residents` under RLS and never trust client-provided flat/society ids. `_resident/app.bills.tsx` consumes `getResidentBills`, replacing the direct-client `flat_residents` + `bills` query pair.
- **Generate confirmation copy.** Dialog explicitly states "No payments are recorded in this step. Payment entry and receipt verification comes in Stage 3C", along with the `RR/YYYYMM/####` numbering rule and regeneration lockout.
- **Behavioral tests (closure).** `tests/unit/billing-stage3b-closure.test.ts` (20 cases) proves: no `as any`, no client-submitted totals on finalize, resident-safe reads with explicit ownership fallback, `requireSupabaseAuth` on every Stage 3B fn, migration writes `audit_log` rows on both finalize + cancel, preview JSON contains `unit_count`/`current_charges_total`/`total_payable`, `no_active_units` warning surfaces, `RR/YYYYMM/####` allocator with `lpad(_next, 4, '0')` + unique bill numbers, no Stage 3B source touches payments/receipts/ledger/platform fee, cancel-blocked-when-verified copy, and resident bills route uses `useServerFn(getResidentBills)`. Total suite: **677 passed / 19 skipped / 11 todo**.

## Stage 3B — Recurring Bills, Bill Numbering, Dues, Bill Lifecycle (initial pass, 2026-07-18)

**Delivered**
- **Schema (additive).** `bills` extended with `cycle_config_id`, `template_id`, `current_charges`, `previous_balance`, `penalties`, `adjustments`, `tax_amount`, `total_payable`, `generated_by`, `finalized_at`, `generation_batch_id`, `calc_snapshot`. New tables `bill_generation_batches` (society-scoped idempotency: unique on `society_id, cycle_config_id, request_id`) and `bill_number_sequences` (per-society, per-YYYYMM prefix counter). New unique index `bills_society_bill_number_unique` guarantees no duplicate bill numbers per society.
- **Bill numbering.** `RR/YYYYMM/####` allocator implemented in `public._allocate_bill_number(society, period_start, prefix)`. Executed only inside the SECURITY DEFINER RPC — not granted to authenticated. Uses `ON CONFLICT ... DO UPDATE ... RETURNING` for a lock-safe sequence.
- **Preview.** `public.preview_bill_batch(society, cycle_config, limit, offset)` reuses the Stage 3A per-unit template preview, then adds `previous_dues_total` (sum of unpaid finalized bills across the society with `due_date < cycle.period_start`), `existing_bill_count` (bills already tied to this cycle), and structured `warnings` (`cycle_not_ready`, `template_not_active`, `duplicate_existing_bills`). Preview never writes.
- **Finalize (atomic + idempotent).** `public.finalize_bill_batch(society, cycle_config, request_id, prefix)` gates on `_billing_require_admin`, replays idempotently by `(society, cycle_config, request_id)`, refuses `cycle_not_ready` / `template_not_active` / `duplicate_bills_for_cycle`. For every active flat it computes current charges from the template lines, adds per-flat `previous_balance` from that flat's outstanding bills, allocates a structured `bill_number`, inserts the `bills` row plus its `bill_line_items`, and writes a `calc_snapshot` for audit. Returns `{ idempotent_replay, batch_id, bills_created, total_amount }`.
- **Lifecycle.** `public.cancel_bill(society, bill_id, reason)` refuses cancelling bills that already have verified payments, and stamps `cancelled_at / cancelled_by / cancel_reason` with `status = 'cancelled'`. Draft is represented implicitly (a bill exists only after finalize); a soft cancel replaces re-generation.
- **Server functions** (`src/lib/billing-generate.functions.ts`, all `requireSupabaseAuth`): `previewBillBatch`, `finalizeBillBatch`, `listBillBatches`, `listBills`, `getBillDetail`, `cancelBill`. Errors flow through `mapBillingError` → shared `mapError` — no raw DB messages ever reach the UI. Preview return is serialization-safe (template preview payload flattened to `template_preview_json`).
- **UI.** New route `/society/bill-studio/generate` (`src/routes/_society/society.bill-studio.generate.tsx`) lists ready cycles, previews with warnings + previous dues, and finalizes with a client-generated UUID idempotency key. Recent batches are listed with counts and totals. `BillingConfigCard`'s Stage 3B affordance is now an active link to that route and disables when no ready cycles exist.
- **Tests.** `tests/unit/billing-stage3b.test.ts` (14 cases) covers safe error mapping for every Stage 3B code, "no leaked DB message" guarantee, source integrity (no `as any` in Stage 3B code, idempotency key wired through `crypto.randomUUID()`), migration presence of allocator + unique index + idempotency `UNIQUE (society, cycle, request_id)` + duplicate-guard, and the protected society UUID absence. Stage 3A behavioral test tightened to scope the "no bill inserts" assertion to the preview function body only — Stage 3B's finalize legitimately writes to `bills` and `bill_line_items`. Suite: 660 passed / 19 skipped / 11 todo (1 unrelated pre-existing failure).
- **Protected society safety.** `1907a918-c4b8-4f43-a837-450530cc7c34` is asserted absent from every new Stage 3B file.

**Explicitly out of scope in Stage 3B (deferred to 3C/3D):** payments, receipts, gateway integration (Razorpay/UPI/cards/wallets/PayU/Cashfree), platform fee, reconciliation, dues aging beyond a per-flat carry-forward, penalty automation, reminder/email/SMS flows.

**Exact next position:** Stage 3C — Payments and receipts.


## Stage 3A — Bill Studio and Billing Configuration (COMPLETE 2026-07-17)

**Delivered (initial run)**
- Additive migration creates `billing_charge_heads`, `billing_templates`, `billing_template_lines`, `billing_cycle_configs`. RLS restricts reads to holders of `billing.manage` (Society/Super Admin) via the 3-arg `current_user_has_society_permission(_, _, NULL)` helper. All mutations go through SECURITY DEFINER RPCs with a shared `_billing_require_admin` gate; direct `INSERT/UPDATE/DELETE` on tables is not granted to `authenticated`.
- Server-authoritative preview: `preview_billing_template(society, template, limit, offset)` computes per-unit line amounts from canonical `flats`, including `area_based` NULL/zero-area warnings and `manual_variable` markers, plus a society-wide totals summary. Preview never writes bills.
- Server functions in `src/lib/billing-config.functions.ts`: `listChargeHeads`, `saveChargeHead`, `listBillingTemplates`, `saveBillingTemplate`, `listTemplateLines`, `saveTemplateLine`, `archiveTemplateLine`, `configureBillingCycle`, `listBillingCycles`, `previewBillingTemplate`. All require `requireSupabaseAuth`. `mapError` translates DB error codes into safe UI messages.

**Closure delivered (this run)**
- **Serial-safe preview.** Corrective migration (`20260717192157_...`) rewrites `preview_billing_template` to include both structured and serial-mode units (no `block_id IS NOT NULL` eligibility filter), scopes to `is_active = true`, and canonicalizes unit type via `COALESCE(NULLIF(btrim(f.unit_type),''), NULLIF(btrim(f.type),''), '')`. Same migration adds `billing_templates_prevent_active_overlap` trigger raising `template_overlap` for overlapping active windows on the same society + frequency.
- **Billing cycle UI wired.** `BillingConfigCard` now consumes `listBillingCycles`/`configureBillingCycle`, adds a "New cycle" dialog (template, name, period/due dates, draft|ready), lists cycles under the active template, and exposes an explicitly-disabled "Generate bills · Stage 3B" affordance so the boundary is honest.
- **Safe server error handling.** All server functions route errors through `mapError`; list handlers no longer throw raw `error.message`. `template_overlap` and `area_not_available` are mapped explicitly. No PostgreSQL detail can reach the client.
- **Typed RPC adapters (no `any`).** `BillingRpcClient` interface + `toBillingRpcClient`, `buildRpcArgs`, `callBillingRpc`, `extractRpcId` helpers replace every `as any`. Verified by a source-contract test.
- **Capability verification.** `billing.manage` is confirmed to be held by `society_admin` / `super_admin` only, denied to `block_admin` / `resident` / `security`.
- **Behavioral tests.** `tests/unit/billing-config-stage3a-behavioral.test.ts` (24 cases) covers safe error mapping, adapter helpers, denied-role mapping (`unavailable` → role message), cross-society (`template_not_found` → safe not-found), duplicate charge head, invalid cycle dates, preview payload shape including serial + structured rows, no `as any` in source, `useServerFn(listBillingCycles|configureBillingCycle)` wiring in `BillingConfigCard`, the Stage 3B boundary + "no bills generated" copy, latest preview migration is serial-safe and area/unit-type canonical, no Razorpay/Stripe/Paddle/UPI/platform-fee/`bills`|`payments`|`ledger_entries` writes in Stage 3A sources, and role-capability parity. Total suite: 647 passed / 19 skipped / 11 todo.
- **Protected society safety.** Every check uses synthetic UUIDs; `1907a918-c4b8-4f43-a837-450530cc7c34` is explicitly asserted absent from Stage 3A sources.

**Explicitly out of scope in Stage 3A:** real bill generation, payments/receipts/dues/penalties/reminders, Razorpay, UPI, cards, wallets, online gateway, platform fee, reconciliation. Preview + configuration only.

**Exact next position:** Stage 3B — Real bill generation from ready cycles.




## Stage 2E — Onboarding, Migration QA & Stage 2 Closure (COMPLETE 2026-07-17)

**Scope delivered**
- **Provenance conflict correctness (final closure):** additive migration adds `public._migration_link_or_conflict(...)` (SECURITY DEFINER, fixed `search_path`, revoked from PUBLIC/anon/authenticated, granted only to `service_role`) which enforces the exact rule: no existing link → INSERT; same key + same canonical id → safe no-op replay; same key + different canonical id → `RAISE 'provenance_mismatch' USING ERRCODE='MG001'` so the outer sub-transaction rolls back every canonical write before the commit request is marked failed. Every `migration_entity_links` write inside `commit_migration_job` (structure, unit, resident, family, vehicle) now flows through this helper — no `ON CONFLICT DO NOTHING` remains in the commit body.
- **Pre-commit dedup:** each `create` branch for structure/unit/resident/family/vehicle first checks whether the source key already resolves to a still-present canonical row and reuses it instead of creating a duplicate. This protects repeated imports.
- **Family/vehicle canonical ids preserved:** family provenance stores `family_members.id`, vehicle provenance stores `vehicles.id`. Resident lookup for family/vehicle is source_type-scoped.
- **Atomic rollback preserved:** the outer PL/pgSQL sub-transaction (`BEGIN ... EXCEPTION WHEN SQLSTATE 'MG001'`) still reverts every canonical write in the current attempt before recording the failure code.
- **FK safety preserved:** `family_members.offline_resident_id` and `vehicles.offline_resident_id` remain `ON DELETE RESTRICT`.
- **Server-derived checksum preserved:** `commitMigrationJob` loads `migration_jobs.file_checksum` server-side; resume works without any browser-held checksum.
- **Setup checklist wired into a real surface:** `SetupChecklistCard` (in `src/components/society/SetupChecklistCard.tsx`) consumes `getSetupChecklist` and is mounted on `src/routes/_society/society.dashboard.tsx`. Import remains optional and never blocks required completion. Team/privacy show as actionable review items with links, not fake ticks.
- **Recovery UX preserved:** `/society/import` recent-jobs list + resume + failure-guidance map unchanged. `/society/matrix-import` still redirects to `/society/import`.
- **Test hygiene preserved:** `tests/billing-cron.mjs` remains a Node-only script (not a vitest file).

**Verification (this run):** provenance behaviour is proven by strong SQL contract tests that extract the effective `commit_migration_job` and `_migration_link_or_conflict` bodies from the applied migration and assert every rule (no `ON CONFLICT DO NOTHING` in commit provenance, real family/vehicle canonical ids, source_type-scoped lookups, MG001 rollback on different-ID conflict). Runtime PostgreSQL rollback verification remains deferred to the Stage 13 DB test harness.

**Stage 2 closure status:** Stage 2A–2E complete. Ready for Stage 3 scoping.

**Exact next position:** Stage 3A — Bill Studio and Billing Configuration.



## Stage 2D — Migration & Bulk Import (COMPLETE 2026-07-17)

### People commit closure (final run)

- `commit_migration_job` now performs real canonical writes for every
  supported entity type — structures, units, residents (via
  `offline_residents` for non-login creates and `flat_residents` for
  matched auth users), family members, and vehicles. The people counters
  (`residents_created`, `residents_matched`, `occupancies_created`,
  `family_created`, `vehicles_created`) are derived from actual inserts,
  never hardcoded.
- Additive schema extension: `family_members` and `vehicles` gained a
  nullable `offline_resident_id` FK and a CHECK constraint requiring
  exactly one of `user_id` / `offline_resident_id`. `family_members` also
  gained `society_id` / `flat_id` provenance columns (backfilled for
  existing rows) and a society-admin read policy.
- Duplicate active vehicle plates block the commit as
  `unresolved_conflicts` (never silently overwrite). Unresolvable resident
  links, missing units, and invalid plates likewise mark the commit
  request `failed` and roll the job back to `ready` so retries are safe.
- Completion guard: after each entity loop, the RPC counts any remaining
  valid/warning rows with `create`/`match_existing` and returns
  `unresolved_conflicts` if any are still uncommitted or unlinked. A job
  cannot reach `completed` while staged work remains.
- Behavioral tests (`tests/unit/migration-behavioral.test.ts`) invoke the
  real `_commitMigrationJobViaRpc` against a mocked supabase client and
  assert the full status/result contract — including people counts,
  idempotent replay, blocked-conflict handling, malformed-result guards,
  and unknown-status rejection. No source-regex assertions.
- UI: the confirm dialog now honestly enumerates what will be written and
  the result card shows the full people-commit counters. The stale "no
  residents/family/vehicles" disclaimer is removed.

## Stage 2D — Migration & Bulk Import (superseded intermediate status)

### Upload hardening delivered this run

- Storage authorization no longer casts arbitrary object folders to `uuid`.
  New SECURITY DEFINER helper `public.migration_upload_path_ok(name)`
  validates the exact path shape `<society-uuid>/<job-uuid>/<random>.<ext>`,
  confirms the job belongs to the society, and confirms the caller is a
  Society Admin (or Super Admin). Malformed paths return `false` — never
  throw. The storage policy on `migration-uploads` uses this helper.
- Browser CreateJob contract removed. `initializeMigrationUpload` is the
  only entry point: it validates the declared filename/size/mime, creates
  a job via `migration_create_job` (SECURITY DEFINER), generates the final
  private path server-side, and returns a short-lived signed upload URL
  for that exact path.
- `finalizeMigrationUpload` downloads the private object server-side,
  enforces the 10 MB cap on actual bytes, checks the magic-byte signature
  (rejects XLSX/EXE/ELF), computes SHA-256 from real bytes, parses CSV
  server-side, and stores authoritative parsed rows in the new
  `migration_parsed_rows` table. Finalize records the authoritative
  checksum/size/row count through `migration_finalize_upload`.
- New CSV parser in `src/lib/migration-pipeline.ts` (no dependency):
  handles UTF-8 BOM, quoted commas, escaped quotes, CRLF/LF, blank
  lines, and rejects malformed quotes, empty headers, duplicate headers,
  oversized cells, and row-cap breaches. Formula-looking cells stay
  inert text — neutralization only fires on downloadable reports.
- `validateMigrationJob` no longer accepts caller-supplied rows. It loads
  the authoritative parsed rows, applies mapping server-side, runs Zod,
  and replaces staging atomically through the new
  `migration_replace_staging` RPC (locks the job, deletes stale staging,
  bulk-inserts new staging, updates counters — all in one transaction).
- Direct `INSERT/UPDATE/DELETE` grants on `migration_jobs`,
  `migration_rows`, and `migration_entity_links` are revoked from
  `authenticated`. Every mutation goes through the SECURITY DEFINER RPCs.
- Production `/society/import` route rewritten to consume the new server
  functions end-to-end (source → CSV upload → server parse → mapping →
  server validate → server-paginated preview). Browser XLSX dependency
  removed. Confirm-import is deliberately disabled with an "Import commit
  will be enabled after final validation is complete" message — no
  canonical writes are performed from the browser anymore.
- Honest XLSX status: `finalizeMigrationUpload` returns
  `unsupported_format` for `.xlsx` uploads. The UI copy advertises CSV
  only. A safe server-side XLSX parser lands with the remaining Stage 2D
  work.

### Tests

- 32 new assertions in `tests/unit/migration-stage2d-upload.test.ts`
  cover CSV parsing edge cases, signature detection, disabled commit,
  removed browser-write patterns, missing `as any`, and SQL-level
  invariants (safe path helper, revoked grants, parsed-rows table,
  replace-staging RPC). Full unit suite: 587 pass, 5 skipped.

### Remaining Stage 2D work

- Real transactional canonical commit (`commit_migration_job` PLPGSQL
  dispatching to Stage 2A/2B admin functions).
- Separate `migration_commit_requests` table for commit idempotency
  (distinct from upload idempotency).
- Real `canonical_entity_id` in `migration_entity_links` (currently
  placeholder — no rows are written into that table by this run).
- Server-side XLSX parser or a hard, documented CSV-only stance.
- Final result UI (post-commit summary).
- Stage 2D completion + closure.

Stage 2D remains **IN PROGRESS**. Protected society
`1907a918-c4b8-4f43-a837-450530cc7c34` is untouched — no fixture, seed,
or runtime reference.

## Stage 2D — Prior scaffolding notes



Canonical import pipeline scaffolded end-to-end:

- Migration `20260717044655…` adds `migration_jobs`, `migration_rows`,
  `migration_entity_links` (staging + provenance), plus enums
  `migration_job_status`, `migration_entity_type`, `migration_row_action`,
  `migration_row_status`.
- Society-scoped SECURITY DEFINER helper
  `public.current_user_can_admin_migrations(_society_id)` powers RLS on all
  three tables. Residents, block admins, guards and anonymous are denied.
- Private storage bucket `migration-uploads` with society-scoped RLS
  (`storage.foldername(name)[1]::uuid` binds path to society id).
- Shared browser-safe pipeline module `src/lib/migration-pipeline.ts`:
  file-safety validator (10 MB cap, 5 000 row cap, XLSM/XLSB/macros
  rejected), formula neutralization for downloadable error reports,
  MyGate/ADDA/NoBrokerHood/SociyoHub/generic column-mapping presets,
  strict Zod row schemas for structures / units / residents / occupancy /
  family / vehicles, plate normalization, deterministic checksums.
- Server functions in `src/lib/migration.functions.ts`
  (`createMigrationJob`, `validateMigrationJob`, `listMigrationJobs`,
  `getMigrationPreview`, `commitMigrationJob`) — all typed against
  generated `Database` types, strict Zod input/output, safe stable error
  codes only (`invalid_file`, `unsupported_format`, `too_many_rows`,
  `invalid_mapping`, `validation_failed`, `unresolved_conflicts`,
  `job_not_ready`, `job_already_committing`, `idempotency_conflict`,
  `unavailable`, `operation_failed`). No `as any`.
- Idempotent commit: `(society_id, idempotency_key)` unique on jobs;
  identical `creation_request_id` re-runs return the existing completion;
  changed checksum returns `idempotency_conflict`. Provenance rows are
  upserted on `(society_id, source_type, entity_type, source_key)`.
- Preview is server-paginated (`getMigrationPreview`) — no operational
  mutation, no PII leaked in the job list.
- 23 focused unit tests in `tests/unit/migration-pipeline.test.ts`:
  file safety (CSV/XLSX accepted; XLSM/XLSB/XLTM/archives/executables
  rejected; oversized rejected; row cap enforced; empty rejected),
  formula neutralization, MyGate/ADDA/NoBrokerHood preset detection,
  row-schema validation including plate normalization, and deterministic
  checksums. All pass; `bunx tsgo --noEmit` clean.
- Protected society `1907a918-c4b8-4f43-a837-450530cc7c34` remains
  completely untouched — no fixture, seed, or runtime reference.
- Canonical writes for new structures / units / residents remain the
  responsibility of the existing Stage 2A/2B admin RPCs. The Stage 2D
  commit records provenance for matched rows and leaves canonical inserts
  as the Stage 2E wiring task; auth users are never fabricated.
- Integration tests: honestly skipped pending isolated fixtures + private
  test storage. No production data used.

**Exact next position:** Stage 2E — Onboarding, Migration QA and Stage 2
Closure (canonical write wiring, resumable partial commits, and the
production UI consuming the pipeline).

---

## Immediately after Stage 3A closes


### Checkpoint F — Flat 360
Upgrade `src/routes/_society/society.flats.$id.tsx` in place (no duplicate route). Sections: Identity + Occupancy, Financial Summary, Occupancy History, Operations (vehicles, visitors, documents, approvals), No-Dues status, Deterministic Unit Summary + Lovable-AI Summary (Pro-gated, cached/rate-limited, deterministic fallback on failure). Real data only; honest empty states.

### Checkpoint G — No-Dues workflow (Pro)
- Migration (additive): `no_dues_requests`, `no_dues_certificates`, `no_dues_audit`, `check_no_dues_eligibility(unit_id)` RPC. RLS scoped to society + owner; server-side transitions only.
- Storage: private bucket `no-dues-certificates`.
- Server fns in `src/lib/no-dues.functions.ts`: `submitNoDuesRequest`, `reviewNoDuesRequest`, `approveAndIssue` (idempotent), `rejectRequest`, `revokeCertificate`, `listMyRequests`, `listSocietyRequests`. Certificates via `pdf-lib` + `qrcode`.
- Public route: `src/routes/api/public/verify/no-dues.$token.ts` (JSON, minimum data).
- Public page: `src/routes/verify.no-dues.$token.tsx`.
- Society Admin UI: `/society/no-dues`, `/society/no-dues/$id`.
- Resident UI: `/app/no-dues`, `/app/no-dues/$id`.

### Checkpoint H — Gamification (Pro)
- Migration (additive): `payment_points_ledger` (unique on `payment_id`), `society_settings.gamification_enabled`.
- Server fn awarding 2 points on verified on-time payment; reversal handling.
- Leaderboard route already exists — wire it to the new ledger.

### Checkpoint J — Whole-app visual parity
Iterate every route in the "Not touched in Stage 3A" section of `UI_REFERENCE_MAP.md`. Route-level visible changes required. Reference screenshots (user-provided) are source of truth; where absent, use SociyoHub tokens + primitives.

## Stage 3B — Non-Member Payments, AI Income Categorization, Reconciliation
All Pro. Feature keys: `non_member_payments`, `ai_income_categorization`, `reconciliation`.

## Stage 3C — AI Secretary / Society Knowledge Base
Pro. Document upload, indexing, source-cited answers from society-uploaded docs only. Feature key: `ai_secretary`.

## Stage 3D — Universal Smart QR, low-risk migration, privacy/transparency controls
All Pro. Feature keys: `smart_qr_collections`, `migration`, `privacy_controls`.

## Stage 3E — Premium enhancements
Advanced AI limits, deeper automation, advanced forecasting, custom branding, higher usage caps, priority support. Premium differentiation lives here — **not** by removing Pro workflows.

---

## Stage 4 — Remaining Feature Completion
Complaints/helpdesk, documents, approvals, notifications, communication, imports/exports, advanced reports across resident/admin/guard/super-admin.

## Stage 5 — Production Security Hardening
Dependency audit, secrets audit, endpoint rate limiting on remaining surfaces, strict schema validation, RLS penetration tests, upload security, audit logs, backups/recovery, export/deletion, session/device security.

## Stage 6 — UI/UX, Accessibility, Performance
Whole-app usability sweep, WCAG-level accessibility, performance budget, offline/error/empty/loading states, user onboarding polish, old-age-friendly usability.

## Stage 7 — Android / Play Store Readiness
PWA vs native wrapper decision, app icons, splash, deep links, notification permissions, Privacy/Data Safety forms, account deletion, legal pages, crash monitoring, release build, internal/closed testing.

## Final Stage — Payment Integration
Payment-provider review, live gateway integration, webhook verification, reconciliation, failure/refund handling, production payment testing. **Absolutely no payment activation before this stage.**

---

**Roadmap Lock:** Payment integration MUST remain the final stage. Any earlier
stage that touches payment activation, platform fees, or replaces
Cash + Bank Transfer maintenance behavior violates the lock. See
`docs/RELEASE_READINESS.md` for permanent rules.

---

## Stage 3B — Turn 18A status (2026-07-15)

Backend foundation for Non-Member Payments landed:

- Tables `society_income_categories`, `non_member_payers`, `society_income_records` (additive, admin-only RLS).
- Server functions in `src/lib/non-member-income.functions.ts` with strict Pro/Premium gating.
- 25 new unit tests; integration matrix scaffolded but honestly skipped without isolated fixtures.

Next (Turn 18B): Society Admin UI for categories, payers, income entry + verification/reversal, and Reports wiring. Still no online payment gateway.
Later Stage 3B turns: AI Income Categorization (server-side, Pro), Universal Smart QR, Reconciliation import.

## Stage 1E — completed

Authoritative SQL income reporting (`get_society_income_report`),
manual reconciliation foundation (`transition_income_reconciliation`
with atomic `audit_log`), server-paginated payer directory
(`list_non_member_payers_page`), and dashboard/detail UI wired to the
new sources. Verification and reconciliation are strictly independent
state machines. All privileged RPCs revoke PUBLIC/anon and grant
`authenticated` only.

**Preview inspection (Stage 1E):** Rendered preview inspected at 360,
390, 414, 768, and 1280 CSS widths for: Income dashboard populated,
dashboard empty, report loading, filtered record list, record detail
with reconcile / undo-reconciliation dialogs (verification note
visible), category page, payer page, Basic locked, and role denied.
No horizontal overflow, ₹ values not clipped, dialogs fit mobile,
44px touch targets on all primary actions, status pills distinguished
by shape+label (not color alone). Reduced motion respected.

**Non-critical debt deferred to Stage 13:**

- Optional server-side CSV export of the SQL report (no safe export
  subsystem exists yet).
- `needs_review` and `partially_matched` still surface but Stage 1E
  only ships the manual `matched` ↔ `unreconciled` transitions.
- Real bank-statement import, Smart QR, and AI auto-matching remain
  future stages.

## Next: Stage 2A — Society Structure Audit and Canonical Setup Model


---

# Stage 2A — Society Structure Audit and Canonical Setup Model — COMPLETE

**Canonical model:** `public.societies`, `public.blocks`, `public.flats` are the
authoritative structure/unit tables. `public.hierarchy_nodes` is retained for
backward compatibility only — it must not be a new independent write source.

## Migration (additive, safe)

- `societies.structure_mode` — `'structured' | 'serial'`, nullable for legacy.
- `blocks`: added `structure_kind` (`block|tower|wing`), `is_active`,
  `display_order`, generated `normalized_name`. Unique index
  `blocks_society_normalized_name_uidx` (society + normalized name).
- `flats`: `block_id` is now nullable; added `is_active`, `display_order`,
  generated `normalized_label`. Partial unique indexes:
  - structured — `(society_id, block_id, normalized_label)` where `block_id IS NOT NULL`
  - serial — `(society_id, normalized_label)` where `block_id IS NULL`
- Trigger `flats_enforce_structure_mode`:
  - structured → block_id required, block must belong to same society and be active.
  - serial → block_id must be NULL; floor forced NULL.
  - NULL mode → permissive (legacy).
- `commit_society_wizard` updated: sets `structure_mode`; serial layout writes
  units with `block_id = NULL` (no more synthetic "Houses" block).

## Authoritative RPCs (SECURITY DEFINER, REVOKE PUBLIC/anon, GRANT authenticated)

- `get_society_structure_overview(_society_id)`
- `configure_society_structure_mode(_society_id, _mode)` — blocks unsafe conversions.
- `list_society_units_page(...)` — server search / block / floor / unit_type / active filters, limit ≤ 100, default 25.
- `create_society_unit`, `update_society_unit`, `set_society_unit_active`, `set_society_block_active`.

## Authorization
- Society Admin & Super Admin only for their society (`is_society_admin_for` / `is_super_admin`).
- Block Admin / Resident / Guard / anon denied.
- Cross-society IDs return non-enumerating `{ ok: false, reason: 'not_found' }`.
- Fixed `SET search_path = public` on every new SECURITY DEFINER function.

## UI wiring (existing routes only — no duplicate navigation)
- `society.setup.tsx` — step 1 now offers the canonical Structured/Serial chooser,
  calls `configure_society_structure_mode`, and displays the live overview.
- `society.blocks.tsx` — hides itself in serial mode and points users to Units.
- `society.flats.tsx` — server-paginated unit list (25/page, ≤100), search + block
  filter, respects mode (hides block/floor fields in serial), gated on
  "Structure setup required" when unconfigured.
- `onboarding.create.tsx` — unchanged UI; the wizard payload now always writes
  canonical `blocks`/`flats` and sets `structure_mode`.

## Legacy data safety
- No automatic mode inference for ambiguous societies; they remain NULL and see
  "Structure setup required".
- Existing IDs, unit names, block names, and hierarchy_nodes rows are preserved.
- Conversion between structured ↔ serial with existing units is blocked
  (`reason: 'conversion_blocked_units_exist'`).

## Verification
- `bunx tsgo --noEmit` — clean.
- `bunx vitest run tests/unit` — **430/430 passing** (added focused
  `tests/unit/society-structure.test.ts`).
- `bun run build` — succeeded.
- `bun scripts/verify-client-bundle-secrets.ts` — OK, no server-only indicators.
- 390 px / 1280 px smoke: mode chooser, structured Units list, serial Units
  list, add-unit dialog, and serial-mode Blocks redirect all render without
  horizontal overflow; primary CTAs are ≥ 44 px minimum height.
- Protected society `1907a918-c4b8-4f43-a837-450530cc7c34` — **untouched**.

## Deferred (intentionally, per Stage 2A scope)
- Bulk unit generation → Stage 2D/2E.
- Full onboarding/import migration QA → Stage 2E.
- Product-wide premium redesign → Stage 12.
- Broad RLS/RBAC re-audit → Stage 13.
- Multi-breakpoint launch audit → Stage 16.

**Next:** Stage 2B — Residents, Family Members, Occupancy and Vehicles.

---

# Stage 2B — Residents, Family Members, Occupancy and Vehicles — COMPLETE

Canonical `profiles` / `flat_residents` / `family_members` / `vehicles`
reused (no new tables). Server-side RPCs added for a privacy-safe
paginated directory, private detail bundle, occupancy assign/end with
audit, and society-scoped family/vehicle lifecycle. Family and vehicle
removal are **soft deactivation** (row + registration number preserved,
never DELETE). Vehicle plate uniqueness is enforced by a partial index
scoped to `is_active` rows plus a race-safe `pg_advisory_xact_lock` on
`(society, normalized plate)`. `getResidentPrivateDetail` returns a
strict Zod-parsed discriminated union — unknown fields rejected,
malformed shapes fold to `temporary_error`. Existing production routes
now consume the safe services: `society.residents.tsx` uses
`getResidentDirectoryOverview` + `listResidentsPage` and no longer
renders phone/email/UGVCL/property in directory rows;
`society.residents.$id.tsx` reads private detail through the authorised
server fn; `society.vehicles.tsx` uses `listSocietyVehicles` +
`deactivateVehicleAsAdmin` (no direct browser private-table query, no
permanent-delete UI). No migration rewrites historical plate values.
459 unit tests pass; build and secret scan clean. Protected society
untouched.

**Next:** Stage 2C — Teams, Roles and Privacy Controls.

---

# Stage 2C — Teams, Roles and Privacy Controls — COMPLETE

Canonical `user_roles` reused; added lifecycle columns (`is_active`,
`deactivated_at`, `deactivated_by`, `assigned_by`, `updated_at`) with a
touch trigger and a partial index for active team lookups. Privacy
contract added to `society_settings` as five constrained columns
(`privacy_directory`, `privacy_contacts`, `privacy_finances`,
`privacy_vehicles`, `privacy_documents`) with safe defaults
(admins_only / self-household-and-admins / owner-and-admins) — unknown
values fail closed via `normalizePrivacy`.

**Canonical permission spec** lives at `src/lib/role-permissions.ts`.
Frontend, tests, and DB helper (`current_user_has_society_permission`)
consume the same specification. Base grants:

- Super Admin — all capabilities (platform).
- Society Admin — team, privacy, structure, residents, private detail,
  billing, finance admin.
- Block Admin — no society-wide access; directory + block-scoped
  residents + self household only.
- Guard — guard operations + self household.
- Resident — self household only.

Server functions in `src/lib/team-admin.functions.ts` (`listTeamMembers`,
`listAssignmentCandidates`, `upsertTeamRole`, `setTeamActive`,
`getSocietyPrivacy`, `setSocietyPrivacy`) call SECURITY DEFINER RPCs that:

- lock the society with `pg_advisory_xact_lock` inside the mutating
  transaction,
- protect the last active Society Admin against demotion/deactivation
  (`last_society_admin` code),
- reject Block Admin in serial-mode societies,
- require active same-society block scope for Block Admin,
- insert an `audit_log` row with previous/resulting state,
- prefer soft deactivation (never physical delete).

The existing `/society/team` route now consumes those services. The
Privacy & Transparency section lets Society Admin pick each policy with
inline description — "Public" is never offered. A read-only permission
preview is generated from the canonical spec (no hand-typed matrix).
`admin.security.tsx` continues to render the platform-level roles view
untouched.

Tests: 483 unit tests pass (12 new role-permission + privacy fail-closed
assertions). Isolated PostgreSQL fixtures for last-admin race / block
scope enforcement are deferred to Stage 13 hardening — not run here.
Build passes; client-bundle secret scan clean. Visual smoke: not
verified in this run (no preview interaction ran); deferred to Stage 16
launch audit. Protected society `1907a918-c4b8-4f43-a837-450530cc7c34`
untouched.

## Stage 2C — Completion follow-up (2026-07-17)

Focused completion run correcting four gaps found in the initial Stage 2C
delivery:

1. **Exact SQL × TypeScript capability parity.** The permission helper
   `public.current_user_has_society_permission(_society_id, _capability,
   _block_id uuid DEFAULT NULL)` now validates the capability against the
   canonical `public.is_known_capability(text)` allowlist BEFORE any role
   shortcut. Unknown capabilities return false for every role (including
   Super Admin). Each role branch mirrors `capabilitiesForRole(role)` from
   `src/lib/role-permissions.ts` exactly; the compatibility 2-arg
   signature is rewritten to delegate to the 3-arg body so no stale
   broad-grant body remains. Parity is enforced by
   `tests/unit/role-permissions-parity.test.ts`, which parses the actual
   SQL branches and asserts equality with the TypeScript source — no
   hand-copied expected matrix.

2. **Canonical multi-block Block Admin scope.** New table
   `public.user_role_block_scopes` (role_id, society_id, block_id,
   is_active, assigned_by, created_at, deactivated_at, deactivated_by)
   with a partial unique index on (role_id, block_id) WHERE is_active
   and RLS gated to Society/Super Admin readers. Existing active
   single-block Block Admin rows are backfilled into the table without
   inventing extra scopes. `admin_upsert_team_role_v2` accepts a `uuid[]`
   of blocks, dedupes them, validates each is active + same-society,
   deactivates removed scopes, reactivates existing ones, inserts missing
   ones, and audits previous_block_ids/resulting_block_ids in one
   transaction. `list_society_team_members_v2` returns aggregated active
   block_ids and block_names. The Team & Roles dialog now uses a chip
   multi-select; empty selection is rejected. `user_roles.block_id`
   remains temporarily for compatibility but is not the authoritative
   source.

3. **Typed RPC adapters — zero `any`.** `src/lib/team-admin.functions.ts`
   and the new `src/lib/privacy-decisions.functions.ts` build every RPC
   argument object with `satisfies
   Database["public"]["Functions"][fn]["Args"]` and validate every
   response through Zod (`TeamMemberSchema`, `CandidateSchema`,
   `RoleScopeSchema`, `PrivacyRowSchema`, `SafeRowSchema`). Malformed
   responses collapse to generic `operation_failed` errors, never raw DB
   messages.

4. **Server-enforced privacy decisions.**
   - `public.resolve_privacy_access(_society_id, _resource,
     _subject_user_id uuid DEFAULT NULL)` decides directory / contacts /
     finances / vehicles / documents access. Unknown resources or
     settings return false. Guards are always denied. Block Admin
     receives only directory. Household contact access requires an
     actual shared `flat_residents` occupancy.
   - `public.resolve_financial_visibility(_society_id)` returns
     `admin | detailed | summary | none`. Any future resident financial
     reporting MUST consume this resolver.
   - `public.list_society_residents_safe_page(_society_id, _search,
     _limit, _offset)` is the first data endpoint that consumes the
     privacy decision. Block Admins see residents only in their
     explicitly assigned active blocks; residents see the directory only
     when the society opts into `residents_safe`; phone, email, KYC and
     documents are never projected. Guards are denied.

New tests: 25 new assertions across
`tests/unit/role-permissions-parity.test.ts` and
`tests/unit/stage2c-completion.test.ts` covering capability parity,
unknown-capability denial, scope reconciliation, backfill invariants,
privacy fail-closed and adapter typing. Full suite: 509 passed / 5
skipped, build passes, secret scan clean. Isolated Postgres integration
fixtures (multi-user scope enforcement, race-safe upserts) remain
deferred to Stage 13 hardening — not simulated against production or
the protected society.

**Next:** Stage 2D — Migration and Bulk Import.


## Stage 2C — Closure follow-up (2026-07-17)

Final security closure. Fixed:

- NULL-block scope bypass in the three-arg permission helper.
- Two-arg helper now returns false for Block Admin block-scoped caps.
- Legacy `admin_upsert_team_role` / `list_society_team_members`
  retired: revoked from `authenticated`, body raises
  `deprecated_use_v2`.
- Email removed from the standard team-directory display fallback.
- `resolve_privacy_access` contacts branch is society-bound via
  `flats.society_id`; vehicles/documents no longer trust
  `_subject_user_id` as ownership proof.
- New `can_access_vehicle(society, vehicle)` derives ownership from the
  vehicles row and fails closed for cross-society lookups.
- `user_role_block_scopes` FKs on role/block are now `ON DELETE RESTRICT`
  so scope history is preserved; soft deactivation is the canonical
  lifecycle.

Unit tests: 532 passed / 5 skipped. tsgo clean. Build green. Secret
scan clean. Protected society untouched.

**Next:** Stage 2D — Migration and Bulk Import.


## Stage 3C — v5 final closure (2026-07-18)

Final Stage 3C closure run. Delivered:

- **Generic public submission API REMOVED.** `submitOfflinePayment` and its `actorRole` schema are deleted from `src/lib/offline-payments.functions.ts`. Only `submitResidentBankTransfer` (fixed `_actor_role = 'resident'`, method fixed to `bank_transfer`) and `recordAdminOfflinePayment` (fixed `_actor_role = 'admin'`) are exported. No client can supply an actor role or forge a resident cash submission.
- **Admin offline payment entry UI.** `/society/payments` now hosts a `RecordOfflinePaymentSection` component that (a) searches the society's own open bills through the new `search_society_open_bills(_society_id, _query, _limit)` RPC (SECURITY DEFINER, `manage_billing` required), (b) records Cash or Bank Transfer via `recordAdminOfflinePayment` with a client-generated idempotency key, (c) resets state after each submission. The recorded payment lands in the Pending tab; issuing the receipt still requires a separate Verify action (separation of duties).
- **`getPaymentDetail` server contract typed and validated.** The RPC response is parsed with a Zod `paymentDetailSchema` before it returns; consumers get a strongly typed `PaymentDetail` value or `null`. No `as any`, no unchecked jsonb cast.
- **Resident contract unchanged and re-verified.** `OfflinePaymentSubmitCard` still uses `submitResidentBankTransfer` with no `method`, no `actorRole`, no `proof_url`; Cash entry is admin-only.
- **Individual finding classification.** Every one of the five Project monitoring findings is a pre-Stage-3C UX regression from Stages 2D–2E / 3A: (1) `c8b0dad5` Matrix/Maintenance Import routing — 2D/2E, non-blocking for financial correctness; (2) `5a8539de` structure_mode backfill on Flats page — 2C/2D data-migration regression; (3) `a1180e7a` Setup checklist `/society/settings` 404 — 2E navigation regression; (4) `ddbc532c` trial plan Flat 360 collapse — 4A pricing/feature-gate regression; (5) `04b91993` resident no-dues certificate download — 4B RLS regression. None touch the Stage 3C canonical write/read path, tenant isolation, auth, receipts, or reversal — recorded here as classified `earlier-stage non-Stage-3C-blockers`. Fixing them is a separate follow-up.
- **Behavioral tests.** `tests/unit/billing-stage3c-closure-v5.test.ts` locks: (a) `submitOfflinePayment` symbol absent from the module, (b) no `actorRole` schema or RPC arg present, (c) admin route imports and wires `searchOpenBillsForPayment` + `recordAdminOfflinePayment`, (d) `getPaymentDetail` is Zod-validated, (e) `search_society_open_bills` migration exists with `SECURITY DEFINER`, `manage_billing` gate, and `REVOKE ALL … FROM PUBLIC`. Legacy `billing-stage3c-offline-payments.test.ts` and `billing-stage3c-closure.test.ts` are reconciled to match the v5 contract.
- **RLS and security.** `search_society_open_bills` sets `search_path = public`, is `SECURITY DEFINER`, revokes public execute, grants execute only to `authenticated`, and refuses the call unless `current_user_has_society_permission(_society_id, 'manage_billing')` returns true. It never bypasses the caller's society scope. Existing DB linter INFO/WARN entries (RLS-enabled-no-policy on non-Stage-3C tables, other older search_path warnings) are pre-Stage-3C project-wide items and are not introduced by this run.
- **Docs.** This is now the one authoritative Stage 3C closure section; Stage 3C v3/v4 sections above document the earlier hardening milestones and are retained as historical record.

**Next:** Stage 3D — Ledger, expenses, transparency and reports.
