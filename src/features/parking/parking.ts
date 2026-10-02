/** Pure helpers for the parking screens. Server is the authority; these only format. */

export const VIOLATION_TYPES = [
  ["wrong_slot", "Wrong slot"],
  ["unauthorized", "Unauthorised parking"],
  ["expired_temporary", "Expired temporary slot"],
  ["blocking_access", "Blocking access"],
  ["ev_misuse", "EV slot misuse"],
  ["visitor_slot_misuse", "Visitor slot misuse"],
  ["other", "Other"],
] as const;

export const TEMP_PURPOSES = [
  ["guest", "Guest"],
  ["maintenance", "Maintenance work"],
  ["replacement_vehicle", "Replacement vehicle"],
  ["short_term", "Short-term allocation"],
  ["other", "Other"],
] as const;

export const label = (pairs: readonly (readonly [string, string])[], k: string | null | undefined) =>
  pairs.find((p) => p[0] === k)?.[1] ?? (k ?? "").replace(/_/g, " ");

export interface AllocationLike { status: string; kind: string; starts_at: string; ends_at: string | null }

/** Display state; an "active" temporary row past its end shows as expired even before the server sweep runs. */
export function allocationState(a: AllocationLike, now = Date.now()): "active" | "upcoming" | "expired" | "released" | "cancelled" {
  if (a.status === "released" || a.status === "cancelled" || a.status === "expired") return a.status;
  if (a.ends_at && new Date(a.ends_at).getTime() <= now) return "expired";
  if (new Date(a.starts_at).getTime() > now) return "upcoming";
  return "active";
}

/** CSV cell that neutralises spreadsheet formulas. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: unknown[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

export function normPlate(p: string) {
  return p.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
