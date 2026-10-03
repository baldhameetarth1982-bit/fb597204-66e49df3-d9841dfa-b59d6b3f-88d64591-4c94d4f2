import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { GroupsBoard } from "@/components/community/GroupsBoard";

export const Route = createFileRoute("/_society/society/groups")({
  head: () => ({
    meta: [
      { title: "Community groups — SociyoHub" },
      { name: "description", content: "Create clubs and interest groups and approve members." },
      { property: "og:title", content: "Community groups — SociyoHub" },
      { property: "og:description", content: "Clubs and interest groups for residents." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => {
    const { societyId } = useSocietyId();
    return (
      <PageShell>
        <PageHeader title="Community groups" description="Groups are community spaces, separate from official notices." />
        {societyId ? <GroupsBoard societyId={societyId} mode="admin" /> : <p className="text-muted-foreground">Loading…</p>}
      </PageShell>
    );
  },
});
