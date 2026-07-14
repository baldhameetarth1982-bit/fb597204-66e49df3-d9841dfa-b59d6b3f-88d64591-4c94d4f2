import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { StatusChip } from "@/components/system/StatusChip";
import { Button } from "@/components/ui/button";
import {
  getNoDuesRequestDetail,
  getCertificateDownloadUrl,
} from "@/lib/no-dues.functions";

export const Route = createFileRoute("/_resident/app/no-dues/$id")({
  head: () => ({
    meta: [
      { title: "No-Dues Request — SocioHub" },
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
  const detailFn = useServerFn(getNoDuesRequestDetail);
  const dlFn = useServerFn(getCertificateDownloadUrl);
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
  const audit = (data as any).audit ?? [];
  const cert = (data as any).certificate;
  const elig = req?.eligibility_snapshot ?? {};
  const blockers = elig?.blockers ?? [];

  return (
    <div className="pb-24">
      <MobileHero title={`Request · ${flat?.flat_number ?? "—"}`} subtitle={req.status} />
      <div className="px-4 space-y-3">
        <SectionCard>
          <div className="flex items-center justify-between">
            <StatusChip>{req.status}</StatusChip>
            <p className="text-sm">Outstanding ₹{Number(elig?.total_outstanding ?? 0)}</p>
          </div>
          {req.purpose && (
            <p className="text-xs mt-2 text-muted-foreground">Purpose: {req.purpose}</p>
          )}
          {req.rejection_reason && (
            <p className="text-xs mt-2 text-destructive">Reason: {req.rejection_reason}</p>
          )}
        </SectionCard>

        {blockers.length > 0 && (
          <SectionCard>
            <p className="text-sm font-medium mb-1">Why it's blocked</p>
            <ul className="text-xs space-y-1">
              {blockers.slice(0, 20).map((b: any, i: number) => (
                <li key={i} className="text-muted-foreground">
                  {b.type}
                  {b.bill_number ? ` · ${b.bill_number}` : ""}
                  {b.remaining_amount != null ? ` · ₹${b.remaining_amount}` : ""}
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
            {cert.revoked_at ? (
              <p className="text-xs text-destructive">Revoked</p>
            ) : (
              <Button size="sm" variant="outline" onClick={handleDownload} className="mt-2">
                Download PDF
              </Button>
            )}
          </SectionCard>
        )}

        <SectionCard>
          <p className="text-sm font-medium mb-2">Timeline</p>
          <ul className="space-y-2 text-xs">
            {audit.map((a: any) => (
              <li key={a.id} className="flex justify-between">
                <span>
                  {a.action}
                  {a.new_status ? ` → ${a.new_status}` : ""}
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
