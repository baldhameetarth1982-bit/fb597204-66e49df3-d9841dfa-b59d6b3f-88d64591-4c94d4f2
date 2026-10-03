import { createFileRoute } from "@tanstack/react-router";

/**
 * Sends queued Email/SMS/WhatsApp. Woken on enqueue by a DB trigger, plus an hourly
 * backstop for retries. Same CRON_SECRET / scheduler-token auth as other hooks; every
 * run is logged in scheduler_job_runs (one window per 5 minutes).
 */
export const Route = createFileRoute("/api/public/hooks/messaging-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isAuthorizedScheduler } = await import("@/lib/scheduler-auth.server");
        if (!(await isAuthorizedScheduler(request))) return new Response("Unauthorized", { status: 401 });
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { recordSchedulerRun } = await import("@/lib/scheduler-runs.server");
        const w = new Date(Math.floor(Date.now() / 300_000) * 300_000).toISOString().slice(0, 16);
        return recordSchedulerRun(supabaseAdmin as never, "messaging-dispatch", w, async () => {
          const { dispatchMessages } = await import("@/lib/messaging.server");
          const stats = await dispatchMessages(200);
          return Response.json({ ok: true, count: stats.processed, ...stats });
        });
      },
    },
  },
});
