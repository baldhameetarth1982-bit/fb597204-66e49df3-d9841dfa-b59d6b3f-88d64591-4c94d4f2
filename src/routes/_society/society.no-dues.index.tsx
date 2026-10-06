import { LoadError } from "@/components/people/PeopleUI";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusChip } from "@/components/system/StatusChip";
import { Button } from "@/components/ui/button";
import {
  listSocietyNoDuesRequests,
} from "@/lib/no-dues.functions";
import { useTranslation } from "react-i18next";
import { statusLabel, formatCurrency, ndDateTime } from "@/lib/no-dues-labels";
import { useSocietyId } from "@/hooks/useSocietyId";

export const Route = createFileRoute("/_society/society/no-dues/")({
  head: () => ({
    meta: [
      { title: "No-Dues Requests — SociyoHub" },
      { name: "description", content: "Review resident no-dues requests and issue certificates." },
      { property: "og:title", content: "No-Dues Requests — SociyoHub" },
      { property: "og:description", content: "Review resident no-dues requests and issue certificates." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: NoDuesAdmin,
});

function NoDuesAdmin() {
  return (
    <FeatureGate feature="no_dues">
      <NoDuesAdminInner />
    </FeatureGate>
  );
}

function NoDuesAdminInner() {
  const { t } = useTranslation();
  const { societyId } = useSocietyId();
  const list = useServerFn(listSocietyNoDuesRequests);
  const { data, isLoading, isError, refetch } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-no-dues", societyId],
    queryFn: () => list({ data: { societyId: societyId! } }),
  });

  return (
    <div className="pb-24">
      <MobileHero
        title={t("nd.adminTitle")}
        subtitle={t("nd.adminSub")}
      />
      <div className="px-4 space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">{t("common.loading")}</p>}
        {isError && <LoadError title={t("nd.loadFail")} onRetry={() => refetch()} />}
        {!isLoading && !isError && (data ?? []).length === 0 && (
          <SectionCard>
            <p className="text-sm text-muted-foreground">{t("nd.emptyAdmin")}</p>
          </SectionCard>
        )}
        {(data ?? []).map((r: any) => {
          const snap = r.eligibility_snapshot ?? {};
          return (
            <SectionCard key={r.id}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-medium">{t("nd.reqId", { id: String(r.id).slice(0, 8) })}</p>
                  <p className="text-xs text-muted-foreground">
                    {ndDateTime(r.submitted_at)}
                  </p>
                </div>
                <StatusChip>{statusLabel(r.status)}</StatusChip>
              </div>
              {r.purpose && (
                <p className="text-sm mb-2">
                  <span className="text-muted-foreground">{t("nd.purpose")}:</span> {r.purpose}
                </p>
              )}
              {snap.total_outstanding > 0 && (
                <p className="text-xs text-destructive mb-2">
                  {t("nd.outstandingItems", { amt: formatCurrency(snap.total_outstanding), n: snap.blockers?.length ?? 0 })}
                </p>
              )}
              <Button asChild size="sm" variant={r.status === "submitted" || r.status === "under_review" || r.status === "approved" ? "default" : "outline"} className="min-h-11">
                <Link to="/society/no-dues/$id" params={{ id: r.id }}>
                  {r.status === "submitted" || r.status === "under_review"
                    ? t("nd.reviewReq")
                    : r.status === "approved"
                      ? t("nd.issueCert")
                      : t("nd.openDetails")}
                </Link>
              </Button>
            </SectionCard>
          );
        })}
      </div>
    </div>
  );
}
