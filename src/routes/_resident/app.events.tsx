import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { EventsBoard } from "@/components/community/EventsBoard";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_resident/app/events")({
  head: () => ({
    meta: [
      { title: "Events — SociyoHub" },
      { name: "description", content: "See upcoming society events and RSVP." },
      { property: "og:title", content: "Events — SociyoHub" },
      { property: "og:description", content: "Upcoming society events and RSVPs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => {
    const { societyId } = useSocietyId();
    return (
      <PageShell>
        <PageHeader title={tu("sv.events")} description={tu("op.rsvp_to_events_in_your")} />
        {societyId ? <EventsBoard societyId={societyId} mode="resident" /> : <p className="text-muted-foreground">{tu("common.loading")}</p>}
      </PageShell>
    );
  },
});
