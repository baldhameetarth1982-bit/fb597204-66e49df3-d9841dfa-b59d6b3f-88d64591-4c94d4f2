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

// ---- Basic hygiene --------------------------------------------------------
mustNot("as unknown as PromiseLike", "unsafe `as unknown as PromiseLike` cast present");
mustNot(".catch(() => undefined)", "swallowed error via `.catch(() => undefined)`");
mustNot(".catch(()=>undefined)", "swallowed error via `.catch(()=>undefined)`");
mustNot(/catch\s*\{\s*\}/, "bare `catch {}` swallowing errors");
mustNot(/\bTODO\b/, "TODO marker in fixture");
mustNot(/\bplaceholder\b/i, "placeholder marker in fixture");
mustNot(/Not implemented/i, "`Not implemented` marker in fixture");
mustNot(
  /admin\.auth\.admin\.deleteUser\([^)]*\)\s*[;)]/,
  "auth deleteUser result appears to be ignored (must go through collectCleanupResult)",
);

// ---- Required exports -----------------------------------------------------
for (const name of [
  "assertSupabaseResult",
  "assertSupabaseSingleResult",
  "assertAuthAdminResult",
  "collectCleanupResult",
  "formatCleanupFailures",
  "verifyTrackedRowsAbsent",
  "verifySyntheticUsersAbsent",
  "extractRpcId",
  "redactMessage",
]) {
  must(
    new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(src),
    `missing required export: ${name}`,
  );
}

// ---- extractRpcId strictness ---------------------------------------------
must(
  /export function extractRpcId\(\s*label:\s*string,\s*data:\s*unknown\s*\):\s*string/.test(src),
  "extractRpcId must take (label, data) and return a validated string",
);
must(/UUID_RE/.test(src) && /malformed UUID/.test(src), "extractRpcId must validate UUID shape");
// extractRpcId must never return empty string — enforced structurally by the
// `empty id` throw. formatCleanupFailures may return "" for empty input.
must(
  /extractRpcId[\s\S]{0,600}throw new Error[\s\S]{0,100}empty id/.test(src),
  "extractRpcId must throw on empty id (never return \"\")",
);

// ---- Cross-society correctness -------------------------------------------
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

// ---- Society layout + structure_mode consistency -------------------------
must(
  /name:\s*`\$\{prefix\}-A`[\s\S]{0,240}layout:\s*"structured"[\s\S]{0,120}structure_mode:\s*"structured"/.test(src),
  "society A must set both layout: structured and structure_mode: structured",
);
must(
  /name:\s*`\$\{prefix\}-B`[\s\S]{0,240}layout:\s*"serial"[\s\S]{0,120}structure_mode:\s*"serial"/.test(src),
  "society B must set both layout: serial and structure_mode: serial",
);

// ---- Actor role ----------------------------------------------------------
mustNot(/_actor_role:\s*"society_admin"/, "legacy `_actor_role: society_admin` present");
must(
  /submitAdminCashPayment[\s\S]{0,800}_actor_role:\s*"admin"/.test(src),
  "submitAdminCashPayment does not pin `_actor_role: admin`",
);
must(
  /submitAdminBankTransferPayment[\s\S]{0,800}_actor_role:\s*"admin"/.test(src),
  "submitAdminBankTransferPayment does not pin `_actor_role: admin`",
);

