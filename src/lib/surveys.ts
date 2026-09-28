export type QType = "single" | "multi" | "rating" | "text";
export interface SurveyQuestion { id: string; poll_id: string; position: number; prompt: string; qtype: QType; options: string[]; required: boolean }
export interface Survey { id: string; title: string; description: string | null; status: string; closes_at: string | null; created_at: string }

export const QTYPE_LABEL: Record<QType, string> = {
  single: "One choice", multi: "Multiple choice", rating: "Rating 1–5", text: "Short answer",
};

export const isSurveyOpen = (s: Survey) => s.status === "open" && (!s.closes_at || new Date(s.closes_at) > new Date());

/** Maps server error codes to plain messages; raw database text is never shown. */
export function surveyError(e: unknown): string {
  const m = (e instanceof Error ? e.message : (e as { message?: string } | null)?.message ?? "").toLowerCase();
  if (m.includes("already_responded")) return "You've already answered this survey.";
  if (m.includes("survey_closed")) return "This survey is closed.";
  if (m.includes("answer_required")) return "Please answer every required question.";
  if (m.includes("invalid_answers")) return "Some answers aren't valid. Please check and try again.";
  if (m.includes("invalid_close_date")) return "The closing date must be in the future.";
  if (m.includes("invalid_questions")) return "Each question needs text, and choice questions need 2–10 options.";
  if (m.includes("invalid_survey")) return "Add a title of 3–150 characters.";
  if (m.includes("invalid_transition")) return "This survey can't be changed from its current state.";
  if (m.includes("rate_limited")) return "Too many attempts. Please try again later.";
  if (m.includes("not_authorized") || m.includes("permission")) return "You don't have permission to do this.";
  return "Something went wrong. Please try again.";
}
