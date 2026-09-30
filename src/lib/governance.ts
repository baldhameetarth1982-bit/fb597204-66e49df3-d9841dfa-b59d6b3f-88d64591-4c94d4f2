import { supabase } from "@/integrations/supabase/client";

/** Governance RPC helper — every rule (society, role, eligibility, state) is enforced in the database. */
export async function govRpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw error;
  return data as T;
}

const MSG: Record<string, string> = {
  forbidden: "You don't have permission to do this.",
  not_found: "This item isn't available.",
  invalid_title: "Please enter a title (3 characters or more).",
  invalid_date: "Please choose a valid date in the future.",
  place_required: "Add a location or an https meeting link.",
  invalid_link: "Meeting links must start with https://",
  invalid_transition: "That change isn't allowed at this stage.",
  not_started: "You can mark a meeting as held only after it starts.",
  reason_required: "Please give a reason (5 characters or more).",
  minutes_required: "Write and save the minutes before publishing.",
  minutes_locked: "Minutes can only be edited after the meeting is held and before they're published.",
  rsvp_closed: "RSVP is closed for this meeting.",
  not_member: "That person isn't a current member.",
  invalid_vote: "Only a closed formal vote from this society can be linked.",
  invalid_option: "Each vote needs 2–10 options.",
  vote_frozen: "Voting has opened, so its settings are locked.",
  vote_closed: "This vote is closed and can't be reopened.",
  poll_closed: "This vote is closed.",
  already_voted: "You've already voted.",
  home_already_voted: "Someone from your home has already voted.",
  not_eligible: "You aren't eligible for this vote.",
  already_open: "You already have an open request of this type.",
  details_required: "Please describe what should be corrected.",
  outcome_required: "Please explain the decision (10 characters or more).",
  self_review: "Another committee member must review your own request.",
  export_not_approved: "Your data copy is available once the committee approves an export request (valid 30 days).",
  use_archive: "Documents are archived, not deleted, so their history is kept.",
  rate_limited: "Too many changes in a short time. Please wait a bit.",
  invalid_input: "Please check the details and try again.",
};

export function govError(err: unknown) {
  const raw = String((err as { message?: string })?.message ?? "");
  for (const k of Object.keys(MSG)) if (raw.includes(k)) return MSG[k];
  if (/fetch|network/i.test(raw)) return "You seem to be offline. Check your connection and retry.";
  return "Something went wrong. Please try again.";
}

export const MEETING_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-foreground" },
  scheduled: { label: "Scheduled", className: "bg-primary/10 text-primary" },
  held: { label: "Held", className: "bg-secondary text-secondary-foreground" },
  minutes_published: { label: "Minutes published", className: "bg-success/15 text-success" },
  cancelled: { label: "Cancelled", className: "bg-destructive/10 text-destructive" },
};

export const PRIVACY_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-warning/15 text-warning-foreground" },
  under_review: { label: "Under review", className: "bg-primary/10 text-primary" },
  completed: { label: "Completed", className: "bg-success/15 text-success" },
  partially_completed: { label: "Reviewed — some records kept", className: "bg-secondary text-secondary-foreground" },
  declined: { label: "Declined", className: "bg-destructive/10 text-destructive" },
  withdrawn: { label: "Withdrawn", className: "bg-muted text-muted-foreground" },
};

export const PRIVACY_KIND: Record<string, string> = { export: "Copy of my data", correction: "Correct my data", deletion: "Delete my data" };

export const ELIGIBILITY: Record<string, string> = { person: "One vote per resident", home: "One vote per home", committee: "Committee only" };

export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
