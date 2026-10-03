import { createFileRoute } from "@tanstack/react-router";

/** Scheduler hook: sends queued Email/SMS/WhatsApp. Same CRON_SECRET / scheduler-token auth as other hooks. */
export const Route = createFileRoute("/api/public/hooks/messaging-dispatch")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { isAuthorizedScheduler } = await import("@/lib/scheduler-auth.server");
        if (!(await isAuthorizedScheduler(request))) return new Response("Unauthorized", { status: 401 });
        try {
          const { dispatchMessages } = await import("@/lib/messaging.server");
          const stats = await dispatchMessages(200);
          return Response.json({ ok: true, ...stats });
        } catch {
          return Response.json({ ok: false }, { status: 500 });
        }
      },
    },
  },
});
