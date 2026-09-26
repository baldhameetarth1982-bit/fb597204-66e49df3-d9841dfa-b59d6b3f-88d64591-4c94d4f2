/**
 * Turns any thrown value into text that is safe to show in a toast.
 * Intentional, human-readable server messages pass through; database,
 * network and stack details are replaced with a calm fallback so table,
 * column, function, constraint or token details never reach the screen.
 */
const TECHNICAL =
  /violates|constraint|relation "|column "|function |does not exist|duplicate key|syntax error|permission denied for|row-level security|jwt|pgrst|sqlstate|null value|invalid input syntax|\bat [\w.$]+ \(|[0-9a-f]{8}-[0-9a-f]{4}-|[{}<>]|https?:\/\//i;
const NETWORK = /failed to fetch|networkerror|network request failed|load failed/i;

export function userMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && typeof (err as { message?: unknown }).message === "string"
        ? (err as { message: string }).message
        : "";
  const text = raw.trim();
  if (!text) return fallback;
  if (NETWORK.test(text)) return "You appear to be offline. Check your connection and try again.";
  if (text.length > 160 || TECHNICAL.test(text)) return fallback;
  return text;
}
