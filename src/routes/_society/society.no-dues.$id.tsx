import { createFileRoute } from "@tanstack/react-router";
import { userMessage } from "@/lib/user-error";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusChip } from "@/components/system/StatusChip";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DialogTrigger, DialogClose,
} from "@/components/ui/dialog";
import {
  getNoDuesRequestDetail,
  reviewNoDuesRequest,
  issueNoDuesCertificate,
  revokeNoDuesCertificate,
  getCertificateDownloadUrl,
  getCertificateVerificationLink,
} from "@/lib/no-dues.functions";
import {
  statusLabel, auditActionLabel, formatCurrency, blockerTitle, blockerSubtitle, ndDate, ndDateTime,
} from "@/lib/no-dues-labels";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/no-dues/$id")({
  head: () => ({
    meta: [
      { title: "No-Dues Request — SociyoHub" },
      { name: "description", content: "Review and issue no-dues certificates." },
    ],
  }),
  component: () => (
    <FeatureGate feature="no_dues">
      <SocietyNoDuesDetail />
    </FeatureGate>
  ),
});

function verifyReasonLabel(reason?: string) {
  switch (reason) {
    case "legacy_migration_required": return i18n.t("nd.vl.legacy");
    case "legacy_token_unavailable": return i18n.t("nd.vl.older");
    case "encryption_unavailable": return i18n.t("nd.vl.temp");
    case "integrity_check_failed": return i18n.t("nd.vl.integrity");
    case "temporarily_unavailable": return i18n.t("nd.vl.temp");
    default: return i18n.t("nd.vl.none");
  }
}

