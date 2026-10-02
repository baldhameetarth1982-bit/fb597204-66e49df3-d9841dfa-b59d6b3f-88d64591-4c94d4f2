import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Building2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { SettingsShell, SettingsSection, SettingsDisclosure, SaveBar } from "@/components/settings/SettingsUI";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { SocietyInviteCodeCard } from "@/components/society/SocietyInviteCodeCard";
import { ErrorState } from "@/components/system/ErrorState";

export const Route = createFileRoute("/_society/society/business-profile")({
  head: () => ({ meta: [{ title: "Society details — SociyoHub" }] }),
  component: BusinessProfilePage,
});

function BusinessProfilePage() {
  const { profile } = useAuth();
  const societyId = profile?.society_id;

  const [form, setForm] = useState({
    legal_business_name: "",
    business_address: "",
    business_city: "",
    business_state: "",
    business_pincode: "",
    business_gstin: "",
    business_pan: "",
  });
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState<typeof form | null>(null);

  const { data: society, isLoading, isError, isFetching, refetch } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-business", societyId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_society_business_profile", {
        _society_id: societyId!,
      });
      if (error) throw error;
      return Array.isArray(data) ? data[0] ?? null : data;
    },
  });

  useEffect(() => {
    if (!society || isError) return;
    const next = {
      legal_business_name: society.legal_business_name ?? "",
      business_address: society.business_address ?? "",
      business_city: society.business_city ?? "",
      business_state: society.business_state ?? "",
      business_pincode: society.business_pincode ?? "",
      business_gstin: society.business_gstin ?? "",
      business_pan: society.business_pan ?? "",
    };
    setForm(next);
    setBaseline(next);
  }, [society, isError]);

  // Only allow saving once the real saved values have loaded — never save defaults/blanks over real data.
  const loaded = !!society && !isError && baseline !== null;
  const dirty = loaded && JSON.stringify(form) !== JSON.stringify(baseline);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const complete =
    !!form.legal_business_name &&
    !!form.business_address &&
    !!form.business_city &&
    !!form.business_state &&
    /^[0-9]{6}$/.test(form.business_pincode) &&
    (!form.business_pan || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.business_pan.toUpperCase()));

  const payoutReady = complete && society?.payout_status === "active";

  async function save() {
    if (!societyId || !loaded || saving) return;
    if (!complete) {
      toast.error("Please fill all required fields correctly.");
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).rpc("update_society_business_profile", {
      _society_id: societyId,
      _legal_business_name: form.legal_business_name,
      _business_address: form.business_address,
      _business_city: form.business_city,
      _business_state: form.business_state,
      _business_pincode: form.business_pincode,
      _business_gstin: form.business_gstin,
      _business_pan: form.business_pan,
    });
    setSaving(false);
    if (error) {
      const msg = String(error.message ?? "");
      toast.error(
        /forbidden|permission|not authori/i.test(msg)
          ? "Only Society Admins can change these details."
          : "Couldn't save. Your changes are still here — please try again.",
      );
      return;
    }
    toast.success("Society details saved");
    setBaseline(form);
    void refetch();
  }

  if (isLoading) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (!societyId || isError || !society) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <ErrorState
          title={!societyId ? "No society linked" : "Couldn't load your society details"}
          description="Nothing has been changed. Your saved details are safe."
          onRetry={societyId ? () => void refetch() : undefined}
          showSupport={false}
        />
      </div>
    );
  }

  return (
    <SettingsShell
      title="Society information"
      scope="Whole society"
      icon={Building2}
      description="Registered name and address used for the whole society. Only Society Admins can change these, and every change is recorded."
      action={payoutReady ? (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
          <ShieldCheck className="h-3 w-3 mr-1" /> Payout ready
        </Badge>
      ) : undefined}
    >
      <SettingsSection title="Registered name" description="Exactly as on your society registration certificate.">
        <Field label="Legal business / society name *" value={form.legal_business_name}
          onChange={(v) => setForm((s) => ({ ...s, legal_business_name: v }))} />
      </SettingsSection>

      <SettingsSection title="Registered address">
        <div className="space-y-4">
          <div>
            <Label htmlFor="bp-address">Address *</Label>
            <Textarea id="bp-address" rows={2} value={form.business_address}
              onChange={(e) => setForm((s) => ({ ...s, business_address: e.target.value }))} className="mt-1" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City *" value={form.business_city} onChange={(v) => setForm((s) => ({ ...s, business_city: v }))} />
            <Field label="State *" value={form.business_state} onChange={(v) => setForm((s) => ({ ...s, business_state: v }))} />
            <Field label="Pincode *" inputMode="numeric" value={form.business_pincode}
              onChange={(v) => setForm((s) => ({ ...s, business_pincode: v.replace(/[^0-9]/g, "").slice(0, 6) }))} />
          </div>
        </div>
      </SettingsSection>

      <SettingsDisclosure title="Tax details (optional)" description="GSTIN and PAN, if your society has them"
        defaultOpen={!!(form.business_gstin || form.business_pan)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="GSTIN" value={form.business_gstin}
            onChange={(v) => setForm((s) => ({ ...s, business_gstin: v.toUpperCase().slice(0, 15) }))} />
          <Field label="PAN" hint="Format: ABCDE1234F" value={form.business_pan}
            onChange={(v) => setForm((s) => ({ ...s, business_pan: v.toUpperCase().slice(0, 10) }))} />
        </div>
      </SettingsDisclosure>

      <SaveBar dirty={dirty} saving={saving} disabled={isFetching}
        onSave={save} onDiscard={() => baseline && setForm(baseline)} />

      <SettingsDisclosure title="Invite code" description="Share with residents so they can join this society">
        {societyId && <SocietyInviteCodeCard societyId={societyId} />}
      </SettingsDisclosure>
    </SettingsShell>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
  inputMode,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  inputMode?: "numeric" | "text";
}) {
  const id = "bp-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode={inputMode} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1 h-11" />
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
