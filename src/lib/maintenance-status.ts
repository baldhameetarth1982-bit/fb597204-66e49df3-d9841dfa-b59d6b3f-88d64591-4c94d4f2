// Maintenance status rules for the Accounts > Maintenance view.
// Timing: which calendar month a maintenance month is collected in.
//   post    → October collected in November
//   current → October collected in October
//   pre     → October collected in September
// Within the collection month: 1st–10th PENDING, 11th–end DUE; from the 1st of
// the following month OVERDUE. Before the collection month: UPCOMING.
export type MaintenanceTiming = "post" | "current" | "pre";
export type MaintenanceStatus = "paid" | "advance" | "pending" | "due" | "overdue" | "upcoming";

const offset: Record<MaintenanceTiming, number> = { post: 1, current: 0, pre: -1 };

/** Collection month (YYYY, 0-based month) for a maintenance month. */
export function collectionMonth(year: number, month: number, timing: MaintenanceTiming) {
  const d = new Date(Date.UTC(year, month + offset[timing], 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
}

/** today is an India calendar date "YYYY-MM-DD". paid = canonical verified payment covers it. */
export function maintenanceStatus(opts: { year: number; month: number; timing: MaintenanceTiming; today: string; paid: boolean }): MaintenanceStatus {
  const [ty, tm, td] = opts.today.split("-").map(Number);
  const c = collectionMonth(opts.year, opts.month, opts.timing);
  const todayIdx = ty * 12 + (tm - 1);
  const collIdx = c.year * 12 + c.month;
  if (opts.paid) return todayIdx < collIdx ? "advance" : "paid";
  if (todayIdx < collIdx) return "upcoming";
  if (todayIdx > collIdx) return "overdue";
  return td <= 10 ? "pending" : "due";
}

export function indiaToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}
