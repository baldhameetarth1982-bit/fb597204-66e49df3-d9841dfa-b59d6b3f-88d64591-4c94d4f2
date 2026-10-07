import { toast } from "sonner";
import i18n from "@/lib/i18n";

/**
 * Last-line safety net for error pop-ups: many screens pass a server error's
 * text straight to toast.error. Human messages pass through unchanged; text
 * that looks like database/RPC/stack detail is replaced with the generic
 * localized message so internals never reach the screen.
 */
const TECHNICAL =
  /violates|constraint|relation "|column "|function [\w.]+\(|does not exist|duplicate key|syntax error|permission denied for|row-level security|\bjwt\b|pgrst|sqlstate|null value|invalid input syntax|\bat [\w.$]+ \(|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i;

let installed = false;
export function installToastGuard() {
  if (installed) return;
  installed = true;
  const original = toast.error;
  (toast as { error: typeof toast.error }).error = ((message, data) => {
    const safe =
      typeof message === "string" && TECHNICAL.test(message) ? (i18n.t("errors.generic") as string) : message;
    return original(safe, data);
  }) as typeof toast.error;
}
