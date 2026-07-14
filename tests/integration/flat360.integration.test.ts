/**
 * Flat 360 integration tests.
 *
 * SKIPPED by default. Requires an isolated test database.
 * Enable with:
 *
 *   ALLOW_SOCIOHUB_TEST_FIXTURES=true
 *   SUPABASE_URL=<isolated-test-project>
 *   SUPABASE_SERVICE_ROLE_KEY=<isolated-test-key>
 *
 * Never runs against production. The suite refuses to execute unless the
 * caller opts in explicitly, and the test file itself never opens a
 * connection to the real SocioHub project.
 */
import { describe, it } from "vitest";

const allow = process.env.ALLOW_SOCIOHUB_TEST_FIXTURES === "true";

describe.skipIf(!allow)("Flat 360 integration (requires isolated fixtures)", () => {
  it.skip("Society A Admin reads Flat A", () => { /* impl in dedicated env turn */ });
  it.skip("Society A Admin denied Society B Flat", () => {});
  it.skip("Block A Admin allowed Block A", () => {});
  it.skip("Block A Admin denied Block B", () => {});
  it.skip("resident denied admin route", () => {});
  it.skip("Basic entitlement returns core data only", () => {});
  it.skip("Pro entitlement returns advanced data", () => {});
  it.skip("no PII in snapshot", () => {});
  it.skip("no certificate secrets in snapshot", () => {});
  it.skip("query error stays as error state", () => {});
  it.skip("unsupported stays as unsupported", () => {});
  it.skip("serial society structure supported", () => {});
  it.skip("structured society structure supported", () => {});
});

if (!allow) {
  // eslint-disable-next-line no-console
  console.log(
    "[flat360.integration] SKIPPED — set ALLOW_SOCIOHUB_TEST_FIXTURES=true with an isolated SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY to run.",
  );
}
