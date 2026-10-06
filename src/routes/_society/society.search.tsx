import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { GlobalSearch } from "@/components/shared/GlobalSearch";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/search")({
  head: () => ({ meta: [{ title: "Search — SociyoHub" }] }),
  component: SocietySearch,
});

function SocietySearch() {
  const { societyId } = useSocietyId();
  return (
    <PageShell>
      <PageHeader title={tu("common.search")} description={tu("op.find_residents_flats_bills_visitors")} />
      {societyId ? <GlobalSearch societyId={societyId} scope="society" /> : null}
    </PageShell>
  );
}
