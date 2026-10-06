import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { ClassesBoard } from "@/components/community/ClassesBoard";
import { tu } from "@/lib/i18n";

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
        <PageHeader title={tu("op.classes_instructors")} description={tu("op.classes_run_at_your_amenities")} />
        {societyId ? <ClassesBoard societyId={societyId} mode="admin" /> : <p className="text-muted-foreground">{tu("common.loading")}</p>}
      </PageShell>
    );
  },
});
