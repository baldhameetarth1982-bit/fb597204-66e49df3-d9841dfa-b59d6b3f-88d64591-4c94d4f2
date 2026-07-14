import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusChip } from "@/components/system/StatusChip";
import { Button } from "@/components/ui/button";
import {
  listSocietyNoDuesRequests,
  reviewNoDuesRequest,
  issueNoDuesCertificate,
} from "@/lib/no-dues.functions";
import { useSocietyId } from "@/hooks/useSocietyId";

export const Route = createFileRoute("/_society/society/no-dues")({
  head: () => ({
    meta: [
      { title: "No-Dues Requests — SocioHub" },
      { name: "description", content: "Review resident no-dues requests and issue certificates." },
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
  const { societyId } = useSocietyId();
  const list = useServerFn(listSocietyNoDuesRequests);
  const review = useServerFn(reviewNoDuesRequest);
  const issue = useServerFn(issueNoDuesCertificate);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, refetch, isLoading } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-no-dues", societyId],
    queryFn: () => list({ data: { societyId: societyId! } }),
  });

  const act = useMutation({
    mutationFn: async (args: { id: string; kind: "approve" | "reject" | "issue" }) => {
      setBusy(args.id);
      try {
        if (args.kind === "issue") {
          await issue({ data: { requestId: args.id } });
        } else {
          await review({
            data: {
              requestId: args.id,
              decision: args.kind,
              reason: args.kind === "reject" ? "Rejected by admin" : undefined,
            },
          });
        }
      } finally {
        setBusy(null);
      }
    },
    onSuccess: () => {
      toast.success("Updated");
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <div className="pb-24">
      <MobileHero
        title="No-Dues Requests"
        subtitle="Review, approve, and issue no-dues certificates."
      />
      <div className="px-4 space-y-3">
        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && (data ?? []).length === 0 && (
          <SectionCard>
            <p className="text-sm text-muted-foreground">No requests yet.</p>
          </SectionCard>
        )}
        {(data ?? []).map((r: any) => {
          const snap = r.eligibility_snapshot ?? {};
          return (
            <SectionCard key={r.id}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-medium">Request {String(r.id).slice(0, 8)}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(r.submitted_at).toLocaleString()}
                  </p>
                </div>
                <StatusChip status={r.status} />
              </div>
              {r.purpose && (
                <p className="text-sm mb-2">
                  <span className="text-muted-foreground">Purpose:</span> {r.purpose}
                </p>
              )}
              {snap.total_outstanding > 0 && (
                <p className="text-xs text-destructive mb-2">
                  Outstanding: ₹{snap.total_outstanding} ({snap.outstanding_bills?.length ?? 0} bills)
                </p>
              )}
              <div className="flex gap-2 flex-wrap">
                {(r.status === "submitted" || r.status === "under_review") && (
                  <>
                    <Button
                      size="sm"
                      disabled={busy === r.id}
                      onClick={() => act.mutate({ id: r.id, kind: "approve" })}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === r.id}
                      onClick={() => act.mutate({ id: r.id, kind: "reject" })}
                    >
                      Reject
                    </Button>
                  </>
                )}
                {r.status === "approved" && (
                  <Button
                    size="sm"
                    disabled={busy === r.id}
                    onClick={() => act.mutate({ id: r.id, kind: "issue" })}
                  >
                    Issue Certificate
                  </Button>
                )}
              </div>
            </SectionCard>
          );
        })}
      </div>
    </div>
  );
}
