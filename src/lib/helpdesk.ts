import { supabase } from "@/integrations/supabase/client";
import i18n, { localeTag } from "@/lib/i18n";

const tr = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;

export type TicketCategory = "complaint" | "daily_help" | "maintenance" | "lost_found" | "approval";
export type TicketStatus =
  | "open" | "in_progress" | "awaiting_approval" | "resolved" | "closed" | "rejected" | "cancelled" | "on_hold" | "reopened";
export type TicketPriority = "low" | "normal" | "high" | "urgent";

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  complaint: "Complaint",
  maintenance: "Repair / maintenance",
  daily_help: "Service request",
  lost_found: "Lost & found",
  approval: "Needs committee approval",
};

export const CATEGORY_HINT: Record<TicketCategory, string> = {
  complaint: "Noise, cleanliness, parking, neighbours",
  maintenance: "Lift, plumbing, electrical, common areas",
  daily_help: "Housekeeping, gardener, pest control",
  lost_found: "Report or claim an item",
  approval: "Renovation, event, move-in/out, NOC",
};

export const STATUS_META: Record<TicketStatus, { label: string; tone: string }> = {
  open: { label: "Open", tone: "bg-primary/10 text-primary" },
  in_progress: { label: "In progress", tone: "bg-warning/15 text-warning-foreground" },
  awaiting_approval: { label: "Awaiting approval", tone: "bg-accent text-accent-foreground" },
  resolved: { label: "Resolved", tone: "bg-success/15 text-success" },
  closed: { label: "Closed", tone: "bg-muted text-muted-foreground" },
  rejected: { label: "Rejected", tone: "bg-destructive/10 text-destructive" },
  cancelled: { label: "Cancelled", tone: "bg-muted text-muted-foreground" },
  on_hold: { label: "On hold", tone: "bg-muted text-foreground" },
  reopened: { label: "Reopened", tone: "bg-destructive/10 text-destructive" },
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low", normal: "Normal", high: "High", urgent: "Urgent",
};

const STATUS_KEY: Record<string, string> = { cancelled: "billStatus.cancelled", rejected: "inc.st.rejected" };
/** Translated labels for the current UI language; the English constants above stay as data. */
export const categoryLabel = (c: string) => (c in CATEGORY_LABEL ? tr(`hd.cat.${c}`) : tr("hd.request"));
export const categoryHint = (c: TicketCategory) => tr(`hd.hint.${c}`);
export const priorityLabel = (p: string) => (p === "urgent" ? tr("notif.urgent") : p in PRIORITY_LABEL ? tr(`hd.pr.${p}`) : p);

export const ACTIVE_STATUSES: TicketStatus[] = ["open", "reopened", "in_progress", "on_hold", "awaiting_approval", "resolved"];

/** Server-set SLA due time → plain status. */
export function slaState(dueIso: string | null | undefined, status: string): "overdue" | "due_soon" | null {
  if (!dueIso || !["open", "reopened", "in_progress", "on_hold"].includes(status)) return null;
  const ms = new Date(dueIso).getTime() - Date.now();
  return ms < 0 ? "overdue" : ms < 12 * 3600_000 ? "due_soon" : null;
}

export function statusMeta(s: string) {
  const m = STATUS_META[s as TicketStatus];
  if (!m) return { label: tr("hd.st.updated"), tone: "bg-muted text-muted-foreground" };
  return { ...m, label: tr(STATUS_KEY[s] ?? `hd.st.${s}`) };
}

/** Plain-language messages; raw server text is only used for matching. */
export function helpdeskErrorMessage(err: unknown): string {
  const raw = String((err as { message?: string })?.message ?? err ?? "").toLowerCase();
  if (typeof navigator !== "undefined" && !navigator.onLine) return tr("hd.err.offline");
  if (raw.includes("rate_limited")) return tr("hd.err.rate");
  if (raw.includes("invalid_subject")) return tr("hd.err.subject");
  if (raw.includes("invalid_description")) return tr("hd.err.desc");
  if (raw.includes("reason_required")) return tr("hd.err.reason");
  if (raw.includes("invalid_transition")) return tr("hd.err.transition");
  if (raw.includes("ticket_closed")) return tr("hd.err.closed");
  if (raw.includes("invalid_assignee")) return tr("hd.err.assignee");
  if (raw.includes("already_rated")) return tr("hd.err.rated");
  if (raw.includes("invalid_vendor")) return tr("hd.err.vendor");
  if (raw.includes("invalid_asset")) return tr("hd.err.asset");
  if (raw.includes("too_many_files")) return tr("hd.err.files");
  if (raw.includes("invalid_file")) return tr("hd.err.file");
  if (raw.includes("no_society")) return tr("hd.err.noSociety");
  if (raw.includes("not_authorized") || raw.includes("42501")) return tr("hd.err.denied");
  if (raw.includes("not_found")) return tr("hd.err.notFound");
  return tr("errors.generic");
}

export interface TimelineEvent {
  id: string; kind: string; actor_kind: string; actor_name: string;
  from_status: string | null; to_status: string | null; body: string | null; created_at: string;
}

export async function fetchTimeline(ticketId: string): Promise<TimelineEvent[]> {
  const { data, error } = await supabase.rpc("helpdesk_ticket_timeline", { _ticket: ticketId });
  if (error) throw error;
  return (data ?? []) as TimelineEvent[];
}

export function describeEvent(e: TimelineEvent): string {
  switch (e.kind) {
    case "created": return tr("hd.ev.created");
    case "comment": return tr("fd.comment");
    case "assigned": return e.body === "Unassigned" ? tr("hd.ev.unassigned") : tr("hd.ev.assigned");
    case "approval_requested": return tr("hd.ev.approvalRequested");
    case "approved": return tr("hd.ev.approved");
    case "rejected": return tr("inc.st.rejected");
    case "escalated": return tr("hd.ev.escalated");
    case "on_hold": return tr("hd.ev.onHold");
    case "reopened": return tr("hd.st.reopened");
    case "rated": return tr("hd.ev.rated", { rating: e.body ?? "" });
    case "evidence": return tr("hd.t.fileAttached");
    case "linked": return tr("hd.ev.linked");
    case "status": return tr("hd.ev.status", { status: statusMeta(e.to_status ?? "").label });
    default: return tr("hd.ev.update");
  }
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleString(localeTag(), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
