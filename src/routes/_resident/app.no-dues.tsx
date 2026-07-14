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
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import {
  listMyNoDuesRequests,
  submitNoDuesRequest,
  checkNoDuesEligibility,
  getCertificateDownloadUrl,
} from "@/lib/no-dues.functions";

export const Route = createFileRoute("/_resident/app/no-dues")({
  head: () => ({
    meta: [
      { title: "No-Dues Certificate — SocioHub" },
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
  const list = useServerFn(listMyNoDuesRequests);
  const submit = useServerFn(submitNoDuesRequest);
  const check = useServerFn(checkNoDuesEligibility);
  const dl = useServerFn(getCertificateDownloadUrl);
  const [purpose, setPurpose] = useState("");

  const { data: myFlat } = useQuery({
    queryKey: ["my-active-flat"],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data } = await supabase
        .from("flat_residents")
        .select("flat_id,flats(id,society_id,flat_number)")
        .eq("user_id", auth.user.id)
        .eq("is_active", true)
        .maybeSingle();
      return (data as any)?.flats ?? null;
    },
  });

  const { data: requests, refetch } = useQuery({
    queryKey: ["my-no-dues"],
    queryFn: () => list(),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!myFlat) throw new Error("No active flat");
      return submit({
        data: { societyId: myFlat.society_id, flatId: myFlat.id, purpose: purpose || undefined },
      });
    },
    onSuccess: (r: any) => {
      if (r.status === "blocked_by_dues")
        toast.warning(`Blocked: ₹${r.snapshot?.total_outstanding ?? 0} outstanding`);
      else toast.success("Request submitted");
      setPurpose("");
      refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <div className="pb-24">
      <MobileHero title="No-Dues Certificate" subtitle="Request a certificate for your flat." />
      <div className="px-4 space-y-3">
        <SectionCard>
          <p className="text-sm mb-2 font-medium">New request</p>
          <Input
            placeholder="Purpose (e.g. society transfer)"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            maxLength={500}
            className="mb-2"
          />
          <Button
            onClick={() => mutation.mutate()}
            disabled={!myFlat || mutation.isPending}
            className="w-full"
          >
            {mutation.isPending ? "Submitting…" : "Submit request"}
          </Button>
        </SectionCard>

        {(requests ?? []).map((r: any) => (
          <SectionCard key={r.id}>
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-medium">
                {new Date(r.submitted_at).toLocaleDateString()}
              </p>
              <StatusChip>{r.status}</StatusChip>
            </div>
            {r.purpose && <p className="text-xs text-muted-foreground">{r.purpose}</p>}
            {r.eligibility_snapshot?.total_outstanding > 0 && (
              <p className="text-xs text-destructive mt-1">
                Outstanding ₹{r.eligibility_snapshot.total_outstanding}
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

function CertificateDownload({ requestId, dl }: { requestId: string; dl: any }) {
  const { data: certId } = useQuery({
    queryKey: ["cert-for-req", requestId],
    queryFn: async () => {
      const { data } = await supabase
        .from("no_dues_certificates")
        .select("id")
        .eq("request_id", requestId)
        .maybeSingle();
      return data?.id ?? null;
    },
  });
  const handle = async () => {
    if (!certId) return;
    try {
      const r = await dl({ data: { certificateId: certId } });
      window.open(r.url, "_blank");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  };
  return (
    <Button size="sm" variant="outline" className="mt-2" onClick={handle} disabled={!certId}>
      Download Certificate
    </Button>
  );
}
