/**
 * Stage 3E — safe financial error presentation.
 *
 * Maps any thrown value to a user-safe category + message. Raw server text is
 * only used for classification and is NEVER returned to the UI, so SQL, table
 * or column names, RPC names, constraint names, stack traces, paths, IDs and
 * secrets can't leak into financial screens.
 */
import i18n from "@/lib/i18n";

export type FinanceErrorKind =
  | "plan_locked"
  | "permission_denied"
  | "not_initialized"
  | "offline"
  | "not_found"
  | "unavailable";

export interface SafeFinanceError {
  kind: FinanceErrorKind;
  title: string;
  message: string;
  retryable: boolean;
}

const RETRYABLE: Record<FinanceErrorKind, boolean> = {
  plan_locked: false,
  permission_denied: false,
  not_initialized: true,
  offline: true,
  not_found: false,
  unavailable: true,
};

/** Copy is resolved at call time so it follows the user's selected language. */
function copyFor(kind: FinanceErrorKind): Omit<SafeFinanceError, "kind"> {
  return {
    title: i18n.t(`financeErr.${kind}.title`),
    message: i18n.t(`financeErr.${kind}.message`),
    retryable: RETRYABLE[kind],
  };
}

function rawText(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === "string" ? m : "";
  }
  return "";
}

export function classifyFinanceError(err: unknown, online = true): FinanceErrorKind {
  if (!online) return "offline";
  const t = rawText(err).toLowerCase();
  if (/pro or premium plan|plan[_ ]locked|upgrade required|not included in (your|the) plan/.test(t)) return "plan_locked";
  if (/accounts are not initialized/.test(t)) return "not_initialized";
  if (/unauthori[sz]ed|not[_ ]authori[sz]ed|forbidden|not allowed|permission denied|access denied|\b401\b|\b403\b/.test(t)) return "permission_denied";
  if (/not[_ ]found|no rows|\b404\b/.test(t)) return "not_found";
  if (/failed to fetch|networkerror|network request failed|load failed/.test(t)) return "offline";
  return "unavailable";
}

export function toSafeFinanceError(err: unknown, online = true): SafeFinanceError {
  const kind = classifyFinanceError(err, online);
  return { kind, ...copyFor(kind) };
}

/**
 * For form actions (e.g. bill creation): keep short, plain validation
 * messages from the server so the user knows what to fix, but replace
 * anything that looks technical (SQL, constraint/table/RPC names, stack
 * traces, IDs) with safe copy.
 */
const TECHNICAL =
  /violates|constraint|relation|column|syntax|function\s+\w+\(|rpc|pgrst|sqlstate|duplicate key|\bat\s+\S+:\d+|stack|[0-9a-f]{8}-[0-9a-f]{4}-|_\w+_|\bnull value\b|jwt|supabase|postgres/i;

/** Known server error codes mapped to translated plain-language copy. */
const CODE_KEYS = new Set([
  "category_exists",
  "invalid_name",
  "invalid_category",
  "income_not_billable",
  "structure_mode_not_configured",
  "document_not_found",
]);

/** Bare snake_case codes (e.g. "category_exists") are internal identifiers. */
const BARE_CODE = /^[a-z]+(?:_[a-z0-9]+)+$/;

export function toSafeFinanceMessage(err: unknown, fallback?: string): string {
  const t = rawText(err).trim();
  if (CODE_KEYS.has(t)) return i18n.t(`financeErr.code.${t}`);
  if (/duplicate_bill_for_period/.test(t)) return i18n.t("ln.err.dupBill");
  if (/flat_capacity_reached/.test(t)) return i18n.t("ln.err.flatLimit");
  const kind = classifyFinanceError(err);
  if (kind !== "unavailable") return copyFor(kind).message;
  if (t && t.length <= 160 && !TECHNICAL.test(t) && !BARE_CODE.test(t)) return t;
  return fallback ?? i18n.t("errors.generic");
}
