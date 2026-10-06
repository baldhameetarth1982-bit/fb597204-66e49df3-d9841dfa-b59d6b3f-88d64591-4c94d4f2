import { createFileRoute } from "@tanstack/react-router";
import { userMessage } from "@/lib/user-error";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusChip } from "@/components/system/StatusChip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { fetchCurrentHomeId } from "@/components/resident/HomeSwitcher";
import {
  listMyNoDuesRequests,
  submitNoDuesRequest,
  checkNoDuesEligibility,
  getCertificateDownloadUrl,
  getNoDuesRequestDetail,
} from "@/lib/no-dues.functions";
import { useTranslation } from "react-i18next";
import { statusLabel, formatCurrency, ndDate } from "@/lib/no-dues-labels";

export const Route = createFileRoute("/_resident/app/no-dues/")({
  head: () => ({
    meta: [
      { title: "No-Dues Certificate — SociyoHub" },
      { name: "description", content: "Request and download your no-dues certificate." },
    ],
  }),
  component: () => (
    <FeatureGate feature="no_dues">
      <ResidentNoDues />
    </FeatureGate>
  ),
});

function ResidentNoDues() {
  const { t } = useTranslation();
  const list = useServerFn(listMyNoDuesRequests);
  const submit = useServerFn(submitNoDuesRequest);
  const check = useServerFn(checkNoDuesEligibility);
  const dl = useServerFn(getCertificateDownloadUrl);
  const [purpose, setPurpose] = useState("");

  const { data: myFlat } = useQuery({
    queryKey: ["my-active-flat"],
    queryFn: async () => {
      // Server-selected current home; eligibility is still re-checked on the server.
      const homeId = await fetchCurrentHomeId();
      if (!homeId) return null;
      const { data } = await supabase.from("flats").select("id,society_id,flat_number").eq("id", homeId).maybeSingle();
      return (data as any) ?? null;
    },
  });

  const { data: requests, refetch } = useQuery({
    queryKey: ["my-no-dues"],
    queryFn: () => list(),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!myFlat) throw new Error(t("nd.noHome"));
      return submit({
        data: { societyId: myFlat.society_id, flatId: myFlat.id, purpose: purpose || undefined },
      });
    },
    onSuccess: (r: any) => {
      if (r.status === "blocked_by_dues")
        toast.warning(t("nd.blockedToast", { amt: formatCurrency(r.snapshot?.total_outstanding ?? 0) }));
      else toast.success(t("nd.submitted"));
      setPurpose("");
      refetch();
    },
    onError: (e: any) => toast.error(userMessage(e, t("nd.failed"))),
  });

  return (
    <div className="pb-24">
      <MobileHero title={t("nd.title")} subtitle={t("nd.subtitle")} icon={FileCheck2} />
      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        <SectionCard title={t("nd.newReq")} description={t("nd.newReqDesc")}>
          <label htmlFor="no-dues-purpose" className="mb-2 block text-sm font-medium">{t("nd.purpose")}</label>
          <Input
            id="no-dues-purpose"
            placeholder={t("nd.purposePh")}
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            maxLength={500}
            className="mb-3"
          />
          <Button
            onClick={() => mutation.mutate()}
            disabled={!myFlat || mutation.isPending}
            className="w-full"
          >
            {mutation.isPending ? t("nd.submitting") : t("nd.submit")}
          </Button>
        </SectionCard>

        {(requests ?? []).length === 0 && (
          <div className="border-y border-dashed border-border py-10 text-center">
            <FileCheck2 className="mx-auto h-7 w-7 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium">{t("nd.empty")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("nd.emptyDesc")}</p>
          </div>
        )}
        {(requests ?? []).map((r: any) => (
          <SectionCard key={r.id}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium">
                {ndDate(r.submitted_at)}
              </p>
              <StatusChip>{statusLabel(r.status)}</StatusChip>
            </div>
            {r.purpose && <p className="text-xs text-muted-foreground">{r.purpose}</p>}
            {r.eligibility_snapshot?.total_outstanding > 0 && (
              <p className="text-xs text-destructive mt-1">
                {t("nd.outstanding", { amt: formatCurrency(r.eligibility_snapshot.total_outstanding) })}
              </p>
            )}
            {r.status === "issued" && (
              <CertificateDownload requestId={r.id} dl={dl as any} />
            )}
          </SectionCard>
        ))}
      </div>
    </div>
  );
}

/**
 * `no_dues_certificates` is not readable by `authenticated` (all reads go
 * through server functions using supabaseAdmin), so the certificate id is
 * resolved via the authorized `getNoDuesRequestDetail` server function.
 */
function CertificateDownload({ requestId, dl }: { requestId: string; dl: any }) {
  const { t } = useTranslation();
  const detail = useServerFn(getNoDuesRequestDetail);
  const { data: certId, isLoading } = useQuery({
    queryKey: ["cert-for-req", requestId],
    queryFn: async () => {
      const res = await detail({ data: { requestId } });
      return (res?.certificate?.id as string | undefined) ?? null;
    },
  });
  const handle = async () => {
    if (!certId) return;
    try {
      const r = await dl({ data: { certificateId: certId } });
      window.open(r.url, "_blank");
    } catch (e: any) {
      toast.error(userMessage(e, t("nd.failed")));
    }
  };
  return (
    <Button
      size="sm"
      variant="outline"
      className="mt-2"
      onClick={handle}
      disabled={isLoading || !certId}
    >
      {isLoading ? t("nd.preparing") : certId ? t("nd.downloadCert") : t("nd.certUnavailable")}
    </Button>
  );
}
