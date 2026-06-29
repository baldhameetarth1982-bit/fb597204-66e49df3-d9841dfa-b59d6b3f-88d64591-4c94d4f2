import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Landmark, Loader2, ShieldCheck, AlertTriangle, RefreshCw } from "lucide-react";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  createSocietyLinkedAccount, refreshPayoutStatus, getPayoutInfo,
} from "@/lib/payouts.functions";

export const Route = createFileRoute("/_society/society/payouts")({
  head: () => ({ meta: [{ title: "Payouts — SocioHub" }] }),
  component: PayoutsPage,
});

function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    not_setup: { label: "Not set up", cls: "bg-muted text-muted-foreground" },
    pending: { label: "Pending review", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
    active: { label: "Active — receiving payments", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
    rejected: { label: "Rejected — please resubmit", cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  };
  const m = map[status] ?? map.not_setup;
  return <Badge className={`rounded-full ${m.cls} border-0`}>{m.label}</Badge>;
}

function PayoutsPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const create = useServerFn(createSocietyLinkedAccount);
  const refresh = useServerFn(refreshPayoutStatus);
  const info = useServerFn(getPayoutInfo);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [state, setState] = useState<{ status: string; last4: string | null; holder: string | null; hasLinkedAccount: boolean }>({
    status: "not_setup", last4: null, holder: null, hasLinkedAccount: false,
  });

  const [holderName, setHolderName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [pan, setPan] = useState("");

  useEffect(() => {
    if (!societyId) { if (!sidLoading) setLoading(false); return; }
    (async () => {
      try { setState(await info({ data: { societyId } })); } catch (e: any) { toast.error(e.message); }
      setLoading(false);
    })();
  }, [societyId, sidLoading]);

  async function submit() {
    if (!societyId) return;
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase())) { toast.error("PAN format ABCDE1234F"); return; }
    setSaving(true);
    try {
      const res = await create({
        data: { societyId, holderName, email, phone, accountNumber, ifsc: ifsc.toUpperCase(), beneficiaryName, pan: pan.toUpperCase() },
      });
      toast.success(res.status === "active" ? "Bank attached — payments live" : "Submitted — pending Razorpay review");
      setState(await info({ data: { societyId } }));
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  }

  async function doRefresh() {
    if (!societyId) return;
    setRefreshing(true);
    try {
      const r = await refresh({ data: { societyId } });
      setState(await info({ data: { societyId } }));
      toast.success(`Status: ${r.status}`);
    } catch (e: any) { toast.error(e.message); }
    setRefreshing(false);
  }

  if (sidLoading || loading) {
    return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <PageShell>
      <PageHeader title="Payouts" description="Attach your society's bank to receive maintenance directly. SocioHub keeps 1.5%, the rest lands in your account." />

      <Card className="rounded-2xl mb-5">
        <CardContent className="p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-primary/10 grid place-items-center"><Landmark className="h-5 w-5 text-primary" /></div>
            <div>
              <div className="text-sm font-medium">Current status</div>
              <div className="mt-1"><StatusChip status={state.status} /></div>
              {state.last4 && <div className="text-xs text-muted-foreground mt-1">A/C ending {state.last4} · {state.holder}</div>}
            </div>
          </div>
          {state.hasLinkedAccount && (
            <Button variant="outline" size="sm" className="rounded-xl" onClick={doRefresh} disabled={refreshing}>
              {refreshing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />} Refresh
            </Button>
          )}
        </CardContent>
      </Card>

      {state.status !== "active" && (
        <Card className="rounded-2xl mb-5 border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm">Until your bank is verified, residents can <b>only pay in cash</b>. You can still mark their bills paid manually from the Billing screen.</p>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> Society bank details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Society / legal name</Label>
              <Input value={holderName} onChange={(e) => setHolderName(e.target.value)} placeholder="Green Park Apartments CHS" />
            </div>
            <div className="space-y-1.5">
              <Label>Beneficiary name (as in bank)</Label>
              <Input value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} placeholder="Green Park Apt CHS" />
            </div>
            <div className="space-y-1.5">
              <Label>Admin email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@society.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Admin phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
            </div>
            <div className="space-y-1.5">
              <Label>Account number</Label>
              <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))} />
            </div>
            <div className="space-y-1.5">
              <Label>IFSC</Label>
              <Input value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} placeholder="HDFC0001234" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>PAN of society / signatory</Label>
              <Input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button onClick={submit} disabled={saving || !holderName || !accountNumber || !ifsc || !pan || !email || !phone || !beneficiaryName} className="rounded-xl h-11">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {state.hasLinkedAccount ? "Resubmit" : "Submit for verification"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
