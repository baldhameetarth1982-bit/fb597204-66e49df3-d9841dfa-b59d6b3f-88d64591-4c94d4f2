/**
 * Stage 3B — Canonical bill display status.
 *
 * One shared helper used by resident bill list, resident bill detail and
 * admin bill detail. Derives display status strictly from canonical bill
 * fields. Legacy payment-order status values ("success", "captured",
 * "completed") MUST NOT drive a Paid state independently — those live on
 * historical payment rows that predate the Stage 3C verification workflow
 * and are not authoritative. Only `bills.status = 'paid'` (or
 * `partially_paid`) — set by the canonical verification workflow — can
 * make a bill display as paid.
 */

export type BillDisplayCode =
  | "cancelled"
  | "paid"
  | "partially_paid"
  | "overdue"
  | "due"
  | "unknown";

export type BillDisplayTone = "success" | "danger" | "warning" | "neutral";

export interface BillDisplayInput {
  status?: string | null;
  due_date?: string | null;
  cancelled_at?: string | null;
}

export interface BillDisplayState {
  code: BillDisplayCode;
  label: string;
  tone: BillDisplayTone;
  /** True only when the bill's canonical status is `paid`. */
  isPaid: boolean;
  isCancelled: boolean;
  isOverdue: boolean;
}

/**
 * Only these canonical status values are trusted from the `bills.status`
 * column. Legacy payment aliases are excluded on purpose.
 */
const CANONICAL_STATUSES = new Set([
  "paid",
  "partially_paid",
  "unpaid",
  "overdue",
  "cancelled",
]);

export function getBillDisplayStatus(
  bill: BillDisplayInput,
  now: Date = new Date(),
): BillDisplayState {
  const raw = (bill.status ?? "").toString().trim().toLowerCase();

  // Cancelled always wins — cancelled_at or explicit status.
  if (bill.cancelled_at || raw === "cancelled") {
    return {
      code: "cancelled",
      label: "Cancelled",
      tone: "neutral",
      isPaid: false,
      isCancelled: true,
      isOverdue: false,
    };
  }

  if (raw === "paid") {
    return {
      code: "paid",
      label: "Paid",
      tone: "success",
      isPaid: true,
      isCancelled: false,
      isOverdue: false,
    };
  }

  if (raw === "partially_paid") {
    return {
      code: "partially_paid",
      label: "Partially paid",
      tone: "warning",
      isPaid: false,
      isCancelled: false,
      isOverdue: false,
    };
  }

  const overdue = bill.due_date
    ? new Date(bill.due_date).getTime() < now.getTime()
    : false;

  // Any non-canonical status (including legacy "success" / "captured")
  // falls through to a safe due/overdue state — never Paid.
  if (raw === "" || !CANONICAL_STATUSES.has(raw)) {
    if (overdue) {
      return {
        code: "overdue",
        label: "Overdue",
        tone: "danger",
        isPaid: false,
        isCancelled: false,
        isOverdue: true,
      };
    }
    return {
      code: raw === "" ? "unknown" : "unknown",
      label: raw === "" ? "Due" : "Status unavailable",
      tone: "warning",
      isPaid: false,
      isCancelled: false,
      isOverdue: false,
    };
  }

  if (raw === "overdue" || overdue) {
    return {
      code: "overdue",
      label: "Overdue",
      tone: "danger",
      isPaid: false,
      isCancelled: false,
      isOverdue: true,
    };
  }

  return {
    code: "due",
    label: "Due",
    tone: "warning",
    isPaid: false,
    isCancelled: false,
    isOverdue: false,
  };
}
