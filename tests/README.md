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
