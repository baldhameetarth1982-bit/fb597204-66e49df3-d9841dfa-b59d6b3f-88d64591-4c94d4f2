import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles, Play, Save, IndianRupee, CalendarClock } from "lucide-react";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import {
  getBillingSchedule, saveBillingSchedule, runBillingNow,
} from "@/lib/billing.functions";

export const Route = createFileRoute("/_society/society/bill-studio")({
  head: () => ({ meta: [{ title: "Bill Studio — SocioHub" }] }),
  component: BillStudio,
});

function BillStudio() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const get = useServerFn(getBillingSchedule);
  const save = useServerFn(saveBillingSchedule);
  const runNow = useServerFn(runBillingNow);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [sch, setSch] = useState<any>(null);

  const [mode, setMode] = useState<"flat" | "per_sqft" | "per_bhk">("flat");
  const [amount, setAmount] = useState("2500");
  const [cycle, setCycle] = useState<"weekly" | "monthly" | "quarterly">("monthly");
  const [anchorDay, setAnchorDay] = useState("1");
  const [dueOffsetDays, setDueOffsetDays] = useState("10");
  const [lateFeeType, setLateFeeType] = useState<"none" | "flat" | "percent">("none");
  const [lateFeeValue, setLateFeeValue] = useState("0");
  const [prorate, setProrate] = useState(true);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (!societyId) { if (!sidLoading) setLoading(false); return; }
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
  }, [societyId, sidLoading]);

  async function handleSave() {
    if (!societyId) return;
    setSaving(true);
    try {
      const res = await save({
        data: {
          societyId, mode,
          amount: Number(amount),
          cycle,
          anchorDay: Number(anchorDay),
          dueOffsetDays: Number(dueOffsetDays),
          lateFeeType,
          lateFeeValue: Number(lateFeeValue),
          prorate, enabled,
        },
      });
      toast.success("Schedule saved. Next run " + new Date(res.nextRunAt).toLocaleDateString());
      const { schedule } = await get({ data: { societyId } });
      setSch(schedule);
    } catch (e: any) { toast.error(e.message); }
    setSaving(false);
  }

  async function handleRun() {
    if (!societyId) return;
    setRunning(true);
    try {
      const res = await runNow({ data: { societyId } });
      toast.success(`Generated ${res.count} bills · ₹${res.total.toLocaleString("en-IN")}`);
      const { schedule } = await get({ data: { societyId } });
      setSch(schedule);
    } catch (e: any) { toast.error(e.message); }
    setRunning(false);
  }

  if (sidLoading || loading) {
    return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  if (!societyId) {
    return (
      <PageShell>
        <PageHeader title="Bill Studio" description="Automated maintenance billing." />
        <EmptyState icon={Building2} title="No society linked" description="Set up your society first." />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Bill Studio"
        description="Set maintenance once — system auto-generates bills every cycle."
        actions={
          <Button onClick={handleRun} disabled={running || !sch} variant="secondary" className="rounded-xl h-11">
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            Run now
          </Button>
        }
      />

      {sch && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Next auto-run</div>
              <div className="mt-1 flex items-center gap-2 text-lg font-semibold">
                <CalendarClock className="h-4 w-4 text-primary" />
                {new Date(sch.next_run_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Last run</div>
              <div className="mt-1 text-lg font-semibold">
                {sch.last_run_at ? new Date(sch.last_run_at).toLocaleDateString() : "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                {sch.last_run_count ? `${sch.last_run_count} bills · ₹${Number(sch.last_run_total).toLocaleString("en-IN")}` : "Never run"}
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground">Auto-generate</div>
              <div className="mt-1 flex items-center gap-3">
                <Switch checked={enabled} onCheckedChange={setEnabled} />
                <span className="text-sm font-medium">{enabled ? "ON" : "Paused"}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> Billing rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount mode</Label>
              <Select value={mode} onValueChange={(v: any) => setMode(v)}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat ₹ per unit</SelectItem>
                  <SelectItem value="per_sqft">₹ × sqft</SelectItem>
                  <SelectItem value="per_bhk">₹ × BHK</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount (₹)</Label>
              <div className="relative">
                <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="pl-9 rounded-xl" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Cycle</Label>
              <Select value={cycle} onValueChange={(v: any) => setCycle(v)}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Anchor day</Label>
              <Input type="number" min={1} max={28} value={anchorDay} onChange={(e) => setAnchorDay(e.target.value)} className="rounded-xl" />
            </div>
            <div className="space-y-2">
              <Label>Due after (days)</Label>
              <Input type="number" min={0} max={60} value={dueOffsetDays} onChange={(e) => setDueOffsetDays(e.target.value)} className="rounded-xl" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Late fee</Label>
              <Select value={lateFeeType} onValueChange={(v: any) => setLateFeeType(v)}>
                <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No late fee</SelectItem>
                  <SelectItem value="flat">Flat ₹ per day</SelectItem>
                  <SelectItem value="percent">% per day</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Late fee value</Label>
              <Input type="number" min={0} value={lateFeeValue} onChange={(e) => setLateFeeValue(e.target.value)} disabled={lateFeeType === "none"} className="rounded-xl" />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-xl border border-border p-4">
            <div>
              <div className="font-medium">Pro-rate new residents</div>
              <div className="text-sm text-muted-foreground">Bill partial cycle if a resident joins mid-period</div>
            </div>
            <Switch checked={prorate} onCheckedChange={setProrate} />
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} className="rounded-xl h-11">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save schedule
            </Button>
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}
