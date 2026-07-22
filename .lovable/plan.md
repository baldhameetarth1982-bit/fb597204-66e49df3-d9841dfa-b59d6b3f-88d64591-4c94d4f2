# Stage 3A — Execution Plan

This stage is very large (docs, unified catalog, feature directory, Flat 360, full No-Dues workflow with certificate + QR + public verification, gamification, UI parity pass). To keep quality high and avoid an uncontrolled rewrite, I'll execute it in **9 sequenced checkpoints**, reporting after each so you can course-correct.

I need your go-ahead on the plan itself and on **two clarifying decisions** below before I start Checkpoint A. Everything else is already decided by your brief.

---

## Clarifying decisions I need from you

1. **Certificate PDF renderer** — No-Dues certificates require server-side PDF generation. The Cloudflare Worker runtime we run on does **not** support `puppeteer`, `sharp`, or native canvas. Approved options:
  - **(a)** `pdf-lib` (pure JS, works on Workers) — clean typographic PDF with embedded QR PNG. Recommended.
  - **(b)** Render an HTML certificate page and let the resident "Save as PDF" from the browser. No server PDF.
   I'll default to **(a) pdf-lib + qrcode** unless you say otherwise.
2. **AI Summary in Flat 360** — your brief says "AI Summary only when a real configured provider is available." Lovable AI Gateway is available by default. Do you want the AI summary **on** (using Lovable AI Gateway, Pro-gated) or **off** for Stage 3A (deterministic summary only, AI card shown as "Planned")?

---

## Checkpoints

### A. Audit (read-only)

Enumerate every route under `src/routes`, every feature key used by `FeatureGate`, every table via `supabase--read_query`, current nav sources (sidebar, bottom navs, `More` pages), existing No-Dues / gamification / flat-detail code. Output: an audit report in `docs/FEATURE_MATRIX.md` classifying each feature (built / partial / missing / locked / planned / unreachable) with route, min plan, backend readiness. **No code changes.**

### B. Source-of-truth docs

Create/update the 9 files in `docs/`:
`SOCIOHUB_MASTER_CONTEXT.md`, `PRODUCT_DECISIONS.md`, `FEATURE_MATRIX.md`, `UI_REFERENCE_MAP.md`, `PAYMENT_ARCHITECTURE.md`, `AUTH_ARCHITECTURE.md`, `SECURITY_REQUIREMENTS.md`, `DEVELOPMENT_HISTORY.md`, `NEXT_STAGES.md`. Encodes the non-negotiable rules (Firebase→Supabase auth, Razorpay = subscriptions only, Cash + Bank Transfer for maintenance, no platform fee, plan inheritance model).

### C. Unified feature catalog + entitlements

Extend `src/lib/plan-features.ts` into a full `src/lib/feature-catalog.ts` (single source of truth: key, label, description, category, minPlan, roles, route, keywords, icon, status, backendReady, navigationGroup). Rewrite `hasFeature` around **rank inheritance** — Premium auto-inherits everything in the catalog; uncategorized features default to Pro. Update `useFeatureAccess`, `FeatureGate`, `UpgradePrompt`, `LockedFeatureCard` to consume it. **No feature removed**; existing keys preserved.

### D. Feature discovery

New route `src/routes/_society/society.features.tsx` (Society Admin Feature Directory) and `src/routes/_resident/app.features.tsx` (resident view). Powered entirely by the catalog: search, categories, plan badges, status badges, role filter, favorites (localStorage), recently-used (localStorage). Add discovery entries in existing `society.more.tsx` and `app` More surfaces — no new bottom-nav items.

### E. Exact UI parity pass

Update `docs/UI_REFERENCE_MAP.md` with the screens I touch this stage (Feature Directory, More, Flat 360, No-Dues x4, Gamification). Match tokens + primitives (MobileHero, SectionCard, ListCard, StatPill, StatusChip). 390 / 360 / 414 / 1280 verified via Playwright headless. **I will not re-skin unrelated existing pages** in this stage — that's an unbounded task and would violate "do not stop after plan" by expanding into everything.

### F. Flat / Unit 360

Upgrade existing `src/routes/_society/society.flats.$id.tsx` (do not create a duplicate). Sections: Identity + Occupancy, Financial Summary, Occupancy History, Operations (vehicles, visitors, documents, approvals), No-Dues status, Deterministic Summary. AI Summary card behavior driven by decision #2 above. Honest empty states for missing data. Pro-gated.

