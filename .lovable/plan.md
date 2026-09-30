# Workstream 7 — Finance, Migration & Handover Depth

Extends the existing canonical systems only. No new accounting, migration, export or builder system. Maintenance stays Cash + Bank Transfer; Razorpay stays SaaS-only. `src/lib/utils.ts` and the protected society are left alone.

## Already in place (reused, not rebuilt)
- Bill preview before posting and idempotent finalize (`preview_bill_batch` / `finalize_bill_batch`)
- Dues ageing (`get_receivables_ageing`), cancelling a bill only when no verified payment exists (`cancel_bill`), the payment reversal workflow
- CSV migration covering structure, units, residents, family and vehicles, with staging, duplicate and conflict detection, atomic commit/rollback and retry by request id
- Server-derived setup checklist, Auditor Pack and full society export

## Genuine gaps to close

### 1. Billing depth
- **Exceptions report**: preview returns a per-flat exception list (no occupant, zero amount, already billed, missing area/type rule) shown before finalize. Admins must acknowledge it before they can finalize.
- **Approval (maker-checker)**: an optional society setting, "Require second approver for bill runs". When it is on, a run is prepared first, then a different admin with `billing.manage` approves it. The finalize RPC enforces this on the server. The setting is off by default, so existing flows keep working.
- **Late fee**: the existing `late_fee_type/value` settings are currently never applied. Fix: the next bill run adds a late-fee line for unpaid overdue finalized bills, calculated only on the server, deduplicated once per bill per period, and shown in the preview. If this can't be made safe, the dead setting gets hidden instead of pretending to work.
- **Immutable adjustments**: add `bill_adjustments`, an append-only table with a reason and a signed amount under strict monetary limits. Entries are written only via the `admin_add_bill_adjustment` RPC, which posts through the existing journal and never edits the bill row. A mistake is corrected by a counter-adjustment, never a delete.
- **Arrears**: add an ageing drill-down on the Billing page, reusing `get_receivables_ageing`.

### 2. Migration depth
- **Partial success**: an optional "import valid rows, keep conflicts for review" mode. Each committed row links to the job in the existing `migration_rows`/provenance, so every imported record can be traced to its job and society.
- **Historical dues import**: a new `opening_balance` entity type that stores per-flat opening arrears as evidence, marked "Imported – unverified". These rows show in ageing as a separate line. They never create receipts, payments or verified status, and the admin posts them through an explicit confirm RPC.
- **Source templates**: column-mapping presets for generic spreadsheet exports. XLSX is converted to CSV in the browser, and the same 10 MB, 5,000-row and 60-column limits apply. No claims of competitor integrations.
- **Dual-run comparison**: re-upload a source file in compare-only mode. It shows matched, missing, changed, conflicting and unresolved rows against the current SociyoHub records, with no writes. Corrections go only through existing admin actions.
- **UI states**: preparing, validating, preview, ready, importing, partial, conflict, failed, retry, completed, rolled back, awaiting review.

### 3. Handover
- Add a Handover checklist view built from the existing setup checklist plus live counts: structure, flats, occupancy, opening balances imported/confirmed, documents, open migration conflicts and unresolved setup items.
- Handover status (not started, in progress, ready, handed over) is stored on the existing `society_settings`, changed via an audited admin RPC, and uses normal society admin authorization.
- No builder role or separate console. This dependency will be documented.

### 4. Auditor Pack & export
- Add export sections: procurement requests/quotations, budgets and revisions, meetings/resolutions, formal votes (aggregates only for secret ballots), document metadata (no file bytes), staff/assets/inventory, migration job history and bill adjustments.
- Add these to the Auditor Pack: bill adjustments, procurement and budget-vs-actual, with verified/pending/rejected/reversed kept separate.
- The same per-section column whitelists, rate limit and audit row apply. Sensitive columns (ID docs, tokens, phones for secret votes) stay excluded.

## Technical details
- One migration (0113) for `bill_adjustments` (append-only trigger, GRANTs, RLS), the approval columns on `bill_generation_batches`, the late-fee computation in preview/finalize, the `opening_balance` entity and confirm RPC, the compare-only RPC, the handover RPC, and the extended `get_society_export_section` whitelist.
- All RPCs are SECURITY DEFINER, resolve the society on the server from membership plus permission, and are rate-limited and audited.
- Server functions live in the existing `billing-generate.functions.ts`, `migration.functions.ts` and `society-export.functions.ts`.

## Validation
- Rollback-only SQL QA covers: cross-society denial, wrong role, same-admin approval denial, adjustment immutability and delete denial, late-fee dedupe, duplicate/replay protection, partial commit provenance, opening balances never becoming verified, compare making no writes, and sensitive export columns.
- TypeScript/build, source-contract unit tests, and previews of Billing, Migration, Handover, Auditor Pack and Export on the demo account at 390 and 1280px.
- Workstream 7 is marked complete only after all of these pass. Workstream 8 does not start in this workstream.
