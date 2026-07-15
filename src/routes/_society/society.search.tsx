import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { GlobalSearch } from "@/components/shared/GlobalSearch";

export const Route = createFileRoute("/_society/society/search")({
  head: () => ({ meta: [{ title: "Search — SociyoHub" }] }),
  component: SocietySearch,
});

function SocietySearch() {
  const { societyId } = useSocietyId();
  return (
    <PageShell>
      <PageHeader title="Search" description="Find residents, flats, bills, visitors and notices" />
      {societyId ? <GlobalSearch societyId={societyId} scope="society" /> : null}
    </PageShell>
  );
}
