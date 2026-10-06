import { supabase } from "@/integrations/supabase/client";
import i18n, { localeTag } from "@/lib/i18n";

const tr = (k: string) => i18n.t(k) as string;

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
  invalid_window: "Check the dates: nominations must close before voting opens, and voting must end in the future.",
  posts_required: "Add at least one post before opening nominations.",
  pending_nominations: "Approve or reject every pending nomination before opening voting.",
  candidates_required: "Every post needs at least one approved candidate before voting opens.",
  nominations_closed: "Nominations aren't open right now.",
  already_nominated: "You've already been nominated for this post.",
  candidate_not_eligible: "This person is no longer eligible (for example, they have moved out).",
  withdraw_closed: "Nominations can no longer be withdrawn.",
  too_many_choices: "You picked more candidates than there are seats for a post.",
  results_locked: "Published results can't be changed.",
  invalid_fy: "Use a financial year like 2025-26.",
  invalid_quorum: "Enter a valid quorum (a percentage up to 100, or a number).",
  agm_locked: "This AGM can't be changed at this stage.",
  agenda_required: "Add at least one agenda item before publishing the notice.",
  correction_required: "Corrections to published minutes need a reason (10 characters or more).",
  vote_not_closed: "Close the linked formal vote before recording this result.",
  resolution_locked: "Decided resolutions can't be changed.",
  use_agm: "This meeting is an AGM. Manage it from the AGM page.",
};

/** Messages with a translation (gv.e.*); the rest stay English until their screens are localized. */
const LOCALIZED = new Set(["forbidden", "not_found", "invalid_title", "invalid_transition", "reason_required", "already_voted", "home_already_voted", "not_eligible", "rate_limited", "invalid_input", "invalid_window", "posts_required", "pending_nominations", "candidates_required", "nominations_closed", "already_nominated", "candidate_not_eligible", "withdraw_closed", "too_many_choices", "results_locked"]);

export function govError(err: unknown) {
  const raw = String((err as { message?: string })?.message ?? "");
  for (const k of Object.keys(MSG)) if (raw.includes(k)) return LOCALIZED.has(k) ? tr(`gv.e.${k}`) : MSG[k];
  if (/fetch|network/i.test(raw)) return tr("ge.network");
  return tr("errors.generic");
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

export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(localeTag(), { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", numberingSystem: "latn" });

export const ELECTION_STATUS: Record<string, { label: string; className: string }> = {
  draft: { get label() { return tr("docState.draft"); }, className: "bg-muted text-foreground" },
  nomination_open: { get label() { return tr("el.st.nomination_open"); }, className: "bg-primary/10 text-primary" },
  nomination_review: { get label() { return tr("el.st.nomination_review"); }, className: "bg-warning/15 text-warning-foreground" },
  voting_open: { get label() { return tr("el.st.voting_open"); }, className: "bg-primary/10 text-primary" },
  voting_closed: { get label() { return tr("el.st.voting_closed"); }, className: "bg-secondary text-secondary-foreground" },
  results_published: { get label() { return tr("el.st.results_published"); }, className: "bg-success/15 text-success" },
  archived: { get label() { return tr("cm.st.archived"); }, className: "bg-muted text-muted-foreground" },
};

export const NOMINATION_STATUS: Record<string, { label: string; className: string }> = {
  pending: { get label() { return tr("el.nst.pending"); }, className: "bg-warning/15 text-warning-foreground" },
  approved: { get label() { return tr("vs.st.approved"); }, className: "bg-success/15 text-success" },
  rejected: { get label() { return tr("el.nst.rejected"); }, className: "bg-destructive/10 text-destructive" },
  withdrawn: { get label() { return tr("el.nst.withdrawn"); }, className: "bg-muted text-muted-foreground" },
};

export const ELECTION_ELIGIBILITY: Record<string, string> = {} as Record<string, string>;
Object.defineProperties(ELECTION_ELIGIBILITY, {
  home: { enumerable: true, get: () => tr("el.elig.home") },
  person: { enumerable: true, get: () => tr("el.elig.person") },
});

export const AGM_STATUS: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-foreground" },
  notice_published: { label: "Notice published", className: "bg-primary/10 text-primary" },
  scheduled: { label: "Scheduled", className: "bg-primary/10 text-primary" },
  in_progress: { label: "In progress", className: "bg-warning/15 text-warning-foreground" },
  completed: { label: "Completed", className: "bg-secondary text-secondary-foreground" },
  minutes_pending: { label: "Minutes in review", className: "bg-warning/15 text-warning-foreground" },
  minutes_published: { label: "Minutes published", className: "bg-success/15 text-success" },
  archived: { label: "Archived", className: "bg-muted text-muted-foreground" },
};

export const RESOLUTION_STATUS: Record<string, { label: string; className: string }> = {
  proposed: { label: "Proposed", className: "bg-muted text-foreground" },
  passed: { label: "Passed", className: "bg-success/15 text-success" },
  rejected: { label: "Rejected", className: "bg-destructive/10 text-destructive" },
  deferred: { label: "Deferred", className: "bg-secondary text-secondary-foreground" },
  withdrawn: { label: "Withdrawn", className: "bg-muted text-muted-foreground" },
};

export type ElectionCandidate = { nomination_id: string; name: string; votes: number; rank: number; outcome: "elected" | "tied" | "unresolved" | "not_elected" };
export type ElectionPostResult = { post_id: string; post: string; seats: number; valid_votes: number; state: "decided" | "unresolved"; candidates: ElectionCandidate[] };
export type ElectionResults = { published: boolean; hidden?: boolean; eligible?: number | null; participated?: number | null; posts?: ElectionPostResult[]; hash?: string; published_at?: string };
export type Quorum = { basis: string; eligible: number; present: number; required: number; met: boolean; frozen: boolean; corrected?: boolean };

/** datetime-local value → ISO; empty → null. */
export const localToIso = (v: string) => (v ? new Date(v).toISOString() : null);
/** ISO → datetime-local value in the device's timezone. */
export const isoToLocal = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
