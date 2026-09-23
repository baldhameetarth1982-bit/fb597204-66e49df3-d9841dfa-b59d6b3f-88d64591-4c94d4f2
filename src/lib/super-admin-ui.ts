/** Client-safe display helpers for Super Admin SaaS operations. */
export type SaasTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface SaasState {
  key: "suspended" | "active" | "trial" | "trial_ending" | "trial_expired" | "plan_expired" | "setup";
  label: string;
  tone: SaasTone;
  detail: string | null;
}

const DAY = 86_400_000;
const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/** Single derived subscription state shown everywhere in Super Admin. */
export function saasState(s: {
  status: string | null;
  plan_status: string | null;
  plan_expires_at: string | null;
  trial_ends_at: string | null;
}): SaasState {
  const now = Date.now();
  if (s.status === "suspended") return { key: "suspended", label: "Suspended", tone: "danger", detail: null };
  const ps = (s.plan_status ?? "").toLowerCase();
  if (ps === "active") {
    if (s.plan_expires_at && new Date(s.plan_expires_at).getTime() < now)
      return { key: "plan_expired", label: "Plan expired", tone: "warning", detail: `Expired ${fmt(s.plan_expires_at)}` };
    return { key: "active", label: "Paid", tone: "success", detail: s.plan_expires_at ? `Renews ${fmt(s.plan_expires_at)}` : null };
  }
  if (ps === "trial" || ps === "trialing") {
    if (!s.trial_ends_at || new Date(s.trial_ends_at).getTime() <= now)
      return { key: "trial_expired", label: "Trial ended", tone: "warning", detail: s.trial_ends_at ? `Ended ${fmt(s.trial_ends_at)}` : null };
    const days = Math.ceil((new Date(s.trial_ends_at).getTime() - now) / DAY);
    return days <= 3
      ? { key: "trial_ending", label: `Trial · ${days}d left`, tone: "warning", detail: `Ends ${fmt(s.trial_ends_at)}` }
      : { key: "trial", label: `Trial · ${days}d left`, tone: "info", detail: `Ends ${fmt(s.trial_ends_at)}` };
  }
  if (ps === "expired" || ps === "cancelled" || ps === "canceled" || ps === "past_due")
    return { key: "plan_expired", label: ps === "past_due" ? "Payment due" : "Plan expired", tone: "warning", detail: null };
  return { key: "setup", label: "No plan yet", tone: "neutral", detail: null };
}

export const PLAN_NAME: Record<string, string> = { trial: "Trial", basic: "Basic", pro: "Pro", premium: "Premium" };
export const planName = (id: string | null) => (id ? PLAN_NAME[id] ?? id : "—");
export { fmt as fmtDate };

export const ACTION_MESSAGES: Record<string, string> = {
  not_authorized: "Only Super Admins can do this.",
  not_found: "This society no longer exists.",
  invalid_input: "Check the values and try again.",
  reason_required: "Add a short reason (at least 3 characters).",
  already_paid: "This society already has a paid plan — grant or extend the plan instead.",
  unchanged: "Nothing changed — the society is already in that state.",
};

export function humanAction(a: string): string {
  const map: Record<string, string> = {
    "super_admin.plan_granted": "Plan granted by Super Admin",
    "super_admin.trial_extended": "Trial extended by Super Admin",
    "super_admin.society_suspended": "Society suspended",
    "super_admin.society_active": "Society restored",
  };
  return map[a] ?? a.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
