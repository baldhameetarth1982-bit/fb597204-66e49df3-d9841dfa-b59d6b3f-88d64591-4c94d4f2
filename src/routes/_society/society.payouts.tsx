import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Landmark, Loader2, Info, RefreshCw } from "lucide-react";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { StatusChip } from "@/components/system/StatusChip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { SettingsSection, SettingsDisclosure } from "@/components/settings/SettingsUI";
import { toast } from "sonner";
import { createSocietyLinkedAccount, refreshPayoutStatus, getPayoutInfo } from "@/lib/payouts.functions";

export const Route = createFileRoute("/_society/society/payouts")({
  head: () => ({ meta: [{ title: "Payouts — SociyoHub" }] }),
  component: PayoutsPage,
});

const STATUS: Record<string, { label: string; tone: "neutral" | "warning" | "success" | "danger"; next: string }> = {
  not_setup: { label: "Not set up", tone: "neutral", next: "Add your society's bank details below to start verification." },
  pending: { label: "Pending review", tone: "warning", next: "Verification usually takes a few working days. Tap Refresh to check." },
  active: { label: "Verified", tone: "success", next: "Your bank account is verified." },
  rejected: { label: "Rejected", tone: "danger", next: "Check the details below and resubmit." },
};

function Field({ id, label, className, ...p }: { id: string; label: string; className?: string } & React.ComponentProps<typeof Input>) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} className="h-11" {...p} />
    </div>
  );
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
  }, [societyId, sidLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    if (!societyId) return;
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase())) { toast.error("PAN format ABCDE1234F"); return; }
    setSaving(true);
    try {
      const res = await create({
        data: { societyId, holderName, email, phone, accountNumber, ifsc: ifsc.toUpperCase(), beneficiaryName, pan: pan.toUpperCase() },
      });
      toast.success(res.status === "active" ? "Bank account verified" : "Submitted — pending verification");
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
      toast.success(`Status: ${STATUS[r.status]?.label ?? r.status}`);
    } catch (e: any) { toast.error(e.message); }
    setRefreshing(false);
  }

  const s = STATUS[state.status] ?? STATUS.not_setup;
  const complete = holderName && accountNumber && ifsc && pan && email && phone && beneficiaryName;

  const form = (
    <div className="space-y-5">
      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Society</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="p-holder" label="Society / legal name" value={holderName} onChange={(e) => setHolderName(e.target.value)} placeholder="Green Park Apartments CHS" />
          <Field id="p-pan" label="PAN of society / signatory" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} />
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Bank account</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="p-ben" label="Beneficiary name (as in bank)" value={beneficiaryName} onChange={(e) => setBeneficiaryName(e.target.value)} className="sm:col-span-2" />
          <Field id="p-acc" label="Account number" inputMode="numeric" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))} />
          <Field id="p-ifsc" label="IFSC" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} placeholder="HDFC0001234" />
        </div>
      </fieldset>
      <fieldset className="space-y-3">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Contact</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="p-email" label="Admin email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Field id="p-phone" label="Admin phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+919876543210" />
        </div>
      </fieldset>
      <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">{complete ? "Ready to submit." : "Fill every field to submit."}</p>
        <Button onClick={submit} disabled={saving || !complete} className="h-11 rounded-xl">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {state.hasLinkedAccount ? "Resubmit for verification" : "Submit for verification"}
        </Button>
      </div>
    </div>
  );

  return (
    <PageShell>
      <PageHeader title="Payouts" description="Your society's bank account on record with SociyoHub." />
      {sidLoading || loading ? (
        <div className="space-y-4" aria-busy="true"><div className="h-24 animate-pulse rounded-2xl bg-muted" /><div className="h-72 animate-pulse rounded-2xl bg-muted" /></div>
      ) : (
        <div className="mx-auto max-w-3xl space-y-5">
          <section className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-4 rounded-2xl border border-border bg-card p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><Landmark className="h-5 w-5" /></div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">Bank account</h2>
                <StatusChip tone={s.tone}>{s.label}</StatusChip>
              </div>
              {state.last4 && <p className="mt-1 truncate text-sm">A/C ending <span className="tabular-nums">{state.last4}</span> · {state.holder}</p>}
              <p className="mt-1 text-sm text-muted-foreground">{s.next}</p>
            </div>
            {state.hasLinkedAccount && (
              <Button variant="outline" className="col-span-2 h-11 rounded-xl sm:col-span-1" onClick={doRefresh} disabled={refreshing}>
                {refreshing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />} Refresh
              </Button>
            )}
          </section>

          <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p>Residents pay maintenance by <b>Cash</b> or <b>Bank Transfer</b>. The committee verifies each payment from the Payments screen.</p>
          </div>

          {state.hasLinkedAccount ? (
            <SettingsDisclosure title="Update bank details" description="Resubmitting starts verification again." defaultOpen={state.status === "rejected"}>
              {form}
            </SettingsDisclosure>
          ) : (
            <SettingsSection title="Society bank details">{form}</SettingsSection>
          )}
        </div>
      )}
    </PageShell>
  );
}
