import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Building2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-6 pb-[calc(96px+env(safe-area-inset-bottom))]">
      {societyId && <SocietyInviteCodeCard societyId={societyId} />}

      <header className="flex items-start gap-3">
        <div className="h-11 w-11 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0">
          <Building2 className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Society details</h1>
          <p className="text-sm text-muted-foreground">
            Your society's registered name and address. These apply to the whole society and only Society Admins can
            change them. Changes are recorded in activity history.
          </p>
        </div>
        {payoutReady && (
          <Badge className="bg-emerald-500/15 text-emerald-500 border-emerald-500/30">
            <ShieldCheck className="h-3 w-3 mr-1" /> Payout ready
          </Badge>
        )}
      </header>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base">Registered details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            label="Legal business / society name *"
            hint="Exact name as on your society registration certificate."
            value={form.legal_business_name}
            onChange={(v) => setForm((s) => ({ ...s, legal_business_name: v }))}
          />

          <div>
            <Label>Registered address *</Label>
            <Textarea
              rows={2}
              value={form.business_address}
              onChange={(e) => setForm((s) => ({ ...s, business_address: e.target.value }))}
              className="mt-1"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="City *"
              value={form.business_city}
              onChange={(v) => setForm((s) => ({ ...s, business_city: v }))}
            />
            <Field
              label="State *"
              value={form.business_state}
              onChange={(v) => setForm((s) => ({ ...s, business_state: v }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Pincode *"
              value={form.business_pincode}
              onChange={(v) => setForm((s) => ({ ...s, business_pincode: v.replace(/[^0-9]/g, "").slice(0, 6) }))}
            />
            <Field
              label="GSTIN (optional)"
              value={form.business_gstin}
              onChange={(v) => setForm((s) => ({ ...s, business_gstin: v.toUpperCase().slice(0, 15) }))}
            />
          </div>

          <Field
            label="PAN (optional)"
            hint="Format: ABCDE1234F"
            value={form.business_pan}
            onChange={(v) => setForm((s) => ({ ...s, business_pan: v.toUpperCase().slice(0, 10) }))}
          />

          <div className="flex gap-2">
            {dirty && (
              <Button
                variant="outline"
                onClick={() => baseline && setForm(baseline)}
                disabled={saving}
                className="min-h-[48px] rounded-xl"
              >
                Discard
              </Button>
            )}
            <Button
              onClick={save}
              disabled={saving || !dirty || isFetching}
              className="flex-1 min-h-[48px] rounded-xl"
            >
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {dirty ? "Save changes" : "No changes to save"}
            </Button>
          </div>
          {dirty && <p className="text-xs text-muted-foreground text-center">You have unsaved changes.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1" />
      {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}
