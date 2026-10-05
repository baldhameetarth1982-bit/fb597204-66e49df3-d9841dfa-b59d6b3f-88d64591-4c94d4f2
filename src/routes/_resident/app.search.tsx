import { createFileRoute } from "@tanstack/react-router";
import { useSocietyId } from "@/hooks/useSocietyId";
import { useTranslation } from "react-i18next";
import { GlobalSearch } from "@/components/shared/GlobalSearch";

export const Route = createFileRoute("/_resident/app/search")({
  head: () => ({ meta: [{ title: "Search — SociyoHub" }] }),
  component: ResidentSearch,
});

function ResidentSearch() {
  const { societyId } = useSocietyId();
  const { t } = useTranslation();
  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold">{t("nav.search")}</h1>
      {societyId ? <GlobalSearch societyId={societyId} scope="resident" /> : null}
    </div>
  );
}
