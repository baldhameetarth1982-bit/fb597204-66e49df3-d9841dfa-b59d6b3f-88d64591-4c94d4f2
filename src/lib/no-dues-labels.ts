/**
 * Human-readable labels for No-Dues blockers, statuses, and audit actions.
 * Keeps raw internal identifiers out of the UI.
 */
import type { EligibilityBlocker } from "./no-dues.functions";

export function formatCurrency(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "₹0";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case "submitted": return "Submitted";
    case "under_review": return "Under review";
    case "approved": return "Approved";
    case "issued": return "Issued";
    case "rejected": return "Rejected";
    case "revoked": return "Revoked";
    case "blocked_by_dues": return "Blocked — dues pending";
    default: return status ?? "—";
  }
}

export function statusExplanation(status: string | null | undefined): string {
  switch (status) {
    case "submitted": return "Your request is waiting for society admin review.";
    case "under_review": return "The society is reviewing your request.";
    case "approved": return "Approved. Your certificate will be issued shortly.";
    case "issued": return "Your certificate has been issued. You can download it below.";
    case "rejected": return "Your request was rejected. See the reason below.";
    case "revoked": return "This certificate has been revoked and is no longer valid.";
    case "blocked_by_dues":
      return "Some dues or pending payments are blocking this request. Clear them and submit again.";
    default: return "";
  }
}

export function auditActionLabel(action: string | null | undefined): string {
  switch (action) {
    case "submit": return "Submitted";
    case "approve": return "Approved";
    case "reject": return "Rejected";
    case "issue": return "Certificate issued";
    case "revoke": return "Certificate revoked";
    case "finalize_blocked": return "Blocked — new dues detected";
    case "auto_block": return "Auto-blocked";
    default: return action ?? "—";
  }
}

export function blockerTitle(b: EligibilityBlocker): string {
  switch (b.type) {
    case "bill_due": {
      if (b.overdue) return "Overdue bill";
      if (b.payment_state === "partial") return "Partially paid bill";
      return "Unpaid bill";
    }
    case "pending_offline_payment":
      return b.method === "cash" ? "Cash payment pending verification" : "Offline payment pending verification";
    case "financial_data_inconsistency":
      return "Payment records need admin review";
    default:
      return "Outstanding item";
  }
}

export function blockerSubtitle(b: EligibilityBlocker): string {
  const parts: string[] = [];
  if (b.bill_number) parts.push(`Bill ${b.bill_number}`);
  if (b.due_date) parts.push(`Due ${new Date(b.due_date).toLocaleDateString()}`);
  if (b.remaining_amount != null) parts.push(formatCurrency(b.remaining_amount));
  if (b.type === "pending_offline_payment" && b.amount != null) parts.push(formatCurrency(b.amount));
  return parts.join(" · ");
}

export function blockerResolution(b: EligibilityBlocker): string {
  switch (b.type) {
    case "bill_due":
      return b.overdue
        ? "Please clear this overdue bill before requesting a No-Dues certificate."
        : "Please settle this bill to proceed.";
    case "pending_offline_payment":
      return "Awaiting society admin to verify your payment. Contact your admin if this has been pending for long.";
    case "financial_data_inconsistency":
      return "This bill's records need administrator review. Please contact your society admin.";
    default:
      return "";
  }
}
