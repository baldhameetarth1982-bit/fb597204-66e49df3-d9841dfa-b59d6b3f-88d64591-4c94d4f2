/**
 * Stage 3C — shared runtime fixture module.
 *
 * Consumed by:
 *   - tests/integration/billing-stage3c-live.test.ts (vitest live matrix)
 *   - tests/e2e/stage3c-fixtures.ts (Playwright browser scenarios)
 *
 * The module is transport-agnostic: it constructs an authoritative Supabase
 * service-role client against the isolated (local `supabase start`) stack
 * whose URL and keys are injected by the GitHub Actions workflow. It never
 * touches the shared production project and refuses to run when the caller
 * has not opted in via `ALLOW_SOCIOHUB_LIVE_STAGE3C=true`.
 *
 * This module intentionally does NOT contain any protected-society literal.
 *
 * Every mutation inspects `.error` via the strict result helpers below.
 * Cleanup collects every failure, verifies post-cleanup absence for every
 * tracked category, and only then throws a single labeled combined error.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Sensitive-value redaction registry
// ---------------------------------------------------------------------------

/** Values (env-derived or fixture-derived) that must never appear in logs. */
const SENSITIVE_VALUES = new Set<string>();

function registerSensitiveValue(v: string | undefined | null): void {
  if (typeof v === "string" && v.length >= 4) SENSITIVE_VALUES.add(v);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Strict result helpers
// ---------------------------------------------------------------------------

export type SupabaseAsyncResult<T> = PromiseLike<{
  data: T | null;
  error: unknown;
}>;

export type AuthAdminAsyncResult<T> = PromiseLike<{
  data: T | null;
  error: unknown;
}>;

function extractErrorMessage(err: unknown): string {
  if (!err) return "unknown error";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const rec = err as Record<string, unknown>;
    const msg =
      (typeof rec.message === "string" && rec.message) ||
      (typeof rec.hint === "string" && rec.hint) ||
      (typeof rec.details === "string" && rec.details) ||
      "";
    const code = typeof rec.code === "string" ? ` [${rec.code}]` : "";
    if (msg) return `${msg}${code}`;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return "unserializable error";
  }
}

/**
 * Canonical strict UUID validator used across the fixture. Uses the
 * project's existing Zod dependency; supports the RFC 4122 8-4-4-4-12
 * grammar with variant/version enforcement. Never introduce a new dep.
 */
const RpcIdSchema = z.string().trim().uuid();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deterministic UTC payment date exposed to every live test case.
 * Must satisfy the RPC's "not a future date" rule and remain stable
 * for the complete suite run. Do not call `Date.now()` from cases.
 */
export const STAGE3C_TEST_PAYMENT_DATE = "2026-06-15";

/**
 * Duplicate-safe UUID tracker. Trims + validates the input as a
 * canonical UUID (via `UUID_RE`) and appends it to `collection` only
 * if not already present. Rejects blank strings and non-strings with
 * a labeled error.
 */
export function trackUniqueId(collection: string[], id: unknown, label: string): void {
  if (typeof id !== "string" || id.trim().length === 0)
    throw new Error(`[stage3c:trackUniqueId:${label}] blank or non-string id`);
  const trimmed = id.trim();
  if (!UUID_RE.test(trimmed))
    throw new Error(`[stage3c:trackUniqueId:${label}] malformed UUID`);
  if (collection.includes(trimmed)) return;
  collection.push(trimmed);
}


/**
 * Strict UUID extractor for RPC responses. Accepts a bare UUID string,
 * `{ id }`, or `{ payment_id }`; trims and validates the shape using
 * Zod; throws a labeled error on anything else. Never returns an empty
 * string and never stringifies arbitrary objects.
 */
export function extractRpcId(label: string, data: unknown): string {
  let raw: unknown = data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const rec = data as Record<string, unknown>;
    if (typeof rec.id === "string") raw = rec.id;
    else if (typeof rec.payment_id === "string") raw = rec.payment_id;
  }
  if (typeof raw !== "string") {
    throw new Error(`[stage3c:${label}] expected UUID id in RPC response, got ${typeof data}`);
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new Error(`[stage3c:${label}] empty id in RPC response`);
  }
  const parsed = RpcIdSchema.safeParse(trimmed);
  if (!parsed.success) {
    throw new Error(`[stage3c:${label}] malformed UUID in RPC response`);
  }
  return parsed.data;
}

/**
 * Redact JWT-shaped tokens, sb_ keys, Authorization/cookie/session headers,
 * service-role/password/access/refresh token labels, and any explicit
 * sensitive values before surfacing a message to test logs.
 */
