import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { EventsBoard } from "@/components/community/EventsBoard";

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
        <PageHeader title="Community events" description="Events are community content, separate from official notices." />
        {societyId ? <EventsBoard societyId={societyId} mode="admin" /> : <p className="text-muted-foreground">Loading…</p>}
      </PageShell>
    );
  },
});
