import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Gift, Ban, RotateCcw, KeyRound, Clock, Loader2, AlertCircle, Home, Users, UserPlus, LifeBuoy, History, ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusChip } from "@/components/system/StatusChip";
import { saasState, planName, fmtDate, ACTION_MESSAGES, humanAction } from "@/lib/super-admin-ui";

export const Route = createFileRoute("/_admin/admin/societies/$id")({
  head: () => ({ meta: [{ title: "Society — Super Admin · SociyoHub" }, { name: "description", content: "Subscription, trial and lifecycle controls for one society." }] }),
  component: SocietyDetailPage,
});

type Overview = {
  status: "ok";
  society: {
    id: string; name: string; city: string | null; state: string | null; created_at: string; lifecycle: string | null;
    plan_id: string | null; plan_status: string | null; plan_expires_at: string | null; trial_ends_at: string | null;
    total_units: number | null; structure_mode: string | null; invite_code_enabled: boolean | null;
  };
  counts: { units: number; members: number; pending_joins: number; open_tickets: number };
  admins: { name: string; role: string; since: string }[];
  activity: { action: string; at: string }[];
};

type Action = null | "grant" | "trial" | "suspend" | "restore";

function SocietyDetailPage() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [action, setAction] = useState<Action>(null);
  const q = useQuery({
    queryKey: ["admin-society", id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_society_overview", { _society_id: id });
      if (error) throw new Error("load_failed");
      return data as unknown as Overview | { status: "not_found" | "not_authorized" };
    },
  });
  const plans = useQuery({
    queryKey: ["plans-min"],
    queryFn: async () => (await supabase.from("plans").select("id,name,price_monthly_inr").order("sort_order")).data ?? [],
    staleTime: 300_000,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-society", id] });
    qc.invalidateQueries({ queryKey: ["admin-societies-v2"] });
  };

  const back = (
    <Link to="/admin/societies" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
      <ArrowLeft className="h-4 w-4" /> Societies
    </Link>
  );

  if (q.isLoading) {
    return <div className="mx-auto max-w-4xl space-y-3 p-4"><Skeleton className="h-10 w-32" /><Skeleton className="h-44 rounded-3xl" /><Skeleton className="h-28 rounded-3xl" /></div>;
  }
  if (q.error || !q.data || q.data.status !== "ok") {
    const nf = q.data?.status === "not_found";
    return (
      <div className="mx-auto max-w-4xl p-4">
        {back}
        <div className="rounded-3xl border bg-card p-8 text-center">
          <AlertCircle className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
          <p className="font-medium">{nf ? "Society not found" : q.data?.status === "not_authorized" ? "Super Admin access required" : "Couldn't load this society"}</p>
          {!nf && q.data?.status !== "not_authorized" && <Button variant="outline" className="mt-3 min-h-11" onClick={() => q.refetch()}>Retry</Button>}
        </div>
      </div>
    );
  }

  const { society: s, counts, admins, activity } = q.data;
  const st = saasState({ status: s.lifecycle, plan_status: s.plan_status, plan_expires_at: s.plan_expires_at, trial_ends_at: s.trial_ends_at });
  const suspended = s.lifecycle === "suspended";

  return (
    <div className="min-h-dvh bg-muted/30 pb-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))]">
      <div className="mx-auto max-w-4xl space-y-4 p-4">
        {back}
        <section className="rounded-3xl bg-[oklch(0.22_0.05_260)] p-5 text-white shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-white/60">Society</p>
          <h1 className="mt-1 text-2xl font-semibold leading-tight">{s.name}</h1>
          <p className="mt-0.5 text-sm text-white/70">{[s.city, s.state].filter(Boolean).join(", ") || "Location not set"} · joined {fmtDate(s.created_at)}</p>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kv k="Plan" v={planName(s.plan_id)} />
            <Kv k="Status" v={st.label} />
            <Kv k={st.key.startsWith("trial") ? "Trial ends" : "Plan until"} v={st.key.startsWith("trial") ? (s.trial_ends_at ? fmtDate(s.trial_ends_at) : "—") : (s.plan_expires_at ? fmtDate(s.plan_expires_at) : "—")} />
            <Kv k="Units" v={`${counts.units}${s.total_units ? ` / ${s.total_units} declared` : ""}`} />
          </div>
        </section>

        <section className="rounded-3xl border bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Subscription controls</h2>
            <StatusChip tone={st.tone}>{st.label}</StatusChip>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <ActBtn icon={Gift} label="Grant plan" onClick={() => setAction("grant")} />
            <ActBtn icon={Clock} label="Extend trial" disabled={s.plan_status === "active"} onClick={() => setAction("trial")} />
            {suspended
              ? <ActBtn icon={RotateCcw} label="Restore" onClick={() => setAction("restore")} />
              : <ActBtn icon={Ban} label="Suspend" danger onClick={() => setAction("suspend")} />}
            <InviteReset societyId={s.id} />
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Every action is checked on the server and recorded in the audit history. Paid plans bought by societies go through Razorpay checkout.
          </p>
        </section>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric icon={Home} label="Active units" value={counts.units} />
          <Metric icon={Users} label="Members" value={counts.members} />
          <Metric icon={UserPlus} label="Pending joins" value={counts.pending_joins} warn={counts.pending_joins > 0} />
          <Metric icon={LifeBuoy} label="Open tickets" value={counts.open_tickets} warn={counts.open_tickets > 0} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-3xl border bg-card p-4 shadow-sm">
            <h2 className="mb-2 font-semibold">Committee</h2>
            {admins.length === 0 ? (
              <p className="rounded-xl bg-warning/10 p-3 text-sm text-warning">No active admin — the society can't be managed until someone is assigned.</p>
            ) : (
              <ul className="divide-y">
                {admins.map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                    <span className="truncate font-medium">{a.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{a.role === "society_admin" ? "Society admin" : "Block admin"}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="rounded-3xl border bg-card p-4 shadow-sm">
            <h2 className="mb-2 flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-primary" /> Recent activity</h2>
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recorded activity yet.</p>
            ) : (
              <ul className="space-y-2">
                {activity.map((a, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{humanAction(a.action)}</span>
                    <time className="shrink-0 text-xs text-muted-foreground">{new Date(a.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</time>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <ActionSheet
        action={action} onClose={() => setAction(null)} societyId={s.id} societyName={s.name}
        currentPlan={s.plan_id} plans={(plans.data ?? []) as { id: string; name: string; price_monthly_inr: number | null }[]}
        onDone={() => { setAction(null); refresh(); }}
      />
    </div>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return <div className="min-w-0"><p className="text-[11px] text-white/60">{k}</p><p className="truncate text-sm font-semibold">{v}</p></div>;
}
function Metric({ icon: Icon, label, value, warn }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-2xl border bg-card p-3.5 shadow-sm">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <p className={`mt-1.5 text-xl font-semibold tabular-nums ${warn ? "text-warning" : ""}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
function ActBtn({ icon: Icon, label, onClick, disabled, danger }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Button variant="outline" disabled={disabled} onClick={onClick} className={`min-h-12 flex-col gap-1 py-2 text-xs ${danger ? "text-destructive hover:text-destructive" : ""}`}>
      <Icon className="h-4 w-4" />{label}
    </Button>
  );
}

function InviteReset({ societyId }: { societyId: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <ActBtn icon={busy ? Loader2 : KeyRound} label="New invite code" disabled={busy} onClick={async () => {
      if (busy || !window.confirm("Generate a new invite code? The old code stops working immediately.")) return;
      setBusy(true);
      const { error } = await supabase.rpc("regenerate_society_invite_code", { _society_id: societyId });
      setBusy(false);
      if (error) toast.error("Couldn't regenerate the invite code. Try again.");
      else toast.success("New invite code generated");
    }} />
  );
}

function ActionSheet({
  action, onClose, societyId, societyName, currentPlan, plans, onDone,
}: {
  action: Action; onClose: () => void; societyId: string; societyName: string; currentPlan: string | null;
  plans: { id: string; name: string; price_monthly_inr: number | null }[]; onDone: () => void;
}) {
  const [planId, setPlanId] = useState(currentPlan && currentPlan !== "trial" ? currentPlan : "pro");
  const [months, setMonths] = useState("1");
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const needsReason = action === "trial" || action === "suspend" || action === "restore";
  const paidPlans = plans.filter((p) => p.id !== "trial");

  async function submit() {
    if (busy) return;
    if (needsReason && reason.trim().length < 3) { toast.error(ACTION_MESSAGES.reason_required); return; }
    setBusy(true);
    try {
      if (action === "grant") {
        const { error } = await supabase.rpc("admin_grant_society_plan", { _society_id: societyId, _plan_id: planId, _months: Number(months), _extend: true });
        if (error) throw error;
        toast.success(`${planName(planId)} granted for ${months} month${months === "1" ? "" : "s"}`);
      } else {
        const { data, error } = action === "trial"
          ? await supabase.rpc("admin_extend_trial", { _society_id: societyId, _days: Number(days), _reason: reason.trim() })
          : await supabase.rpc("admin_set_society_status", { _society_id: societyId, _status: action === "suspend" ? "suspended" : "active", _reason: reason.trim() });
        if (error) throw error;
        const status = (data as { status?: string } | null)?.status ?? "temporary_error";
        if (status !== "success") { toast.error(ACTION_MESSAGES[status] ?? "Couldn't save. Try again."); return; }
        toast.success(action === "trial" ? "Trial extended" : action === "suspend" ? "Society suspended" : "Society restored");
      }
      setReason("");
      onDone();
    } catch {
      toast.error("Couldn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const titles: Record<Exclude<Action, null>, [string, string]> = {
    grant: ["Grant a plan", `Activate or extend a paid plan for ${societyName} without charging them.`],
    trial: ["Extend trial", "Adds days from today or from the current trial end, whichever is later."],
    suspend: ["Suspend society", "Members lose access until you restore it. No data is deleted."],
    restore: ["Restore society", "Members regain access with their existing plan."],
  };

  return (
    <Sheet open={!!action} onOpenChange={(o) => !o && !busy && onClose()}>
      <SheetContent side="bottom" className="rounded-t-3xl pb-[max(1rem,env(safe-area-inset-bottom))] sm:mx-auto sm:max-w-lg">
        {action && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle>{titles[action][0]}</SheetTitle>
              <SheetDescription>{titles[action][1]}</SheetDescription>
            </SheetHeader>
            <div className="mt-4 space-y-4">
              {action === "grant" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="plan">Plan</Label>
                    <Select value={planId} onValueChange={setPlanId}>
                      <SelectTrigger id="plan" className="min-h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>{paidPlans.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="months">Duration</Label>
                    <Select value={months} onValueChange={setMonths}>
                      <SelectTrigger id="months" className="min-h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>{["1", "3", "6", "12"].map((m) => <SelectItem key={m} value={m}>{m} month{m === "1" ? "" : "s"}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
              )}
              {action === "trial" && (
                <div className="space-y-1.5">
                  <Label htmlFor="days">Extra days</Label>
                  <Select value={days} onValueChange={setDays}>
                    <SelectTrigger id="days" className="min-h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>{["3", "7", "14", "30"].map((d) => <SelectItem key={d} value={d}>{d} days</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
              {needsReason && (
                <div className="space-y-1.5">
                  <Label htmlFor="reason">Reason (saved in audit history)</Label>
                  <Textarea id="reason" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
                </div>
              )}
              <Button className="min-h-12 w-full" variant={action === "suspend" ? "destructive" : "default"} disabled={busy} onClick={submit}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : titles[action][0]}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
