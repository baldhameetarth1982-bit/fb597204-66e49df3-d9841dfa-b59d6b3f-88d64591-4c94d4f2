/**
 * Stage 3E — safe financial error presentation.
 *
 * Maps any thrown value to a user-safe category + message. Raw server text is
 * only used for classification and is NEVER returned to the UI, so SQL, table
 * or column names, RPC names, constraint names, stack traces, paths, IDs and
 * secrets can't leak into financial screens.
 */
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

const COPY: Record<FinanceErrorKind, Omit<SafeFinanceError, "kind">> = {
  plan_locked: {
    title: "Available on a higher plan",
    message: "This financial view is included in the Pro or Premium plan.",
    retryable: false,
  },
  permission_denied: {
    title: "Access restricted",
    message: "You don't have permission to view this financial information.",
    retryable: false,
  },
  not_initialized: {
    title: "Accounts not set up yet",
    message: "The society's chart of accounts hasn't been initialized.",
    retryable: true,
  },
  offline: {
    title: "You're offline",
    message: "Reconnect to the internet and try again.",
    retryable: true,
  },
  not_found: {
    title: "Not found",
    message: "This record could not be found or is no longer available.",
    retryable: false,
  },
  unavailable: {
    title: "Couldn't load financial data",
    message: "Something went wrong on our side. Please try again in a moment.",
    retryable: true,
  },
};

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
  if (/unauthori[sz]ed|forbidden|not allowed|permission denied|access denied|\b401\b|\b403\b/.test(t)) return "permission_denied";
  if (/not found|no rows|\b404\b/.test(t)) return "not_found";
  if (/failed to fetch|networkerror|network request failed|load failed/.test(t)) return "offline";
  return "unavailable";
}

export function toSafeFinanceError(err: unknown, online = true): SafeFinanceError {
  const kind = classifyFinanceError(err, online);
  return { kind, ...COPY[kind] };
}
