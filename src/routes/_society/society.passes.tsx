import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { useSocietyId } from "@/hooks/useSocietyId";
import { CommitteePasses } from "@/features/passes/MaterialPasses";

export const Route = createFileRoute("/_society/society/passes")({
  head: () => ({
    meta: [
      { title: "Passes & service lift — SociyoHub" },
      { name: "description", content: "Approve material, construction and move passes and manage the service lift schedule." },
      { property: "og:title", content: "Passes & service lift — SociyoHub" },
      { property: "og:description", content: "Committee approvals for gate passes and lift bookings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PassesPage,
});

function PassesPage() {
  const { societyId } = useSocietyId();
  return (
    <PageShell>
      <PageHeader title="Passes & service lift" description="Approve material, construction and move passes. Lift bookings never overlap." />
      {societyId ? <CommitteePasses societyId={societyId} /> : <p className="text-sm text-muted-foreground">Loading…</p>}
    </PageShell>
  );
}
