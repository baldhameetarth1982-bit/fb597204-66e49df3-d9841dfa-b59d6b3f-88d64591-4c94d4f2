/**
 * Stage 3C — Fixture source scan.
 *
 * Fails when the shared runtime fixture regresses on any of the strict
 * source-level invariants. Never prints the protected society secret.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FILE = "tests/helpers/stage3c-runtime-fixtures.ts";
const src = readFileSync(join(process.cwd(), FILE), "utf8");

const problems: string[] = [];

function must(cond: boolean, msg: string) {
  if (!cond) problems.push(msg);
}
function mustNot(pat: RegExp | string, msg: string) {
  const hit = typeof pat === "string" ? src.includes(pat) : pat.test(src);
  if (hit) problems.push(msg);
}

// Forbidden patterns
mustNot("as unknown as PromiseLike", "unsafe `as unknown as PromiseLike` cast present");
mustNot(".catch(() => undefined)", "swallowed error via `.catch(() => undefined)`");
mustNot(".catch(()=>undefined)", "swallowed error via `.catch(()=>undefined)`");
mustNot(/catch\s*\{\s*\}/, "bare `catch {}` swallowing errors");
mustNot(/\bTODO\b/, "TODO marker in fixture");
mustNot(/\bplaceholder\b/i, "placeholder marker in fixture");
mustNot(/Not implemented/i, "`Not implemented` marker in fixture");

// Cleanup must not ignore auth deletion errors
mustNot(
  /admin\.auth\.admin\.deleteUser\([^)]*\)\s*[;)]/,
  "auth deleteUser result appears to be ignored (must go through collectCleanupResult)",
);

// Required helpers exported
for (const name of [
  "assertSupabaseResult",
  "assertSupabaseSingleResult",
  "assertAuthAdminResult",
  "collectCleanupResult",
  "formatCleanupFailures",
  "verifyTrackedRowsAbsent",
  "verifySyntheticUsersAbsent",
]) {
  must(
    new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(src),
    `missing required export: ${name}`,
  );
}

// Cross-society correctness
must(
  /insert:unrelatedFlat[\s\S]{0,400}society_id:\s*societyB/.test(src),
  "unrelatedFlat is not assigned to societyB",
);
must(
  /insert:unrelatedFlat[\s\S]{0,400}block_id:\s*null/.test(src),
  "unrelatedFlat is not serial-mode (block_id:null)",
);
must(
  /user_id:\s*unrelatedResident\.id[\s\S]{0,120}?society_id:\s*societyB/.test(src),
  "unrelatedResident role is not scoped to societyB",
);

// No generic submitOfflinePayment export or actorRole client-input surface.
mustNot(/export\s+const\s+submitOfflinePayment\b/, "generic submitOfflinePayment exported");
mustNot(/actorRole\s*[:?]/, "browser-controlled actorRole input surface");

// Cleanup must invoke both post-cleanup verifications
must(
  /verifyTrackedRowsAbsent\s*\(/.test(src),
  "cleanup does not call verifyTrackedRowsAbsent",
);
must(
  /verifySyntheticUsersAbsent\s*\(/.test(src),
  "cleanup does not call verifySyntheticUsersAbsent",
);

// Protected society literal (from environment, never echoed)
const protectedId = process.env.SOCIOHUB_PROTECTED_SOCIETY_ID;
if (protectedId && src.includes(protectedId)) {
  problems.push("protected society literal is present in fixture source");
}

if (problems.length > 0) {
  // Do not echo protectedId. Only surface problem labels.
  console.error(`stage3c fixture source scan failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("stage3c fixture source scan: ok");
