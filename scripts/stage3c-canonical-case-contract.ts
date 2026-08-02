#!/usr/bin/env bun
/**
 * Stage 3C — INDEPENDENT canonical 93-case contract.
 *
 * This module is the single source of expectation for both the source
 * validator and the report validator. It is deliberately PURE and
 * deliberately ISOLATED:
 *
 *   - it imports nothing from the matrix registry;
 *   - it imports nothing from the case manifest;
 *   - it imports nothing from the integration suite;
 *   - it never reads a Vitest report;
 *   - it never reads a file at all.
 *
 * The ids are GENERATED from literal category/count declarations written
 * out below. That is what makes the validators independent: a corrupted
 * registry can no longer agree with a corrupted report, because neither
 * of them gets to define what "correct" means.
 */

export type Stage3CCanonicalCategory = {
  readonly name: string;
  readonly count: number;
};

/**
 * THE canonical category order and totals. Literal, hand-written, and
 * intentionally duplicated from nothing.
 */
export const STAGE3C_CANONICAL_CATEGORIES: readonly Stage3CCanonicalCategory[] = Object.freeze([
  Object.freeze({ name: "AUTH", count: 7 }),
  Object.freeze({ name: "PENDING", count: 8 }),
  Object.freeze({ name: "VERIFY", count: 9 }),
  Object.freeze({ name: "RESIDENT-SUBMIT", count: 8 }),
  Object.freeze({ name: "IDEMPOTENCY", count: 4 }),
  Object.freeze({ name: "REFERENCE", count: 4 }),
  Object.freeze({ name: "READ", count: 10 }),
  Object.freeze({ name: "PRIVACY", count: 16 }),
  Object.freeze({ name: "REJECTION", count: 5 }),
  Object.freeze({ name: "REVERSAL", count: 9 }),
  Object.freeze({ name: "SEARCH", count: 10 }),
  Object.freeze({ name: "CLEANUP", count: 3 }),
] as const);

export const STAGE3C_CANONICAL_TOTAL = 93;
export const STAGE3C_CANONICAL_PRODUCT_TOTAL = 90;
export const STAGE3C_CANONICAL_CLEANUP_TOTAL = 3;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function buildCanonicalIds(): readonly string[] {
  const out: string[] = [];
  const names = new Set<string>();
  for (const category of STAGE3C_CANONICAL_CATEGORIES) {
    if (!/^[A-Z]+(-[A-Z]+)*$/.test(category.name))
      throw new Error(`[stage3c:canonical] malformed category name: ${category.name}`);
    if (names.has(category.name))
      throw new Error(`[stage3c:canonical] duplicate category: ${category.name}`);
    names.add(category.name);
    if (!Number.isInteger(category.count) || category.count < 1 || category.count > 99)
      throw new Error(`[stage3c:canonical] invalid count for ${category.name}`);
    for (let i = 1; i <= category.count; i += 1) out.push(`${category.name}-${pad2(i)}`);
  }
  if (out.length !== STAGE3C_CANONICAL_TOTAL)
    throw new Error(
      `[stage3c:canonical] category totals sum to ${out.length}, expected ${STAGE3C_CANONICAL_TOTAL}`,
    );
  if (new Set(out).size !== out.length)
    throw new Error("[stage3c:canonical] generated ids contain duplicates");
  return Object.freeze(out);
}

/** The immutable canonical ordered id array — exactly 93 entries. */
export const STAGE3C_CANONICAL_CASE_IDS: readonly string[] = buildCanonicalIds();

export const STAGE3C_CANONICAL_CATEGORY_ORDER: readonly string[] = Object.freeze(
  STAGE3C_CANONICAL_CATEGORIES.map((c) => c.name),
);

export const STAGE3C_CANONICAL_CATEGORY_TOTALS: Readonly<Record<string, number>> = Object.freeze(
  Object.fromEntries(STAGE3C_CANONICAL_CATEGORIES.map((c) => [c.name, c.count])),
);

export const STAGE3C_CANONICAL_CLEANUP_IDS: readonly string[] = Object.freeze(
  STAGE3C_CANONICAL_CASE_IDS.filter((id) => id.startsWith("CLEANUP-")),
);

export const STAGE3C_CANONICAL_PRODUCT_IDS: readonly string[] = Object.freeze(
  STAGE3C_CANONICAL_CASE_IDS.filter((id) => !id.startsWith("CLEANUP-")),
);

/** Matches ANY case-shaped id in a canonical category (used to catch strays). */
export const STAGE3C_CASE_ID_RE = new RegExp(
  `\\b(${STAGE3C_CANONICAL_CATEGORY_ORDER.join("|")})-(\\d{2})\\b`,
);

