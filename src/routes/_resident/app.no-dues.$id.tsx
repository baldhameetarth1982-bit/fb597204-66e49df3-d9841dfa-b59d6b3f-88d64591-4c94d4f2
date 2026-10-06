import { createFileRoute } from "@tanstack/react-router";
import { userMessage } from "@/lib/user-error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusChip } from "@/components/system/StatusChip";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import {
  getNoDuesRequestDetail,
  getCertificateDownloadUrl,
  getCertificateVerificationLink,
  recheckAndResubmitNoDues,
} from "@/lib/no-dues.functions";
import {
  statusLabel,
  statusExplanation,
  auditActionLabel,
  formatCurrency,
  blockerTitle,
  blockerSubtitle,
  blockerResolution,
  ndDate,
  ndDateTime,
} from "@/lib/no-dues-labels";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_resident/app/no-dues/$id")({
  head: () => ({
    meta: [
      { title: "No-Dues Request — SociyoHub" },
      { name: "description", content: "Track your no-dues request." },
    ],
  }),
  component: () => (
    <FeatureGate feature="no_dues">
      <ResidentNoDuesDetail />
    </FeatureGate>
  ),
});

function ResidentNoDuesDetail() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const detailFn = useServerFn(getNoDuesRequestDetail);
  const dlFn = useServerFn(getCertificateDownloadUrl);
  const linkFn = useServerFn(getCertificateVerificationLink);
  const recheckFn = useServerFn(recheckAndResubmitNoDues);

  const { data, isLoading } = useQuery({
    queryKey: ["nd-detail-resident", id],
    queryFn: () => detailFn({ data: { requestId: id } }),
  });

  const handleDownload = async () => {
    const cid = (data as any)?.certificate?.id;
    if (!cid) return;
    try {
      const r = await dlFn({ data: { certificateId: cid } });
      window.open(r.url, "_blank");
    } catch (e: any) {
      toast.error(userMessage(e, t("nd.failed")));
    }
  };

  const handleCopyVerify = async () => {
    const cid = (data as any)?.certificate?.id;
    if (!cid) return;
    try {
      const r: any = await linkFn({ data: { certificateId: cid } });
      if (!r?.available) {
        const msg =
          r?.reason === "legacy_migration_required"
            ? t("nd.vl.legacyResident")
            : t("nd.vl.thisCert");
        toast.error(msg);
        return;
      }
      await navigator.clipboard.writeText(r.url);
      toast.success(t("nd.linkCopied"));
    } catch {
      toast.error(t("nd.linkFetchFail"));
    }
  };

  const [recheckOpen, setRecheckOpen] = useState(false);
  const recheck = useMutation({
    mutationFn: () => recheckFn({ data: { requestId: id } }),
    onSuccess: (r: any) => {
      setRecheckOpen(false);
      if (r?.status === "submitted") toast.success(t("nd.resubmitted"));
      else toast.info(t("nd.stillPending"));
      qc.invalidateQueries({ queryKey: ["nd-detail-resident", id] });
    },
    onError: (e: any) => {
      toast.error(e?.message === "RATE_LIMITED"
        ? t("nd.recheckWait")
        : t("nd.recheckFail"));
    },
  });

  if (isLoading || !data) {
    return (
      <div className="pb-24">
        <MobileHero title={t("nd.reqTitle")} subtitle={t("nd.loadingDetails")} icon={FileCheck2} />
      </div>
    );
  }

  const req = (data as any).request;
  const flat = (data as any).flat;
  const audit = (data as any).audit ?? [];
  const cert = (data as any).certificate;
  const elig = req?.eligibility_snapshot ?? {};
  const blockers = elig?.blockers ?? [];

  return (
    <div className="pb-24">
      <MobileHero title={t("nd.reqFor", { unit: flat?.flat_number ?? "—" })} subtitle={statusLabel(req.status)} icon={FileCheck2} />
      <div className="mx-auto max-w-3xl space-y-4 px-4 pt-4">
        <SectionCard>
          <div className="flex items-center justify-between">
            <StatusChip>{statusLabel(req.status)}</StatusChip>
            <p className="text-sm">{t("nd.outstanding", { amt: formatCurrency(elig?.total_outstanding) })}</p>
          </div>
          {statusExplanation(req.status) && (
            <p className="text-xs mt-2 text-muted-foreground">{statusExplanation(req.status)}</p>
          )}
          {req.purpose && (
            <p className="text-xs mt-2 text-muted-foreground">{t("nd.purposeV", { v: req.purpose })}</p>
          )}
          {req.rejection_reason && (
            <p className="text-xs mt-2 text-destructive">{t("nd.reasonV", { v: req.rejection_reason })}</p>
          )}
          {req.status === "blocked_by_dues" && (
            <div className="mt-3">
              <Dialog open={recheckOpen} onOpenChange={setRecheckOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">{t("nd.recheckBtn")}</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{t("nd.recheckTitle")}</DialogTitle>
                    <DialogDescription>
                      {t("nd.recheckDesc")}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline" disabled={recheck.isPending}>{t("common.cancel")}</Button>
                    </DialogClose>
                    <Button onClick={() => recheck.mutate()} disabled={recheck.isPending}>
                      {recheck.isPending ? t("nd.rechecking") : t("nd.confirmRecheck")}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </SectionCard>

        {blockers.length > 0 && (
          <SectionCard>
            <p className="text-sm font-medium mb-2">{t("nd.whyBlocked")}</p>
            <ul className="space-y-3">
              {blockers.slice(0, 20).map((b: any, i: number) => (
                <li key={i} className="border-s-2 border-destructive/40 ps-3">
                  <p className="text-sm font-medium">{blockerTitle(b)}</p>
                  {blockerSubtitle(b) && (
                    <p className="text-xs text-muted-foreground">{blockerSubtitle(b)}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">{blockerResolution(b)}</p>
                </li>
              ))}
            </ul>
          </SectionCard>
        )}

        {cert && (
          <SectionCard>
            <p className="text-sm font-medium mb-1">{t("nd.cert")}</p>
            <p className="text-xs text-muted-foreground">{t("nd.certNo", { n: cert.certificate_number })}</p>
            <p className="text-xs text-muted-foreground">
              {t("nd.issuedOn", { d: ndDate(cert.issued_at) })}
              {cert.valid_until ? ` · ${t("nd.validTill", { d: cert.valid_until })}` : ""}
            </p>
            {cert.revoked_at ? (
              <p className="text-xs text-destructive mt-1">{t("nd.certRevoked")}</p>
            ) : (
              <div className="flex gap-2 mt-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={handleDownload}>{t("nd.downloadPdf")}</Button>
                <Button size="sm" variant="ghost" onClick={handleCopyVerify}>{t("nd.copyLink")}</Button>
              </div>
            )}
          </SectionCard>
        )}


        <SectionCard>
          <p className="text-sm font-medium mb-2">{t("nd.timeline")}</p>
          <ul className="space-y-2 text-xs">
            {audit.map((a: any) => (
              <li key={a.id} className="flex justify-between">
                <span>{auditActionLabel(a.action)}</span>
                <span className="text-muted-foreground">
                  {ndDateTime(a.created_at)}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
