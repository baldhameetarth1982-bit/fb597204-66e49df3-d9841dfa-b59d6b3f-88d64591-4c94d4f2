/**
 * Stage 1D — typed error contract for Non-Member Income surfaces.
 *
 * UI code MUST map any thrown Error.message to one of these codes via
 * `mapIncomeError` before rendering. Raw Postgres / Supabase / constraint
 * text must never reach the user.
 */
export const INCOME_ERROR_CODES = [
  "success",
  "duplicate_request",
  "duplicate_category",
  "category_inactive",
  "payer_inactive",
  "invalid_input",
  "plan_required",
  "not_authorized",
  "not_found",
  "temporary_error",
] as const;

export type IncomeErrorCode = (typeof INCOME_ERROR_CODES)[number];

/** Server error `message` strings → typed UI code. Unknowns collapse to
 * `temporary_error` so DB text, constraint names, and stack traces cannot
 * leak into the UI. */
export function mapIncomeError(raw: unknown): IncomeErrorCode {
  const msg = raw instanceof Error ? raw.message : typeof raw === "string" ? raw : "";
  switch (msg) {
    case "duplicate_category_key":
      return "duplicate_category";
    case "category_inactive":
    case "category_society_mismatch":
      return "category_inactive";
    case "payer_inactive":
    case "payer_society_mismatch":
      return "payer_inactive";
    case "forbidden_plan":
      return "plan_required";
    case "forbidden_society":
    case "invalid_transition":
      return "not_authorized";
    case "not_found":
      return "not_found";
    case "duplicate_request":
      return "duplicate_request";
    case "":
      return "temporary_error";
    default:
      return "temporary_error";
  }
}

export const INCOME_ERROR_MESSAGES: Record<IncomeErrorCode, string> = {
  success: "",
  duplicate_request: "This income was already recorded.",
  duplicate_category: "A category with this key already exists.",
  category_inactive: "That category is inactive. Pick an active category.",
  payer_inactive: "That payer is inactive. Pick an active payer.",
  invalid_input: "Please check the highlighted fields.",
  plan_required: "This feature requires the Pro or Premium plan.",
  not_authorized: "You don't have permission for this action.",
  not_found: "That record no longer exists.",
  temporary_error: "Something went wrong. Please try again.",
};

export function friendlyIncomeError(raw: unknown): string {
  return INCOME_ERROR_MESSAGES[mapIncomeError(raw)];
}
