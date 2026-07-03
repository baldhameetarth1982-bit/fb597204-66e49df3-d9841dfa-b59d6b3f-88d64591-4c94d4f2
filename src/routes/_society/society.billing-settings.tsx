import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Save, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { FinanceTabs } from "@/components/shared/FinanceTabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/billing-settings")({
  head: () => ({ meta: [{ title: "Billing Settings — SocioHub" }] }),
  component: BillingSettingsPage,
});

type Settings = {
  maintenance_frequency: string;
  maintenance_due_day: number;
  grace_days: number;
  late_fee_amount: number;
  late_fee_type: string;
  financial_year_start_month: number;
};

const DEFAULTS: Settings = {
  maintenance_frequency: "monthly",
  maintenance_due_day: 10,
  grace_days: 5,
  late_fee_amount: 0,
  late_fee_type: "flat",
  financial_year_start_month: 4,
};

function BillingSettingsPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [form, setForm] = useState<Settings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!societyId) return;
    (async () => {
      const { data } = await supabase
        .from("society_settings")
        .select("maintenance_frequency,maintenance_due_day,grace_days,late_fee_amount,late_fee_type,financial_year_start_month")
        .eq("society_id", societyId)
        .maybeSingle();
      if (data) {
        setForm({
          maintenance_frequency: data.maintenance_frequency ?? DEFAULTS.maintenance_frequency,
          maintenance_due_day: data.maintenance_due_day ?? DEFAULTS.maintenance_due_day,
          grace_days: data.grace_days ?? DEFAULTS.grace_days,
          late_fee_amount: Number(data.late_fee_amount ?? 0),
          late_fee_type: data.late_fee_type ?? DEFAULTS.late_fee_type,
          financial_year_start_month: data.financial_year_start_month ?? DEFAULTS.financial_year_start_month,
        });
      }
      setLoading(false);
    })();
  }, [societyId]);

  async function save() {
    if (!societyId) return;
    setSaving(true);
    const { error } = await supabase
      .from("society_settings")
      .update(form)
      .eq("society_id", societyId);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Billing settings saved");
  }

  if (sidLoading || loading) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <PageShell>
      <FinanceTabs />
      <PageHeader
        title="Billing Settings"
        description="Configure auto-billing schedule, grace period, late fees, and financial year."
      />

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> Auto-billing policy
          </CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Billing frequency</Label>
            <Select
              value={form.maintenance_frequency}
              onValueChange={(v) => setForm({ ...form, maintenance_frequency: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="half_yearly">Half-yearly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Auto-bill day of month (1–28)</Label>
            <Input
              type="number" min={1} max={28}
              value={form.maintenance_due_day}
              onChange={(e) => setForm({ ...form, maintenance_due_day: Number(e.target.value) })}
            />
          </div>

          <div>
            <Label className="text-xs">Grace days (0–30)</Label>
            <Input
              type="number" min={0} max={30}
              value={form.grace_days}
              onChange={(e) => setForm({ ...form, grace_days: Number(e.target.value) })}
            />
          </div>

          <div>
            <Label className="text-xs">Financial year start month</Label>
            <Select
              value={String(form.financial_year_start_month)}
              onValueChange={(v) => setForm({ ...form, financial_year_start_month: Number(v) })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Late fee type</Label>
            <Select
              value={form.late_fee_type}
              onValueChange={(v) => setForm({ ...form, late_fee_type: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Flat amount (₹)</SelectItem>
                <SelectItem value="percent">Percent of bill (%)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">
              Late fee {form.late_fee_type === "percent" ? "(%)" : "(₹)"}
            </Label>
            <Input
              type="number" min={0} step="0.01"
              value={form.late_fee_amount}
              onChange={(e) => setForm({ ...form, late_fee_amount: Number(e.target.value) })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 flex justify-end">
        <Button onClick={save} disabled={saving} className="rounded-xl">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save settings
        </Button>
      </div>
    </PageShell>
  );
}