function SocietyNoDuesDetail() {
  const { id } = Route.useParams();
  const { t } = useTranslation();
  const qc = useQueryClient();
  const detailFn = useServerFn(getNoDuesRequestDetail);
  const reviewFn = useServerFn(reviewNoDuesRequest);
  const issueFn = useServerFn(issueNoDuesCertificate);
  const revokeFn = useServerFn(revokeNoDuesCertificate);
  const dlFn = useServerFn(getCertificateDownloadUrl);
  const linkFn = useServerFn(getCertificateVerificationLink);

  const [approveOpen, setApproveOpen] = useState(false);
  const [approveNotes, setApproveNotes] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectNotes, setRejectNotes] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [revokeReason, setRevokeReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["nd-detail", id],
    queryFn: () => detailFn({ data: { requestId: id } }),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["nd-detail", id] });

  const approve = useMutation({
    mutationFn: () => reviewFn({ data: { requestId: id, decision: "approve", notes: approveNotes || undefined } }),
    onSuccess: (r: any) => {
      toast.success(r?.status === "blocked_by_dues" ? t("nd.blockedNew") : t("nd.st.approved"));
      setApproveOpen(false); setApproveNotes(""); invalidate();
    },
    onError: (e: any) => toast.error(userMessage(e, t("nd.failed"))),
  });

  const reject = useMutation({
    mutationFn: () => reviewFn({ data: { requestId: id, decision: "reject", reason: rejectReason.trim(), notes: rejectNotes || undefined } }),
    onSuccess: () => {
      toast.success(t("nd.st.rejected"));
      setRejectOpen(false); setRejectReason(""); setRejectNotes(""); invalidate();
    },
    onError: (e: any) => toast.error(userMessage(e, t("nd.failed"))),
  });

  const issue = useMutation({
    mutationFn: () => issueFn({ data: { requestId: id, validForDays: 90 } }),
    onSuccess: () => { toast.success(t("nd.au.issue")); setIssueOpen(false); invalidate(); },
    onError: (e: any) => {
      const m = e?.message;
      const friendly =
        m === "BLOCKED_BY_DUES" ? t("nd.blockedIssue") :
        m === "ISSUE_FAILED" ? t("nd.issueFail") :
        t("nd.issueFailGen");
      toast.error(friendly);
    },
  });

  const revoke = useMutation({
    mutationFn: () => {
      const cid = (data as any)?.certificate?.id;
      if (!cid) throw new Error("No certificate");
      return revokeFn({ data: { certificateId: cid, reason: revokeReason.trim() } });
    },
    onSuccess: () => { toast.success(t("nd.st.revoked")); setRevokeOpen(false); setRevokeReason(""); invalidate(); },
    onError: (e: any) => toast.error(userMessage(e, t("nd.failed"))),
  });

  const handleDownload = async () => {
    const cid = (data as any)?.certificate?.id;
    if (!cid) return;
    try {
      const r = await dlFn({ data: { certificateId: cid } });
      window.open(r.url, "_blank");
    } catch (e: any) { toast.error(userMessage(e, t("nd.failed"))); }
  };

  const handleCopyVerify = async () => {
    const cid = (data as any)?.certificate?.id;
    if (!cid) return;
    try {
      const r: any = await linkFn({ data: { certificateId: cid } });
      if (!r?.available) { toast.error(verifyReasonLabel(r?.reason)); return; }
      await navigator.clipboard.writeText(r.url);
      toast.success(t("nd.linkCopied"));
    } catch { toast.error(t("nd.linkFetchFail")); }
  };

  if (isLoading || !data) {
    return (
      <div className="pb-24">
        <MobileHero title={t("nd.reqTitle")} subtitle={t("common.loading")} />
      </div>
    );
  }

  const req = (data as any).request;
  const flat = (data as any).flat;
  const resident = (data as any).resident;
  const audit = (data as any).audit ?? [];
  const cert = (data as any).certificate;
  const elig = req?.eligibility_snapshot ?? {};
  const blockers = elig?.blockers ?? [];

  const canApprove = req.status === "submitted";
  const canReject = req.status === "submitted";
  const canIssue = req.status === "approved" && !cert;
  const canRevoke = cert && !cert.revoked_at;
  const rejectValid = rejectReason.trim().length >= 3;
  const revokeValid = revokeReason.trim().length >= 3;

  return (
    <div className="pb-24">
      <MobileHero
        title={t("nd.reqFor", { unit: flat?.flat_number ?? "—" })}
        subtitle={resident?.full_name ?? t("nd.resident")}
      />
      <div className="px-4 space-y-3">
        <SectionCard>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">{t("common.status")}</p>
              <StatusChip>{statusLabel(req.status)}</StatusChip>
            </div>
            <div className="text-end">
              <p className="text-xs text-muted-foreground">{t("nd.outstandingLbl")}</p>
              <p className="font-semibold">{formatCurrency(elig?.total_outstanding)}</p>
            </div>
          </div>
          {req.purpose && (
            <p className="text-sm mt-2">
              <span className="text-muted-foreground">{t("nd.purpose")}: </span>{req.purpose}
            </p>
          )}
          {req.rejection_reason && (
            <p className="text-sm mt-2 text-destructive">{t("nd.reasonV", { v: req.rejection_reason })}</p>
          )}
        </SectionCard>

        {blockers.length > 0 && (
          <SectionCard>
            <p className="text-sm font-medium mb-2">{t("nd.blockers")}</p>
            <ul className="space-y-3">
              {blockers.slice(0, 20).map((b: any, i: number) => (
                <li key={i} className="border-s-2 border-destructive/40 ps-3">
                  <p className="text-sm font-medium">{blockerTitle(b)}</p>
                  {blockerSubtitle(b) && (
                    <p className="text-xs text-muted-foreground">{blockerSubtitle(b)}</p>
                  )}
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
            {cert.revoked_at && (
              <p className="text-xs text-destructive">{t("nd.revokedV", { v: cert.revoke_reason ?? "" })}</p>
            )}
            <div className="flex gap-2 mt-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={handleDownload}>{t("common.download")}</Button>
              <Button size="sm" variant="ghost" onClick={handleCopyVerify}>{t("nd.copyLink")}</Button>
            </div>
          </SectionCard>
        )}

        {(canApprove || canReject) && (
          <SectionCard>
            <p className="text-sm font-medium mb-2">{t("nd.review")}</p>
            <div className="flex gap-2 flex-wrap">
              {canApprove && (
                <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">{t("nd.approveBtn")}</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("nd.approveTitle")}</DialogTitle>
                      <DialogDescription>
                        {t("nd.approveDesc")}
                      </DialogDescription>
                    </DialogHeader>
                    <Textarea
                      placeholder={t("nd.notesOpt")}
                      value={approveNotes}
                      onChange={(e) => setApproveNotes(e.target.value)}
                      maxLength={1000}
                    />
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline" disabled={approve.isPending}>{t("common.cancel")}</Button>
                      </DialogClose>
                      <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                        {approve.isPending ? t("nd.approving") : t("nd.confirmApprove")}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
              {canReject && (
                <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="destructive">{t("nd.rejectBtn")}</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>{t("nd.rejectTitle")}</DialogTitle>
                      <DialogDescription>
                        {t("nd.rejectDesc")}
                      </DialogDescription>
                    </DialogHeader>
                    <Textarea
                      placeholder={t("nd.reasonPh")}
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      minLength={3}
                      maxLength={500}
                      className="mb-2"
                    />
                    <Textarea
                      placeholder={t("nd.internalNotes")}
                      value={rejectNotes}
                      onChange={(e) => setRejectNotes(e.target.value)}
                      maxLength={1000}
                    />
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline" disabled={reject.isPending}>{t("common.cancel")}</Button>
                      </DialogClose>
                      <Button
                        variant="destructive"
                        onClick={() => reject.mutate()}
                        disabled={reject.isPending || !rejectValid}
                      >
                        {reject.isPending ? t("nd.rejecting") : t("nd.confirmReject")}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </SectionCard>
        )}

        {canIssue && (
          <SectionCard>
            <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
              <DialogTrigger asChild>
                <Button className="w-full">{t("nd.issueBtn")}</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>{t("nd.issueTitle")}</DialogTitle>
                  <DialogDescription>
                    {t("nd.issueDesc")}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline" disabled={issue.isPending}>{t("common.cancel")}</Button>
                  </DialogClose>
                  <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
                    {issue.isPending ? t("nd.issuing") : t("nd.confirmIssue")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </SectionCard>
        )}

        {canRevoke && (
          <SectionCard>
            <AlertDialog open={revokeOpen} onOpenChange={setRevokeOpen}>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive">{t("nd.revokeBtn")}</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("nd.revokeTitle")}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("nd.revokeDesc")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Textarea
                  placeholder={t("nd.reasonPh")}
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  minLength={3}
                  maxLength={500}
                />
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={revoke.isPending}>{t("common.cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => { e.preventDefault(); revoke.mutate(); }}
                    disabled={revoke.isPending || !revokeValid}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {revoke.isPending ? t("nd.revoking") : t("nd.confirmRevoke")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
