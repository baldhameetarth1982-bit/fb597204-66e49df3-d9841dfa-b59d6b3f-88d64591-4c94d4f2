import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Stage 3C — Razorpay-based maintenance ordering is retired.
 *
 * Maintenance collection is offline-only (Cash / Bank Transfer) via
 * `submit_offline_payment` and the admin verification workflow. This
 * server function is kept as a deprecation stub so any accidental
 * caller fails loudly instead of silently creating a Razorpay order.
 */
export const createMaintenanceOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ billId: z.string().uuid() }).parse(i))
  .handler(async () => {
    throw new Error(
      "Online maintenance payments are not available. Please record your payment offline (Cash or Bank Transfer) and wait for admin verification.",
    );
  });
