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
import { tu } from "@/lib/i18n";

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
      toast.error(tu("op.please_fill_all_required_fields"));
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
    toast.success(tu("op.society_details_saved"));
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
          title={!societyId ? tu("op.no_society_linked") : tu("op.couldn_t_load_your_society")}
          description={tu("op.nothing_has_been_changed_your_3")}
          onRetry={societyId ? () => void refetch() : undefined}
          showSupport={false}
        />
      </div>
    );
  }

  return (
    <SettingsShell
      title={tu("st.socInfo")}
      scope="Whole society"
      icon={Building2}
      description={tu("op.registered_name_and_address_used")}
      action={payoutReady ? (
        <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
          <ShieldCheck className="h-3 w-3 mr-1" /> {tu("op.payout_ready")}
        </Badge>
      ) : undefined}
    >
      <SettingsSection title={tu("op.registered_name")} description={tu("op.exactly_as_on_your_society")}>
        <Field label={tu("op.legal_business_society_name")} value={form.legal_business_name}
          onChange={(v) => setForm((s) => ({ ...s, legal_business_name: v }))} />
      </SettingsSection>

      <SettingsSection title={tu("op.registered_address")}>
        <div className="space-y-4">
          <div>
            <Label htmlFor="bp-address">{tu("op.address")}</Label>
            <Textarea id="bp-address" rows={2} value={form.business_address}
              onChange={(e) => setForm((s) => ({ ...s, business_address: e.target.value }))} className="mt-1" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label={tu("op.city")} value={form.business_city} onChange={(v) => setForm((s) => ({ ...s, business_city: v }))} />
            <Field label={tu("op.state")} value={form.business_state} onChange={(v) => setForm((s) => ({ ...s, business_state: v }))} />
            <Field label={tu("op.pincode")} inputMode="numeric" value={form.business_pincode}
              onChange={(v) => setForm((s) => ({ ...s, business_pincode: v.replace(/[^0-9]/g, "").slice(0, 6) }))} />
          </div>
        </div>
      </SettingsSection>

      <SettingsDisclosure title={tu("op.tax_details_optional")} description={tu("op.gstin_and_pan_if_your")}
        defaultOpen={!!(form.business_gstin || form.business_pan)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="GSTIN" value={form.business_gstin}
            onChange={(v) => setForm((s) => ({ ...s, business_gstin: v.toUpperCase().slice(0, 15) }))} />
          <Field label="PAN" hint={tu("op.format_abcde1234f")} value={form.business_pan}
            onChange={(v) => setForm((s) => ({ ...s, business_pan: v.toUpperCase().slice(0, 10) }))} />
        </div>
      </SettingsDisclosure>

      <SaveBar dirty={dirty} saving={saving} disabled={isFetching}
        onSave={save} onDiscard={() => baseline && setForm(baseline)} />

      <SettingsDisclosure title={tu("op.invite_code")} description={tu("op.share_with_residents_so_they")}>
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
