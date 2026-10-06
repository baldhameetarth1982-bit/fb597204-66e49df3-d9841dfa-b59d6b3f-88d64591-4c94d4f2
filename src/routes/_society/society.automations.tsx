import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Receipt, BellRing, Lock, AlertTriangle, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { SettingsSection, SaveBar } from "@/components/settings/SettingsUI";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getAutomations, setAutomation, type AutomationSnapshot } from "@/lib/automation.functions";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/automations")({
  head: () => ({ meta: [{ title: "Automations — SociyoHub" }, { name: "robots", content: "noindex" }] }),
  component: AutomationsPage,
});

const ERR: Record<string, string> = {
  forbidden: "You don't have permission to manage automations.",
  plan_required: "Changing automations needs the Growth or Pro plan.",
  schedule_missing: "Set up your billing schedule first.",
  invalid_config: "One of the values is out of range.",
};
const errText = (e: unknown) => ERR[(e as Error)?.message] ?? "Couldn't save. Check your connection and try again.";
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

type Draft = { billOn: boolean; offset: number; remOn: boolean; minDays: number; repeat: number };
const toDraft = (s: AutomationSnapshot): Draft => ({
  billOn: s.bill_run?.enabled ?? false,
  offset: s.bill_run?.due_offset_days ?? 0,
  remOn: s.reminders.enabled,
  minDays: s.reminders.min_days_overdue,
  repeat: s.reminders.repeat_days,
});

const ACTIVITY_LABELS: Record<string, string> = {
  maintenance_reminder_sent: "Reminder recorded",
  automation_config_changed: "Automation settings changed",
};

function AutomationsPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const fetchFn = useServerFn(getAutomations);
  const saveFn = useServerFn(setAutomation);

  const q = useQuery({
    enabled: !!societyId,
    queryKey: ["automations", societyId],
    queryFn: () => fetchFn({ data: { societyId: societyId! } }),
    retry: false,
  });
  const activity = useQuery({
    enabled: !!societyId,
    queryKey: ["automation-activity", societyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("id, action, created_at")
        .eq("society_id", societyId!)
        .in("action", Object.keys(ACTIVITY_LABELS))
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => { if (q.data) setDraft(toDraft(q.data)); }, [q.data]);

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const s = q.data!;
      const base = toDraft(s);
      if (s.bill_run && (d.billOn !== base.billOn || d.offset !== base.offset))
        await saveFn({ data: { societyId: societyId!, key: "bill_run", enabled: d.billOn, config: { due_offset_days: d.offset } } });
      if (d.remOn !== base.remOn || d.minDays !== base.minDays || d.repeat !== base.repeat)
        await saveFn({ data: { societyId: societyId!, key: "reminders", enabled: d.remOn, config: { min_days_overdue: d.minDays, repeat_days: d.repeat } } });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["automations", societyId] }),
        qc.invalidateQueries({ queryKey: ["automation-activity", societyId] }),
      ]);
      toast.success(tu("op.automations_saved"));
    },
    onError: (e) => toast.error(errText(e)),
  });

  if (!societyId || q.isLoading || (q.data && !draft)) {
    return <PageShell><PageHeader title={tu("nav.automations")} /><div className="grid place-items-center py-16"><Loader2 className="h-5 w-5 animate-spin" /></div></PageShell>;
  }
  if (q.isError || !q.data || !draft) {
    return (
      <PageShell>
        <PageHeader title={tu("nav.automations")} />
        <div className="rounded-2xl border bg-card p-6 text-center space-y-3">
          <AlertTriangle className="mx-auto h-6 w-6 text-destructive" />
          <p className="text-sm">{(q.error as Error)?.message === "forbidden" ? ERR.forbidden : tu("op.couldn_t_load_automation_settings")}</p>
          <Button variant="outline" className="h-11" onClick={() => q.refetch()}><RotateCw className="mr-2 h-4 w-4" />{tu("common.retry")}</Button>
        </div>
      </PageShell>
    );
  }

  const s = q.data;
  const locked = !s.entitled;
  const base = toDraft(s);
  const dirty = JSON.stringify(base) !== JSON.stringify(draft);
  const num = (v: string, min: number, max: number) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

  return (
    <PageShell>
      <PageHeader title={tu("nav.automations")} description={tu("op.jobs_sociyohub_runs_for_your")} />
      <div className="space-y-4">
        {locked && (
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
            <Lock className="h-4 w-4" />
            <span className="flex-1">{tu("op.you_can_view_these_automations")}</span>
            <Button asChild size="sm" className="h-11"><Link to="/society/subscription">{tu("sec.seePlans")}</Link></Button>
          </div>
        )}

        <SettingsSection
          title={tu("op.monthly_bill_run")}
          icon={Receipt}
          trailing={<Badge variant={s.bill_run?.enabled ? "default" : "secondary"}>{s.bill_run ? (s.bill_run.enabled ? "On" : tu("op.off")) : tu("op.not_set_up")}</Badge>}
          description={tu("op.creates_maintenance_bills_for_every")}
        >
          {!s.bill_run ? (
            <p className="text-sm text-muted-foreground">{tu("op.no_billing_schedule_yet")} <Link to="/society/billing" className="underline">{tu("op.set_one_up_in_billing")}</Link> {tu("op.to_use_this_automation")}</p>
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-muted-foreground">{tu("op.repeats")}</dt><dd className="capitalize">{s.bill_run.cycle}</dd></div>
                <div><dt className="text-muted-foreground">{tu("op.checked_daily_at")}</dt><dd>7:30 AM</dd></div>
                <div><dt className="text-muted-foreground">{tu("op.last_run")}</dt><dd>{when(s.bill_run.last_run_at)}{s.bill_run.last_run_count != null && s.bill_run.last_run_at ? ` · ${s.bill_run.last_run_count} bills` : ""}</dd></div>
                <div><dt className="text-muted-foreground">{tu("op.next_run")}</dt><dd>{s.bill_run.enabled ? when(s.bill_run.next_run_at) : tu("cm.st.paused")}</dd></div>
              </dl>
              <div className="flex min-h-11 items-center justify-between gap-3">
                <Label htmlFor="bill-on">{tu("op.run_automatically")}</Label>
                <Switch id="bill-on" checked={draft.billOn} disabled={locked} onCheckedChange={(v) => setDraft({ ...draft, billOn: v })} />
              </div>
              <div className="flex min-h-11 items-center justify-between gap-3">
                <Label htmlFor="bill-offset">{tu("op.payment_due_after_days")}</Label>
                <Input id="bill-offset" type="number" inputMode="numeric" min={0} max={60} className="h-11 w-24" disabled={locked}
                  value={draft.offset} onChange={(e) => setDraft({ ...draft, offset: num(e.target.value, 0, 60) })} />
              </div>
              <p className="text-xs text-muted-foreground">{tu("op.amount_billing_day_and_cycle")} <Link to="/society/billing" className="underline">{tu("nav.billing")}</Link>. Saving here never starts a run right away.</p>
            </div>
          )}
        </SettingsSection>

        <SettingsSection
          title={tu("op.unpaid_dues_reminders")}
          icon={BellRing}
          trailing={<Badge variant={s.reminders.enabled ? "default" : "secondary"}>{s.reminders.enabled ? "On" : tu("op.off")}</Badge>}
          description={tu("op.every_morning_sends_the_main")}
        >
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-muted-foreground">{tu("op.checked_daily_at")}</dt><dd>9:00 AM</dd></div>
              <div><dt className="text-muted-foreground">{tu("op.last_reminder")}</dt><dd>{when(s.reminders.last_run_at)}</dd></div>
              <div><dt className="text-muted-foreground">{tu("op.last_7_days")}</dt><dd>{s.reminders.sent_7d} {tu("op.reminders")}</dd></div>
            </dl>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="rem-on">{tu("op.send_reminders")}</Label>
              <Switch id="rem-on" checked={draft.remOn} disabled={locked} onCheckedChange={(v) => setDraft({ ...draft, remOn: v })} />
            </div>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="rem-min">{tu("op.start_after_due_date_days")}</Label>
              <Input id="rem-min" type="number" inputMode="numeric" min={0} max={60} className="h-11 w-24" disabled={locked}
                value={draft.minDays} onChange={(e) => setDraft({ ...draft, minDays: num(e.target.value, 0, 60) })} />
            </div>
            <div className="flex min-h-11 items-center justify-between gap-3">
              <Label htmlFor="rem-rep">{tu("op.repeat_every_days")}</Label>
              <Input id="rem-rep" type="number" inputMode="numeric" min={1} max={30} className="h-11 w-24" disabled={locked}
                value={draft.repeat} onChange={(e) => setDraft({ ...draft, repeat: num(e.target.value, 1, 30) })} />
            </div>
          </div>
        </SettingsSection>

        {!locked && (
          <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate(draft)} onDiscard={() => setDraft(base)} />
        )}

        <SettingsSection title={tu("sd.recent")}>
          {activity.isLoading ? (
            <div className="grid place-items-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : activity.isError ? (
            <p className="text-sm text-muted-foreground">{tu("op.couldn_t_load_activity")}</p>
          ) : !activity.data?.length ? (
            <p className="text-sm text-muted-foreground">{tu("op.no_automation_activity_yet")}</p>
          ) : (
            <ul className="divide-y text-sm">
              {activity.data.map((r) => (
                <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2">
                  <span>{ACTIVITY_LABELS[r.action] ?? r.action}</span>
                  <span className="text-muted-foreground">{when(r.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </SettingsSection>
      </div>
    </PageShell>
  );
}