export function redactMessage(
  message: string,
  sensitiveValues: readonly string[] = [],
): string {
  let out = message;
  const explicit = new Set<string>([...SENSITIVE_VALUES, ...sensitiveValues]);
  for (const v of explicit) {
    if (!v || v.length < 4) continue;
    out = out.split(v).join("[REDACTED_VALUE]");
  }
  out = out
    .replace(/eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g, "[REDACTED_JWT]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[REDACTED_SB_KEY]")
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s"',}]+/gi, "$1[REDACTED]")
    .replace(/bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
    .replace(/(cookie|set-cookie|session|refresh[_-]?token|access[_-]?token)(["'\s:=]+)[^\s"',}]+/gi,
      "$1$2[REDACTED]")
    .replace(/service[_-]?role["'\s:=]+[A-Za-z0-9_.\-]+/gi, "service_role=[REDACTED]")
    .replace(/password["'\s:=]+[^\s"']+/gi, "password=[REDACTED]");
  return out;
}

export async function assertSupabaseResult<T>(
  label: string,
  operation: SupabaseAsyncResult<T>,
): Promise<T | null> {
  const { data, error } = await operation;
  if (error) {
    throw new Error(`[stage3c:${label}] ${redactMessage(extractErrorMessage(error))}`);
  }
  return data;
}

export async function assertSupabaseSingleResult<T>(
  label: string,
  operation: SupabaseAsyncResult<T>,
): Promise<T> {
  const data = await assertSupabaseResult<T>(label, operation);
  if (data === null || data === undefined) {
    throw new Error(`[stage3c:${label}] expected single row, got none`);
  }
  return data;
}

export async function assertAuthAdminResult<T>(
  label: string,
  operation: AuthAdminAsyncResult<T>,
  opts: { requireData?: boolean } = {},
): Promise<T | null> {
  const { data, error } = await operation;
  if (error) {
    throw new Error(`[stage3c:auth:${label}] ${redactMessage(extractErrorMessage(error))}`);
  }
  if (opts.requireData && (data === null || data === undefined)) {
    throw new Error(`[stage3c:auth:${label}] missing expected data`);
  }
  return data;
}

export type CleanupFailure = { label: string; message: string };

export async function collectCleanupResult(
  label: string,
  operation: PromiseLike<{ data?: unknown; error?: unknown } | unknown>,
  sink: CleanupFailure[],
): Promise<void> {
  try {
    const result = (await operation) as unknown;
    if (result && typeof result === "object" && "error" in result) {
      const err = (result as { error: unknown }).error;
      if (err) {
        sink.push({ label, message: redactMessage(extractErrorMessage(err)) });
      }
    }
  } catch (e) {
    sink.push({ label, message: redactMessage(extractErrorMessage(e)) });
  }
}

export function formatCleanupFailures(fails: CleanupFailure[]): string {
  if (fails.length === 0) return "";
  const lines = fails.map((f) => `  - ${f.label}: ${redactMessage(f.message)}`);
  return `Stage 3C fixture teardown had ${fails.length} failure(s):\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------
// Environment gating
// ---------------------------------------------------------------------------

export type Stage3CEnv = {
  url: string;
  serviceRoleKey: string;
  publishableKey: string;
};

/**
 * Canonical disposable/local hostnames allowed for the Stage 3C
 * destructive fixture. Any other host — including normal `*.supabase.co`
 * projects, custom public HTTPS hosts, or arbitrary URLs — is rejected
 * before any credential is used. No general bypass env var exists.
 */
export const STAGE3C_ALLOWED_HOSTS: readonly string[] = Object.freeze([
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
  "kong",
  "supabase_kong",
  "supabase-kong",
]);

export function isStage3CHostAllowed(url: string): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  return STAGE3C_ALLOWED_HOSTS.includes(host);
}

export function requireStage3CEnv(): Stage3CEnv {
  if (process.env.ALLOW_SOCIOHUB_LIVE_STAGE3C !== "true") {
    throw new Error(
      "Stage 3C live fixtures require ALLOW_SOCIOHUB_LIVE_STAGE3C=true. Refusing to run.",
    );
  }
  const url = process.env.SOCIOHUB_TEST_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SOCIOHUB_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
  const publishableKey = process.env.SOCIOHUB_TEST_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !serviceRoleKey || !publishableKey) {
    throw new Error(
      "Stage 3C fixtures require SOCIOHUB_TEST_SUPABASE_URL / _SERVICE_ROLE_KEY / _PUBLISHABLE_KEY.",
    );
  }
  const shared = process.env.SUPABASE_URL ?? "";
  if (shared && shared === url) {
    throw new Error(
      "Stage 3C fixtures refuse to run against the shared SUPABASE_URL. Use a disposable isolated project.",
    );
  }
  if (!isStage3CHostAllowed(url)) {
    throw new Error(
      "Stage 3C fixtures refuse to run against a non-disposable Supabase host. Only local/isolated hostnames are permitted.",
    );
  }
  // Register sensitive credentials/URLs so redactMessage strips them.
  registerSensitiveValue(serviceRoleKey);
  registerSensitiveValue(publishableKey);
  registerSensitiveValue(process.env.SOCIOHUB_PROTECTED_SOCIETY_ID);
  return { url, serviceRoleKey, publishableKey };
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export type FlatResidentKey = { flat_id: string; user_id: string };
export type UserRoleKey = { user_id: string; role: string; society_id: string };
export type ReceiptSequenceKey = { society_id: string; year_month: number };
export type FixtureAuditSelector = {
  society_id: string;
  since: string; // ISO timestamp — fixture-time boundary
};

export type TrackedIds = {
  authUserIds: string[];
  societyIds: string[];
  userRoles: UserRoleKey[];
  userRoleIds: string[];
  userRoleBlockScopeIds: string[];
  blockIds: string[];
  flatIds: string[];
  flatResidents: FlatResidentKey[];
  flatResidentIds: string[];
  billIds: string[];
  billLineItemIds: string[];
  paymentIds: string[];
  paymentReceiptIds: string[];
  receiptSequences: ReceiptSequenceKey[];
  auditSelectors: FixtureAuditSelector[];
  /** Fixture setup start ISO timestamp — audit deletion boundary. */
  setupStartedAt: string;
};

function makeTracker(): TrackedIds {
  return {
    authUserIds: [],
    societyIds: [],
    userRoles: [],
    userRoleIds: [],
    userRoleBlockScopeIds: [],
    blockIds: [],
    flatIds: [],
    flatResidents: [],
    flatResidentIds: [],
    billIds: [],
    billLineItemIds: [],
    paymentIds: [],
    paymentReceiptIds: [],
    receiptSequences: [],
    auditSelectors: [],
    setupStartedAt: new Date().toISOString(),
  };
}

function dedupeSeq(rows: ReceiptSequenceKey[]): ReceiptSequenceKey[] {
  const seen = new Set<string>();
  const out: ReceiptSequenceKey[] = [];
  for (const r of rows) {
    const k = `${r.society_id}|${r.year_month}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SyntheticUser = {
  id: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

export type FinancialScenarios = {
  openBillId: string;
  openBillId2: string;
  cancelledBillId: string;
  fullyUnavailableBillId: string;
  pendingAdminCashPaymentId: string;
  pendingResidentBankTransferPaymentId: string;
  verifiedPaymentId: string;
  verifiedReceiptId: string;
  rejectedPaymentId: string;
  reversedPaymentId: string;
  voidReceiptId: string;
};

export type Stage3CMatrixResources = {
  /** Extra flat inside Society A / blockA — used to prove same-society, cross-flat denial. */
  otherFlatA: string;
  /** Dedicated unpaid bill on flatA for RESIDENT-SUBMIT lifecycle. */
  residentSubmitBillId: string;
  /** Dedicated unpaid bill on otherFlatA for RESIDENT-SUBMIT ownership denial. */
  otherFlatBillId: string;
  /** Dedicated unpaid bill on flatA for IDEMPOTENCY-01/02/03. */
  idempotencyBillAId: string;
  /** Dedicated unpaid bill on flatA for IDEMPOTENCY cross-bill scenarios. */
  idempotencyBillBId: string;
  /** Dedicated unpaid bill on flatA for REFERENCE-01/02. */
  referenceBillId: string;
};

/**
 * Strict, required ownership contract for matrix validation. Supplies
 * flatA plus the exact four existing core bill IDs that must NOT
 * overlap any dedicated matrix bill. Ownership is mandatory: the
 * fixture runtime must always supply it so the overlap and cross-flat
 * invariants are enforced.
 */
export type Stage3CMatrixOwnership = {
  flatA: string;
  existingBillIds: readonly [string, string, string, string];
};

const Stage3CMatrixOwnershipSchema = z
  .object({
    flatA: z.string().trim().uuid(),
    existingBillIds: z
      .array(z.string().trim().uuid())
      .length(4, "existingBillIds must contain exactly four UUIDs")
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "existingBillIds must be unique",
      }),
  })
  .strict();

const Stage3CMatrixResourcesSchema = z
  .object({
    otherFlatA: z.string().trim().uuid(),
    residentSubmitBillId: z.string().trim().uuid(),
    otherFlatBillId: z.string().trim().uuid(),
    idempotencyBillAId: z.string().trim().uuid(),
    idempotencyBillBId: z.string().trim().uuid(),
    referenceBillId: z.string().trim().uuid(),
  })
  .strict();

export function validateStage3CMatrixResources(
  raw: unknown,
  ownership: Stage3CMatrixOwnership,
): Stage3CMatrixResources {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("[stage3c:matrix] resource bag must be a plain object");
  const parsed = Stage3CMatrixResourcesSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}:${i.message}`)
      .join("; ");
    throw new Error(`[stage3c:matrix] invalid matrix resources: ${details}`);
  }
  const own = Stage3CMatrixOwnershipSchema.safeParse(ownership);
  if (!own.success) {
    const details = own.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}:${i.message}`)
      .join("; ");
    throw new Error(`[stage3c:matrix] invalid ownership: ${details}`);
  }
  const v = parsed.data;
  const dedicatedBillIds = [
    v.residentSubmitBillId,
    v.otherFlatBillId,
    v.idempotencyBillAId,
    v.idempotencyBillBId,
    v.referenceBillId,
  ];
  const uniqueBills = new Set(dedicatedBillIds);
  if (uniqueBills.size !== dedicatedBillIds.length)
    throw new Error("[stage3c:matrix] dedicated bill IDs must be unique");
  if (v.otherFlatA === own.data.flatA)
    throw new Error("[stage3c:matrix] otherFlatA must not equal flatA");
  const coreSet = new Set(own.data.existingBillIds);
  for (const id of dedicatedBillIds) {
    if (coreSet.has(id))
      throw new Error(
        "[stage3c:matrix] dedicated bill overlaps an existing core bill scenario",
      );
  }
  return v;
}

/**
 * Strict parser for the `otherFlatA` returned row. Rejects malformed
 * UUIDs, wrong society/block/flat_number, non-`occupied` status, and
 * unknown fields. Never trusts the insert-input payload as proof of
 * the database's actual returned row.
 */
const OtherFlatARowSchema = z
  .object({
    id: z.string().uuid(),
    society_id: z.string().uuid(),
    block_id: z.string().uuid(),
    flat_number: z.string().min(1),
    status: z.literal("occupied"),
  })
  .strict();

export function parseOtherFlatARow(
  raw: unknown,
  expected: { societyId: string; blockId: string; flatNumber: string },
): { id: string; society_id: string; block_id: string; flat_number: string; status: "occupied" } {
  const parsed = OtherFlatARowSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `${i.path.join(".") || "<root>"}:${i.message}`)
      .join("; ");
    throw new Error(`[stage3c:otherFlatA] invalid returned row: ${details}`);
  }
  const row = parsed.data;
  if (row.society_id !== expected.societyId)
    throw new Error("[stage3c:otherFlatA] returned society_id mismatch");
  if (row.block_id !== expected.blockId)
    throw new Error("[stage3c:otherFlatA] returned block_id mismatch");
  if (row.flat_number !== expected.flatNumber)
    throw new Error("[stage3c:otherFlatA] returned flat_number mismatch");
  return row;
}

const MatrixPaymentRowSchema = z
  .object({ id: z.string().uuid(), bill_id: z.string().uuid() })
  .strict();
const MatrixReceiptRowSchema = z
  .object({ id: z.string().uuid(), payment_id: z.string().uuid() })
  .strict();

export function parseMatrixPaymentRows(
  raw: unknown,
): ReadonlyArray<{ id: string; bill_id: string }> {
  if (!Array.isArray(raw))
    throw new Error("[stage3c:matrix:startClean:payments] rows must be an array");
  return raw.map((r, idx) => {
    const p = MatrixPaymentRowSchema.safeParse(r);
    if (!p.success)
      throw new Error(
        `[stage3c:matrix:startClean:payments] malformed row at index ${idx}`,
      );
    return p.data;
  });
}

export function parseMatrixReceiptRows(
  raw: unknown,
): ReadonlyArray<{ id: string; payment_id: string }> {
  if (!Array.isArray(raw))
    throw new Error("[stage3c:matrix:startClean:receipts] rows must be an array");
  return raw.map((r, idx) => {
    const p = MatrixReceiptRowSchema.safeParse(r);
    if (!p.success)
      throw new Error(
        `[stage3c:matrix:startClean:receipts] malformed row at index ${idx}`,
      );
    return p.data;
  });
}

/**
 * Verify that every dedicated matrix bill starts with zero payments
 * and zero receipts. Uses schema-correct traversal:
 * bills -> payments (by bill_id) -> payment_receipts (by payment_id).
 * All query errors are fatal — never swallowed, never "not fatal".
 */
export async function assertMatrixBillsStartClean(
  admin: SupabaseClient,
  matrix: Stage3CMatrixResources,
): Promise<void> {
  const ids = [
    matrix.residentSubmitBillId,
    matrix.otherFlatBillId,
    matrix.idempotencyBillAId,
    matrix.idempotencyBillBId,
    matrix.referenceBillId,
  ];
  if (ids.length !== 5)
    throw new Error("[stage3c:matrix:startClean] expected exactly 5 dedicated bill IDs");
  if (new Set(ids).size !== ids.length)
    throw new Error("[stage3c:matrix:startClean] dedicated bill IDs must be unique");
  for (const id of ids) {
    if (!/^[0-9a-fA-F-]{36}$/.test(id))
      throw new Error("[stage3c:matrix:startClean] dedicated bill ID must be UUID");
  }
  const pay = await admin
    .from("payments")
    .select("id, bill_id")
    .in("bill_id", ids);
  if (pay.error)
    throw new Error(
      `[stage3c:matrix:startClean:payments] ${redactMessage(extractErrorMessage(pay.error))}`,
    );
  const paymentRows = parseMatrixPaymentRows(pay.data ?? []);
  const paymentIds = paymentRows.map((r) => r.id);
  let receiptCount = 0;
  if (paymentIds.length > 0) {
    const rec = await admin
      .from("payment_receipts")
      .select("id, payment_id")
      .in("payment_id", paymentIds);
    if (rec.error)
      throw new Error(
        `[stage3c:matrix:startClean:receipts] ${redactMessage(extractErrorMessage(rec.error))}`,
      );
    receiptCount = parseMatrixReceiptRows(rec.data ?? []).length;
  }
  if (paymentRows.length !== 0 || receiptCount !== 0)
    throw new Error(
      `[stage3c:matrix:startClean] expected 0 payments and 0 receipts, got payments=${paymentRows.length} receipts=${receiptCount}`,
    );
}



export type Stage3CFixture = {
  prefix: string;
  admin: SupabaseClient;
  societyA: string;
  societyB: string;
  blockA: string;
  flatA: string;
  unrelatedFlat: string;
  users: {
    adminA1: SyntheticUser;
    adminA2: SyntheticUser;
    adminB: SyntheticUser;
    blockAdmin: SyntheticUser;
    guard: SyntheticUser;
    activeResident: SyntheticUser;
    movedOutResident: SyntheticUser;
    unrelatedResident: SyntheticUser;
  };
  scenarios: FinancialScenarios;
  matrix: Stage3CMatrixResources;
  tracked: TrackedIds;
  helpers: ScenarioHelpers;
  openBillId: string;
  openBillId2: string;
  cancelledBillId: string;
  testPaymentDate: string;
  cleanup: () => Promise<void>;

};

export type PaginationOptions = { limit?: number; offset?: number };
export type BillSearchOptions = PaginationOptions & { query?: string };

export type ScenarioHelpers = {
  submitAdminCashPayment(input: SubmitAdminInput): Promise<string>;
  submitAdminBankTransferPayment(input: SubmitAdminInput): Promise<string>;
  submitResidentBankTransferPayment(input: SubmitResidentInput): Promise<string>;
  verifyPayment(actor: SyntheticUser, paymentId: string, notes?: string): Promise<void>;
  rejectPayment(actor: SyntheticUser, paymentId: string, reason: string): Promise<void>;
  reversePayment(actor: SyntheticUser, paymentId: string, reason: string): Promise<void>;
  getBillSummary(actor: SyntheticUser, billId: string): Promise<unknown>;
  getPaymentDetail(actor: SyntheticUser, paymentId: string): Promise<unknown>;
  getResidentPaymentHistory(actor: SyntheticUser, options?: PaginationOptions): Promise<unknown>;
  searchOpenBills(
    actor: SyntheticUser,
    societyId: string,
    options?: BillSearchOptions,
  ): Promise<unknown>;
  countPayments(billId: string): Promise<number>;
  countReceipts(paymentId: string): Promise<number>;
};

export type SubmitAdminInput = {
  actor: SyntheticUser;
  billId: string;
  amount: number;
  paymentDate: string;
  referenceNo?: string;
  notes?: string;
  idempotencyKey: string;
};

export type SubmitResidentInput = Omit<SubmitAdminInput, "referenceNo"> & {
  referenceNo: string;
};

// ---------------------------------------------------------------------------
// Pagination validation
// ---------------------------------------------------------------------------

/**
 * Canonical pagination validator used by every scenario helper. Exported
 * for direct behavioral testing — do not duplicate this logic in tests.
 */
export function validateStage3CPagination(
  label: string,
  opts: PaginationOptions | undefined,
  defaults: { limit: number; offset: number; max: number },
): { limit: number; offset: number } {
  const limit = opts?.limit ?? defaults.limit;
  const offset = opts?.offset ?? defaults.offset;
  if (!Number.isInteger(limit) || limit < 1 || limit > defaults.max) {
    throw new Error(`[stage3c:${label}] invalid limit: ${limit}`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`[stage3c:${label}] invalid offset: ${offset}`);
  }
  return { limit, offset };
}

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

function makePrefix(): string {
  return `s3c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

async function mkUser(
  admin: SupabaseClient,
  env: Stage3CEnv,
  prefix: string,
  slug: string,
  tracked: TrackedIds,
): Promise<SyntheticUser> {
  const email = `${prefix}-${slug}@example.test`;
  const password = `Aa1!${Math.random().toString(36).slice(2, 12)}`;
  registerSensitiveValue(password);
  const created = await assertAuthAdminResult(
    `createUser:${slug}`,
    admin.auth.admin.createUser({ email, password, email_confirm: true }),
    { requireData: true },
  );
  const user = (created as { user: { id: string } | null } | null)?.user;
  if (!user) throw new Error(`[stage3c:auth:createUser:${slug}] missing user`);
  tracked.authUserIds.push(user.id);
  const client = createClient(env.url, env.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) {
    throw new Error(`[stage3c:signIn:${slug}] ${redactMessage(extractErrorMessage(signIn.error))}`);
  }
  return { id: user.id, email, password, client };
}

export function buildScenarioHelpers(admin: SupabaseClient): ScenarioHelpers {
  return {
    async submitAdminCashPayment(input) {
      const { data, error } = await input.actor.client.rpc("submit_offline_payment", {
        _bill_id: input.billId,
        _method: "cash",
        _amount: input.amount,
        _payment_date: input.paymentDate,
        _reference_no: input.referenceNo ?? null,
        _notes: input.notes ?? null,
        _idempotency_key: input.idempotencyKey,
        _actor_role: "admin",
      });
      if (error)
        throw new Error(`[stage3c:submitAdminCash] ${redactMessage(extractErrorMessage(error))}`);
      return extractRpcId("submitAdminCash", data);
    },
    async submitAdminBankTransferPayment(input) {
      const { data, error } = await input.actor.client.rpc("submit_offline_payment", {
        _bill_id: input.billId,
        _method: "bank_transfer",
        _amount: input.amount,
        _payment_date: input.paymentDate,
        _reference_no: input.referenceNo ?? null,
        _notes: input.notes ?? null,
        _idempotency_key: input.idempotencyKey,
        _actor_role: "admin",
      });
      if (error)
        throw new Error(`[stage3c:submitAdminBank] ${redactMessage(extractErrorMessage(error))}`);
      return extractRpcId("submitAdminBank", data);
    },
    async submitResidentBankTransferPayment(input) {
      const { data, error } = await input.actor.client.rpc("submit_offline_payment", {
        _bill_id: input.billId,
        _method: "bank_transfer",
        _amount: input.amount,
        _payment_date: input.paymentDate,
        _reference_no: input.referenceNo,
        _notes: input.notes ?? null,
        _idempotency_key: input.idempotencyKey,
        _actor_role: "resident",
      });
      if (error)
        throw new Error(`[stage3c:submitResidentBank] ${redactMessage(extractErrorMessage(error))}`);
      return extractRpcId("submitResidentBank", data);
    },
    async verifyPayment(actor, paymentId, notes) {
      const { error } = await actor.client.rpc("verify_offline_payment", {
        _payment_id: paymentId,
        _notes: notes ?? null,
      });
      if (error) throw new Error(`[stage3c:verify] ${redactMessage(extractErrorMessage(error))}`);
    },
    async rejectPayment(actor, paymentId, reason) {
      const { error } = await actor.client.rpc("reject_offline_payment", {
        _payment_id: paymentId,
        _reason: reason,
      });
      if (error) throw new Error(`[stage3c:reject] ${redactMessage(extractErrorMessage(error))}`);
    },
    async reversePayment(actor, paymentId, reason) {
      const { error } = await actor.client.rpc("reverse_offline_payment", {
        _payment_id: paymentId,
        _reason: reason,
      });
      if (error) throw new Error(`[stage3c:reverse] ${redactMessage(extractErrorMessage(error))}`);
    },
    async getBillSummary(actor, billId) {
      const { data, error } = await actor.client.rpc("get_bill_payment_summary", {
        _bill_id: billId,
      });
      if (error)
        throw new Error(`[stage3c:getBillSummary] ${redactMessage(extractErrorMessage(error))}`);
      return data;
    },
    async getPaymentDetail(actor, paymentId) {
      const { data, error } = await actor.client.rpc("get_payment_detail", {
        _payment_id: paymentId,
      });
      if (error)
        throw new Error(`[stage3c:getPaymentDetail] ${redactMessage(extractErrorMessage(error))}`);
      return data;
    },
    async getResidentPaymentHistory(actor, options) {
      const { limit, offset } = validateStage3CPagination("getResidentPaymentHistory", options, {
        limit: 50,
        offset: 0,
        max: 200,
      });
      const { data, error } = await actor.client.rpc("get_resident_payments_v1", {
        _limit: limit,
        _offset: offset,
      });
      if (error)
        throw new Error(
          `[stage3c:getResidentPayments] ${redactMessage(extractErrorMessage(error))}`,
        );
      return data;
    },
    async searchOpenBills(actor, societyId, options) {
      if (typeof societyId !== "string" || !UUID_RE.test(societyId)) {
        throw new Error(`[stage3c:searchOpenBills] invalid society_id`);
      }
      const query = options?.query ?? "";
      if (query.length > 120) {
        throw new Error(`[stage3c:searchOpenBills] query too long`);
      }
      const { limit, offset } = validateStage3CPagination("searchOpenBills", options, {
        limit: 20,
        offset: 0,
        max: 50,
      });
      const { data, error } = await actor.client.rpc("search_society_open_bills", {
        _society_id: societyId,
        _query: query,
        _limit: limit,
        _offset: offset,
      });
      if (error)
        throw new Error(
          `[stage3c:searchOpenBills] ${redactMessage(extractErrorMessage(error))}`,
        );
      return data;
    },
    async countPayments(billId) {
      const { count, error } = await admin
        .from("payments")
        .select("*", { count: "exact", head: true })
        .eq("bill_id", billId);
      if (error)
        throw new Error(`[stage3c:countPayments] ${redactMessage(extractErrorMessage(error))}`);
      return count ?? 0;
    },
    async countReceipts(paymentId) {
      const { count, error } = await admin
        .from("payment_receipts")
        .select("*", { count: "exact", head: true })
        .eq("payment_id", paymentId);
      if (error)
        throw new Error(`[stage3c:countReceipts] ${redactMessage(extractErrorMessage(error))}`);
      return count ?? 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Canonical confirmed-sequence helper (used for every receipt sequence key).
// ---------------------------------------------------------------------------

/**
 * Derive UTC year_month from an ISO timestamp using the same rule the
 * production RPC uses. Exported for reuse and direct testing.
 */
export function stage3cReceiptMonthCode(iso: string): number {
  const d = new Date(iso);
  return d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1);
}

/**
 * Look up the exact `payment_receipt_month_sequences` row for a society
 * and a receipt's `created_at`. Fails loudly if the sequence row is
 * missing or the RPC returned an error. Never mutates tracking; the
 * caller decides whether to push the confirmed key.
 *
 * Every receipt (verified AND void) MUST go through this helper before
 * its sequence key is tracked. The source scan enforces that neither
 * receipt path pushes a raw key without this call.
 */
export async function confirmReceiptSequenceKey(
  admin: SupabaseClient,
  societyId: string,
  receiptCreatedAt: string,
  label: string,
): Promise<ReceiptSequenceKey> {
  const yearMonth = stage3cReceiptMonthCode(receiptCreatedAt);
  const res = await admin
    .from("payment_receipt_month_sequences")
    .select("society_id, year_month")
    .eq("society_id", societyId)
    .eq("year_month", yearMonth)
    .maybeSingle();
  if (res.error) {
    throw new Error(
      `[stage3c:${label}] ${redactMessage(extractErrorMessage(res.error))}`,
    );
  }
  if (!res.data) {
    throw new Error(
      `[stage3c:${label}] no sequence row for year_month=${yearMonth}`,
    );
  }
  return { society_id: societyId, year_month: yearMonth };
}

// ---------------------------------------------------------------------------
// Post-cleanup verification
// ---------------------------------------------------------------------------

/**
 * Bounded exact-ID verifier. Returns the intersection of `tracked ∩
 * remaining` (up to `tracked.length` rows). Never uses `.limit(1)`.
 */
export async function fetchRemainingTrackedIds(
  admin: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
): Promise<{ remaining: string[]; error: unknown }> {
  if (ids.length === 0) return { remaining: [], error: null };
  const { data, error } = await admin
    .from(table)
    .select(column)
    .in(column, ids)
    .limit(ids.length);
  if (error) return { remaining: [], error };
  const tracked = new Set(ids);
  const seen = new Set<string>();
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const v = row[column];
    if (typeof v === "string" && tracked.has(v)) seen.add(v);
  }
  return { remaining: Array.from(seen), error: null };
}

function summarizeIds(ids: string[]): string {
  if (ids.length <= 8) return ids.join(",");
  return `${ids.slice(0, 8).join(",")}...(+${ids.length - 8} more)`;
}

export async function verifyTrackedRowsAbsent(
  admin: SupabaseClient,
  tracked: TrackedIds,
  sink: CleanupFailure[],
): Promise<void> {
  const check = async (
    label: string,
    table: string,
    column: string,
    ids: string[],
  ): Promise<void> => {
    const { remaining, error } = await fetchRemainingTrackedIds(admin, table, column, ids);
    if (error) {
      sink.push({ label: `verify:${label}`, message: redactMessage(extractErrorMessage(error)) });
      return;
    }
    if (remaining.length > 0) {
      sink.push({
        label: `verify:${label}`,
        message: `${remaining.length} tracked ${table} row(s) remain [${summarizeIds(remaining)}]`,
      });
    }
  };
  await check("payment_receipts", "payment_receipts", "id", tracked.paymentReceiptIds);
  await check("payments", "payments", "id", tracked.paymentIds);
  await check("bill_line_items", "bill_line_items", "id", tracked.billLineItemIds);
  await check("bills", "bills", "id", tracked.billIds);
  await check(
    "user_role_block_scopes",
    "user_role_block_scopes",
    "id",
    tracked.userRoleBlockScopeIds,
  );
  await check("flat_residents", "flat_residents", "id", tracked.flatResidentIds);
  await check("flats", "flats", "id", tracked.flatIds);
  await check("blocks", "blocks", "id", tracked.blockIds);
  await check("user_roles", "user_roles", "id", tracked.userRoleIds);
  await check("societies", "societies", "id", tracked.societyIds);

  for (const seq of dedupeSeq(tracked.receiptSequences)) {
    const { data, error } = await admin
      .from("payment_receipt_month_sequences")
      .select("society_id, year_month")
      .eq("society_id", seq.society_id)
      .eq("year_month", seq.year_month);
    if (error) {
      sink.push({
        label: "verify:receipt_sequences",
        message: redactMessage(extractErrorMessage(error)),
      });
    } else if ((data ?? []).length > 0) {
      sink.push({
        label: "verify:receipt_sequences",
        message: `receipt sequence row remains for year_month=${seq.year_month}`,
      });
    }
  }

  for (const sel of tracked.auditSelectors) {
    const { data, error } = await admin
      .from("audit_log")
      .select("id")
      .eq("society_id", sel.society_id)
      .gte("created_at", sel.since)
      .limit(1);
    if (error) {
      sink.push({ label: "verify:audit_log", message: redactMessage(extractErrorMessage(error)) });
    } else if ((data ?? []).length > 0) {
      sink.push({ label: "verify:audit_log", message: "fixture-time audit rows remain" });
    }
  }
}

/**
 * Verify that no synthetic auth users are left behind. Individual per-ID
 * `getUserById` checks come first for a fast happy path, then a paginated
 * prefix scan of `admin.auth.admin.listUsers`.
 *
 * Pagination FAILS CLOSED: hitting the defensive safety cap while the
 * last observed page was still full appends a labeled failure — the
 * fixture never silently claims all users were inspected.
 */
export const STAGE3C_LIST_USERS_PAGE_CAP = 100;

export async function verifySyntheticUsersAbsent(
  admin: SupabaseClient,
  userIds: string[],
  prefix: string,
  sink: CleanupFailure[],
): Promise<void> {
  for (const uid of userIds) {
    const { data, error } = await admin.auth.admin.getUserById(uid);
    if (error) {
      const msg = extractErrorMessage(error).toLowerCase();
      if (!msg.includes("not found") && !msg.includes("user not found")) {
        sink.push({
          label: `verify:auth:${uid}`,
          message: redactMessage(extractErrorMessage(error)),
        });
      }
      continue;
    }
    if (data && (data as { user?: unknown }).user) {
      sink.push({
        label: `verify:auth:${uid}`,
        message: "synthetic auth user still present",
      });
    }
  }

  const perPage = 200;
  let page = 1;
  let remainingCount = 0;
  let completed = false;
  let lastPageFull = false;
  for (let i = 0; i < STAGE3C_LIST_USERS_PAGE_CAP; i++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) {
      sink.push({
        label: "verify:auth:listUsers",
        message: redactMessage(extractErrorMessage(error)),
      });
      return;
    }
    const users = (data as { users?: { email?: string | null }[] } | null)?.users ?? [];
    for (const u of users) {
      const email = (u.email ?? "").toLowerCase();
      if (email.startsWith(`${prefix.toLowerCase()}-`)) remainingCount++;
    }
    lastPageFull = users.length >= perPage;
    if (!lastPageFull) {
      completed = true;
      break;
    }
    page++;
  }
  if (remainingCount > 0) {
    sink.push({
      label: "verify:auth:prefix",
      message: `${remainingCount} synthetic user(s) with fixture prefix remain`,
    });
  }
  if (!completed && lastPageFull) {
    sink.push({
      label: "verify:auth:pagination_limit",
      message:
        `listUsers safety cap ${STAGE3C_LIST_USERS_PAGE_CAP} reached with a full last page; ` +
        `synthetic user absence NOT confirmed`,
    });
  }
}


// ---------------------------------------------------------------------------
// Strict cleanup
// ---------------------------------------------------------------------------

async function strictCleanup(
  admin: SupabaseClient,
  prefix: string,
  tracked: TrackedIds,
): Promise<void> {
  const fails: CleanupFailure[] = [];

  if (tracked.paymentReceiptIds.length)
    await collectCleanupResult(
      "delete:payment_receipts",
      admin.from("payment_receipts").delete().in("id", tracked.paymentReceiptIds),
      fails,
    );
  if (tracked.paymentIds.length)
    await collectCleanupResult(
      "delete:payments",
      admin.from("payments").delete().in("id", tracked.paymentIds),
      fails,
    );
  if (tracked.billLineItemIds.length)
    await collectCleanupResult(
      "delete:bill_line_items",
      admin.from("bill_line_items").delete().in("id", tracked.billLineItemIds),
      fails,
    );
  if (tracked.billIds.length)
    await collectCleanupResult(
      "delete:bills",
      admin.from("bills").delete().in("id", tracked.billIds),
      fails,
    );
  if (tracked.flatResidentIds.length) {
    await collectCleanupResult(
      "delete:flat_residents",
      admin.from("flat_residents").delete().in("id", tracked.flatResidentIds),
      fails,
    );
  }
  if (tracked.userRoleBlockScopeIds.length) {
    await collectCleanupResult(
      "delete:user_role_block_scopes",
      admin
        .from("user_role_block_scopes")
        .delete()
        .in("id", tracked.userRoleBlockScopeIds),
      fails,
    );
  }
  if (tracked.flatIds.length)
    await collectCleanupResult(
      "delete:flats",
      admin.from("flats").delete().in("id", tracked.flatIds),
      fails,
    );
  if (tracked.blockIds.length)
    await collectCleanupResult(
      "delete:blocks",
      admin.from("blocks").delete().in("id", tracked.blockIds),
      fails,
    );
  if (tracked.userRoleIds.length) {
    await collectCleanupResult(
      "delete:user_roles",
      admin.from("user_roles").delete().in("id", tracked.userRoleIds),
      fails,
    );
  }

  // Exact composite-key monthly sequence deletion; deduplicated.
  for (const seq of dedupeSeq(tracked.receiptSequences)) {
    await collectCleanupResult(
      `delete:payment_receipt_month_sequences:${seq.year_month}`,
      admin
        .from("payment_receipt_month_sequences")
        .delete()
        .eq("society_id", seq.society_id)
        .eq("year_month", seq.year_month),
      fails,
    );
  }

  for (const sel of tracked.auditSelectors) {
    await collectCleanupResult(
      "delete:audit_log",
      admin
        .from("audit_log")
        .delete()
        .eq("society_id", sel.society_id)
        .gte("created_at", sel.since),
      fails,
    );
  }
  if (tracked.societyIds.length)
    await collectCleanupResult(
      "delete:societies",
      admin.from("societies").delete().in("id", tracked.societyIds),
      fails,
    );
  for (const uid of tracked.authUserIds) {
    await collectCleanupResult(
      `delete:auth:${uid}`,
      admin.auth.admin.deleteUser(uid),
      fails,
    );
  }

  // Prefix-scoped safety net (does not drive deletion; only surfaces leaks).
  const remainingSocieties = await admin
    .from("societies")
    .select("id")
    .like("name", `${prefix}-%`);
  if (remainingSocieties.error) {
    fails.push({
      label: "verify:prefix_societies",
      message: redactMessage(extractErrorMessage(remainingSocieties.error)),
    });
  } else if ((remainingSocieties.data ?? []).length > 0) {
    fails.push({
      label: "verify:prefix_societies",
      message: `fixture prefix ${prefix} still has ${remainingSocieties.data?.length ?? 0} societies`,
    });
  }

  await verifyTrackedRowsAbsent(admin, tracked, fails);
  await verifySyntheticUsersAbsent(admin, tracked.authUserIds, prefix, fails);

  if (fails.length > 0) {
    throw new Error(formatCleanupFailures(fails));
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Legacy internal alias — use `stage3cReceiptMonthCode` externally. */
const receiptMonthCode = stage3cReceiptMonthCode;
void receiptMonthCode;

export async function setupStage3CFixture(): Promise<Stage3CFixture> {
  const env = requireStage3CEnv();
  const prefix = makePrefix();
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tracked = makeTracker();
  // Guard escapeRegex from tree-shaking so redaction utilities remain live.
  void escapeRegex;

  try {
    // ---- Societies -----------------------------------------------------
    const sA = await assertSupabaseSingleResult<{ id: string }>(
      "insert:societyA",
      admin
        .from("societies")
        .insert({
          name: `${prefix}-A`,
          status: "active",
          plan: "basic",
          layout: "structured",
          structure_mode: "structured",
        })
        .select("id")
        .single(),
    );
    tracked.societyIds.push(sA.id);
    const societyA = sA.id;
    tracked.auditSelectors.push({ society_id: societyA, since: tracked.setupStartedAt });

    const sB = await assertSupabaseSingleResult<{ id: string }>(
      "insert:societyB",
      admin
        .from("societies")
        .insert({
          name: `${prefix}-B`,
          status: "active",
          plan: "basic",
          layout: "serial",
          structure_mode: "serial",
        })
        .select("id")
        .single(),
    );
    tracked.societyIds.push(sB.id);
    const societyB = sB.id;
    tracked.auditSelectors.push({ society_id: societyB, since: tracked.setupStartedAt });

    // ---- Block in Society A -------------------------------------------
    const bk = await assertSupabaseSingleResult<{ id: string }>(
      "insert:blockA",
      admin
        .from("blocks")
        .insert({ society_id: societyA, name: "A", structure_kind: "block" })
        .select("id")
        .single(),
    );
    tracked.blockIds.push(bk.id);
    const blockA = bk.id;

    // ---- Flat A in Society A ------------------------------------------
    const fl = await assertSupabaseSingleResult<{ id: string }>(
      "insert:flatA",
      admin
        .from("flats")
        .insert({
          society_id: societyA,
          block_id: blockA,
          flat_number: "101",
          status: "occupied",
        })
        .select("id")
        .single(),
    );
    tracked.flatIds.push(fl.id);
    const flatA = fl.id;

    // ---- Unrelated flat in SOCIETY B (serial mode) --------------------
    const unrelated = await assertSupabaseSingleResult<{ id: string }>(
      "insert:unrelatedFlat",
      admin
        .from("flats")
        .insert({
          society_id: societyB,
          block_id: null,
          flat_number: "1",
          status: "occupied",
        })
        .select("id")
        .single(),
    );
    tracked.flatIds.push(unrelated.id);
    const unrelatedFlat = unrelated.id;

    // ---- Users --------------------------------------------------------
    const adminA1 = await mkUser(admin, env, prefix, "a1", tracked);
    const adminA2 = await mkUser(admin, env, prefix, "a2", tracked);
    const adminB = await mkUser(admin, env, prefix, "badmin", tracked);
    const blockAdmin = await mkUser(admin, env, prefix, "ba", tracked);
    const guard = await mkUser(admin, env, prefix, "guard", tracked);
    const activeResident = await mkUser(admin, env, prefix, "res", tracked);
    const movedOutResident = await mkUser(admin, env, prefix, "resmo", tracked);
    const unrelatedResident = await mkUser(admin, env, prefix, "resu", tracked);

    // ---- Roles --------------------------------------------------------
    type RoleRow = {
      user_id: string;
      role: string;
      society_id: string;
      is_active: boolean;
      block_id?: string;
    };
    const roleRows: RoleRow[] = [
      { user_id: adminA1.id, role: "society_admin", society_id: societyA, is_active: true },
      { user_id: adminA2.id, role: "society_admin", society_id: societyA, is_active: true },
      { user_id: adminB.id, role: "society_admin", society_id: societyB, is_active: true },
      {
        user_id: blockAdmin.id,
        role: "block_admin",
        society_id: societyA,
        block_id: blockA,
        is_active: true,
      },
      { user_id: guard.id, role: "security", society_id: societyA, is_active: true },
      { user_id: activeResident.id, role: "resident", society_id: societyA, is_active: true },
      {
        user_id: movedOutResident.id,
        role: "resident",
        society_id: societyA,
        is_active: true,
      },
      {
        user_id: unrelatedResident.id,
        role: "resident",
        society_id: societyB,
        is_active: true,
      },
    ];
    let blockAdminRoleId = "";
    for (const r of roleRows) {
      const inserted = await assertSupabaseSingleResult<{ id: string }>(
        `insert:user_role:${r.role}:${r.user_id.slice(0, 8)}`,
        admin.from("user_roles").insert(r).select("id").single(),
      );
      tracked.userRoleIds.push(inserted.id);
      tracked.userRoles.push({
        user_id: r.user_id,
        role: r.role,
        society_id: r.society_id,
      });
      if (r.role === "block_admin") blockAdminRoleId = inserted.id;
    }

    // ---- Block Admin scope (Stage 2C invariant: scoped to blockA) ----
    if (blockAdminRoleId) {
      const scope = await assertSupabaseSingleResult<{ id: string }>(
        "insert:user_role_block_scope",
        admin
          .from("user_role_block_scopes")
          .insert({
            role_id: blockAdminRoleId,
            society_id: societyA,
            block_id: blockA,
            is_active: true,
          })
          .select("id")
          .single(),
      );
      tracked.userRoleBlockScopeIds.push(scope.id);
    }

    // ---- Flat residency ----------------------------------------------
    const residencyRows = [
      {
        flat_id: flatA,
        user_id: activeResident.id,
        relationship: "owner",
        is_primary: true,
        is_active: true,
      },
      {
        flat_id: flatA,
        user_id: movedOutResident.id,
        relationship: "tenant",
        is_active: false,
        moved_out_at: "2024-01-01",
      },
      {
        flat_id: unrelatedFlat,
        user_id: unrelatedResident.id,
        relationship: "owner",
        is_primary: true,
        is_active: true,
      },
    ];
    for (const r of residencyRows) {
      const inserted = await assertSupabaseSingleResult<{ id: string }>(
        `insert:flat_resident:${r.flat_id.slice(0, 8)}:${r.user_id.slice(0, 8)}`,
        admin.from("flat_residents").insert(r).select("id").single(),
      );
      tracked.flatResidentIds.push(inserted.id);
      tracked.flatResidents.push({ flat_id: r.flat_id, user_id: r.user_id });
    }

    // ---- Bills --------------------------------------------------------
    /**
     * Canonical bill helper. Accepts an explicit `flatId` so bills on
     * flatA and on the matrix-only otherFlatA share one code path.
     * Every bill gets exactly one canonical maintenance line item and
     * both PKs are tracked exactly once via `trackUniqueId`.
     */
    async function addBill(input: {
      label: string;
      amount: number;
      status: string;
      flatId: string;
      extra?: Record<string, unknown>;
    }): Promise<string> {
      const { label, amount, status, flatId, extra } = input;
      if (typeof flatId !== "string" || !UUID_RE.test(flatId))
        throw new Error(`[stage3c:addBill:${label}] invalid flatId`);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new Error(`[stage3c:addBill:${label}] amount must be finite positive`);
      const row = await assertSupabaseSingleResult<{ id: string }>(
        `insert:bill:${label}`,
        admin
          .from("bills")
          .insert({
            society_id: societyA,
            flat_id: flatId,
            period_label: label,
            period_start: "2026-01-01",
            period_end: "2026-01-31",
            amount,
            total_payable: amount,
            due_date: "2026-02-15",
            status,
            bill_number: `RR/${prefix}/${label}`,
            finalized_at: new Date().toISOString(),
            ...(extra ?? {}),
          })
          .select("id")
          .single(),
      );
      trackUniqueId(tracked.billIds, row.id, `bill:${label}`);
      // One canonical maintenance line item per bill — matches the schema
      // check kind IN ('maintenance','additional').
      const lineItem = await assertSupabaseSingleResult<{ id: string; amount: number }>(
        `insert:bill_line_item:${label}`,
        admin
          .from("bill_line_items")
          .insert({
            bill_id: row.id,
            society_id: societyA,
            kind: "maintenance",
            description: `Maintenance ${label}`,
            amount,
          })
          .select("id, amount")
          .single(),
      );
      trackUniqueId(tracked.billLineItemIds, lineItem.id, `bill_line_item:${label}`);
      if (Number(lineItem.amount) !== amount) {
        throw new Error(
          `[stage3c:bill_line_item:${label}] amount mismatch: got ${lineItem.amount} expected ${amount}`,
        );
      }
      return row.id;
    }

    const openBillId = await addBill({ label: "open1", amount: 1000, status: "unpaid", flatId: flatA });
    const openBillId2 = await addBill({ label: "open2", amount: 750, status: "unpaid", flatId: flatA });
    const fullyUnavailableBillId = await addBill({
      label: "full",
      amount: 500,
      status: "unpaid",
      flatId: flatA,
    });
    const cancelledBillId = await addBill({
      label: "canc",
      amount: 500,
      status: "cancelled",
      flatId: flatA,
      extra: {
        cancelled_at: new Date().toISOString(),
        cancelled_by: adminA1.id,
        cancel_reason: "test",
      },
    });

    // ---- Matrix-only extra flat (Society A / blockA, no residency) ---
    const otherFlatARawRow = await assertSupabaseSingleResult<unknown>(
      "insert:otherFlatA",
      admin
        .from("flats")
        .insert({
          society_id: societyA,
          block_id: blockA,
          flat_number: "202",
          status: "occupied",
        })
        .select("id, society_id, block_id, flat_number, status")
        .single(),
    );
    const otherFlatARow = parseOtherFlatARow(otherFlatARawRow, {
      societyId: societyA,
      blockId: blockA,
      flatNumber: "202",
    });
    if (otherFlatARow.id === flatA)
      throw new Error("[stage3c:otherFlatA] must differ from flatA");
    trackUniqueId(tracked.flatIds, otherFlatARow.id, "otherFlatA");
    const otherFlatA = otherFlatARow.id;

    // ---- Five dedicated matrix bills (foundation, no payments yet) ---
    const residentSubmitBillId = await addBill({
      label: "res-submit",
      amount: 1200,
      status: "unpaid",
      flatId: flatA,
    });
    const otherFlatBillId = await addBill({
      label: "other-flat",
      amount: 900,
      status: "unpaid",
      flatId: otherFlatA,
    });
    const idempotencyBillAId = await addBill({
      label: "idem-a",
      amount: 1000,
      status: "unpaid",
      flatId: flatA,
    });
    const idempotencyBillBId = await addBill({
      label: "idem-b",
      amount: 800,
      status: "unpaid",
      flatId: flatA,
    });
    const referenceBillId = await addBill({
      label: "ref",
      amount: 1100,
      status: "unpaid",
      flatId: flatA,
    });

    const matrix: Stage3CMatrixResources = validateStage3CMatrixResources(
      {
        otherFlatA,
        residentSubmitBillId,
        otherFlatBillId,
        idempotencyBillAId,
        idempotencyBillBId,
        referenceBillId,
      },
      {
        flatA,
        existingBillIds: [
          openBillId,
          openBillId2,
          cancelledBillId,
          fullyUnavailableBillId,
        ],
      },
    );

    await assertMatrixBillsStartClean(admin, matrix);


    // ---- Financial scenarios via canonical RPCs ----------------------
    const helpers = buildScenarioHelpers(admin);

    // (2) Pending admin Cash payment on openBillId
    const pendingAdminCashPaymentId = await helpers.submitAdminCashPayment({
      actor: adminA1,
      billId: openBillId,
      amount: 200,
      paymentDate: "2026-02-01",
      idempotencyKey: `${prefix}-adm-cash`,
      notes: "fixture pending cash",
    });
    tracked.paymentIds.push(pendingAdminCashPaymentId);

    // (3) Pending resident Bank Transfer payment on openBillId2
    const pendingResidentBankTransferPaymentId = await helpers
      .submitResidentBankTransferPayment({
        actor: activeResident,
        billId: openBillId2,
        amount: 150,
        paymentDate: "2026-02-01",
        referenceNo: `${prefix}-REF-RES`,
        idempotencyKey: `${prefix}-res-bank`,
      });
    tracked.paymentIds.push(pendingResidentBankTransferPaymentId);

    // (4) Verified payment with valid receipt on fullyUnavailableBillId
    const verifiedPaymentId = await helpers.submitAdminBankTransferPayment({
      actor: adminA1,
      billId: fullyUnavailableBillId,
      amount: 500,
      paymentDate: "2026-02-01",
      referenceNo: `${prefix}-REF-VER`,
      idempotencyKey: `${prefix}-adm-verify`,
    });
    tracked.paymentIds.push(verifiedPaymentId);
    await helpers.verifyPayment(adminA2, verifiedPaymentId, "fixture verify");

    const verifiedReceiptRow = await assertSupabaseSingleResult<{
      id: string;
      created_at: string;
    }>(
      "select:verifiedReceipt",
      admin
        .from("payment_receipts")
        .select("id, created_at")
        .eq("payment_id", verifiedPaymentId)
        .single(),
    );
    tracked.paymentReceiptIds.push(verifiedReceiptRow.id);

    // Confirmed receipt-sequence tracking — the canonical helper derives
    // year_month from the ACTUAL receipt.created_at AND verifies the exact
    // sequence row exists before the key may be tracked.
    const verifiedSeq = await confirmReceiptSequenceKey(
      admin,
      societyA,
      verifiedReceiptRow.created_at,
      "select:receiptSequence",
    );
    tracked.receiptSequences.push(verifiedSeq);

    // (5) Rejected payment on openBillId
    const rejectedPaymentId = await helpers.submitAdminCashPayment({
      actor: adminA1,
      billId: openBillId,
      amount: 50,
      paymentDate: "2026-02-01",
      idempotencyKey: `${prefix}-adm-rej`,
    });
    tracked.paymentIds.push(rejectedPaymentId);
    await helpers.rejectPayment(adminA2, rejectedPaymentId, "fixture reject");

    // (6) Reversed payment with VOID receipt on openBillId2
    const reversedPaymentId = await helpers.submitAdminBankTransferPayment({
      actor: adminA1,
      billId: openBillId2,
      amount: 100,
      paymentDate: "2026-02-01",
      referenceNo: `${prefix}-REF-REV`,
      idempotencyKey: `${prefix}-adm-rev`,
    });
    tracked.paymentIds.push(reversedPaymentId);
    await helpers.verifyPayment(adminA2, reversedPaymentId, "fixture pre-reverse");
    const voidReceiptRow = await assertSupabaseSingleResult<{
      id: string;
      created_at: string;
    }>(
      "select:voidReceipt",
      admin
        .from("payment_receipts")
        .select("id, created_at")
        .eq("payment_id", reversedPaymentId)
        .single(),
    );
    tracked.paymentReceiptIds.push(voidReceiptRow.id);
    // Track second receipt-month if different (deduped in cleanup/verify).
    // Void receipt uses the SAME canonical confirmation helper — never push
    // a raw {society_id, year_month} without confirmation.
    const voidSeq = await confirmReceiptSequenceKey(
      admin,
      societyA,
      voidReceiptRow.created_at,
      "select:voidReceiptSequence",
    );
    tracked.receiptSequences.push(voidSeq);
    await helpers.reversePayment(adminA2, reversedPaymentId, "fixture reverse");

    const scenarios: FinancialScenarios = {
      openBillId,
      openBillId2,
      cancelledBillId,
      fullyUnavailableBillId,
      pendingAdminCashPaymentId,
      pendingResidentBankTransferPaymentId,
      verifiedPaymentId,
      verifiedReceiptId: verifiedReceiptRow.id,
      rejectedPaymentId,
      reversedPaymentId,
      voidReceiptId: voidReceiptRow.id,
    };

    return {
      prefix,
      admin,
      societyA,
      societyB,
      blockA,
      flatA,
      unrelatedFlat,
      users: {
        adminA1,
        adminA2,
        adminB,
        blockAdmin,
        guard,
        activeResident,
        movedOutResident,
        unrelatedResident,
      },
      scenarios,
      matrix,
      tracked,
      helpers,
      openBillId,
      openBillId2,
      cancelledBillId,
      testPaymentDate: STAGE3C_TEST_PAYMENT_DATE,
      cleanup: () => strictCleanup(admin, prefix, tracked),

    };
  } catch (setupError) {
    let cleanupMessage = "";
    try {
      await strictCleanup(admin, prefix, tracked);
    } catch (cleanupError) {
      cleanupMessage = redactMessage(extractErrorMessage(cleanupError));
    }
    const setupMsg = redactMessage(extractErrorMessage(setupError));
    if (cleanupMessage) {
      throw new Error(
        `[stage3c:setup] ${setupMsg}\n[stage3c:setup:cleanup] ${cleanupMessage}`,
      );
    }
    throw new Error(`[stage3c:setup] ${setupMsg}`);
  }
}
