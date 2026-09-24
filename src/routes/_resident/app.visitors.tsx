import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Share2, Copy, Check, X, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { VISITOR_CATEGORIES, categoryLabel, effectiveStatus, fmtTime, gateErrorMessage, statusMeta } from "@/lib/visitors";

export const Route = createFileRoute("/_resident/app/visitors")({
  head: () => ({
    meta: [
      { title: "My Visitors — SociyoHub" },
      { name: "description", content: "Invite guests, approve visitors at the gate and see your visitor history." },
    ],
  }),
  component: MyVisitors,
});

interface VisitorRow {
  id: string; visitor_name: string; vehicle_number: string | null; purpose: string | null; category: string;
  entry_at: string; exit_at: string | null; status: string | null; gate_pass_code: string | null;
  expected_at: string | null; valid_until: string | null; created_at: string;
}

const WHEN = [
  { v: "today", label: "Today", hours: 24, offset: 0 },
  { v: "tomorrow", label: "Tomorrow", hours: 24, offset: 1 },
  { v: "week", label: "Next 7 days", hours: 168, offset: 0 },
] as const;
const EMPTY = { name: "", phone: "", category: "guest", purpose: "", vehicle: "", when: "today" as (typeof WHEN)[number]["v"] };

function MyVisitors() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ code: string; name: string } | null>(null);
  const [tab, setTab] = useState<"active" | "history">("active");

  const q = useQuery({
    queryKey: ["my-visitors", user?.id],
    enabled: !!user,
    refetchInterval: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("visitors")
        .select("id, visitor_name, vehicle_number, purpose, category, entry_at, exit_at, status, gate_pass_code, expected_at, valid_until, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as VisitorRow[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["my-visitors"] });

  const rows = (q.data ?? []).map((v) => ({ ...v, eff: effectiveStatus(v) }));
  const ACTIVE = ["awaiting", "approved", "expected", "pending", "inside"];
  const active = rows.filter((v) => ACTIVE.includes(v.eff));
  const history = rows.filter((v) => !ACTIVE.includes(v.eff));
  const waiting = active.filter((v) => v.eff === "awaiting");
  const shown = tab === "active" ? active.filter((v) => v.eff !== "awaiting") : history;

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const w = WHEN.find((x) => x.v === form.when)!;
    const start = new Date();
    if (w.offset) { start.setDate(start.getDate() + w.offset); start.setHours(0, 0, 0, 0); }
    setSaving(true);
    const { data, error } = await supabase.rpc("visitor_invite", {
      _flat_id: undefined as unknown as string, _name: form.name, _phone: form.phone, _category: form.category,
      _purpose: form.purpose, _vehicle: form.vehicle, _expected_at: start.toISOString(), _valid_hours: w.hours,
    });
    setSaving(false);
    if (error) return toast.error(gateErrorMessage(error));
    const r = (data as { gate_pass_code: string }[])?.[0];
    setIssued({ code: r.gate_pass_code, name: form.name });
    setForm(EMPTY);
    setOpen(false);
    refresh();
  }

  async function act(id: string, action: "approve" | "deny" | "cancel") {
    if (busyId) return;
    setBusyId(id);
    const { error } = await supabase.rpc("visitor_resident_action", { _id: id, _action: action });
    setBusyId(null);
    if (error) toast.error(gateErrorMessage(error));
    else toast.success(action === "approve" ? "Guard told to let them in" : action === "deny" ? "Entry denied" : "Invite cancelled");
    refresh();
  }

  function share(code: string, name: string) {
    const text = `Hi ${name}, your gate pass code is ${code}. Show it to the guard at the gate.`;
    if (navigator.share) navigator.share({ text }).catch(() => undefined);
    else void navigator.clipboard.writeText(text).then(() => toast.success("Copied"));
  }

  return (
    <div className="px-4 py-5 space-y-4 pb-28 max-w-xl mx-auto">
      <header className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Visitors</h1>
          <p className="text-sm text-muted-foreground">Invite guests and approve people at the gate</p>
        </div>
        <Button className="min-h-11 rounded-xl" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Invite</Button>
      </header>

      {waiting.length > 0 && (
        <section aria-label="Waiting at the gate" className="space-y-2">
          {waiting.map((v) => (
            <Card key={v.id} className="rounded-2xl border-warning/50 bg-warning/10">
              <CardContent className="p-4 space-y-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-warning-foreground">At the gate now</p>
                  <p className="font-semibold">{v.visitor_name}</p>
                  <p className="text-sm text-muted-foreground">{v.purpose || categoryLabel(v.category)} · {fmtTime(v.created_at)}</p>
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1 h-12 rounded-xl" disabled={busyId === v.id} onClick={() => act(v.id, "approve")}>
                    {busyId === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="h-4 w-4 mr-1" />Approve</>}
                  </Button>
                  <Button variant="outline" className="flex-1 h-12 rounded-xl" disabled={busyId === v.id} onClick={() => act(v.id, "deny")}>
                    <X className="h-4 w-4 mr-1" />Deny
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      <div role="tablist" className="grid grid-cols-2 gap-1 rounded-2xl bg-muted p-1">
        {(["active", "history"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={cn("min-h-11 rounded-xl text-sm font-medium", tab === t ? "bg-background shadow-sm" : "text-muted-foreground")}>
            {t === "active" ? `Upcoming & inside (${active.length - waiting.length})` : "History"}
          </button>
        ))}
      </div>

      {q.isLoading ? (
        <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />)}</div>
      ) : q.isError && rows.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-6 text-center space-y-3">
          <p className="text-sm">{gateErrorMessage(q.error)}</p>
          <Button variant="outline" className="min-h-11 rounded-xl" onClick={() => q.refetch()}>Retry</Button>
        </CardContent></Card>
      ) : shown.length === 0 ? (
        <Card className="rounded-2xl"><CardContent className="p-8 text-center">
          <UsersRound className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">{tab === "active" ? "No upcoming visitors. Tap Invite to create a gate pass." : "No past visitors yet."}</p>
        </CardContent></Card>
      ) : (
        <ul className="space-y-2">
          {shown.map((v) => {
            const m = statusMeta(v.eff);
            const hasCode = (v.eff === "expected" || v.eff === "pending") && v.gate_pass_code;
            return (
              <li key={v.id}><Card className="rounded-2xl"><CardContent className="p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold truncate">{v.visitor_name}</p>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", m.className)}>{m.label}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {v.purpose || categoryLabel(v.category)}{v.vehicle_number ? ` · ${v.vehicle_number}` : ""}
                  {" · "}
                  {v.exit_at ? `In ${fmtTime(v.entry_at)} · Out ${fmtTime(v.exit_at)}` : v.eff === "inside" ? `In since ${fmtTime(v.entry_at)}` : v.valid_until ? `Valid till ${fmtTime(v.valid_until)}` : fmtTime(v.created_at)}
                </p>
                {hasCode && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="font-mono text-lg tracking-[0.3em] font-semibold">{v.gate_pass_code}</span>
                    <Button size="sm" variant="ghost" className="min-h-11 ml-auto" onClick={() => share(v.gate_pass_code!, v.visitor_name)}><Share2 className="h-4 w-4 mr-1" />Share</Button>
                    <Button size="sm" variant="ghost" className="min-h-11" disabled={busyId === v.id} onClick={() => act(v.id, "cancel")}>Cancel</Button>
                  </div>
                )}
              </CardContent></Card></li>
            );
          })}
        </ul>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          <SheetHeader><SheetTitle>Invite a visitor</SheetTitle></SheetHeader>
          <form onSubmit={invite} className="space-y-4 py-4">
            <div className="flex flex-wrap gap-2">
              {VISITOR_CATEGORIES.map((c) => (
                <button type="button" key={c.value} onClick={() => setForm({ ...form, category: c.value })}
                  className={cn("min-h-11 px-4 rounded-full border text-sm font-medium", form.category === c.value ? "bg-primary text-primary-foreground border-primary" : "border-border")}>
                  {c.label}
                </button>
              ))}
            </div>
            <div><Label htmlFor="i-name">Name *</Label><Input id="i-name" className="h-12" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="i-phone">Phone</Label><Input id="i-phone" className="h-12" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><Label htmlFor="i-veh">Vehicle</Label><Input id="i-veh" className="h-12" value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value })} /></div>
            </div>
            <div><Label htmlFor="i-purpose">Note for guard</Label><Input id="i-purpose" className="h-12" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} placeholder="e.g. Dinner guest" /></div>
            <div>
              <Label>Valid for</Label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {WHEN.map((w) => (
                  <button type="button" key={w.v} onClick={() => setForm({ ...form, when: w.v })}
                    className={cn("min-h-11 rounded-xl border text-sm", form.when === w.v ? "bg-primary text-primary-foreground border-primary" : "border-border")}>
                    {w.label}
                  </button>
                ))}
              </div>
            </div>
            <Button type="submit" className="w-full h-14 rounded-xl text-base" disabled={saving}>
              {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create gate pass"}
            </Button>
          </form>
        </SheetContent>
      </Sheet>

      <Sheet open={!!issued} onOpenChange={(o) => !o && setIssued(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader><SheetTitle>Gate pass ready</SheetTitle></SheetHeader>
          {issued && (
            <div className="py-6 text-center space-y-4">
              <p className="text-sm text-muted-foreground">Share this code with {issued.name}. It works once.</p>
              <p className="font-mono text-4xl font-bold tracking-[0.4em]">{issued.code}</p>
              <div className="flex gap-2">
                <Button className="flex-1 h-12 rounded-xl" onClick={() => share(issued.code, issued.name)}><Share2 className="h-4 w-4 mr-2" />Share</Button>
                <Button variant="outline" className="flex-1 h-12 rounded-xl" onClick={() => void navigator.clipboard.writeText(issued.code).then(() => toast.success("Copied"))}><Copy className="h-4 w-4 mr-2" />Copy</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
