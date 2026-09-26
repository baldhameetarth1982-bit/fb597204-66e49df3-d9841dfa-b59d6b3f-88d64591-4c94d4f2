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
  it.todo("Society A Admin reads Flat A");
  it.todo("Society A Admin denied Society B Flat");
  it.todo("Block A Admin allowed Block A");
  it.todo("Block A Admin denied Block B");
  it.todo("resident denied admin route");
  it.todo("Basic entitlement returns core data only");
  it.todo("Pro entitlement returns advanced data");
  it.todo("no PII in snapshot");
  it.todo("no certificate secrets in snapshot");
  it.todo("query error stays as error state");
  it.todo("unsupported stays as unsupported");
  it.todo("serial society structure supported");
  it.todo("structured society structure supported");
});

if (!allow) {
  // eslint-disable-next-line no-console
  console.log(
    "[flat360.integration] SKIPPED — set ALLOW_SOCIOHUB_TEST_FIXTURES=true with an isolated SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY to run.",
  );
}
