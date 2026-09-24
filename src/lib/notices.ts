export const NOTICE_CATEGORIES = [
  { value: "general", label: "General", className: "bg-muted text-foreground" },
  { value: "important", label: "Important", className: "bg-warning/15 text-warning-foreground" },
  { value: "emergency", label: "Emergency", className: "bg-destructive text-destructive-foreground" },
  { value: "event", label: "Event", className: "bg-primary/10 text-primary" },
  { value: "maintenance", label: "Maintenance", className: "bg-secondary text-secondary-foreground" },
  { value: "billing", label: "Billing", className: "bg-success/15 text-success" },
] as const;

export function noticeCategory(v: string | null | undefined) {
  return NOTICE_CATEGORIES.find((c) => c.value === v) ?? NOTICE_CATEGORIES[0];
}

export interface NoticeRow {
  id: string; title: string; body: string; category: string; audience: string; block_id: string | null;
  status: string; publish_at: string | null; published_at: string | null; created_at: string; edited_at: string | null;
}

export function liveAt(n: Pick<NoticeRow, "publish_at" | "published_at">) {
  return n.publish_at ?? n.published_at;
}

const MSG: Record<string, string> = {
  invalid_title: "Title must be 3–140 characters.",
  invalid_body: "Please write the notice (up to 5,000 characters).",
  invalid_block: "Pick a valid block for this notice.",
  invalid_date: "Schedule within the next 60 days.",
  edit_window_closed: "Published notices can only be edited for 7 days. Post a new notice instead.",
  notice_archived: "This notice was archived and can't be edited.",
  rate_limited: "Too many changes in a short time. Please wait a bit.",
  forbidden: "Only the committee can publish notices.",
  not_found: "This notice isn't available.",
  poll_closed: "This poll has closed.",
  already_voted: "You've already voted in this poll.",
  invalid_option: "That option isn't part of this poll.",
};
export function commErrorMessage(err: unknown) {
  const raw = String((err as { message?: string })?.message ?? "");
  for (const k of Object.keys(MSG)) if (raw.includes(k)) return MSG[k];
  if (/fetch|network/i.test(raw)) return "You seem to be offline. Check your connection and retry.";
  return "Something went wrong. Please try again.";
}
