/** Today's date in India as YYYY-MM-DD, so due dates flip at Indian midnight. */
export function todayIST(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** A dated item is overdue only while still open and strictly past its due day. */
export function isOverdue(dueOn: string | null | undefined, open: boolean, now: Date = new Date()): boolean {
  return open && !!dueOn && dueOn < todayIST(now);
}
