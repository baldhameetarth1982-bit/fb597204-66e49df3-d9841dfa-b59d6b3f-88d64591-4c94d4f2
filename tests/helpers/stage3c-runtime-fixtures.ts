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
 * Mirrors production `extractRpcId` in `src/lib/billing-config.functions.ts`.
 * Pulls a canonical UUID out of an RPC response that may be a bare string,
 * `{ id }`, or `{ payment_id }`. Returns `""` when nothing usable is present
 * so callers can detect a missing id instead of stringifying `[object Object]`.
 */
export function extractRpcId(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const rec = data as Record<string, unknown>;
    if (typeof rec.id === "string") return rec.id;
    if (typeof rec.payment_id === "string") return rec.payment_id;
  }
  return "";
}

/**
 * Redact JWT-shaped tokens, sb_ keys, and obvious password/service_role
 * labels before surfacing a cleanup message to test logs. Used by
 * {@link formatCleanupFailures}.
 */
export function redactMessage(msg: string): string {
  return msg
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[REDACTED_JWT]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[REDACTED_SB_KEY]")
    .replace(/service[_-]?role["'\s:=]+[A-Za-z0-9_.\-]+/gi, "service_role=[REDACTED]")
    .replace(/password["'\s:=]+[^\s"']+/gi, "password=[REDACTED]");
}

/**
 * Await a Supabase query builder, inspect its resolved `.error`, and throw
 * a labeled `Error` when non-null. Returns `data` on success.
 */
export async function assertSupabaseResult<T>(
  label: string,
  operation: SupabaseAsyncResult<T>,
): Promise<T | null> {
  const { data, error } = await operation;
  if (error) {
    throw new Error(`[stage3c:${label}] ${extractErrorMessage(error)}`);
  }
  return data;
}

/**
 * Like {@link assertSupabaseResult} but additionally requires a non-null
 * single-row payload.
 */
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

/**
 * Await a Supabase auth-admin call (createUser/deleteUser/listUsers), inspect
 * its resolved error, and require data when `requireData` is set.
 */
export async function assertAuthAdminResult<T>(
  label: string,
  operation: AuthAdminAsyncResult<T>,
  opts: { requireData?: boolean } = {},
): Promise<T | null> {
  const { data, error } = await operation;
  if (error) {
    throw new Error(`[stage3c:auth:${label}] ${extractErrorMessage(error)}`);
  }
  if (opts.requireData && (data === null || data === undefined)) {
    throw new Error(`[stage3c:auth:${label}] missing expected data`);
  }
  return data;
}

export type CleanupFailure = { label: string; message: string };

/**
 * Await a cleanup operation (Supabase query builder OR auth-admin call OR
 * plain promise), inspect its `.error` when present, and append a labeled
 * failure to `sink` instead of throwing. Also handles genuinely thrown
 * exceptions so remaining cleanup continues.
 */
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
        sink.push({ label, message: extractErrorMessage(err) });
      }
    }
  } catch (e) {
    sink.push({ label, message: extractErrorMessage(e) });
  }
}

/**
 * Combine collected cleanup failures into one readable error message. Never
 * leaks secrets — only the labels + Supabase error messages provided by the
 * server are included.
 */
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
  return { url, serviceRoleKey, publishableKey };
}

// ---------------------------------------------------------------------------
// Tracking
// ---------------------------------------------------------------------------

export type FlatResidentKey = { flat_id: string; user_id: string };
export type UserRoleKey = { user_id: string; role: string; society_id: string };
export type ReceiptSequenceKey = { society_id: string; year_month: number };
export type FixtureAuditSelector = { society_id: string };

export type TrackedIds = {
  authUserIds: string[];
  societyIds: string[];
  userRoles: UserRoleKey[];
  /** Exact user_roles row PKs — used for scoped deletion. */
  userRoleIds: string[];
  /** Exact user_role_block_scopes row PKs. */
  userRoleBlockScopeIds: string[];
  blockIds: string[];
  flatIds: string[];
  flatResidents: FlatResidentKey[];
  /** Exact flat_residents row PKs — used for scoped deletion. */
  flatResidentIds: string[];
  billIds: string[];
  billLineItemIds: string[];
  paymentIds: string[];
  paymentReceiptIds: string[];
  receiptSequences: ReceiptSequenceKey[];
  auditSelectors: FixtureAuditSelector[];
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
  };
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
  tracked: TrackedIds;
  helpers: ScenarioHelpers;
  /** Back-compat convenience aliases used by existing consumers. */
  openBillId: string;
  openBillId2: string;
  cancelledBillId: string;
  cleanup: () => Promise<void>;
};

