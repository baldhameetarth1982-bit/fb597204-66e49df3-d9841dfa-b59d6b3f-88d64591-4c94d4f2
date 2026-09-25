import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2, Save, Settings2, CalendarClock, Play, Sparkles, ShieldCheck, SlidersHorizontal,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
import { SettingsShell, SettingsSection, SettingsDisclosure, SaveBar } from "@/components/settings/SettingsUI";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusChip } from "@/components/system/StatusChip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ErrorState } from "@/components/system/ErrorState";
import { toSafeFinanceMessage } from "@/lib/finance-safe-error";
import { getBillingSchedule, saveBillingSchedule, runBillingNow } from "@/lib/billing.functions";

export const Route = createFileRoute("/_society/society/billing-settings")({
  head: () => ({ meta: [{ title: "Billing Settings — SociyoHub" }] }),
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
  const [baseline, setBaseline] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!societyId) { if (!sidLoading) setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    setMissing(false);
    (async () => {
      const settingsRes = await supabase
        .from("society_settings")
        .select("maintenance_frequency,maintenance_due_day,grace_days,late_fee_amount,late_fee_type,financial_year_start_month")
        .eq("society_id", societyId)
        .maybeSingle();
      if (cancelled) return;
      if (settingsRes.error) {
        setLoadError(true);
        setBaseline(null);
      } else if (!settingsRes.data) {
        // No settings row visible: never show or save defaults as if they were real.
        setMissing(true);
        setBaseline(null);
      } else {
        const next: Settings = {
          maintenance_frequency: settingsRes.data.maintenance_frequency ?? DEFAULTS.maintenance_frequency,
          maintenance_due_day: settingsRes.data.maintenance_due_day ?? DEFAULTS.maintenance_due_day,
          grace_days: settingsRes.data.grace_days ?? DEFAULTS.grace_days,
          late_fee_amount: Number(settingsRes.data.late_fee_amount ?? 0),
          late_fee_type: settingsRes.data.late_fee_type ?? DEFAULTS.late_fee_type,
          financial_year_start_month: settingsRes.data.financial_year_start_month ?? DEFAULTS.financial_year_start_month,
        };
        setForm(next);
        setBaseline(next);
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [societyId, sidLoading, reloadKey]);

  const policyLoaded = baseline !== null && !loadError;
  const dirty = policyLoaded && JSON.stringify(form) !== JSON.stringify(baseline);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function validate(f: Settings): string | null {
    if (!Number.isInteger(f.maintenance_due_day) || f.maintenance_due_day < 1 || f.maintenance_due_day > 28)
      return "Due day must be a whole number from 1 to 28.";
    if (!Number.isInteger(f.grace_days) || f.grace_days < 0 || f.grace_days > 30)
      return "Grace period must be a whole number from 0 to 30 days.";
    if (!Number.isFinite(f.late_fee_amount) || f.late_fee_amount < 0)
      return "Late fee can't be negative.";
    if (f.late_fee_type === "percent" && f.late_fee_amount > 100)
      return "A percentage late fee can't be more than 100%.";
    return null;
  }

  async function save() {
    if (!societyId || !policyLoaded || saving || !dirty) return;
    const problem = validate(form);
    if (problem) return toast.error(problem);
    setSaving(true);
    const { data, error } = await supabase
      .from("society_settings")
      .update(form)
      .eq("society_id", societyId)
      .select("society_id");
    setSaving(false);
    if (error) return toast.error(toSafeFinanceMessage(error, "Couldn't save. Your changes are still here — please try again."));
    if (!data || data.length === 0)
      return toast.error("Only Society Admins can change billing settings. Nothing was saved.");
    setBaseline(form);
    toast.success("Billing policy saved");
  }

  if (sidLoading || loading) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <SettingsShell
      title="Billing settings"
      scope="Whole society"
      icon={SlidersHorizontal}
      description="Rules for every home in the society. Bills already issued keep the amounts and dates they were created with."
    >
      <div className="rounded-2xl border bg-card"><BillingCenterTabs /></div>

      <SettingsSection title="How residents pay" icon={ShieldCheck} trailing={<StatusChip tone="success">Cash + Bank Transfer</StatusChip>}>
        <p className="text-sm text-muted-foreground">
          Residents pay by <b className="text-foreground">Cash</b> or <b className="text-foreground">Bank Transfer</b>. Each payment stays
          "Awaiting verification" until a committee member confirms it, and a receipt is issued only after that.
          This can't be changed here.
        </p>
      </SettingsSection>

      {!policyLoaded ? (
        <SettingsSection title="Billing policy" icon={Settings2}>
          <ErrorState
            title={missing ? "Billing policy isn't set up yet" : "Couldn't load your billing policy"}
            description={missing ? "Finish society setup first, or ask a Society Admin. Nothing has been changed." : "Nothing has been changed. Your saved settings are safe."}
            onRetry={() => setReloadKey((k) => k + 1)}
            showSupport={false}
          />
        </SettingsSection>
      ) : (<>
        <SettingsSection title="Billing policy" icon={Settings2}
          description="When bills are due and when they count as overdue.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bs-freq">Billing frequency</Label>
              <Select value={form.maintenance_frequency} onValueChange={(v) => setForm({ ...form, maintenance_frequency: v })}>
                <SelectTrigger id="bs-freq" className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="half_yearly">Half-yearly</SelectItem>
                  <SelectItem value="yearly">Yearly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bs-due">Due day of the month</Label>
              <Input id="bs-due" type="number" min={1} max={28} value={form.maintenance_due_day} onChange={(e) => setForm({ ...form, maintenance_due_day: Number(e.target.value) })} className="h-11 rounded-xl" />
              <p className="text-xs text-muted-foreground">1 to 28</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bs-grace">Grace period (days)</Label>
              <Input id="bs-grace" type="number" min={0} max={30} value={form.grace_days} onChange={(e) => setForm({ ...form, grace_days: Number(e.target.value) })} className="h-11 rounded-xl" />
              <p className="text-xs text-muted-foreground">Days after the due day before a bill is overdue</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bs-fy">Financial year starts</Label>
              <Select value={String(form.financial_year_start_month)} onValueChange={(v) => setForm({ ...form, financial_year_start_month: Number(v) })}>
                <SelectTrigger id="bs-fy" className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["January","February","March","April","May","June","July","August","September","October","November","December"].map((m, i) => (
                    <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </SettingsSection>

        <SettingsSection title="Late fee" description="Applied only after the grace period ends.">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="bs-lft">Late fee type</Label>
              <Select value={form.late_fee_type} onValueChange={(v) => setForm({ ...form, late_fee_type: v })}>
                <SelectTrigger id="bs-lft" className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat amount (₹)</SelectItem>
                  <SelectItem value="percent">Percent of bill (%)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bs-lfa">Late fee {form.late_fee_type === "percent" ? "(%)" : "(₹)"}</Label>
              <Input id="bs-lfa" type="number" min={0} step="0.01" value={form.late_fee_amount} onChange={(e) => setForm({ ...form, late_fee_amount: Number(e.target.value) })} className="h-11 rounded-xl" />
            </div>
          </div>
        </SettingsSection>

        <SaveBar dirty={dirty} saving={saving} saveLabel="Save policy" onSave={save} onDiscard={() => baseline && setForm(baseline)} />
      </>)}

      {societyId && (
        <SettingsDisclosure title="Automatic billing" description="Create bills on a schedule. Saved separately from the policy above.">
          <AutoBillingSection societyId={societyId} />
        </SettingsDisclosure>
      )}
    </SettingsShell>
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
  const [loadFailed, setLoadFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    setLoading(true);
    setLoadFailed(false);
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
      } catch {
        // Never let defaults be saved over a schedule we couldn't read.
        setLoadFailed(true);
      }
      setLoading(false);
    })();
  }, [societyId, reload]);

  async function handleSave() {
    if (loadFailed || saving) return;
    const amt = Number(amount), anchor = Number(anchorDay), offset = Number(dueOffsetDays), lf = Number(lateFeeValue);
    if (!Number.isFinite(amt) || amt <= 0) return toast.error("Enter a billing amount above ₹0.");
    if (!Number.isInteger(anchor) || anchor < 1 || anchor > 28) return toast.error("Billing day must be from 1 to 28.");
    if (!Number.isInteger(offset) || offset < 0 || offset > 60) return toast.error("Days until due must be from 0 to 60.");
    if (!Number.isFinite(lf) || lf < 0 || (lateFeeType === "percent" && lf > 100)) return toast.error("Enter a valid late fee.");
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
      toast.success("Auto-billing saved. Next run " + new Date(res.nextRunAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }));
      const { schedule } = await get({ data: { societyId } });
      setSch(schedule);
    } catch (e) { toast.error(toSafeFinanceMessage(e, "Couldn't save auto-billing. Your changes are still here — please try again.")); }
    setSaving(false);
  }

  async function handleRun() {
    if (running) return;
    if (!window.confirm("Generate this cycle's bills for all billable homes now?")) return;
    setRunning(true);
    try {
      const res = await runNow({ data: { societyId } });
      toast.success(`Generated ${res.count} bills · ₹${res.total.toLocaleString("en-IN")}`);
      const { schedule } = await get({ data: { societyId } });
      setSch(schedule);
    } catch (e) { toast.error(toSafeFinanceMessage(e, "Couldn't generate bills. Please try again.")); }
    setRunning(false);
  }

  if (loading) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-6 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></CardContent>
      </Card>
    );
  }

  if (loadFailed) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-2">
          <ErrorState
            title="Couldn't load auto-billing"
            description="Nothing has been changed. Your saved schedule is safe."
            onRetry={() => setReload((k) => k + 1)}
            showSupport={false}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-xl border border-border p-4">
          <div>
            <p className="text-sm font-medium">Auto-generate every cycle</p>
            <p className="text-xs text-muted-foreground">Bills are created automatically each cycle and stay unpaid until a Cash or Bank Transfer payment is verified.</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Auto-generate every cycle" />
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
          <Switch checked={prorate} onCheckedChange={setProrate} aria-label="Pro-rate new residents" />
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={handleRun} disabled={running || !sch} variant="secondary" className="h-11 rounded-xl">
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run now
          </Button>
          <Button onClick={handleSave} disabled={saving} className="h-11 rounded-xl">
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save auto-billing
          </Button>
        </div>
      </div>
    </div>
  );
}
