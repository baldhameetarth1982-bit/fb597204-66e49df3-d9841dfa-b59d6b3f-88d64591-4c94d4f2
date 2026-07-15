import { createFileRoute } from "@tanstack/react-router";
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
  statusLabel, auditActionLabel, formatCurrency, blockerTitle, blockerSubtitle,
} from "@/lib/no-dues-labels";

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
    case "legacy_migration_required": return "Verification link unavailable for this legacy certificate. The PDF's original QR remains valid.";
    case "legacy_token_unavailable": return "Verification link unavailable for this older certificate.";
    case "encryption_unavailable": return "Verification link temporarily unavailable.";
    case "integrity_check_failed": return "Verification link failed an integrity check.";
    case "temporarily_unavailable": return "Verification link temporarily unavailable.";
    default: return "Verification link unavailable.";
  }
}

function SocietyNoDuesDetail() {
  const { id } = Route.useParams();
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
      toast.success(r?.status === "blocked_by_dues" ? "Blocked — new dues found" : "Approved");
      setApproveOpen(false); setApproveNotes(""); invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const reject = useMutation({
    mutationFn: () => reviewFn({ data: { requestId: id, decision: "reject", reason: rejectReason.trim(), notes: rejectNotes || undefined } }),
    onSuccess: () => {
      toast.success("Rejected");
      setRejectOpen(false); setRejectReason(""); setRejectNotes(""); invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const issue = useMutation({
    mutationFn: () => issueFn({ data: { requestId: id, validForDays: 90 } }),
    onSuccess: () => { toast.success("Certificate issued"); setIssueOpen(false); invalidate(); },
    onError: (e: any) => {
      const m = e?.message;
      const friendly =
        m === "BLOCKED_BY_DUES" ? "Blocked — dues appeared during issuance" :
        m === "ISSUE_FAILED" ? "Certificate could not be issued. Please try again." :
        "Failed to issue certificate";
      toast.error(friendly);
    },
  });

  const revoke = useMutation({
    mutationFn: () => {
      const cid = (data as any)?.certificate?.id;
      if (!cid) throw new Error("No certificate");
      return revokeFn({ data: { certificateId: cid, reason: revokeReason.trim() } });
    },
    onSuccess: () => { toast.success("Revoked"); setRevokeOpen(false); setRevokeReason(""); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const handleDownload = async () => {
    const cid = (data as any)?.certificate?.id;
    if (!cid) return;
    try {
      const r = await dlFn({ data: { certificateId: cid } });
      window.open(r.url, "_blank");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const handleCopyVerify = async () => {
    const cid = (data as any)?.certificate?.id;
    if (!cid) return;
    try {
      const r: any = await linkFn({ data: { certificateId: cid } });
      if (!r?.available) { toast.error(verifyReasonLabel(r?.reason)); return; }
      await navigator.clipboard.writeText(r.url);
      toast.success("Link copied");
    } catch { toast.error("Failed to fetch verification link"); }
  };

  if (isLoading || !data) {
    return (
      <div className="pb-24">
        <MobileHero title="No-Dues Request" subtitle="Loading…" />
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
        title={`Request · ${flat?.flat_number ?? "—"}`}
        subtitle={resident?.full_name ?? "Resident"}
      />
      <div className="px-4 space-y-3">
        <SectionCard>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">Status</p>
              <StatusChip>{statusLabel(req.status)}</StatusChip>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Outstanding</p>
              <p className="font-semibold">{formatCurrency(elig?.total_outstanding)}</p>
            </div>
          </div>
          {req.purpose && (
            <p className="text-sm mt-2">
              <span className="text-muted-foreground">Purpose: </span>{req.purpose}
            </p>
          )}
          {req.rejection_reason && (
            <p className="text-sm mt-2 text-destructive">Reason: {req.rejection_reason}</p>
          )}
        </SectionCard>

        {blockers.length > 0 && (
          <SectionCard>
            <p className="text-sm font-medium mb-2">Blockers</p>
            <ul className="space-y-3">
              {blockers.slice(0, 20).map((b: any, i: number) => (
                <li key={i} className="border-l-2 border-destructive/40 pl-3">
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
            <p className="text-sm font-medium mb-1">Certificate</p>
            <p className="text-xs text-muted-foreground">No. {cert.certificate_number}</p>
            <p className="text-xs text-muted-foreground">
              Issued {new Date(cert.issued_at).toLocaleDateString()}
              {cert.valid_until ? ` · valid till ${cert.valid_until}` : ""}
            </p>
            {cert.revoked_at && (
              <p className="text-xs text-destructive">Revoked · {cert.revoke_reason ?? ""}</p>
            )}
            <div className="flex gap-2 mt-2 flex-wrap">
              <Button size="sm" variant="outline" onClick={handleDownload}>Download</Button>
              <Button size="sm" variant="ghost" onClick={handleCopyVerify}>Copy verify link</Button>
            </div>
          </SectionCard>
        )}

        {(canApprove || canReject) && (
          <SectionCard>
            <p className="text-sm font-medium mb-2">Review</p>
            <div className="flex gap-2 flex-wrap">
              {canApprove && (
                <Dialog open={approveOpen} onOpenChange={setApproveOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm">Approve…</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Approve request?</DialogTitle>
                      <DialogDescription>
                        Eligibility will be rechecked. If new dues appeared, the request
                        moves to Blocked by Dues instead of being approved.
                      </DialogDescription>
                    </DialogHeader>
                    <Textarea
                      placeholder="Notes (optional)"
                      value={approveNotes}
                      onChange={(e) => setApproveNotes(e.target.value)}
                      maxLength={1000}
                    />
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline" disabled={approve.isPending}>Cancel</Button>
                      </DialogClose>
                      <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
                        {approve.isPending ? "Approving…" : "Confirm approve"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              )}
              {canReject && (
                <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="destructive">Reject…</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Reject request?</DialogTitle>
                      <DialogDescription>
                        The resident will see this reason. Please be specific.
                      </DialogDescription>
                    </DialogHeader>
                    <Textarea
                      placeholder="Reason (required, 3–500 chars)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      minLength={3}
                      maxLength={500}
                      className="mb-2"
                    />
                    <Textarea
                      placeholder="Internal notes (optional)"
                      value={rejectNotes}
                      onChange={(e) => setRejectNotes(e.target.value)}
                      maxLength={1000}
                    />
                    <DialogFooter>
                      <DialogClose asChild>
                        <Button variant="outline" disabled={reject.isPending}>Cancel</Button>
                      </DialogClose>
                      <Button
                        variant="destructive"
                        onClick={() => reject.mutate()}
                        disabled={reject.isPending || !rejectValid}
                      >
                        {reject.isPending ? "Rejecting…" : "Confirm reject"}
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
                <Button className="w-full">Issue Certificate…</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Issue certificate?</DialogTitle>
                  <DialogDescription>
                    Final eligibility will be rechecked during issuance. If new dues
                    appeared the certificate will not be issued. Default validity is 90 days.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline" disabled={issue.isPending}>Cancel</Button>
                  </DialogClose>
                  <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
                    {issue.isPending ? "Issuing…" : "Confirm issue"}
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
                <Button size="sm" variant="destructive">Revoke Certificate…</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revoke this certificate?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Public verification will show this certificate as <strong>Revoked</strong>.
                    This cannot be undone. Provide a reason (visible on the audit log).
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <Textarea
                  placeholder="Reason (required, 3–500 chars)"
                  value={revokeReason}
                  onChange={(e) => setRevokeReason(e.target.value)}
                  minLength={3}
                  maxLength={500}
                />
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={revoke.isPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={(e) => { e.preventDefault(); revoke.mutate(); }}
                    disabled={revoke.isPending || !revokeValid}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {revoke.isPending ? "Revoking…" : "Confirm revoke"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </SectionCard>
        )}

        <SectionCard>
          <p className="text-sm font-medium mb-2">Timeline</p>
          <ul className="space-y-2 text-xs">
            {audit.map((a: any) => (
              <li key={a.id} className="flex justify-between">
                <span>{auditActionLabel(a.action)}</span>
                <span className="text-muted-foreground">
                  {new Date(a.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </SectionCard>
      </div>
    </div>
  );
}