export type ScenarioHelpers = {
  submitAdminCashPayment(input: SubmitAdminInput): Promise<string>;
  submitAdminBankTransferPayment(input: SubmitAdminInput): Promise<string>;
  submitResidentBankTransferPayment(input: SubmitResidentInput): Promise<string>;
  verifyPayment(actor: SyntheticUser, paymentId: string, notes?: string): Promise<void>;
  rejectPayment(actor: SyntheticUser, paymentId: string, reason: string): Promise<void>;
  reversePayment(actor: SyntheticUser, paymentId: string, reason: string): Promise<void>;
  getBillSummary(actor: SyntheticUser, billId: string): Promise<unknown>;
  getPaymentDetail(actor: SyntheticUser, paymentId: string): Promise<unknown>;
  getResidentPaymentHistory(actor: SyntheticUser): Promise<unknown>;
  searchOpenBills(actor: SyntheticUser, societyId: string, query?: string): Promise<unknown>;
  countPayments(billId: string): Promise<number>;
  countReceipts(paymentId: string): Promise<number>;
};

export type SubmitAdminInput = {
  actor: SyntheticUser;
  billId: string;
  amount: number;
  paymentDate: string; // yyyy-mm-dd
  referenceNo?: string;
  notes?: string;
  idempotencyKey: string;
};

export type SubmitResidentInput = Omit<SubmitAdminInput, "referenceNo"> & {
  referenceNo: string; // bank transfers require a reference
};

// ---------------------------------------------------------------------------
// Internal helpers
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
    throw new Error(`[stage3c:signIn:${slug}] ${extractErrorMessage(signIn.error)}`);
  }
  return { id: user.id, email, password, client };
}

