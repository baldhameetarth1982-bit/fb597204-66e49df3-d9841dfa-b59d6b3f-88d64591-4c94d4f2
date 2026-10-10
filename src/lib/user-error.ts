import i18n from "@/lib/i18n";

/**
 * Turns any thrown value into text that is safe to show in a toast.
 * Intentional, human-readable server messages pass through; database,
 * network and stack details are replaced with a calm fallback so table,
 * column, function, constraint or token details never reach the screen.
 */
const TECHNICAL =
  /violates|constraint|relation "|column "|function |does not exist|duplicate key|syntax error|permission denied for|row-level security|jwt|pgrst|sqlstate|null value|invalid input syntax|\bat [\w.$]+ \(|[0-9a-f]{8}-[0-9a-f]{4}-|[{}<>]|https?:\/\//i;
const NETWORK = /failed to fetch|networkerror|network request failed|load failed/i;

export function userMessage(err: unknown, fallback?: string): string {
  fallback ??= i18n.t("errors.generic");
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : "";
  const text = raw.trim();
  if (!text) return fallback;
  if (NETWORK.test(text)) return i18n.t("errors.offline");
  // Known server rule codes get a plain, translated explanation.
  if (/flat_capacity_reached/.test(text)) return i18n.t("ln.err.flatLimit");
  if (/duplicate_bill_for_period/.test(text)) return i18n.t("ln.err.dupBill");
  if (text.length > 160 || TECHNICAL.test(text)) return fallback;
  return text;
}
