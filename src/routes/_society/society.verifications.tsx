import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck, Loader2, BadgeCheck, FileText, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/verifications")({
  head: () => ({ meta: [{ title: "Pending Verifications — SocioHub" }] }),
  component: VerificationsPage,
});

interface Pending {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  aadhaar_last4: string | null;
  aadhaar_url: string | null;
  aadhaar_uploaded_at: string | null;
  aadhaar_verified: boolean | null;
}

function VerificationsPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [rows, setRows] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    if (!societyId) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("profiles")
      .select(
        "id, full_name, email, phone, aadhaar_last4, aadhaar_url, aadhaar_uploaded_at, aadhaar_verified",
      )
      .eq("society_id", societyId)
      .not("aadhaar_uploaded_at", "is", null)
      .order("aadhaar_uploaded_at", { ascending: false });
    if (error) {
      toast.error(error.message);
      setLoading(false);
      return;
    }
    setRows((data ?? []) as Pending[]);
    // generate signed URLs
    const urlMap: Record<string, string> = {};
    await Promise.all(
      (data ?? []).map(async (p: any) => {
        if (!p.aadhaar_url) return;
        const { data: signed } = await supabase.storage
          .from("kyc")
          .createSignedUrl(p.aadhaar_url, 600);
        if (signed?.signedUrl) urlMap[p.id] = signed.signedUrl;
      }),
    );
    setSignedUrls(urlMap);
    setLoading(false);
  }

  useEffect(() => {
    if (!sidLoading) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [societyId, sidLoading]);

  async function setVerified(id: string, value: boolean) {
    setBusyId(id);
    const { error } = await (supabase as any)
      .from("profiles")
      .update({ aadhaar_verified: value })
      .eq("id", id);
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success(value ? "Resident verified" : "Marked unverified");
    void load();
  }

  if (!sidLoading && !societyId) {
    return (
      <PageShell>
        <PageHeader title="Pending Verifications" />
        <EmptyState icon={ShieldCheck} title="Set up your society first" />
      </PageShell>
    );
  }

  const pending = rows.filter((r) => !r.aadhaar_verified);
  const verified = rows.filter((r) => r.aadhaar_verified);

  return (
    <PageShell>
      <PageHeader
        title="Identity Verifications"
        description="Review Aadhaar documents uploaded by residents."
      />
      {loading ? (
        <div className="grid place-items-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="Nothing to verify"
          description="When residents upload their Aadhaar, requests appear here."
        />
      ) : (
        <div className="grid gap-8">
          <section className="grid gap-3">
            <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" /> Pending ({pending.length})
            </h2>
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pending requests.</p>
            ) : (
              pending.map((p) => (
                <VerificationCard
                  key={p.id}
                  p={p}
                  signedUrl={signedUrls[p.id]}
                  busy={busyId === p.id}
                  onApprove={() => setVerified(p.id, true)}
                />
              ))
            )}
          </section>
          {verified.length > 0 && (
            <section className="grid gap-3">
              <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BadgeCheck className="h-4 w-4" /> Verified ({verified.length})
              </h2>
              {verified.map((p) => (
                <VerificationCard
                  key={p.id}
                  p={p}
                  signedUrl={signedUrls[p.id]}
                  busy={busyId === p.id}
                  onRevoke={() => setVerified(p.id, false)}
                  verified
                />
              ))}
            </section>
          )}
        </div>
      )}
    </PageShell>
  );
}

function VerificationCard({
  p,
  signedUrl,
  busy,
  onApprove,
  onRevoke,
  verified,
}: {
  p: Pending;
  signedUrl?: string;
  busy: boolean;
  onApprove?: () => void;
  onRevoke?: () => void;
  verified?: boolean;
}) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold truncate">{p.full_name ?? "Unnamed resident"}</p>
            {verified ? (
              <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
                Verified
              </Badge>
            ) : (
              <Badge variant="secondary">Pending</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground truncate">{p.email}</p>
          {p.phone && (
            <p className="text-sm text-muted-foreground">{p.phone}</p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            Aadhaar ending •••• {p.aadhaar_last4 ?? "----"} · uploaded{" "}
            {p.aadhaar_uploaded_at
              ? new Date(p.aadhaar_uploaded_at).toLocaleDateString()
              : "—"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {signedUrl ? (
            <Button asChild variant="outline" size="sm" className="rounded-xl">
              <a href={signedUrl} target="_blank" rel="noreferrer">
                <FileText className="h-4 w-4 mr-1" /> View ID
              </a>
            </Button>
          ) : (
            <Button variant="outline" size="sm" className="rounded-xl" disabled>
              No file
            </Button>
          )}
          {!verified && onApprove && (
            <Button size="sm" className="rounded-xl" disabled={busy} onClick={onApprove}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
            </Button>
          )}
          {verified && onRevoke && (
            <Button
              variant="ghost"
              size="sm"
              className="rounded-xl text-destructive"
              disabled={busy}
              onClick={onRevoke}
            >
              Revoke
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