function buildScenarioHelpers(admin: SupabaseClient): ScenarioHelpers {
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
      if (error) throw new Error(`[stage3c:submitAdminCash] ${extractErrorMessage(error)}`);
      return extractRpcId(data);
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
      if (error) throw new Error(`[stage3c:submitAdminBank] ${extractErrorMessage(error)}`);
      return extractRpcId(data);
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
      if (error) throw new Error(`[stage3c:submitResidentBank] ${extractErrorMessage(error)}`);
      return extractRpcId(data);
    },
    async verifyPayment(actor, paymentId, notes) {
      const { error } = await actor.client.rpc("verify_offline_payment", {
        _payment_id: paymentId,
        _notes: notes ?? null,
      });
      if (error) throw new Error(`[stage3c:verify] ${extractErrorMessage(error)}`);
    },
    async rejectPayment(actor, paymentId, reason) {
      const { error } = await actor.client.rpc("reject_offline_payment", {
        _payment_id: paymentId,
        _reason: reason,
      });
      if (error) throw new Error(`[stage3c:reject] ${extractErrorMessage(error)}`);
    },
    async reversePayment(actor, paymentId, reason) {
      const { error } = await actor.client.rpc("reverse_offline_payment", {
        _payment_id: paymentId,
        _reason: reason,
      });
      if (error) throw new Error(`[stage3c:reverse] ${extractErrorMessage(error)}`);
    },
    async getBillSummary(actor, billId) {
      const { data, error } = await actor.client.rpc("get_bill_payment_summary", {
        _bill_id: billId,
      });
      if (error) throw new Error(`[stage3c:getBillSummary] ${extractErrorMessage(error)}`);
      return data;
    },
    async getPaymentDetail(actor, paymentId) {
      const { data, error } = await actor.client.rpc("get_payment_detail", {
        _payment_id: paymentId,
      });
      if (error) throw new Error(`[stage3c:getPaymentDetail] ${extractErrorMessage(error)}`);
      return data;
    },
    async getResidentPaymentHistory(actor) {
      // `get_resident_payments_v1` requires _limit and _offset (see types.ts).
      const { data, error } = await actor.client.rpc("get_resident_payments_v1", {
        _limit: 50,
        _offset: 0,
      });
      if (error) throw new Error(`[stage3c:getResidentPayments] ${extractErrorMessage(error)}`);
      return data;
    },
    async searchOpenBills(actor, societyId, query) {
      const { data, error } = await actor.client.rpc("search_society_open_bills", {
        _society_id: societyId,
        _query: query ?? "",
        _limit: 25,
        _offset: 0,
      });
      if (error) throw new Error(`[stage3c:searchOpenBills] ${extractErrorMessage(error)}`);
      return data;
    },
    async countPayments(billId) {
      const { count, error } = await admin
        .from("payments")
        .select("*", { count: "exact", head: true })
        .eq("bill_id", billId);
      if (error) throw new Error(`[stage3c:countPayments] ${extractErrorMessage(error)}`);
      return count ?? 0;
    },
    async countReceipts(paymentId) {
      const { count, error } = await admin
        .from("payment_receipts")
        .select("*", { count: "exact", head: true })
        .eq("payment_id", paymentId);
      if (error) throw new Error(`[stage3c:countReceipts] ${extractErrorMessage(error)}`);
      return count ?? 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Post-cleanup verification
// ---------------------------------------------------------------------------

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
    if (ids.length === 0) return;
    const { data, error } = await admin.from(table).select(column).in(column, ids).limit(1);
    if (error) {
      sink.push({ label: `verify:${label}`, message: extractErrorMessage(error) });
      return;
    }
    if ((data ?? []).length > 0) {
      sink.push({
        label: `verify:${label}`,
        message: `${(data ?? []).length} tracked ${table} row(s) remain`,
      });
    }
  };
  await check("payment_receipts", "payment_receipts", "id", tracked.paymentReceiptIds);
  await check("payments", "payments", "id", tracked.paymentIds);
  await check("bill_line_items", "bill_line_items", "id", tracked.billLineItemIds);
  await check("bills", "bills", "id", tracked.billIds);
  await check("flats", "flats", "id", tracked.flatIds);
  await check("blocks", "blocks", "id", tracked.blockIds);
  await check("societies", "societies", "id", tracked.societyIds);

  if (tracked.flatResidents.length > 0) {
    const flatIds = Array.from(new Set(tracked.flatResidents.map((k) => k.flat_id)));
    const { data, error } = await admin
      .from("flat_residents")
      .select("flat_id")
      .in("flat_id", flatIds)
      .limit(1);
    if (error) sink.push({ label: "verify:flat_residents", message: extractErrorMessage(error) });
    else if ((data ?? []).length > 0)
      sink.push({ label: "verify:flat_residents", message: "flat_residents remain" });
  }

  if (tracked.userRoles.length > 0) {
    const userIds = Array.from(new Set(tracked.userRoles.map((k) => k.user_id)));
    const { data, error } = await admin
      .from("user_roles")
      .select("user_id")
      .in("user_id", userIds)
      .limit(1);
    if (error) sink.push({ label: "verify:user_roles", message: extractErrorMessage(error) });
    else if ((data ?? []).length > 0)
      sink.push({ label: "verify:user_roles", message: "user_roles remain" });
  }

  if (tracked.receiptSequences.length > 0) {
    const societyIds = Array.from(new Set(tracked.receiptSequences.map((k) => k.society_id)));
    const { data, error } = await admin
      .from("payment_receipt_month_sequences")
      .select("society_id")
      .in("society_id", societyIds)
      .limit(1);
    if (error)
      sink.push({ label: "verify:receipt_sequences", message: extractErrorMessage(error) });
    else if ((data ?? []).length > 0)
      sink.push({
        label: "verify:receipt_sequences",
        message: "receipt sequence rows remain",
      });
  }

  if (tracked.auditSelectors.length > 0) {
    const societyIds = Array.from(new Set(tracked.auditSelectors.map((s) => s.society_id)));
    const { data, error } = await admin
      .from("audit_log")
      .select("id")
      .in("society_id", societyIds)
      .limit(1);
    if (error) sink.push({ label: "verify:audit_log", message: extractErrorMessage(error) });
    else if ((data ?? []).length > 0)
      sink.push({ label: "verify:audit_log", message: "fixture audit rows remain" });
  }
}

