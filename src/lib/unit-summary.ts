/**
 * Deterministic Unit Summary — pure function.
 *
 * Same input → same output, always. No randomness, no AI, no PII.
 * Section states are honoured:
 *   - `unsupported` = unknown, never rendered as zero
 *   - `error`       = surfaced as a safe warning
 *   - `available`/`empty` = normal read
 *
 * Actions only reference route strings that already exist in the app.
 */

export type OccupancyKind = "vacant" | "owner_occupied" | "tenant_occupied" | "multi_resident" | "unknown";

export type SectionSummary =
  | { status: "available"; count?: number; total?: number }
  | { status: "empty" }
  | { status: "unsupported" }
  | { status: "error"; message?: string };

export type Flat360SummaryInput = {
  unit_label: string;
  is_serial: boolean;
  occupancy: {
    kind: OccupancyKind;
    active_count: number; // 0 when vacant / unknown
  };
  financial: {
    total_outstanding: number;
    overdue_count: number;
    partial_count: number;
    unpaid_count: number;
    pending_verification_count: number;
    inconsistency_count: number;
  };
  complaints: SectionSummary & { open_count?: number };
  approvals: SectionSummary & { pending_count?: number };
  no_dues:
    | { status: "unavailable" }
    | {
        status: "available";
        eligible: boolean;
        blocker_count: number;
        latest_request_id: string | null;
      };
  errors: string[]; // section-level error messages to surface as warnings
};

export type UnitSummaryAction = {
  type:
    | "review_dues"
    | "verify_payment"
    | "review_complaints"
    | "review_approvals"
    | "review_no_dues"
    | "none";
  label: string;
  route?: string;
};

export type UnitSummary = {
  headline: string;
  facts: string[];
  warnings: string[];
  next_actions: UnitSummaryAction[];
};

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

function formatINR(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "₹0";
  return INR.format(Math.round(n));
}

export function buildUnitSummary(input: Flat360SummaryInput): UnitSummary {
  const facts: string[] = [];
  const warnings: string[] = [];
  const actions: UnitSummaryAction[] = [];

  // --- Occupancy fact ---
  switch (input.occupancy.kind) {
    case "vacant":
      facts.push(`${input.unit_label} is currently vacant.`);
      break;
    case "owner_occupied":
      facts.push(`${input.unit_label} is owner-occupied.`);
      break;
    case "tenant_occupied":
      facts.push(`${input.unit_label} is tenant-occupied.`);
      break;
    case "multi_resident":
      facts.push(`${input.unit_label} has ${input.occupancy.active_count} active residents.`);
      break;
    case "unknown":
      facts.push(`Occupancy status is not recorded for ${input.unit_label}.`);
      break;
  }

  // --- Financial facts + actions ---
  const f = input.financial;
  if (f.total_outstanding > 0) {
    facts.push(`Outstanding balance: ${formatINR(f.total_outstanding)}.`);
    if (f.overdue_count > 0) {
      warnings.push(`${f.overdue_count} overdue bill${f.overdue_count === 1 ? "" : "s"}.`);
    }
    if (f.partial_count > 0) {
      warnings.push(`${f.partial_count} partially paid bill${f.partial_count === 1 ? "" : "s"}.`);
    }
    actions.push({ type: "review_dues", label: "Review dues", route: "/society/billing" });
  } else if (f.unpaid_count === 0 && f.overdue_count === 0) {
    facts.push("No outstanding dues.");
  }

  if (f.pending_verification_count > 0) {
    warnings.push(
      `${f.pending_verification_count} payment${f.pending_verification_count === 1 ? "" : "s"} pending verification.`,
    );
    actions.push({ type: "verify_payment", label: "Verify payments", route: "/society/accounts" });
  }

  if (f.inconsistency_count > 0) {
    warnings.push(`${f.inconsistency_count} financial inconsistency flagged for review.`);
  }

  // --- Complaints ---
  if (input.complaints.status === "available" && (input.complaints.open_count ?? 0) > 0) {
    const c = input.complaints.open_count!;
    warnings.push(`${c} open complaint${c === 1 ? "" : "s"}.`);
    actions.push({ type: "review_complaints", label: "Review complaints" });
  } else if (input.complaints.status === "error") {
    warnings.push("Complaints could not be loaded.");
  }

  // --- Approvals ---
  if (input.approvals.status === "available" && (input.approvals.pending_count ?? 0) > 0) {
    const a = input.approvals.pending_count!;
    warnings.push(`${a} pending approval${a === 1 ? "" : "s"}.`);
    actions.push({ type: "review_approvals", label: "Review approvals", route: "/society/approvals" });
  } else if (input.approvals.status === "error") {
    warnings.push("Approvals could not be loaded.");
  }

  // --- No-Dues ---
  if (input.no_dues.status === "available") {
    if (!input.no_dues.eligible) {
      warnings.push(
        input.no_dues.blocker_count > 0
          ? `No-Dues blocked by ${input.no_dues.blocker_count} issue${input.no_dues.blocker_count === 1 ? "" : "s"}.`
          : "No-Dues not currently eligible.",
      );
      actions.push({
        type: "review_no_dues",
        label: "Review No-Dues",
        route: "/society/no-dues",
      });
    } else {
      facts.push("Eligible for a No-Dues certificate.");
    }
  }

  // --- Errors (from sections) surfaced as safe warnings ---
  for (const e of input.errors) {
    if (e && typeof e === "string") warnings.push(e);
  }

  // --- Headline ---
  let headline: string;
  if (warnings.length === 0) {
    headline =
      input.occupancy.kind === "vacant"
        ? `${input.unit_label} — vacant, no operational concerns.`
        : `${input.unit_label} — no operational concerns.`;
  } else {
    headline = `${input.unit_label} — ${warnings.length} item${warnings.length === 1 ? "" : "s"} need review.`;
  }

  // Guarantee at least one action so the UI always has a stable slot.
  if (actions.length === 0) {
    actions.push({ type: "none", label: "No action required" });
  }

  // Deduplicate actions by type while preserving order.
  const seen = new Set<string>();
  const dedupActions = actions.filter((a) => {
    if (seen.has(a.type)) return false;
    seen.add(a.type);
    return true;
  });

  return { headline, facts, warnings, next_actions: dedupActions };
}
