import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { GroupsBoard } from "@/components/community/GroupsBoard";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_resident/app/groups")({
  head: () => ({
    meta: [
      { title: "Groups — SociyoHub" },
      { name: "description", content: "Join clubs and interest groups in your society." },
      { property: "og:title", content: "Groups — SociyoHub" },
      { property: "og:description", content: "Clubs and interest groups in your society." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => {
    const { societyId } = useSocietyId();
    return (
      <PageShell>
        <PageHeader title={tu("sv.groups")} description={tu("op.join_clubs_and_interest_groups")} />
        {societyId ? <GroupsBoard societyId={societyId} mode="resident" /> : <p className="text-muted-foreground">{tu("common.loading")}</p>}
      </PageShell>
    );
  },
});
