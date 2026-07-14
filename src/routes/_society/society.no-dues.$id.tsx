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
  getNoDuesRequestDetail,
  reviewNoDuesRequest,
  issueNoDuesCertificate,
  revokeNoDuesCertificate,
  getCertificateDownloadUrl,
} from "@/lib/no-dues.functions";
import {
  statusLabel,
  auditActionLabel,
  formatCurrency,
  blockerTitle,
  blockerSubtitle,
} from "@/lib/no-dues-labels";

export const Route = createFileRoute("/_society/society/no-dues/$id")({
  head: () => ({
    meta: [
      { title: "No-Dues Request — SocioHub" },
      { name: "description", content: "Review and issue no-dues certificates." },
    ],
  }),
  component: () => (
    <FeatureGate feature="no_dues">
      <SocietyNoDuesDetail />
    </FeatureGate>
  ),
});

function SocietyNoDuesDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const detailFn = useServerFn(getNoDuesRequestDetail);
  const reviewFn = useServerFn(reviewNoDuesRequest);
  const issueFn = useServerFn(issueNoDuesCertificate);
  const revokeFn = useServerFn(revokeNoDuesCertificate);
  const dlFn = useServerFn(getCertificateDownloadUrl);

  const [notes, setNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [revokeReason, setRevokeReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["nd-detail", id],
    queryFn: () => detailFn({ data: { requestId: id } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["nd-detail", id] });

  const approve = useMutation({
    mutationFn: () => reviewFn({ data: { requestId: id, decision: "approve", notes } }),
    onSuccess: (r: any) => {
      toast.success(r?.status === "blocked_by_dues" ? "Blocked — new dues found" : "Approved");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const reject = useMutation({
    mutationFn: () =>
      reviewFn({ data: { requestId: id, decision: "reject", reason: rejectReason, notes } }),
    onSuccess: () => {
      toast.success("Rejected");
      setRejectReason("");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const issue = useMutation({
    mutationFn: () => issueFn({ data: { requestId: id, validForDays: 90 } }),
    onSuccess: () => {
      toast.success("Certificate issued");
      invalidate();
    },
    onError: (e: any) =>
      toast.error(e?.message === "BLOCKED_BY_DUES" ? "Blocked — dues appeared" : "Failed"),
  });

  const revoke = useMutation({
    mutationFn: () => {
      const cid = (data as any)?.certificate?.id;
      if (!cid) throw new Error("No certificate");
      return revokeFn({ data: { certificateId: cid, reason: revokeReason } });
    },
    onSuccess: () => {
      toast.success("Revoked");
      setRevokeReason("");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const handleDownload = async () => {
    const cid = (data as any)?.certificate?.id;
    if (!cid) return;
    try {
      const r = await dlFn({ data: { certificateId: cid } });
      window.open(r.url, "_blank");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
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
              <StatusChip>{req.status}</StatusChip>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Outstanding</p>
              <p className="font-semibold">₹{Number(elig?.total_outstanding ?? 0)}</p>
            </div>
          </div>
          {req.purpose && (
            <p className="text-sm mt-2">
              <span className="text-muted-foreground">Purpose: </span>
              {req.purpose}
            </p>
          )}
          {req.rejection_reason && (
            <p className="text-sm mt-2 text-destructive">Reason: {req.rejection_reason}</p>
          )}
        </SectionCard>

        {blockers.length > 0 && (
          <SectionCard>
            <p className="text-sm font-medium mb-1">Blockers</p>
            <ul className="text-xs space-y-1">
              {blockers.slice(0, 20).map((b: any, i: number) => (
                <li key={i} className="text-muted-foreground">
                  {b.type}
                  {b.bill_number ? ` · ${b.bill_number}` : ""}
                  {b.remaining_amount != null ? ` · ₹${b.remaining_amount}` : ""}
                  {b.due_date ? ` · due ${b.due_date}` : ""}
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
              <p className="text-xs text-destructive">
                Revoked · {cert.revoke_reason ?? ""}
              </p>
            )}
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="outline" onClick={handleDownload}>
                Download
              </Button>
            </div>
          </SectionCard>
        )}

        {(canApprove || canReject) && (
          <SectionCard>
            <p className="text-sm font-medium mb-2">Review</p>
            <Textarea
              placeholder="Admin notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              className="mb-2"
            />
            {canReject && (
              <Textarea
                placeholder="Rejection reason (required to reject)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                minLength={3}
                maxLength={500}
                className="mb-2"
              />
            )}
            <div className="flex gap-2">
              {canApprove && (
                <Button
                  size="sm"
                  onClick={() => approve.mutate()}
                  disabled={approve.isPending}
                >
                  Approve
                </Button>
              )}
              {canReject && (
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => reject.mutate()}
                  disabled={reject.isPending || rejectReason.trim().length < 3}
                >
                  Reject
                </Button>
              )}
            </div>
          </SectionCard>
        )}

        {canIssue && (
          <SectionCard>
            <Button
              className="w-full"
              onClick={() => issue.mutate()}
              disabled={issue.isPending}
            >
              Issue Certificate
            </Button>
          </SectionCard>
        )}

        {canRevoke && (
          <SectionCard>
            <p className="text-sm font-medium mb-2">Revoke Certificate</p>
            <Textarea
              placeholder="Reason (required)"
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              minLength={3}
              maxLength={500}
              className="mb-2"
            />
            <Button
              size="sm"
              variant="destructive"
              onClick={() => revoke.mutate()}
              disabled={revoke.isPending || revokeReason.trim().length < 3}
            >
              Revoke
            </Button>
          </SectionCard>
        )}

        <SectionCard>
          <p className="text-sm font-medium mb-2">Timeline</p>
          <ul className="space-y-2 text-xs">
            {audit.map((a: any) => (
              <li key={a.id} className="flex justify-between">
                <span>
                  {a.action}
                  {a.previous_status && a.new_status ? ` · ${a.previous_status} → ${a.new_status}` : ""}
                </span>
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
