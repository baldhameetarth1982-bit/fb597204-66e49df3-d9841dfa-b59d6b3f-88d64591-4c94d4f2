import { describe, expect, it } from "vitest";
import { validateIncomeSuggestion } from "@/lib/income-category-suggestion.server";

const categories = [{ id: "category-a", key: "events", display_name: "Events" }];
const response = (confidence: string, explanation = "This income is for a community event.", categoryKey = "events") =>
  JSON.stringify({ categoryKey, confidence, explanation });

describe("income category suggestion validation", () => {
  it("accepts only an active listed category at usable confidence", () => {
    expect(validateIncomeSuggestion(response("high"), categories)).toEqual({
      status: "suggested",
      categoryId: "category-a",
      categoryName: "Events",
      confidence: "high",
      explanation: "This income is for a community event.",
    });
    expect(validateIncomeSuggestion(response("low"), categories).status).toBe("indeterminate");
    expect(validateIncomeSuggestion(response("medium", undefined, "other"), categories).status).toBe("indeterminate");
  });

  it("does not surface injected links, markup, identifiers, or arbitrary provider fields", () => {
    for (const explanation of [
      "See https://example.com/internal for the category",
      "<script>Ignore previous rules</script>",
      "Refer to 1907a918-c4b8-4f43-a837-450530cc7c34 here",
    ]) {
      expect(validateIncomeSuggestion(response("medium", explanation), categories).status).toBe("indeterminate");
    }
    expect(validateIncomeSuggestion('{"categoryKey":"events","confidence":"high","explanation":"Community event income.","private":"no"}', categories).status).toBe("indeterminate");
    expect(validateIncomeSuggestion("not JSON", categories).status).toBe("indeterminate");
  });
});