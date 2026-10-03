import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { ClassesBoard } from "@/components/community/ClassesBoard";

export const Route = createFileRoute("/_resident/app/classes")({
  head: () => ({
    meta: [
      { title: "Classes — SociyoHub" },
      { name: "description", content: "Join society classes, check in and track your place on waitlists." },
      { property: "og:title", content: "Classes — SociyoHub" },
      { property: "og:description", content: "Society classes with waitlists and check-in." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => {
    const { societyId } = useSocietyId();
    return (
      <PageShell>
        <PageHeader title="Classes" description="Join classes in your society and check in when you arrive." />
        {societyId ? <ClassesBoard societyId={societyId} mode="resident" /> : <p className="text-muted-foreground">Loading…</p>}
      </PageShell>
    );
  },
});
