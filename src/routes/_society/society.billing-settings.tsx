import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2, Save, Settings2, CalendarClock, Play, Sparkles, ShieldCheck, SlidersHorizontal,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusChip } from "@/components/system/StatusChip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getBillingSchedule, saveBillingSchedule, runBillingNow } from "@/lib/billing.functions";

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
  const [gatewayConfigured, setGatewayConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    if (!societyId) return;
    (async () => {
      const [settingsRes, platformRes] = await Promise.all([
        supabase
          .from("society_settings")
          .select("maintenance_frequency,maintenance_due_day,grace_days,late_fee_amount,late_fee_type,financial_year_start_month")
          .eq("society_id", societyId)
          .maybeSingle(),
        supabase.from("platform_settings").select("razorpay_configured").maybeSingle(),
      ]);
      if (settingsRes.data) {
        setForm({
          maintenance_frequency: settingsRes.data.maintenance_frequency ?? DEFAULTS.maintenance_frequency,
          maintenance_due_day: settingsRes.data.maintenance_due_day ?? DEFAULTS.maintenance_due_day,
          grace_days: settingsRes.data.grace_days ?? DEFAULTS.grace_days,
          late_fee_amount: Number(settingsRes.data.late_fee_amount ?? 0),
          late_fee_type: settingsRes.data.late_fee_type ?? DEFAULTS.late_fee_type,
          financial_year_start_month: settingsRes.data.financial_year_start_month ?? DEFAULTS.financial_year_start_month,
        });
      }
      setGatewayConfigured(platformRes.data?.razorpay_configured ?? null);
      setLoading(false);
    })();
  }, [societyId]);

  async function save() {
    if (!societyId) return;
    setSaving(true);
    const { error } = await supabase.from("society_settings").update(form).eq("society_id", societyId);
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
    <div className="pb-24">
      <MobileHero
        eyebrow="Billing centre"
        title="Billing settings"
        subtitle="Payment methods, billing cycle, grace period, late fees, and auto-billing."
        icon={SlidersHorizontal}
        variant="teal"
      />
      <div className="px-4 -mt-6 space-y-4">
        <div className="rounded-2xl bg-card border shadow-sm">
          <BillingCenterTabs />
        </div>


      {/* Payment collection */}
      <Card className="rounded-2xl mb-4">
        <CardContent className="p-5 flex items-start gap-4 flex-wrap">
          <div className="h-11 w-11 rounded-xl grid place-items-center shrink-0 bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">Maintenance payment methods</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Residents can pay by <b>Cash</b> or <b>Bank Transfer</b>. Bank transfers are marked
              <span className="whitespace-nowrap"> "Pending verification" </span>
              until you confirm the receipt.
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Want online collection (UPI / cards / net-banking) for your society?
              {" "}
              <a href="mailto:support@sociohub.live" className="text-primary font-medium underline">
                Contact SocioHub Support
              </a>
              {" "}to enable online payments.
            </p>
          </div>
          <StatusChip tone={gatewayConfigured ? "success" : "warning"}>
            {gatewayConfigured ? "Online enabled" : "Offline only"}
          </StatusChip>
        </CardContent>
      </Card>

      {/* Auto-billing schedule */}
      {societyId && <AutoBillingSection societyId={societyId} />}

      {/* Policy */}
      <Card className="rounded-2xl mt-4">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4" /> Billing policy
          </CardTitle>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs">Billing frequency</Label>
            <Select value={form.maintenance_frequency} onValueChange={(v) => setForm({ ...form, maintenance_frequency: v })}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="half_yearly">Half-yearly</SelectItem>
                <SelectItem value="yearly">Yearly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Due day (1–28)</Label>
            <Input type="number" min={1} max={28} value={form.maintenance_due_day} onChange={(e) => setForm({ ...form, maintenance_due_day: Number(e.target.value) })} className="rounded-xl" />
          </div>

          <div>
            <Label className="text-xs">Grace period (days)</Label>
            <Input type="number" min={0} max={30} value={form.grace_days} onChange={(e) => setForm({ ...form, grace_days: Number(e.target.value) })} className="rounded-xl" />
          </div>

          <div>
            <Label className="text-xs">Financial year start month</Label>
            <Select value={String(form.financial_year_start_month)} onValueChange={(v) => setForm({ ...form, financial_year_start_month: Number(v) })}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((m, i) => (
                  <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Late fee type</Label>
            <Select value={form.late_fee_type} onValueChange={(v) => setForm({ ...form, late_fee_type: v })}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Flat amount (₹)</SelectItem>
                <SelectItem value="percent">Percent of bill (%)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Late fee {form.late_fee_type === "percent" ? "(%)" : "(₹)"}</Label>
            <Input type="number" min={0} step="0.01" value={form.late_fee_amount} onChange={(e) => setForm({ ...form, late_fee_amount: Number(e.target.value) })} className="rounded-xl" />
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 flex justify-end pb-6">
        <Button onClick={save} disabled={saving} className="rounded-xl h-11">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save policy
        </Button>
      </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Auto-billing schedule (moved from Bill Studio into Settings).             */
/* -------------------------------------------------------------------------- */

function AutoBillingSection({ societyId }: { societyId: string }) {
  const get = useServerFn(getBillingSchedule);
  const save = useServerFn(saveBillingSchedule);
  const runNow = useServerFn(runBillingNow);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [sch, setSch] = useState<any>(null);
  const [enabled, setEnabled] = useState(true);
  const [mode, setMode] = useState<"flat" | "per_sqft" | "per_bhk">("flat");
  const [amount, setAmount] = useState("2500");
  const [cycle, setCycle] = useState<"weekly" | "monthly" | "quarterly">("monthly");
  const [anchorDay, setAnchorDay] = useState("1");
  const [dueOffsetDays, setDueOffsetDays] = useState("10");
  const [lateFeeType, setLateFeeType] = useState<"none" | "flat" | "percent">("none");
  const [lateFeeValue, setLateFeeValue] = useState("0");
  const [prorate, setProrate] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { schedule } = await get({ data: { societyId } });
        if (schedule) {
          setSch(schedule);
          setMode(schedule.mode as any);
          setAmount(String(schedule.amount));
          setCycle(schedule.cycle as any);
          setAnchorDay(String(schedule.anchor_day));
          setDueOffsetDays(String(schedule.due_offset_days));
          setLateFeeType(schedule.late_fee_type as any);
          setLateFeeValue(String(schedule.late_fee_value));
          setProrate(schedule.prorate);
          setEnabled(schedule.enabled);
        }
      } catch (e: any) { toast.error(e.message); }
      setLoading(false);
    })();
  }, [societyId]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await save({
        data: {
          societyId, mode,
          amount: Number(amount),
          cycle, anchorDay: Number(anchorDay), dueOffsetDays: Number(dueOffsetDays),
          lateFeeType, lateFeeValue: Number(lateFeeValue),
          prorate, enabled,
        },
      });
      toast.success("Auto-billing saved. Next run " + new Date(res.nextRunAt).toLocaleDateString());
      const { schedule } = await get({ data: { societyId } });
      setSch(schedule);
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  }

  async function handleRun() {
    setRunning(true);
    try {
      const res = await runNow({ data: { societyId } });
      toast.success(`Generated ${res.count} bills · ₹${res.total.toLocaleString("en-IN")}`);
      const { schedule } = await get({ data: { societyId } });
      setSch(schedule);
    } catch (e: any) { toast.error(e.message); }
    setRunning(false);
  }

  if (loading) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-6 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" /> Auto-billing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border border-border p-4">
          <div>
            <p className="text-sm font-medium">Auto-generate every cycle</p>
            <p className="text-xs text-muted-foreground">System generates bills automatically. Bills stay pending until residents pay online.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {sch && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Next run</p>
              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold">
                <CalendarClock className="h-3.5 w-3.5 text-primary" />
                {new Date(sch.next_run_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            <div className="rounded-xl border border-border p-3">
              <p className="text-xs text-muted-foreground">Last run</p>
              <p className="mt-1 text-sm font-semibold">
                {sch.last_run_at ? new Date(sch.last_run_at).toLocaleDateString() : "Never"}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {sch.last_run_count ? `${sch.last_run_count} bills` : ""}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Amount mode</Label>
            <Select value={mode} onValueChange={(v: any) => setMode(v)}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Flat ₹ per unit</SelectItem>
                <SelectItem value="per_sqft">₹ × sqft</SelectItem>
                <SelectItem value="per_bhk">₹ × BHK</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Amount (₹)</Label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Cycle</Label>
            <Select value={cycle} onValueChange={(v: any) => setCycle(v)}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Anchor day</Label>
            <Input type="number" min={1} max={28} value={anchorDay} onChange={(e) => setAnchorDay(e.target.value)} className="rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Due after (days)</Label>
            <Input type="number" min={0} max={60} value={dueOffsetDays} onChange={(e) => setDueOffsetDays(e.target.value)} className="rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Late fee</Label>
            <Select value={lateFeeType} onValueChange={(v: any) => setLateFeeType(v)}>
              <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="flat">Flat ₹ / day</SelectItem>
                <SelectItem value="percent">% / day</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {lateFeeType !== "none" && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">Late fee value</Label>
              <Input type="number" min={0} value={lateFeeValue} onChange={(e) => setLateFeeValue(e.target.value)} className="rounded-xl" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between rounded-xl border border-border p-4">
          <div>
            <p className="text-sm font-medium">Pro-rate new residents</p>
            <p className="text-xs text-muted-foreground">Bill partial cycle if a resident joins mid-period.</p>
          </div>
          <Switch checked={prorate} onCheckedChange={setProrate} />
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={handleRun} disabled={running || !sch} variant="secondary" className="rounded-xl">
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run now
          </Button>
          <Button onClick={handleSave} disabled={saving} className="rounded-xl">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save auto-billing
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
