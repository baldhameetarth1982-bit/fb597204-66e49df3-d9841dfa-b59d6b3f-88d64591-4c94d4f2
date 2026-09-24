import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkRateLimit, RateLimitedError } from "@/lib/rate-limit.server";

const Input = z.object({
  recordId: z.string().uuid(),
  categoryId: z.string().uuid(),
  requestId: z.string().uuid(),
  expectedRevision: z.string().uuid().nullable(),
}).strict();

export type CategoryReviewResult = { status: "success" | "already_processed" | "conflict" | "invalid_transition" | "category_unavailable" | "plan_required" | "not_found" | "rate_limited" | "unavailable" };

/** Server-derived identity, with a second, atomic authorization check in the RPC. */
export const confirmIncomeCategoryFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => Input.parse(raw))
  .handler(async ({ data, context }): Promise<CategoryReviewResult> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    try {
      await checkRateLimit({ bucket: "income_category_review_user", subject: userId, limit: 60, windowSec: 3600 });
    } catch (e) {
      return { status: e instanceof RateLimitedError ? "rate_limited" : "unavailable" };
    }
    try {
      const { data: value, error } = await supabase.rpc("confirm_income_category", {
        _record_id: data.recordId,
        _category_id: data.categoryId,
        _request_id: data.requestId,
        _expected_revision: data.expectedRevision,
      });
      if (error || !value || typeof value !== "object") return { status: "unavailable" };
      const allowed = ["success", "already_processed", "conflict", "invalid_transition", "category_unavailable", "plan_required", "not_found"] as const;
      const status = (value as { status?: string }).status;
      return allowed.some((x) => x === status) ? { status: status as CategoryReviewResult["status"] } : { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  });