/** Super Admin messaging controls. Every call re-checks Super Admin server-side. */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertSuper(context: any) {
  const { data } = await context.supabase.rpc("is_super_admin", { _user_id: context.userId });
  if (data !== true) throw new Error("not_authorized");
}

/** Which providers have server credentials (booleans only — never values). */
export const getMessagingConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuper(context);
    const { channelConnected } = await import("@/lib/messaging.server");
    return { email: channelConnected("email"), sms: channelConnected("sms"), whatsapp: channelConnected("whatsapp") };
  });

export const runMessagingDispatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({}).passthrough().parse(d ?? {}))
  .handler(async ({ context }) => {
    await assertSuper(context);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await checkRateLimit({ bucket: "messaging_dispatch_manual", subject: context.userId as string, limit: 20, windowSec: 3600 });
    const { dispatchMessages } = await import("@/lib/messaging.server");
    return dispatchMessages(100);
  });
