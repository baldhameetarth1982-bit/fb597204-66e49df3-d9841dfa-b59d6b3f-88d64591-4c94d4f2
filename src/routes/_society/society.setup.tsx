import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Wrench, Building2, Layers, Receipt, Wallet, CheckCircle2, Loader2,
  ChevronLeft, ChevronRight, Lock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { PageShell } from "@/components/shared/PageHeader";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  getSocietyStructureOverview,
  configureSocietyStructureMode,
  type StructureMode,
  type StructureOverview,
} from "@/lib/society-structure";

export const Route = createFileRoute("/_society/society/setup")({
  head: () => ({ meta: [{ title: "Setup Wizard — SociyoHub" }] }),
  component: SetupWizardPage,
});

type Settings = {
  society_id: string;
  registration_no: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  structure_type: "blocks" | "towers" | "wings" | "buildings" | "none";
  opening_cash: number;
  opening_bank: number;
  opening_balance_date: string | null;
  maintenance_frequency: "monthly" | "quarterly" | "half_yearly" | "yearly";
  maintenance_due_day: number;
  grace_days: number;
  late_fee_amount: number;
  late_fee_type: "flat" | "percent";
  wizard_step: number;
  setup_completed_at: string | null;
};

const STEPS = [
  { key: "info", label: "Society Info", icon: Building2 },
  { key: "structure", label: "Structure", icon: Layers },
  { key: "policy", label: "Maintenance Policy", icon: Receipt },
  { key: "accounts", label: "Opening Balances", icon: Wallet },
  { key: "finish", label: "Finish", icon: CheckCircle2 },
] as const;

function defaultSettings(sid: string): Settings {
  return {
    society_id: sid,
    registration_no: "", address: "", city: "", state: "", pincode: "",
    structure_type: "blocks",
    opening_cash: 0, opening_bank: 0,
    opening_balance_date: new Date().toISOString().slice(0, 10),
    maintenance_frequency: "monthly",
    maintenance_due_day: 10,
    grace_days: 5,
    late_fee_amount: 0,
    late_fee_type: "flat",
    wizard_step: 0,
    setup_completed_at: null,
  };
}

function SetupWizardPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const navigate = useNavigate();
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const [overview, setOverview] = useState<StructureOverview | null>(null);
  const [modeSaving, setModeSaving] = useState(false);

  async function refreshOverview(sid: string) {
    try {
      const ov = await getSocietyStructureOverview(sid);
      setOverview(ov);
    } catch {
      /* silent — surface via UI if needed */
    }
  }

  async function chooseMode(mode: StructureMode) {
    if (!societyId) return;
    setModeSaving(true);
    try {
      const res = await configureSocietyStructureMode(societyId, mode);
      if (!res.ok) {
        toast.error(
          res.reason === "conversion_blocked_units_exist"
            ? "Cannot change mode — units already exist."
            : res.reason === "review_required_mixed_units"
            ? "Existing data is mixed. Review required before setting a mode."
            : res.reason === "review_required_units_without_block"
            ? "Existing units without a block. Cannot set structured mode automatically."
            : res.reason === "review_required_units_have_block"
            ? "Existing units belong to blocks. Cannot set serial mode automatically."
            : "Could not set mode",
        );
      } else {
        toast.success(mode === "structured" ? "Structured mode set" : "Serial mode set");
        await refreshOverview(societyId);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not set mode");
    } finally {
      setModeSaving(false);
    }
  }

  useEffect(() => {
    if (sidLoading || !societyId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("society_settings")
        .select("*")
        .eq("society_id", societyId)
        .maybeSingle();
      if (error && error.code !== "PGRST116") toast.error(error.message);
      const next = (data as Settings | null) ?? defaultSettings(societyId);
      setS(next);
      setStep(Math.min(next.wizard_step ?? 0, STEPS.length - 1));
      setLoading(false);
      void refreshOverview(societyId);
    })();
  }, [societyId, sidLoading]);

  const locked = !!s?.setup_completed_at;

  function patch<K extends keyof Settings>(k: K, v: Settings[K]) {
    setS((p) => (p ? { ...p, [k]: v } : p));
  }

  async function saveDraft(nextStep: number) {
    if (!s || !societyId) return;
    setSaving(true);
    const payload = { ...s, wizard_step: nextStep };
    const { error } = await supabase
      .from("society_settings")
      .upsert(payload, { onConflict: "society_id" });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    setS(payload);
    setStep(nextStep);
    return true;
  }

  async function finishWizard() {
    if (!s || !societyId) return;
    if (!s.opening_balance_date) {
      toast.error("Opening balance date is required");
      return;
    }
    const ok = await saveDraft(STEPS.length - 1);
    if (!ok) return;
    setSaving(true);
    const { error } = await supabase.rpc("complete_setup_wizard", { _society_id: societyId });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Setup complete — opening balances are now locked");
    setS({ ...s, setup_completed_at: new Date().toISOString(), wizard_step: STEPS.length - 1 });
    navigate({ to: "/society/dashboard" });
  }

  if (loading || !s) {
    return (
      <PageShell>
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <header className="mb-6 space-y-2">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-primary/10 grid place-items-center">
            <Wrench className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Setup Wizard</h1>
            <p className="text-xs text-muted-foreground">
              {locked
                ? "Setup completed. Opening balances are locked — use Adjustment entries for corrections."
                : "Complete the 5 steps to activate your society."}
            </p>
          </div>
        </div>

        {/* Stepper */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {STEPS.map((st, i) => {
            const Icon = st.icon;
            const active = i === step;
            const done = i < step || locked;
            return (
              <button
                key={st.key}
                onClick={() => setStep(i)}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border transition-colors shrink-0",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : done
                    ? "bg-primary/10 text-primary border-primary/30"
                    : "bg-background text-muted-foreground border-border",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {i + 1}. {st.label}
              </button>
            );
          })}
        </div>
      </header>

      <Card className="rounded-3xl">
        <CardContent className="p-5 space-y-4">
          {step === 0 && (
            <>
              <h2 className="text-base font-semibold">Society Information</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Registration No.">
                  <Input className="h-11 rounded-xl" value={s.registration_no ?? ""}
                    onChange={(e) => patch("registration_no", e.target.value)} />
                </Field>
                <Field label="Pincode">
                  <Input className="h-11 rounded-xl" value={s.pincode ?? ""}
                    onChange={(e) => patch("pincode", e.target.value)} />
                </Field>
                <div className="sm:col-span-2">
                  <Field label="Address">
                    <Textarea rows={2} value={s.address ?? ""}
                      onChange={(e) => patch("address", e.target.value)} />
                  </Field>
                </div>
                <Field label="City">
                  <Input className="h-11 rounded-xl" value={s.city ?? ""}
                    onChange={(e) => patch("city", e.target.value)} />
                </Field>
                <Field label="State">
                  <Input className="h-11 rounded-xl" value={s.state ?? ""}
                    onChange={(e) => patch("state", e.target.value)} />
                </Field>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="text-base font-semibold">Society structure</h2>
              <p className="text-xs text-muted-foreground">
                Choose how units are organised. This is the canonical model — you can only
                change it while there are no units.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(["structured", "serial"] as const).map((m) => {
                  const active = overview?.structure_mode === m;
                  const isLockedByUnits =
                    !!overview && overview.structure_mode && overview.structure_mode !== m && overview.total_units > 0;
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={modeSaving || !!isLockedByUnits}
                      onClick={() => chooseMode(m)}
                      className={cn(
                        "rounded-2xl border p-4 text-left transition-colors",
                        active
                          ? "border-primary bg-primary/5 text-primary"
                          : "border-border hover:bg-secondary",
                        isLockedByUnits && "opacity-60 cursor-not-allowed",
                      )}
                    >
                      <div className="text-sm font-semibold capitalize">
                        {m === "structured" ? "Structured (Blocks / Towers / Wings)" : "Serial (direct houses)"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {m === "structured"
                          ? "Units belong to a Block, Tower or Wing. Floor is optional."
                          : "Units belong directly to the society, no block, no floor."}
                      </div>
                      {isLockedByUnits && (
                        <div className="mt-2 text-[11px] font-medium text-amber-600">
                          Locked — remove existing units to switch mode.
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>

              {overview && (
                <div className="rounded-2xl bg-muted/40 p-3 text-xs text-muted-foreground">
                  <div>
                    Current mode:{" "}
                    <b className="text-foreground">
                      {overview.structure_mode ?? "not configured"}
                    </b>
                  </div>
                  <div>
                    Structures: <b className="text-foreground">{overview.total_structures}</b>
                    {" · "}
                    Units: <b className="text-foreground">{overview.total_units}</b>
                    {overview.inconsistent_units > 0 && (
                      <span className="ml-2 text-amber-600">
                        ({overview.inconsistent_units} inconsistent)
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="pt-2 border-t space-y-2">
                <p className="text-xs text-muted-foreground">
                  Label used across the app for structures:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {(["blocks", "towers", "wings", "buildings", "none"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => patch("structure_type", t)}
                      className={cn(
                        "rounded-2xl border p-3 text-sm capitalize text-left",
                        s.structure_type === t
                          ? "border-primary bg-primary/5 text-primary font-semibold"
                          : "border-border hover:bg-secondary",
                      )}
                    >
                      {t === "none" ? "Single building" : t}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-base font-semibold">Maintenance Policy</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Frequency">
                  <Select value={s.maintenance_frequency} onValueChange={(v) => patch("maintenance_frequency", v as any)}>
                    <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Monthly</SelectItem>
                      <SelectItem value="quarterly">Quarterly</SelectItem>
                      <SelectItem value="half_yearly">Half-yearly</SelectItem>
                      <SelectItem value="yearly">Yearly</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Due day of period (1–28)">
                  <Input type="number" min={1} max={28} className="h-11 rounded-xl"
                    value={s.maintenance_due_day}
                    onChange={(e) => patch("maintenance_due_day", Math.max(1, Math.min(28, +e.target.value || 1)))} />
                </Field>
                <Field label="Grace days">
                  <Input type="number" min={0} max={30} className="h-11 rounded-xl"
                    value={s.grace_days}
                    onChange={(e) => patch("grace_days", Math.max(0, Math.min(30, +e.target.value || 0)))} />
                </Field>
                <Field label="Late fee">
                  <div className="flex gap-2">
                    <Input type="number" min={0} className="h-11 rounded-xl"
                      value={s.late_fee_amount}
                      onChange={(e) => patch("late_fee_amount", Math.max(0, +e.target.value || 0))} />
                    <Select value={s.late_fee_type} onValueChange={(v) => patch("late_fee_type", v as any)}>
                      <SelectTrigger className="h-11 w-28 rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="flat">₹ Flat</SelectItem>
                        <SelectItem value="percent">% of dues</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </Field>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold">Opening Balances</h2>
                {locked && (
                  <span className="inline-flex items-center gap-1 text-xs text-amber-600">
                    <Lock className="h-3.5 w-3.5" /> Locked
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Enter your cash-in-hand and bank balance as of the start date. <strong>This can only be entered once.</strong> All future income and expenses will calculate from here.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="As of date">
                  <Input type="date" className="h-11 rounded-xl"
                    disabled={locked}
                    value={s.opening_balance_date ?? ""}
                    onChange={(e) => patch("opening_balance_date", e.target.value)} />
                </Field>
                <Field label="Cash on hand (₹)">
                  <Input type="number" min={0} step="0.01" className="h-11 rounded-xl"
                    disabled={locked}
                    value={s.opening_cash}
                    onChange={(e) => patch("opening_cash", +e.target.value || 0)} />
                </Field>
                <Field label="Bank balance (₹)">
                  <Input type="number" min={0} step="0.01" className="h-11 rounded-xl"
                    disabled={locked}
                    value={s.opening_bank}
                    onChange={(e) => patch("opening_bank", +e.target.value || 0)} />
                </Field>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <h2 className="text-base font-semibold">Review &amp; Finish</h2>
              <ul className="text-sm space-y-1">
                <Row k="Address" v={[s.address, s.city, s.state, s.pincode].filter(Boolean).join(", ") || "—"} />
                <Row k="Structure" v={s.structure_type} />
                <Row k="Maintenance" v={`${s.maintenance_frequency}, due day ${s.maintenance_due_day}, grace ${s.grace_days}d`} />
                <Row k="Late fee" v={s.late_fee_type === "flat" ? `₹${s.late_fee_amount}` : `${s.late_fee_amount}%`} />
                <Row k="Opening cash" v={`₹${s.opening_cash.toLocaleString("en-IN")}`} />
                <Row k="Opening bank" v={`₹${s.opening_bank.toLocaleString("en-IN")}`} />
                <Row k="As of" v={s.opening_balance_date ?? "—"} />
              </ul>
              <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-3 text-xs text-amber-900 dark:text-amber-200">
                Finishing the wizard <strong>locks opening balances forever</strong>. Future corrections must be Adjustment entries.
              </div>
            </>
          )}

          <div className="flex justify-between pt-3 border-t">
            <Button variant="ghost" disabled={step === 0 || saving}
              onClick={() => setStep((i) => Math.max(0, i - 1))}>
              <ChevronLeft className="h-4 w-4 mr-1" /> Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button disabled={saving} onClick={() => saveDraft(step + 1)}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save &amp; Next <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : locked ? (
              <Button onClick={() => navigate({ to: "/society/dashboard" })}>Go to Dashboard</Button>
            ) : (
              <Button disabled={saving} onClick={finishWizard}>
                {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Finish Setup
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </PageShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex justify-between gap-3 py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="font-medium text-right">{v}</span>
    </li>
  );
}
