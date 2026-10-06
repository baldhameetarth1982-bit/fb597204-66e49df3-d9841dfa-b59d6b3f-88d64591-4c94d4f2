/**
 * Human-readable labels for No-Dues blockers, statuses, and audit actions.
 * Keeps raw internal identifiers out of the UI.
 */
import type { EligibilityBlocker } from "./no-dues.functions";
import i18n, { localeTag } from "./i18n";

const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;
/** Display-only dates in the chosen language; stored values are never changed. */
export const ndDate = (v: string | number | Date) => new Date(v).toLocaleDateString(localeTag(), { numberingSystem: "latn" } as Intl.DateTimeFormatOptions);
export const ndDateTime = (v: string | number | Date) => new Date(v).toLocaleString(localeTag(), { numberingSystem: "latn" } as Intl.DateTimeFormatOptions);

export function formatCurrency(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  if (!isFinite(v)) return "₹0";
  return `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case "submitted": return t("nd.st.submitted");
    case "under_review": return t("nd.st.under_review");
    case "approved": return t("nd.st.approved");
    case "issued": return t("nd.st.issued");
    case "rejected": return t("nd.st.rejected");
    case "revoked": return t("nd.st.revoked");
    case "blocked_by_dues": return t("nd.st.blocked_by_dues");
    default: return status ?? "—";
  }
}

export function statusExplanation(status: string | null | undefined): string {
  switch (status) {
    case "submitted": return t("nd.ex.submitted");
    case "under_review": return t("nd.ex.under_review");
    case "approved": return t("nd.ex.approved");
    case "issued": return t("nd.ex.issued");
    case "rejected": return t("nd.ex.rejected");
    case "revoked": return t("nd.ex.revoked");
    case "blocked_by_dues": return t("nd.ex.blocked_by_dues");
    default: return "";
  }
}

export function auditActionLabel(action: string | null | undefined): string {
  switch (action) {
    case "submit": return t("nd.au.submit");
    case "approve": return t("nd.au.approve");
    case "reject": return t("nd.au.reject");
    case "issue": return t("nd.au.issue");
    case "revoke": return t("nd.au.revoke");
    case "finalize_blocked": return t("nd.au.finalize_blocked");
    case "auto_block": return t("nd.au.auto_block");
    default: return action ?? "—";
  }
}

export function blockerTitle(b: EligibilityBlocker): string {
  switch (b.type) {
    case "bill_due": {
      if (b.overdue) return t("nd.bl.overdue");
      if (b.payment_state === "partial") return t("nd.bl.partial");
      return t("nd.bl.unpaid");
    }
    case "pending_offline_payment":
      return b.method === "cash" ? t("nd.bl.cash") : t("nd.bl.offline");
    case "financial_data_inconsistency":
      return t("nd.bl.inconsistent");
    case "opening_balance_due":
      return t("nd.bl.ob");
    case "opening_balance_under_review":
      return t("nd.bl.obReview");
    default:
      return t("nd.bl.other");
  }
}

export function blockerSubtitle(b: EligibilityBlocker): string {
  const parts: string[] = [];
  if (b.bill_number) parts.push(t("nd.bl.bill", { n: b.bill_number }));
  if (b.due_date) parts.push(t("nd.bl.due", { d: ndDate(b.due_date) }));
  if (b.remaining_amount != null && b.type !== "opening_balance_under_review") parts.push(formatCurrency(b.remaining_amount));
  if (b.type === "pending_offline_payment" && b.amount != null) parts.push(formatCurrency(b.amount));
  return parts.join(" · ");
}

export function blockerResolution(b: EligibilityBlocker): string {
  switch (b.type) {
    case "bill_due":
      return b.overdue
        ? t("nd.rs.overdue")
        : t("nd.rs.bill");
    case "pending_offline_payment":
      return t("nd.rs.offline");
    case "financial_data_inconsistency":
      return t("nd.rs.inconsistent");
    case "opening_balance_due":
      return t("nd.rs.ob");
    case "opening_balance_under_review":
      return t("nd.rs.obReview");
    default:
      return "";
  }
}