### G. Automated No-Dues (biggest single piece)

**Migration** (`supabase--migration`, additive):

- Table `no_dues_requests` — status enum (`draft`, `pending_review`, `blocked_by_dues`, `approved`, `rejected`, `issued`, `revoked`), unit_id, resident_id, society_id, blockers jsonb, reason, timestamps.
- Table `no_dues_certificates` — unique cert number, verification_token (opaque, unguessable), pdf_path, qr_url, issuer_id, issued_at, revoked_at, revoke_reason.
- Table `no_dues_audit` — append-only history rows.
- GRANTs (authenticated + service_role) per public-schema rules.
- RLS: residents see own unit only; admins see own society; public verify path has no direct table access.
- Server-side status transitions only; clients cannot set `approved`/`issued`/`revoked`.
- SQL RPC `check_no_dues_eligibility(unit_id)` — deterministic blocker check.

**Server functions** (`src/lib/no-dues.functions.ts` under `requireSupabaseAuth`):

- `submitNoDuesRequest`, `reviewNoDuesRequest`, `approveAndIssue` (idempotent — repeat clicks return the same cert), `rejectRequest`, `revokeCertificate`, `listMyRequests`, `listSocietyRequests`.
- Certificate generation uses `pdf-lib` + `qrcode`, uploaded to Supabase Storage bucket `no-dues-certificates` (private, signed URLs for owner/admin; public verify page uses the token endpoint, not the storage URL).

**Public route** `src/routes/api/public/verify/no-dues.$token.ts` — read-only, returns minimum data (society name, cert number, unit label, issue date, status). Uses `supabaseAdmin` inside handler with token lookup. No PII.

**Public page** `src/routes/verify.no-dues.$token.tsx` — SSR-friendly verification page (society branding, cert number, unit, issue date, status, big "Verified" / "Revoked" badge).

**UI routes**:

- Society admin list `src/routes/_society/society.no-dues.tsx` + detail `society.no-dues.$id.tsx`.
- Resident request list `src/routes/_resident/app.no-dues.tsx` + detail `app.no-dues.$id.tsx`.

Pro-gated via catalog key `no_dues`.

### H. Gamification

Audit existing gamification (`achievements`, `user_points`, `leaderboard` route). Migration only if additive gaps exist: `payment_points_ledger` (payment_id unique, points, source, awarded_at) to make point awards idempotent. Server-side award trigger on payment verification (Cash/Bank Transfer verified by admin, or paid_on_or_before due_date). Reversal path zeroes out entries. Society Admin toggle in `society_settings` (`gamification_enabled` — additive column). Catalog keys `gamification`, `payment_points`, `leaderboard` = Pro. Existing routes preserved; new discovery entries added.

### I. Verify + document

- `bunx tsgo --noEmit` before and after.
- Full build.
- Playwright headless: 390 + 1280 screenshots of Feature Directory, More, Flat 360, No-Dues list/detail/resident/public, Leaderboard (auth session restored from `LOVABLE_BROWSER_AUTH_STATUS` if `injected`; otherwise reported as blocker, no auth weakening).
- Update `FEATURE_MATRIX.md`, `UI_REFERENCE_MAP.md`, `DEVELOPMENT_HISTORY.md`, `NEXT_STAGES.md`.
- Final 31-point report per your brief.

---

## Non-negotiables I will enforce

