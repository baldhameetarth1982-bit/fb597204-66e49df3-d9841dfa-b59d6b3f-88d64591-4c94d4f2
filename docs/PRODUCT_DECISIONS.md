# SociyoHub — Product Decisions

Chronological log of binding product decisions. Newest date wins on conflict.

---

## 2026-07-14 — Stage 3A

### Plan model
- Basic = core essentials only (society setup, blocks/flats, residents, basic maintenance dashboard, bill generation, bill history, Cash + Bank Transfer, announcements, notices, profile).
- Pro = Basic + **every standard functional feature** including all Reddit-validated workflows (Flat 360, complete No-Dues incl. certificate/QR/verification/audit/revocation, Non-Member Payments, AI Income Categorization, AI Secretary, Universal Smart QR Collections, Offline/Online Reconciliation, Low-Risk Migration, Privacy/Financial-Transparency controls, Gamification/payment_points/Leaderboard).
- Premium = Pro + advanced AI limits, deeper automation, advanced analytics, custom branding, higher usage limits, priority support. **Premium auto-inherits every catalog key** — never gated by a hand-maintained array.
- Uncategorized existing features default to Pro (never Basic) and are recorded for review.

### No-Dues workflow
- Single feature key `no_dues` (min plan = Pro). Certificate + QR + audit + revocation are part of the **same** Pro feature — not split into Premium.
- Certificate PDFs use **`pdf-lib` + `qrcode`** server-side (pure JS, Worker-safe). Stored privately in Supabase Storage bucket `no-dues-certificates`. Signed URLs for owner/admin only. Public verification page uses the opaque token → server route → sanitized JSON path (never exposes the storage object directly).
- Statuses: `draft`, `pending_review`, `blocked_by_dues`, `approved`, `rejected`, `issued`, `revoked`. Server-side transitions only; clients cannot set approved/issued/revoked.
- Certificate number is unique per society; generation is idempotent — repeat clicks return the same cert.
- Public verification page exposes: society name, cert number, unit label, issue date, status. **No PII.**

### Flat 360 AI Summary
- **Enabled** in Stage 3A, min plan = Pro.
- Uses Lovable AI Gateway server-side. No client-side keys.
- Summary is grounded **only** on the unit's real Flat-360 data. No generic internet knowledge. No invention.
- Labeled "AI-generated". Deterministic Unit Summary always renders as a fallback when AI is unavailable / errored / rate-limited. AI failure never breaks the page.
- Rate-limit and cache per unit to prevent repeated calls.
- The **full AI Secretary / document-grounded knowledge base** remains Stage 3C.

### Gamification (Pro)
- 2 points per verified on-time maintenance payment (paid on or before due date).
- Cash / Bank Transfer earn points **only after Society-Admin verification**.
- Payment-points ledger is idempotent by `payment_id`; reversal zeroes the entry.
- Society Admin can enable/disable gamification via `society_settings.gamification_enabled`.
- No cash redemption, no fake badges, no fabricated leaderboard values.

### Feature discovery
- Central catalog at `src/lib/plan-features.ts` (Stage 3A extends this file — no duplicate module). All entitlement checks, plan badges, `FeatureGate`, `UpgradePrompt`, More/Operations, Feature Directory, and search query the **same** catalog.
- New routes: `/society/features` and `/app/features` — powered by the catalog. Search, categories, favorites (localStorage), recently-used (localStorage), plan badges, status badges, role filter, locked-plan handling.
- Every built or partial feature must be reachable through at least one path (primary nav, More/Operations, Feature Directory, or contextual screen). Unreachable features are surfaced in `FEATURE_MATRIX.md`.

### Whole-app visual parity (Checkpoint J)
- After functional checkpoints land, iterate every public / Society Admin / Resident / Guard / Super Admin route against reference screenshots.
- Route-level visible changes required — not shared-helper-only edits.
- 360 / 390 / 414 / 1280 acceptance criteria: no overflow, no header/hero/card overlap, no CTA behind bottom nav, no raw table-first mobile layouts, no 404 nav.

---

## Pre-Stage 3A (preserved)

- Firebase Phone OTP + Firebase Google → server-verified → Supabase magic-link exchange.
- Razorpay = subscriptions only.
- Maintenance = Cash + Bank Transfer default. Online gateway per-society, Support-enabled.
- No platform fee.
- `create_society_full` idempotent, authenticated EXECUTE, schema-cache reload.
