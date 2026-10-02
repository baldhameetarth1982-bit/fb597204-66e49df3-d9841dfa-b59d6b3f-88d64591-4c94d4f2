import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { GlobalSearch } from "@/components/shared/GlobalSearch";

export const Route = createFileRoute("/_resident/app/search")({
  head: () => ({ meta: [{ title: "Search — SociyoHub" }] }),
  component: ResidentSearch,
});

function ResidentSearch() {
  const { societyId } = useSocietyId();
  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold">Search</h1>
      {societyId ? <GlobalSearch societyId={societyId} scope="resident" /> : null}
    </div>
  );
}