// ---- extractRpcId call-through -------------------------------------------
mustNot(
  /String\(\(data as \{ id\?: string \}/,
  "unsafe String((data as {id?: string} | ...) ?? \"\") — use extractRpcId(data)",
);
must(
  /return\s+extractRpcId\(\s*"submitAdminCash"/.test(src),
  "submitAdminCash must return extractRpcId(...)",
);

// ---- Pagination (options + validation) -----------------------------------
must(
  /getResidentPaymentHistory\(actor:\s*SyntheticUser,\s*options\?:\s*PaginationOptions\)/.test(src),
  "getResidentPaymentHistory must accept PaginationOptions",
);
must(
  /searchOpenBills\([\s\S]{0,120}options\?:\s*BillSearchOptions/.test(src),
  "searchOpenBills must accept BillSearchOptions",
);
must(/validateStage3CPagination\(/.test(src), "must call the canonical validateStage3CPagination helper");
must(
  /rpc\("get_resident_payments_v1",\s*\{\s*_limit:\s*limit,\s*_offset:\s*offset/.test(src),
  "get_resident_payments_v1 must forward runtime limit/offset (not hardcoded)",
);
must(
  /rpc\("search_society_open_bills",\s*\{\s*_society_id:\s*societyId,\s*_query:\s*query,\s*_limit:\s*limit,\s*_offset:\s*offset/.test(
    src,
  ),
  "search_society_open_bills must forward runtime society/query/limit/offset",
);

// ---- Line items ---------------------------------------------------------
must(
  /from\("bill_line_items"\)\s*\.insert/.test(src),
  "no bill_line_items inserts — Stage 3B/3C requires at least one line per bill",
);
must(/tracked\.billLineItemIds\.push/.test(src), "bill_line_items ids not tracked");
must(
  /kind:\s*"maintenance"/.test(src),
  "bill_line_items kind must be `maintenance` (schema check enum)",
);
mustNot(/kind:\s*"charge"/, "invalid bill_line_item kind `charge` — schema rejects it");

// ---- Block scope + exact PK tracking -------------------------------------
must(
  /from\("user_role_block_scopes"\)\s*\.insert/.test(src),
  "user_role_block_scopes row not provisioned for blockAdmin",
);
must(/tracked\.userRoleBlockScopeIds\.push/.test(src), "user_role_block_scopes id not tracked");
must(/tracked\.userRoleIds\.push/.test(src), "user_roles PKs not tracked");
must(/tracked\.flatResidentIds\.push/.test(src), "flat_residents PKs not tracked");

// ---- Cleanup precision: no broad fallbacks -------------------------------
mustNot(
  /admin\.from\("user_roles"\)\.delete\(\)\.in\("society_id"/,
  "cleanup falls back to society-wide user_roles deletion — must delete by tracked id only",
);
mustNot(
  /admin\.from\("flat_residents"\)\.delete\(\)\.in\("flat_id"/,
  "cleanup falls back to flat-wide flat_residents deletion — must delete by tracked id only",
);
{
  const idx = src.indexOf('"delete:user_roles"');
  const near = idx >= 0 ? src.slice(idx, idx + 400) : "";
  must(
    /\.in\("id",\s*tracked\.userRoleIds\)/.test(near),
    "cleanup must delete user_roles by tracked id",
  );
}

// ---- Legacy sequence table forbidden -------------------------------------
mustNot(
  /payment_receipt_sequences(?!_)/,
  "cleanup must not touch the legacy payment_receipt_sequences table",
);

// ---- Exact composite sequence deletion -----------------------------------
must(
  /from\("payment_receipt_month_sequences"\)\s*\.delete\(\)\s*\.eq\("society_id"[\s\S]{0,120}\.eq\("year_month"/.test(
    src,
  ),
  "monthly sequence cleanup must delete by exact (society_id, year_month), not society_id alone",
);
mustNot(
  /from\("payment_receipt_month_sequences"\)\s*\.delete\(\)\s*\.in\("society_id"/,
  "monthly sequence cleanup must not delete by society_id blast radius",
);

// ---- Confirmed receipt-sequence derivation -------------------------------
must(
  /receiptMonthCode\(verifiedReceiptRow\.created_at\)/.test(src),
  "must derive year_month from actual receipt created_at",
);
must(
  /select:receiptSequence/.test(src),
  "must confirm the sequence row exists after receipt creation",
);

// ---- verifyTrackedRowsAbsent must cover exact IDs -----------------------
must(
  /check\(\s*"user_role_block_scopes",\s*"user_role_block_scopes",\s*"id",\s*tracked\.userRoleBlockScopeIds/.test(
    src,
  ),
  "verifyTrackedRowsAbsent must verify user_role_block_scopes by exact id",
);
must(
  /check\("flat_residents",\s*"flat_residents",\s*"id",\s*tracked\.flatResidentIds\)/.test(src),
  "verifyTrackedRowsAbsent must verify flat_residents by exact id",
);
must(
  /check\("user_roles",\s*"user_roles",\s*"id",\s*tracked\.userRoleIds\)/.test(src),
  "verifyTrackedRowsAbsent must verify user_roles by exact id",
);

// ---- Audit boundary ------------------------------------------------------
must(
  /gte\("created_at",\s*sel\.since\)/.test(src),
  "audit deletion/verification must use fixture-time boundary (sel.since)",
);
must(/setupStartedAt/.test(src), "TrackedIds must include setupStartedAt");

// ---- Synthetic prefix pagination ----------------------------------------
must(
  /admin\.auth\.admin\.listUsers\(\{\s*page,\s*perPage\s*\}\)/.test(src),
  "verifySyntheticUsersAbsent must page listUsers with explicit page/perPage",
);
must(
  /verifySyntheticUsersAbsent\(\s*admin:\s*SupabaseClient,\s*userIds:\s*string\[\],\s*prefix:\s*string/.test(
    src,
  ),
  "verifySyntheticUsersAbsent must accept prefix argument",
);

// ---- Redaction contract --------------------------------------------------
must(
  /export function redactMessage\(\s*message:\s*string,\s*sensitiveValues:\s*readonly string\[\]\s*=\s*\[\]/.test(
    src,
  ),
  "redactMessage must accept explicit sensitive values",
);
must(
  /assertSupabaseResult[\s\S]{0,300}redactMessage/.test(src),
  "assertSupabaseResult must redact secrets",
);
must(
  /assertAuthAdminResult[\s\S]{0,300}redactMessage/.test(src),
  "assertAuthAdminResult must redact secrets",
);
must(
  /collectCleanupResult[\s\S]{0,600}redactMessage/.test(src),
  "collectCleanupResult must redact secrets",
);
must(
  /setupError[\s\S]{0,300}redactMessage/.test(src),
  "setup error path must redact secrets",
);

// ---- Client input surface -----------------------------------------------
mustNot(/export\s+const\s+submitOfflinePayment\b/, "generic submitOfflinePayment exported");
mustNot(/actorRole\s*[:?]/, "browser-controlled actorRole input surface");

// ---- Cleanup invokes both verifications ---------------------------------
must(
  /verifyTrackedRowsAbsent\s*\(/.test(src),
  "cleanup does not call verifyTrackedRowsAbsent",
);
must(
  /verifySyntheticUsersAbsent\s*\(/.test(src),
  "cleanup does not call verifySyntheticUsersAbsent",
);

// ---- Protected society literal ------------------------------------------
const protectedId = process.env.SOCIOHUB_PROTECTED_SOCIETY_ID;
if (protectedId && src.includes(protectedId)) {
  problems.push("protected society literal is present in fixture source");
}

if (problems.length > 0) {
  console.error(`stage3c fixture source scan failed:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("stage3c fixture source scan: ok");
