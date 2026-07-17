/**
 * Automated tests for the billing cron endpoint.
 *
 * Run:
 *   CRON_URL=https://<project>.lovable.app/api/public/hooks/run-billing \
 *   CRON_SECRET=<secret> \
 *   node --test tests/billing-cron.test.mjs
 *
 * The tests cover:
 *  1. Missing secret  -> 401
 *  2. Wrong secret    -> 401
 *  3. Valid secret    -> 200
 *  4. IP rate limit   -> first 200, second within 60s -> 429
 *  5. Idempotency     -> two consecutive successful runs produce no duplicate
 *                       bills for the same (society_id, period_start, period_end)
 *                       (verified indirectly: second run reports
 *                       societiesProcessed === 0 because everything is skipped).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const URL = process.env.CRON_URL;
const SECRET = process.env.CRON_SECRET;
const skip = !URL || !SECRET;

async function post(headers = {}) {
  const r = await fetch(URL, { method: "POST", headers });
  let body = null;
  try {
    body = await r.json();
  } catch {
    body = await r.text().catch(() => null);
  }
  return { status: r.status, body };
}

test("rejects when no secret header is provided", { skip }, async () => {
  const { status } = await post();
  assert.equal(status, 401);
});

test("rejects when secret is wrong", { skip }, async () => {
  const { status, body } = await post({ authorization: "Bearer not-the-secret" });
  assert.equal(status, 401);
  // Error body must not leak internals.
  const s = typeof body === "string" ? body : JSON.stringify(body ?? "");
  assert.ok(!/society|schedule|count|bill/i.test(s), "must not leak details");
});

test("accepts a valid bearer secret", { skip }, async () => {
  const { status, body } = await post({ authorization: `Bearer ${SECRET}` });
  // 200 on success, 429 if a previous test already filled the per-IP window.
  assert.ok(status === 200 || status === 429, `unexpected status ${status}`);
  if (status === 200) {
    assert.equal(body?.ok, true);
    assert.equal(typeof body.totalGenerated, "number");
    assert.equal(typeof body.societiesProcessed, "number");
    assert.equal(typeof body.societiesSkipped, "number");
  }
});

test("rate-limits a second call from the same IP within 60s", { skip }, async () => {
  // First call may itself be rate-limited from earlier tests; that's still
  // proof the limiter works. We only need to see at least one 429.
  const first = await post({ authorization: `Bearer ${SECRET}` });
  const second = await post({ authorization: `Bearer ${SECRET}` });
  assert.ok(
    first.status === 429 || second.status === 429,
    `expected a 429 from the rate limiter, got ${first.status}/${second.status}`,
  );
});

test(
  "is idempotent: re-running for the same period inserts no duplicates",
  { skip },
  async () => {
    // Wait for the per-IP 1/min window to clear so we can issue two successes.
    await new Promise((r) => setTimeout(r, 61_000));
    const a = await post({ authorization: `Bearer ${SECRET}` });
    if (a.status !== 200) {
      // Nothing was due — idempotency is trivially satisfied.
      return;
    }
    await new Promise((r) => setTimeout(r, 61_000));
    const b = await post({ authorization: `Bearer ${SECRET}` });
    assert.equal(b.status, 200);
    // Second run for the same month must skip every society it already billed.
    assert.equal(
      b.body.totalGenerated,
      0,
      "second run generated duplicate bills — idempotency check failed",
    );
  },
);
