# Tests

## Billing cron endpoint

Uses Node's built-in test runner — no extra dependencies.

```bash
CRON_URL=https://<your-project>.lovable.app/api/public/hooks/run-billing \
CRON_SECRET=<your-cron-secret> \
node --test tests/billing-cron.mjs
```

Covers:

- Missing / wrong secret → `401` (and no info leak in the body)
- Valid secret → `200` with `{ ok, totalGenerated, societiesProcessed, societiesSkipped }`
- IP rate limit → `429` on a second call from the same IP inside the 60 s window
- Idempotency → re-running for the same `(society_id, period_start, period_end)`
  inserts zero additional bills (`totalGenerated === 0` on the second pass)

The idempotency test waits ~2 minutes total so it can sneak past the per-IP
rate limit twice. If `CRON_URL` or `CRON_SECRET` are unset, every test is
skipped, so the file is safe to run in CI without configuration.

## Database security suite (Phase 4B/4C)

`tests/sql/phase4b-security-boundaries.sql` runs ~245 checks against the real
row-level security rules and server functions by acting as synthetic signed-in
users: cross-society isolation, Resident / Block Admin / Guard / Auditor /
Society Admin limits, No-Dues lifecycle, polls, meetings, documents,
notification deep-link targets, guard tools, amenity classes and SaaS plan
protection.

- Only synthetic `[QA]` societies with fixed `4b4b0000-` IDs and `.invalid`
  emails. Everything runs inside one block that always ends in an exception,
  so every row is rolled back.
- It needs a database role that can `SET ROLE authenticated`, so it is **not**
  part of `bun run test`. Run it against a disposable local database:

```bash
supabase start && supabase db reset --no-seed
PHASE4B_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres" bun run test:security:db
```

The script refuses any non-local URL. The GitHub workflow
`stage3c-runtime-verification.yml` runs it on its disposable database
(step "Phase 4B/4C database security suite"). `tests/unit/phase4b-sql-harness.test.ts`
(part of the normal suite) checks the harness can never commit data and that
the key checks stay present.