export async function verifySyntheticUsersAbsent(
  admin: SupabaseClient,
  userIds: string[],
  sink: CleanupFailure[],
): Promise<void> {
  for (const uid of userIds) {
    const { data, error } = await admin.auth.admin.getUserById(uid);
    if (error) {
      // A 404-style error is expected once deleted; only treat other errors as failures.
      const msg = extractErrorMessage(error).toLowerCase();
      if (!msg.includes("not found") && !msg.includes("user not found")) {
        sink.push({ label: `verify:auth:${uid}`, message: extractErrorMessage(error) });
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
  } else if (tracked.flatResidents.length) {
    // Fallback for older callers that only tracked composite keys.
    const flatIds = Array.from(new Set(tracked.flatResidents.map((k) => k.flat_id)));
    await collectCleanupResult(
      "delete:flat_residents",
      admin.from("flat_residents").delete().in("flat_id", flatIds),
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
  } else if (tracked.userRoles.length) {
    const societyIds = Array.from(new Set(tracked.userRoles.map((k) => k.society_id)));
    await collectCleanupResult(
      "delete:user_roles",
      admin.from("user_roles").delete().in("society_id", societyIds),
      fails,
    );
  }
  if (tracked.receiptSequences.length) {
    const societyIds = Array.from(new Set(tracked.receiptSequences.map((k) => k.society_id)));
    await collectCleanupResult(
      "delete:payment_receipt_month_sequences",
      admin.from("payment_receipt_month_sequences").delete().in("society_id", societyIds),
      fails,
    );
    await collectCleanupResult(
      "delete:payment_receipt_sequences",
      admin.from("payment_receipt_sequences").delete().in("society_id", societyIds),
      fails,
    );
  }
  if (tracked.auditSelectors.length) {
    const societyIds = Array.from(new Set(tracked.auditSelectors.map((s) => s.society_id)));
    await collectCleanupResult(
      "delete:audit_log",
      admin.from("audit_log").delete().in("society_id", societyIds),
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
      message: extractErrorMessage(remainingSocieties.error),
    });
  } else if ((remainingSocieties.data ?? []).length > 0) {
    fails.push({
      label: "verify:prefix_societies",
      message: `fixture prefix ${prefix} still has ${remainingSocieties.data?.length ?? 0} societies`,
    });
  }

  await verifyTrackedRowsAbsent(admin, tracked, fails);
  await verifySyntheticUsersAbsent(admin, tracked.authUserIds, fails);

  if (fails.length > 0) {
    throw new Error(formatCleanupFailures(fails));
  }
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Provision a full Stage 3C fixture graph. Every mutation checks `.error`
 * and every created row is tracked for strict teardown. If setup fails
 * halfway, tracked rows are cleaned up before the original error is
 * rethrown.
 */
export async function setupStage3CFixture(): Promise<Stage3CFixture> {
  const env = requireStage3CEnv();
  const prefix = makePrefix();
  const admin = createClient(env.url, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const tracked = makeTracker();

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
        })
        .select("id")
        .single(),
    );
    tracked.societyIds.push(sA.id);
    const societyA = sA.id;
    tracked.auditSelectors.push({ society_id: societyA });

    // Society B uses serial structure — block_id null on flats.
    const sB = await assertSupabaseSingleResult<{ id: string }>(
      "insert:societyB",
      admin
        .from("societies")
        .insert({
          name: `${prefix}-B`,
          status: "active",
          plan: "basic",
          layout: "serial",
        })
        .select("id")
        .single(),
    );
    tracked.societyIds.push(sB.id);
    const societyB = sB.id;
    tracked.auditSelectors.push({ society_id: societyB });

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
    // Note: unrelatedResident is a resident of SOCIETY B, not A.
    const roleRows = [
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
    await assertSupabaseResult("insert:user_roles", admin.from("user_roles").insert(roleRows));
    for (const r of roleRows) {
      tracked.userRoles.push({
        user_id: r.user_id,
        role: r.role,
        society_id: r.society_id,
      });
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
    await assertSupabaseResult(
      "insert:flat_residents",
      admin.from("flat_residents").insert(residencyRows),
    );
    for (const r of residencyRows) {
      tracked.flatResidents.push({ flat_id: r.flat_id, user_id: r.user_id });
    }

    // ---- Bills --------------------------------------------------------
    async function addBill(
      label: string,
      amount: number,
      status: string,
      extra: Record<string, unknown> = {},
    ): Promise<string> {
      const row = await assertSupabaseSingleResult<{ id: string }>(
        `insert:bill:${label}`,
        admin
          .from("bills")
          .insert({
            society_id: societyA,
            flat_id: flatA,
            period_label: label,
            period_start: "2026-01-01",
            period_end: "2026-01-31",
            amount,
            total_payable: amount,
            due_date: "2026-02-15",
            status,
            bill_number: `RR/${prefix}/${label}`,
            finalized_at: new Date().toISOString(),
            ...extra,
          })
          .select("id")
          .single(),
      );
      tracked.billIds.push(row.id);
      return row.id;
    }

    const openBillId = await addBill("open1", 1000, "unpaid");
    const openBillId2 = await addBill("open2", 750, "unpaid");
    const fullyUnavailableBillId = await addBill("full", 500, "unpaid");
    const cancelledBillId = await addBill("canc", 500, "cancelled", {
      cancelled_at: new Date().toISOString(),
      cancelled_by: adminA1.id,
      cancel_reason: "test",
    });

    // ---- Financial scenarios via canonical RPCs ----------------------
    // The helpers below drive real business operations against the
    // authenticated user clients. Any RPC failure aborts setup and
    // triggers strict cleanup via the outer try/catch.
    const helpers = buildScenarioHelpers(admin);

    // Track receipt sequence rows for both societies (RPCs create these).
    tracked.receiptSequences.push({
      society_id: societyA,
      year_month: Number(
        `${new Date().getUTCFullYear()}${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`,
      ),
    });

    // (2) Pending admin Cash payment on openBillId
    const pendingAdminCashPaymentId = await helpers.submitAdminCashPayment({
      actor: adminA1,
      billId: openBillId,
      amount: 200,
      paymentDate: "2026-02-01",
      idempotencyKey: `${prefix}-adm-cash`,
      notes: "fixture pending cash",
    });
    if (pendingAdminCashPaymentId) tracked.paymentIds.push(pendingAdminCashPaymentId);

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
    if (pendingResidentBankTransferPaymentId)
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
    if (verifiedPaymentId) tracked.paymentIds.push(verifiedPaymentId);
    await helpers.verifyPayment(adminA2, verifiedPaymentId, "fixture verify");

    const verifiedReceiptRow = await assertSupabaseSingleResult<{ id: string }>(
      "select:verifiedReceipt",
      admin
        .from("payment_receipts")
        .select("id")
        .eq("payment_id", verifiedPaymentId)
        .single(),
    );
    tracked.paymentReceiptIds.push(verifiedReceiptRow.id);

    // (5) Rejected payment (submit then reject) on openBillId
    const rejectedPaymentId = await helpers.submitAdminCashPayment({
      actor: adminA1,
      billId: openBillId,
      amount: 50,
      paymentDate: "2026-02-01",
      idempotencyKey: `${prefix}-adm-rej`,
    });
    if (rejectedPaymentId) tracked.paymentIds.push(rejectedPaymentId);
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
    if (reversedPaymentId) tracked.paymentIds.push(reversedPaymentId);
    await helpers.verifyPayment(adminA2, reversedPaymentId, "fixture pre-reverse");
    const voidReceiptRow = await assertSupabaseSingleResult<{ id: string }>(
      "select:voidReceipt",
      admin
        .from("payment_receipts")
        .select("id")
        .eq("payment_id", reversedPaymentId)
        .single(),
    );
    tracked.paymentReceiptIds.push(voidReceiptRow.id);
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
      tracked,
      helpers,
      openBillId,
      openBillId2,
      cancelledBillId,
      cleanup: () => strictCleanup(admin, prefix, tracked),
    };
  } catch (setupError) {
    // Partial-setup failure: run strict cleanup, then rethrow a combined error.
    let cleanupMessage = "";
    try {
      await strictCleanup(admin, prefix, tracked);
    } catch (cleanupError) {
      cleanupMessage = extractErrorMessage(cleanupError);
    }
    const setupMsg = extractErrorMessage(setupError);
    if (cleanupMessage) {
      throw new Error(
        `[stage3c:setup] ${setupMsg}\n[stage3c:setup:cleanup] ${cleanupMessage}`,
      );
    }
    throw new Error(`[stage3c:setup] ${setupMsg}`);
  }
}
