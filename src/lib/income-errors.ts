/**
 * Stage 1D — typed error contract for Non-Member Income surfaces.
 *
 * UI code MUST map any thrown Error.message to one of these codes via
 * `mapIncomeError` before rendering. Raw Postgres / Supabase / constraint
 * text must never reach the user.
 *
 * Stage 1D correctness pass: also exports the strict discriminated
 * `CreateIncomeResult` contract, a Zod parser that never leaks DB text,
 * and a canonical payload-hash helper used to detect
 * same-key/different-payload idempotency conflicts.
 */
import { z } from "zod";

export const INCOME_ERROR_CODES = [
  "success",
  "duplicate_request",
  "duplicate_category",
  "category_inactive",
  "payer_inactive",
  "invalid_input",
  "plan_required",
  "not_authorized",
  "not_found",
  "idempotency_conflict",
  "temporary_error",
] as const;

export type IncomeErrorCode = (typeof INCOME_ERROR_CODES)[number];

/** Server error `message` strings → typed UI code. Unknowns collapse to
 * `temporary_error` so DB text, constraint names, and stack traces cannot
 * leak into the UI. */
export function mapIncomeError(raw: unknown): IncomeErrorCode {
  const msg = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  switch (msg) {
    case "duplicate_category_key":
      return "duplicate_category";
    case "category_inactive":
    case "category_society_mismatch":
      return "category_inactive";
    case "payer_inactive":
    case "payer_society_mismatch":
      return "payer_inactive";
    case "forbidden_plan":
      return "plan_required";
    case "forbidden_society":
    case "invalid_transition":
      return "not_authorized";
    case "not_found":
      return "not_found";
    case "duplicate_request":
      return "duplicate_request";
    case "idempotency_conflict":
      return "idempotency_conflict";
    case "":
      return "temporary_error";
    default:
      return "temporary_error";
  }
}

export const INCOME_ERROR_MESSAGES: Record<IncomeErrorCode, string> = {
  success: "",
  duplicate_request: "This income was already recorded.",
  duplicate_category: "A category with this key already exists.",
  category_inactive: "That category is inactive. Pick an active category.",
  payer_inactive: "That payer is inactive. Pick an active payer.",
  invalid_input: "Please check the highlighted fields.",
  plan_required: "This feature requires the Pro or Premium plan.",
  not_authorized: "You don't have permission for this action.",
  not_found: "That record no longer exists.",
  idempotency_conflict:
    "This entry was changed after being reviewed. Start over to record it.",
  temporary_error: "Something went wrong. Please try again.",
};

export function friendlyIncomeError(raw: unknown): string {
  return INCOME_ERROR_MESSAGES[mapIncomeError(raw)];
}

// ---------------------------------------------------------------------------
// Stage 1D — strict discriminated result contract for record creation.
// ---------------------------------------------------------------------------

const UuidSchema = z.string().uuid();

export const CreateIncomeResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("created"), id: UuidSchema, idempotent: z.literal(false) }).strict(),
  z.object({ status: z.literal("existing"), id: UuidSchema, idempotent: z.literal(true) }).strict(),
  z.object({ status: z.literal("idempotency_conflict") }).strict(),
  z.object({ status: z.literal("category_inactive") }).strict(),
  z.object({ status: z.literal("payer_inactive") }).strict(),
  z.object({ status: z.literal("invalid_input") }).strict(),
  z.object({ status: z.literal("plan_required") }).strict(),
  z.object({ status: z.literal("not_authorized") }).strict(),
  z.object({ status: z.literal("temporary_error") }).strict(),
]);

export type CreateIncomeResult = z.infer<typeof CreateIncomeResultSchema>;

/** Parses an unknown server payload into a strict result. Any unknown
 * fields, malformed shape, missing status, or non-UUID id collapses to
 * `temporary_error` — DB text and constraint names cannot escape. */
export function parseCreateIncomeResult(raw: unknown): CreateIncomeResult {
  const r = CreateIncomeResultSchema.safeParse(raw);
  return r.success ? r.data : { status: "temporary_error" };
}

// ---------------------------------------------------------------------------
// Stage 1D — UI-ONLY canonical fingerprint helpers.
//
// These helpers are NOT authoritative. The SQL RPC
// `public.create_non_member_income_record` derives its own canonical JSON
// from the actual normalized values it stores and computes the SHA-256
// hash server-side. The caller MUST NOT pass canonical JSON or a payload
// hash to the RPC — the RPC signature no longer accepts them.
//
// These helpers exist only for deterministic non-authoritative UI
// fingerprints (dedupe hints, dev diagnostics). Do not send their output
// to the server.
// ---------------------------------------------------------------------------

export interface CanonicalCreatePayload {
  societyId: string;
  category_id: string;
  payer_kind: "resident" | "non_member" | "anonymous";
  resident_user_id?: string | null;
  non_member_payer_id?: string | null;
  amount: number | string;
  payment_method: string;
  payment_date?: string | null;
  reference_number?: string | null;
  description?: string | null;
}

function normDate(d?: string | null): string {
  if (!d) return "";
  return d.slice(0, 10);
}
function normText(s?: string | null): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}
function normAmount(a: number | string): string {
  const n = typeof a === "string" ? Number(a) : a;
  if (!Number.isFinite(n)) return "NaN";
  return n.toFixed(2);
}

/** UI-only deterministic canonical string. NOT the authoritative canonical
 * data — the server RPC rebuilds its own JSON from normalized stored
 * values. Never pass this to the RPC. */
export function canonicalCreatePayload(p: CanonicalCreatePayload): string {
  const canon = {
    society_id: p.societyId,
    category_id: p.category_id,
    payer_kind: p.payer_kind,
    resident_user_id: p.resident_user_id ?? null,
    non_member_payer_id: p.non_member_payer_id ?? null,
    amount: normAmount(p.amount),
    payment_method: p.payment_method,
    payment_date: normDate(p.payment_date ?? null),
    reference_number: normText(p.reference_number),
    description: normText(p.description),
  };
  return JSON.stringify(canon);
}

/** UI-only SHA-256 hash for local dedupe hints / dev diagnostics. Fails
 * closed and never uses a non-cryptographic fallback. The authoritative
 * financial hash is computed by the SQL RPC. */
export async function hashCreatePayload(
  p: CanonicalCreatePayload,
): Promise<string | null> {

  const canon = canonicalCreatePayload(p);
  const g = globalThis as unknown as { crypto?: { subtle?: SubtleCrypto } };
  if (!g.crypto?.subtle) return null;
  const buf = new TextEncoder().encode(canon);
  const digest = await g.crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Returns a secure v4 UUID or `null` when the runtime cannot generate
 * one securely. Callers MUST refuse to enter Review / submit when null. */
export function secureRequestUuid(): string | null {
  const g = globalThis as unknown as { crypto?: Crypto };
  if (g.crypto && typeof g.crypto.randomUUID === "function") {
    return g.crypto.randomUUID();
  }
  return null;
}
