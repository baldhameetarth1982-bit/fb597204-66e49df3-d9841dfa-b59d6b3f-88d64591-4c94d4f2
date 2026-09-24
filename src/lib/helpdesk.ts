import { supabase } from "@/integrations/supabase/client";

export type TicketCategory = "complaint" | "daily_help" | "maintenance" | "lost_found" | "approval";
export type TicketStatus =
  | "open" | "in_progress" | "awaiting_approval" | "resolved" | "closed" | "rejected" | "cancelled";
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
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low", normal: "Normal", high: "High", urgent: "Urgent",
};

export const ACTIVE_STATUSES: TicketStatus[] = ["open", "in_progress", "awaiting_approval", "resolved"];

export function statusMeta(s: string) {
  return STATUS_META[s as TicketStatus] ?? { label: "Updated", tone: "bg-muted text-muted-foreground" };
}

/** Plain-language messages; raw server text is only used for matching. */
export function helpdeskErrorMessage(err: unknown): string {
  const raw = String((err as { message?: string })?.message ?? err ?? "").toLowerCase();
  if (typeof navigator !== "undefined" && !navigator.onLine) return "You're offline. Your text is kept — try again when connected.";
  if (raw.includes("rate_limited")) return "Too many requests in a short time. Please wait a few minutes.";
  if (raw.includes("invalid_subject")) return "Please give a short title (3–120 characters).";
  if (raw.includes("invalid_description")) return "Please describe the issue (at least 5 characters).";
  if (raw.includes("reason_required")) return "Please add a reason.";
  if (raw.includes("invalid_transition")) return "This request has already moved on. Refresh to see its latest status.";
  if (raw.includes("ticket_closed")) return "This request is closed, so it can't take new comments.";
  if (raw.includes("invalid_assignee")) return "That person isn't on the society team.";
  if (raw.includes("no_society")) return "Join a society before raising a request.";
  if (raw.includes("not_authorized") || raw.includes("42501")) return "You don't have permission to do that.";
  if (raw.includes("not_found")) return "This request couldn't be found.";
  return "Something went wrong. Please try again.";
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
    case "created": return "Request raised";
    case "comment": return "Comment";
    case "assigned": return e.body === "Unassigned" ? "Unassigned" : "Assigned to a team member";
    case "approval_requested": return "Sent for committee approval";
    case "approved": return "Approved by committee";
    case "rejected": return "Rejected";
    case "status": return `Status changed to ${statusMeta(e.to_status ?? "").label}`;
    default: return "Update";
  }
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}