- Firebase→Supabase auth path untouched (that file has been through 4 fixes already — I won't regress it).
- Additive migrations only; no destructive changes to existing tables/policies.
- No `SUPABASE_SERVICE_ROLE_KEY` leakage; `supabaseAdmin` loaded inside handlers only.
- No re-introduction of platform fees / FeeBreakdown.
- Razorpay stays subscription-only; maintenance stays Cash + Bank Transfer.
- No edits to `routeTree.gen.ts`, `client.ts`, `client.server.ts`, `auth-middleware.ts`, `auth-attacher.ts`, `types.ts`, `.env`.
- No test data written to the real protected society society.
- No existing feature key, route, table, or component deleted. Uncategorized features default to Pro in the new catalog and remain reachable.

---

## What I will NOT do in Stage 3A (and why)

- **Re-skin every existing page for exact visual parity.** Your Part 8 is scoped to the pages this stage touches. A whole-app visual pass is Stage 3F-scale work and would exceed a single controllable stage. I will add it to `NEXT_STAGES.md` as an explicit follow-up.
- **Reference screenshots / PDF** — you mention them but no attachment is present in this turn. I'll use the SocioHub visual system (tokens + existing primitives listed in Part 8) and flag every screen in `UI_REFERENCE_MAP.md` as `reference-missing` so we can revisit once you attach them.

---

## Reply with

1. **Approve plan** (or edits).
2. Decision on **PDF renderer** (default: pdf-lib).
3. Decision on **Flat 360 AI Summary** (default: off / "Planned" card for 3A, real AI in Stage 3E).
4. Whether reference screenshots/PDF will be attached — if yes, upload before I start Checkpoint E.

Once I have these, I'll start at Checkpoint A and won't stop until I is done or a real blocker (from your allowed-blocker list) is hit.                                                                                                                                                                                   Approved with the following required corrections.

Decision 1 — PDF renderer

Use:

pdf-lib + qrcode

Requirements:

- pure JavaScript and Cloudflare Worker compatible

- certificate PDF generated server-side

- QR embedded inside the PDF

- clean SocioHub-branded layout

- idempotent generation

- private storage

- signed download access for authorized users

- public verification must use the secure verification token route, not expose the storage object directly

Decision 2 — Flat 360 AI Summary

Turn the AI Summary ON in Stage 3A.

Rules:

- minimum plan = Pro

- use the existing Lovable AI Gateway only if it is already configured securely

- do not expose API keys to the client

- generate the summary only from the real Flat 360 data available to that society

- do not use generic internet knowledge

- do not invent residents, dues, complaints, vehicles, visitors, or documents

- clearly label generated content as AI-generated

- include a deterministic Unit Summary fallback when AI is unavailable

- AI failure must not break the Flat 360 page

- cache or rate-limit generation to prevent repeated unnecessary calls

- Premium may receive higher AI usage limits later, but the functional AI Summary remains available in Pro

Important distinction:

- Flat 360 AI Summary is implemented now in Stage 3A

- the full AI Secretary / document-grounded knowledge base remains Stage 3C

Decision 3 — Reference screenshots

I will attach the SocioHub reference screenshots/PDF before Checkpoint E.

Do not begin visual implementation without inspecting the attached references.

The screenshots are:

- exact visual source of truth

- not inspiration

- not optional

- not permission to create a “similar” generic layout

Required correction to scope

Do not defer whole-app visual parity to a vague future Stage 3F.

Credits are not the limiting factor now.

Add a final checkpoint after the functional implementation:

Checkpoint J — Whole-App Visual Parity Audit and Correction

Checkpoint J must inspect all visible SocioHub roles and routes:

Public:

- landing

- pricing

- authentication

- onboarding

- legal pages

- checkout

- public No-Dues verification

Society Admin:

- dashboard

- residents

- resident detail

- Flat 360

- billing

- bill generation

- bill history

- bill detail

- templates

- billing settings

- maintenance

- matrix

- accounts

- ledger

- expenses

- reports

- visitors

- vehicles

- communication

- polls

- team

- import

- AI Digest

- No-Dues

- gamification

- Feature Directory

- More / Operations

- plan-required

- society settings/profile

Resident:

- dashboard

- bills

- bill detail/payment flow

- visitors

- communication

- society/services

- profile

- No-Dues

- gamification/leaderboard

- Feature Directory

- plan-required

Guard:

- dashboard

- visitor entry

- visitor history

- settings

- any other existing guard routes

Super Admin:

- dashboard

- societies

- users

- plans

- payments/gateway

- reports

- settings

- audit/security

- other existing visible modules

For every route:

- map it to a reference screenshot where available

- inspect the current rendered UI

- classify matched / partial / unmatched

- correct unmatched and partial routes

- do not only edit shared helpers

- do not claim visual completion without route-level visible changes

Do not rebuild screens already matching the reference.

Do not remove any existing feature.

Do not replace working functionality with static visual mockups.

Whole-app visual acceptance:

- 360px

- 390px

- 414px

- 1280px

Verify:

- no horizontal page overflow

- no header/hero/card overlap

- no content behind bottom navigation

- no FAB collision

- no broken tab wrapping

- no raw table-first mobile layouts

- no generic PageHeader/PageShell appearance where references show custom layouts

- no empty unexplained pages

- no 404 navigation

- no duplicated navigation destinations

- consistent typography, spacing, icons, chips, heroes, cards, and empty states

Checkpoint execution behavior

Report after each checkpoint, but do not wait for another approval between A and J.

Continue automatically through all checkpoints unless there is a genuine blocker involving:

- missing secret

- missing reference file

- unavailable external service

- destructive migration risk

- missing authorization

- an architectural conflict that cannot be resolved safely

Do not stop after:

- audit

- documentation

- feature catalog

- typecheck

- partial UI changes

Checkpoint A correction

Checkpoint A should remain read-only for application code and database.

It may write the initial audit to docs/FEATURE_[MATRIX.md](http://MATRIX.md), but must not modify runtime application code, migrations, RLS, or data during the audit checkpoint.

Entitlement rules — confirm before coding

Basic:

- core essentials only

Pro:

- Basic plus all normal functional features

- all Reddit-validated workflows

- Flat 360

- complete No-Dues workflow including certificate, QR, verification, audit, and revocation

- Non-Member Payments

- AI Income Categorization

- AI Secretary

- Smart QR Collections

- reconciliation

- migration

- privacy controls

- gamification

- payment points

- leaderboard

Premium:

- automatically inherits every feature in the entire catalog

- must never lose access because a key was omitted from a manually maintained array

- adds advanced AI limits, deeper automation, advanced analytics, custom branding, higher limits, and priority support

Do not remove a functional feature from Pro merely to make Premium stronger.

Feature discoverability

The Feature Directory and navigation discovery system are mandatory.

Every built or partial feature must be reachable through at least one appropriate path:

- primary navigation

- More / Operations

- Feature Directory

- relevant contextual screen

No existing feature may remain unreachable without being reported and fixed.

Feature Directory must use the same central catalog as:

- entitlement checks

- plan badges

- navigation

- search

- lock states

- UpgradePrompt

- documentation

No duplicated feature arrays.

No-Dues clarification

The complete No-Dues workflow is Pro.

Do not split:

- request/status into Pro

- certificate/QR/audit/revocation into Premium

Use one central feature key unless the architecture genuinely needs separate technical capabilities. Any separate technical keys must still have minimum plan = Pro.

Gamification clarification

Gamification is Pro.

At minimum:

- 2 points for verified on-time maintenance payment

- no points before Cash/Bank Transfer verification

- no duplicate points

- reversal/cancellation handling

- auditable points ledger

- leaderboard from real points only

- admin enable/disable control

- no cash redemption

- no fake badges or values

Testing requirements

Run before changes, after each major checkpoint, and at completion:

bunx tsgo --noEmit

Also run:

- full build command from package.json

- available automated tests

- migration verification

- route checks

- RLS checks for new tables/functions

For new workflows, test both:

- authorized access

- unauthorized cross-society access

Do not state “RLS added” without testing isolation.

Final documentation

At the end, update:

- docs/SOCIOHUB_MASTER_[CONTEXT.md](http://CONTEXT.md)

- docs/PRODUCT_[DECISIONS.md](http://DECISIONS.md)

- docs/FEATURE_[MATRIX.md](http://MATRIX.md)

- docs/UI_REFERENCE_[MAP.md](http://MAP.md)

- docs/PAYMENT_[ARCHITECTURE.md](http://ARCHITECTURE.md)

- docs/AUTH_[ARCHITECTURE.md](http://ARCHITECTURE.md)

- docs/SECURITY_[REQUIREMENTS.md](http://REQUIREMENTS.md)

- docs/DEVELOPMENT_[HISTORY.md](http://HISTORY.md)

- docs/NEXT_[STAGES.md](http://STAGES.md)

The final report must clearly distinguish:

- implemented and tested

- implemented but visually unverified

- frontend-gated only

- backend-enforced

- partial

- blocked

- planned

- Begin Checkpoint A after the reference screenshots/PDF are attached.                                                                                                             my attachment is kinda bigger than 20 mb and now massage is already sented i can not able to attach it now so i think i given you this files before like 5 - 6 massage just use that if you can