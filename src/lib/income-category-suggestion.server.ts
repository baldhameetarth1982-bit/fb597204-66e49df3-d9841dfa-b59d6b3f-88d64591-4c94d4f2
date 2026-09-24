import { z } from "zod";

/** A suggestion is display-only; never a change to the canonical category. */
export const IncomeCategorySuggestionSchema = z.object({
  categoryKey: z.string().min(1).max(64),
  confidence: z.enum(["high", "medium", "low", "indeterminate"]),
  explanation: z.string().min(10).max(220),
}).strict();

export type IncomeSuggestionResult =
  | { status: "suggested"; categoryId: string; categoryName: string; confidence: "high" | "medium"; explanation: string; revision?: string }
  | { status: "indeterminate"; message: string }
  | { status: "not_found" | "plan_required" | "rate_limited" | "unavailable" | "invalid_transition" };

export function validateIncomeSuggestion(
  raw: string,
  categories: Array<{ id: string; key: string; display_name: string }>,
): IncomeSuggestionResult {
  let json: unknown;
  try {
    json = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { status: "indeterminate", message: "No reliable category could be suggested. Please review the category manually." };
  }
  const parsed = IncomeCategorySuggestionSchema.safeParse(json);
  if (!parsed.success || !["high", "medium"].includes(parsed.data.confidence)) {
    return { status: "indeterminate", message: "No reliable category could be suggested. Please review the category manually." };
  }
  const category = categories.find((c) => c.key === parsed.data.categoryKey);
  if (!category) return { status: "indeterminate", message: "No matching active category is available. Please review manually." };
  // Prevent provider-supplied HTML, paths, IDs, and instructions appearing in UI.
  const explanation = parsed.data.explanation;
  if (/[<>]|https?:\/\/|[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}/i.test(explanation)) {
    return { status: "indeterminate", message: "Please review the category manually." };
  }
  return {
    status: "suggested",
    categoryId: category.id,
    categoryName: category.display_name,
    confidence: parsed.data.confidence as "high" | "medium",
    explanation,
  };
}