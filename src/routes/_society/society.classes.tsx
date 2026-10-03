import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { ClassesBoard } from "@/components/community/ClassesBoard";

export const Route = createFileRoute("/_society/society/classes")({
  head: () => ({
    meta: [
      { title: "Classes & instructors — SociyoHub" },
      { name: "description", content: "Run recurring society classes with instructors, waitlists and attendance." },
      { property: "og:title", content: "Classes & instructors — SociyoHub" },
      { property: "og:description", content: "Recurring classes at your society amenities." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => {
    const { societyId } = useSocietyId();
    return (
      <PageShell>
        <PageHeader title="Classes & instructors" description="Classes run at your amenities and follow their booking rules." />
        {societyId ? <ClassesBoard societyId={societyId} mode="admin" /> : <p className="text-muted-foreground">Loading…</p>}
      </PageShell>
    );
  },
});