/** Strict full-string shape: no prefix, no suffix, exactly two digits. */
export const STAGE3C_STRICT_CASE_ID_RE = new RegExp(
  `^(${STAGE3C_CANONICAL_CATEGORY_ORDER.join("|")})-(\\d{2})$`,
);

export function extractCanonicalCaseId(title: string): string | null {
  const m = String(title ?? "").match(STAGE3C_CASE_ID_RE);
  return m ? m[0] : null;
}

/** Category of an id, or null when the id is not canonically shaped. */
export function categoryOf(id: string): string | null {
  const m = String(id ?? "").match(STAGE3C_STRICT_CASE_ID_RE);
  return m ? m[1]! : null;
}

export function categoryTotalsOf(ids: readonly string[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const name of STAGE3C_CANONICAL_CATEGORY_ORDER) totals[name] = 0;
  for (const id of ids) {
    const category = categoryOf(id);
    if (category === null) continue;
    totals[category] = (totals[category] ?? 0) + 1;
  }
  return totals;
}

/**
 * Compare an observed ordered id list against the canonical contract.
 * Returns a (possibly empty) list of human-readable failures. Every
 * property required by the closure contract is checked here so callers
 * cannot accidentally check a weaker subset.
 */
export function validateAgainstCanonical(
  observed: readonly string[],
  label: string,
): string[] {
  const failures: string[] = [];
  const fail = (m: string) => failures.push(`${label}: ${m}`);

  if (observed.length !== STAGE3C_CANONICAL_TOTAL)
    fail(`expected ${STAGE3C_CANONICAL_TOTAL} ids, found ${observed.length}`);

  // shape + unknown category + duplicates
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of observed) {
    if (!STAGE3C_STRICT_CASE_ID_RE.test(id)) {
      fail(`malformed or non-canonical id: ${JSON.stringify(id)}`);
      continue;
    }
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  if (duplicates.size) fail(`duplicate ids: ${[...duplicates].sort().join(", ")}`);

  // category totals
  const totals = categoryTotalsOf(observed);
  for (const category of STAGE3C_CANONICAL_CATEGORIES) {
    const found = totals[category.name] ?? 0;
    if (found !== category.count)
      fail(`category ${category.name} has ${found} case(s), expected ${category.count}`);
  }

  // gaps / missing / extra
  const canonical = new Set(STAGE3C_CANONICAL_CASE_IDS);
  const missing = STAGE3C_CANONICAL_CASE_IDS.filter((id) => !seen.has(id));
  const extra = [...seen].filter((id) => !canonical.has(id));
  if (missing.length) fail(`missing ids: ${missing.join(", ")}`);
  if (extra.length) fail(`unknown ids: ${extra.sort().join(", ")}`);

  // exact order (positional equality)
  if (failures.length === 0) {
    for (let i = 0; i < STAGE3C_CANONICAL_TOTAL; i += 1) {
      if (observed[i] !== STAGE3C_CANONICAL_CASE_IDS[i]) {
        fail(
          `order mismatch at position ${i + 1}: expected ${STAGE3C_CANONICAL_CASE_IDS[i]}, found ${observed[i]}`,
        );
        break;
      }
    }
  }

  // category order
  const observedCategoryOrder: string[] = [];
  for (const id of observed) {
    const category = categoryOf(id);
    if (category === null) continue;
    if (observedCategoryOrder[observedCategoryOrder.length - 1] !== category)
      observedCategoryOrder.push(category);
  }
  if (observedCategoryOrder.join(">") !== STAGE3C_CANONICAL_CATEGORY_ORDER.join(">"))
    fail(
      `category order mismatch: ${observedCategoryOrder.join(">") || "(none)"}`,
    );

  // CLEANUP strictly last
  const tail = observed.slice(-STAGE3C_CANONICAL_CLEANUP_TOTAL);
  if (tail.join(",") !== STAGE3C_CANONICAL_CLEANUP_IDS.join(","))
    fail("CLEANUP-01..03 must be the final three cases, in order");

  return failures;
}

if (import.meta.main) {
  const failures = validateAgainstCanonical(STAGE3C_CANONICAL_CASE_IDS, "self");
  if (failures.length) {
    // eslint-disable-next-line no-console
    console.error(`[stage3c:canonical] self-check FAILED:\n - ${failures.join("\n - ")}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(
    `[stage3c:canonical] ok — ${STAGE3C_CANONICAL_CASE_IDS.length} ids across ${STAGE3C_CANONICAL_CATEGORIES.length} categories`,
  );
}
