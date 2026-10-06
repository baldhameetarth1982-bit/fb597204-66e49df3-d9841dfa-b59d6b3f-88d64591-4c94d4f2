import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { EventsBoard } from "@/components/community/EventsBoard";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/events")({
  head: () => ({
    meta: [
      { title: "Community events — SociyoHub" },
      { name: "description", content: "Create society events, track RSVPs and manage waitlists." },
      { property: "og:title", content: "Community events — SociyoHub" },
      { property: "og:description", content: "Society events with RSVPs, capacity and waitlists." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => {
    const { societyId } = useSocietyId();
    return (
      <PageShell>
        <PageHeader title={tu("op.community_events")} description={tu("op.events_are_community_content_separate")} />
        {societyId ? <EventsBoard societyId={societyId} mode="admin" /> : <p className="text-muted-foreground">{tu("common.loading")}</p>}
      </PageShell>
    );
  },
});
