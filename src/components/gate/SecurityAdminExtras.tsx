// Committee security tools: guard sessions (remote sign-out + QR shift entry),
// patrol routes/rounds, gate devices + RFID tags, safety alert history.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import { Copy, KeyRound, Loader2, Plus, QrCode, ShieldOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { fmtTime, gateErrorMessage } from "@/lib/visitors";
import { ReasonSheet } from "./GateOps";

const Err = ({ e, retry }: { e: unknown; retry: () => void }) => (
  <p className="text-sm text-destructive" role="alert">{gateErrorMessage(e)} <button className="underline min-h-11" onClick={retry}>Retry</button></p>
);
const Spin = () => <Loader2 className="h-5 w-5 animate-spin mx-auto" aria-label="Loading" />;

/* ---------- Guards ---------- */
interface GuardRow { user_id: string; full_name: string | null; phone_last4: string | null; active_session_id: string | null; started_at: string | null; last_seen_at: string | null; expires_at: string | null; method: string | null; device_label: string | null; blocked: boolean }
export function GuardsAdmin() {
  const qc = useQueryClient();
  const [revoke, setRevoke] = useState<GuardRow | null>(null);
  const [qr, setQr] = useState<{ guard: GuardRow; token: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin-guards"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_gate_guards");
      if (error) throw error;
      return (data ?? []) as GuardRow[];
    },
  });
  async function issue(g: GuardRow) {
    setBusy(g.user_id);
    const { data, error } = await supabase.rpc("admin_issue_guard_entry_token", { _guard_user_id: g.user_id });
    setBusy(null);
    if (error) return toast.error(gateErrorMessage(error));
    const r = data as { token: string; expires_at: string };
    setQr({ guard: g, ...r });
    qc.invalidateQueries({ queryKey: ["admin-guards"] });
  }
  if (q.isLoading) return <Spin />;
  if (q.isError) return <Err e={q.error} retry={() => q.refetch()} />;
  const link = qr ? `${window.location.origin}/app/guard?entry=${encodeURIComponent(qr.token)}` : "";
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">Guards can act at the gate only during an active shift. Signing a guard out stops every gate action at once; they then need a fresh QR from you.</p>
      {!q.data?.length ? <p className="text-sm text-muted-foreground text-center py-4">No guards yet. Add one from Team.</p> : (
        <ul className="space-y-2">
          {q.data.map((g) => (
            <li key={g.user_id} className="rounded-2xl border p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium">{g.full_name ?? "Guard"}{g.phone_last4 ? ` · ••${g.phone_last4}` : ""}</p>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", g.active_session_id ? "bg-success/15 text-success" : g.blocked ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                  {g.active_session_id ? "On shift" : g.blocked ? "Signed out · needs QR" : "Off shift"}
                </span>
              </div>
              {g.active_session_id && <p className="text-xs text-muted-foreground">{g.device_label ?? "Device"} · started {fmtTime(g.started_at)} · seen {fmtTime(g.last_seen_at)} · via {g.method === "qr" ? "QR" : "sign-in"}</p>}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="min-h-11" disabled={busy === g.user_id} onClick={() => issue(g)}><QrCode className="h-4 w-4 mr-1" />Shift QR</Button>
                <Button size="sm" variant="outline" className="min-h-11 text-destructive" onClick={() => setRevoke(g)}><ShieldOff className="h-4 w-4 mr-1" />Sign out</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ReasonSheet title={`Sign out ${revoke?.full_name ?? "guard"}`} hint="Ends their gate access on every device now. Recorded in history." min={5}
        open={!!revoke} onOpenChange={(o) => !o && setRevoke(null)}
        onSubmit={async (reason) => {
          const { data, error } = await supabase.rpc("admin_revoke_guard_access", { _guard_user_id: revoke!.user_id, _reason: reason });
          if (error) { toast.error(gateErrorMessage(error)); return false; }
          const n = (data as { revoked_sessions?: number })?.revoked_sessions ?? 0;
          toast.success(n ? "Guard signed out" : "Already signed out — a new QR is now required");
          qc.invalidateQueries({ queryKey: ["admin-guards"] });
          return true;
        }} />
      <Sheet open={!!qr} onOpenChange={(o) => !o && setQr(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader><SheetTitle>Shift QR for {qr?.guard.full_name ?? "guard"}</SheetTitle></SheetHeader>
          {qr && (
            <div className="py-4 space-y-3 text-center">
              <div className="mx-auto w-fit rounded-2xl bg-background p-3 border"><QRCodeSVG value={link} size={220} level="M" /></div>
              <p className="text-sm">Ask the guard to scan this with their own signed-in phone. Works once, only for this guard, until {fmtTime(qr.expires_at)}.</p>
              <Button variant="outline" className="min-h-11" onClick={() => { void navigator.clipboard?.writeText(qr.token); toast.success("Code copied"); }}><Copy className="h-4 w-4 mr-1" />Copy code</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ---------- Patrol ---------- */
interface PatrolOverview { routes: { id: string; name: string; active: boolean; checkpoints: number }[]; rounds: { id: string; route: string; guard: string | null; status: string; scheduled_start: string; due_by: string; done: number; total: number; incidents: number }[] }
const RS: Record<string, string> = { scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", partial: "Incomplete", missed: "Missed", cancelled: "Cancelled" };
export function PatrolAdmin() {
  const qc = useQueryClient();
  const [route, setRoute] = useState({ name: "", cps: [{ name: "", code: "" }] });
  const [sched, setSched] = useState({ route: "", guard: "", start: "", window: "60", days: "1" });
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["admin-patrol"],
    queryFn: async () => {
      const [o, g] = await Promise.all([supabase.rpc("admin_patrol_overview", { _days: 7 }), supabase.rpc("admin_list_gate_guards")]);
      if (o.error) throw o.error;
      if (g.error) throw g.error;
      return { ...(o.data as unknown as PatrolOverview), guards: (g.data ?? []) as GuardRow[] };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-patrol"] });
  async function run(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(true); const { error } = await fn(); setBusy(false);
    if (error) { toast.error(gateErrorMessage(error)); return false; }
    toast.success(ok); refresh(); return true;
  }
  if (q.isLoading) return <Spin />;
  if (q.isError) return <Err e={q.error} retry={() => q.refetch()} />;
  const d = q.data!;
  const validCps = route.cps.filter((c) => c.name.trim().length >= 2);
  return (
    <div className="space-y-3">
      <Card className="rounded-2xl"><CardContent className="p-4 sm:p-4 space-y-2">
        <p className="font-medium">New route</p>
        <div><Label htmlFor="pr-name">Route name *</Label><Input id="pr-name" className="h-11" value={route.name} maxLength={80} onChange={(e) => setRoute({ ...route, name: e.target.value })} placeholder="Night round" /></div>
        {route.cps.map((c, i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_auto] gap-2 items-end">
            <div><Label htmlFor={`cp-${i}`}>Checkpoint {i + 1}</Label><Input id={`cp-${i}`} className="h-11" value={c.name} maxLength={80} onChange={(e) => { const cps = [...route.cps]; cps[i] = { ...c, name: e.target.value }; setRoute({ ...route, cps }); }} /></div>
            <div><Label htmlFor={`cc-${i}`}>Code (optional)</Label><Input id={`cc-${i}`} className="h-11 font-mono uppercase" value={c.code} maxLength={12} onChange={(e) => { const cps = [...route.cps]; cps[i] = { ...c, code: e.target.value.replace(/[^A-Za-z0-9]/g, "") }; setRoute({ ...route, cps }); }} /></div>
            <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Remove checkpoint" disabled={route.cps.length === 1} onClick={() => setRoute({ ...route, cps: route.cps.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <p className="text-xs text-muted-foreground">A code (4–12 letters/digits) printed at the spot proves the guard was there. Codes are stored scrambled and can't be read back.</p>
        <div className="flex gap-2">
          <Button variant="outline" className="min-h-11" disabled={route.cps.length >= 30} onClick={() => setRoute({ ...route, cps: [...route.cps, { name: "", code: "" }] })}><Plus className="h-4 w-4 mr-1" />Checkpoint</Button>
          <Button className="min-h-11" disabled={busy || route.name.trim().length < 2 || !validCps.length || validCps.some((c) => c.code && c.code.length < 4)}
            onClick={async () => { if (await run(() => supabase.rpc("admin_upsert_patrol_route", { _id: null as unknown as string, _name: route.name, _checkpoints: validCps, _active: true }), "Route saved")) setRoute({ name: "", cps: [{ name: "", code: "" }] }); }}>Save route</Button>
        </div>
      </CardContent></Card>

      {d.routes.length > 0 && (
        <Card className="rounded-2xl"><CardContent className="p-4 sm:p-4 space-y-2">
          <p className="font-medium">Schedule rounds</p>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="s-route">Route</Label>
              <select id="s-route" className="h-11 w-full rounded-md border bg-background px-2" value={sched.route} onChange={(e) => setSched({ ...sched, route: e.target.value })}>
                <option value="">Choose…</option>{d.routes.filter((r) => r.active).map((r) => <option key={r.id} value={r.id}>{r.name} ({r.checkpoints})</option>)}
              </select></div>
            <div><Label htmlFor="s-guard">Guard</Label>
              <select id="s-guard" className="h-11 w-full rounded-md border bg-background px-2" value={sched.guard} onChange={(e) => setSched({ ...sched, guard: e.target.value })}>
                <option value="">Choose…</option>{d.guards.map((g) => <option key={g.user_id} value={g.user_id}>{g.full_name ?? "Guard"}</option>)}
              </select></div>
            <div><Label htmlFor="s-start">First start</Label><Input id="s-start" type="datetime-local" className="h-11" value={sched.start} onChange={(e) => setSched({ ...sched, start: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label htmlFor="s-win">Minutes</Label><Input id="s-win" inputMode="numeric" className="h-11" value={sched.window} onChange={(e) => setSched({ ...sched, window: e.target.value.replace(/\D/g, "") })} /></div>
              <div><Label htmlFor="s-days">Days</Label><Input id="s-days" inputMode="numeric" className="h-11" value={sched.days} onChange={(e) => setSched({ ...sched, days: e.target.value.replace(/\D/g, "") })} /></div>
            </div>
          </div>
          <Button className="min-h-11" disabled={busy || !sched.route || !sched.guard || !sched.start}
            onClick={() => run(() => supabase.rpc("admin_schedule_patrol_rounds", { _route_id: sched.route, _guard: sched.guard, _first_start: new Date(sched.start).toISOString(), _window_minutes: Number(sched.window), _days: Number(sched.days) }), "Rounds scheduled")}>Schedule</Button>
        </CardContent></Card>
      )}

      {!d.rounds.length ? <p className="text-sm text-muted-foreground text-center py-2">No patrol rounds in the last 7 days.</p> : (
        <ul className="space-y-2">
          {d.rounds.map((r) => (
            <li key={r.id} className="rounded-2xl border p-3 flex items-center gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.route} · {r.guard ?? "Guard"}</p>
                <p className="text-xs text-muted-foreground">{fmtTime(r.scheduled_start)} · {r.done}/{r.total} checkpoints{r.incidents ? ` · ${r.incidents} incident${r.incidents > 1 ? "s" : ""}` : ""}</p>
              </div>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", r.status === "completed" ? "bg-success/15 text-success" : r.status === "missed" || r.status === "partial" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>{RS[r.status]}</span>
              {(r.status === "scheduled" || r.status === "in_progress") && (
                <Button size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => run(() => supabase.rpc("admin_cancel_patrol_round", { _id: r.id, _reason: "Cancelled by committee" }), "Round cancelled")}>Cancel</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Devices & RFID ---------- */
interface Dev { id: string; kind: string; name: string; gate_label: string | null; provider: string | null; status: string; last_seen_at: string | null }
interface Tag { id: string; last4: string; label: string | null; status: string; created_at: string }
const KIND: Record<string, string> = { anpr: "Number-plate camera", rfid: "RFID reader", barrier: "Boom barrier" };
export function DevicesAdmin({ societyId }: { societyId: string }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ kind: "anpr", name: "", gate: "", provider: "" });
  const [tag, setTag] = useState({ raw: "", label: "" });
  const [secret, setSecret] = useState<{ id: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["admin-devices", societyId],
    queryFn: async () => {
      const [d, t] = await Promise.all([
        supabase.from("gate_devices").select("id, kind, name, gate_label, provider, status, last_seen_at").eq("society_id", societyId).order("created_at"),
        supabase.from("rfid_credentials").select("id, last4, label, status, created_at").eq("society_id", societyId).order("created_at", { ascending: false }).limit(200),
      ]);
      if (d.error) throw d.error;
      if (t.error) throw t.error;
      return { devices: (d.data ?? []) as Dev[], tags: (t.data ?? []) as Tag[] };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-devices"] });
  async function upsert(d: Partial<Dev> & { id: string | null }, status: string, rotate = false) {
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_upsert_gate_device", { _id: d.id as string, _kind: d.kind!, _name: d.name!, _gate_label: d.gate_label ?? "", _provider: d.provider ?? "", _status: status, _rotate_key: rotate });
    setBusy(false);
    if (error) return toast.error(gateErrorMessage(error));
    const r = data as { id: string; device_key: string | null };
    if (r.device_key) setSecret({ id: r.id, key: r.device_key });
    toast.success("Device saved"); refresh();
  }
  if (q.isLoading) return <Spin />;
  if (q.isError) return <Err e={q.error} retry={() => q.refetch()} />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">No hardware provider is connected yet. A device shows "Connected" only after it really sends data. Manual check-in always keeps working.</p>
      <Card className="rounded-2xl"><CardContent className="p-4 sm:p-4 space-y-2">
        <p className="font-medium">Add device</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label htmlFor="d-kind">Type</Label>
            <select id="d-kind" className="h-11 w-full rounded-md border bg-background px-2" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select></div>
          <div><Label htmlFor="d-name">Name *</Label><Input id="d-name" className="h-11" maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><Label htmlFor="d-gate">Gate</Label><Input id="d-gate" className="h-11" maxLength={60} value={form.gate} onChange={(e) => setForm({ ...form, gate: e.target.value })} /></div>
          <div><Label htmlFor="d-prov">Provider</Label><Input id="d-prov" className="h-11" maxLength={60} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} /></div>
        </div>
        <Button className="min-h-11" disabled={busy || form.name.trim().length < 2} onClick={async () => { await upsert({ id: null, kind: form.kind, name: form.name, gate_label: form.gate, provider: form.provider }, "unconfigured"); setForm({ ...form, name: "", gate: "" }); }}><Plus className="h-4 w-4 mr-1" />Add</Button>
      </CardContent></Card>

      <ul className="space-y-2">
        {q.data!.devices.map((d) => {
          const live = d.status === "active" && d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 120_000;
          return (
            <li key={d.id} className="rounded-2xl border p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium">{d.name}</p>
                <span className="text-xs text-muted-foreground">{KIND[d.kind]}{d.gate_label ? ` · ${d.gate_label}` : ""}</span>
                <span className={cn("ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium", live ? "bg-success/15 text-success" : d.status === "active" ? "bg-warning/15 text-warning-foreground" : "bg-muted text-muted-foreground")}>
                  {live ? "Connected" : d.status === "active" ? (d.last_seen_at ? `Offline · seen ${fmtTime(d.last_seen_at)}` : "Waiting for device") : d.status === "disabled" ? "Disabled" : "Not configured"}
                </span>
              </div>
              <div className="flex gap-2 flex-wrap">
                {d.status !== "active" && <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => upsert(d, "active")}>Activate</Button>}
                {d.status !== "disabled" && <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => upsert(d, "disabled")}>Disable</Button>}
                <Button size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => upsert(d, d.status, true)}><KeyRound className="h-4 w-4 mr-1" />New key</Button>
              </div>
            </li>
          );
        })}
      </ul>

      <Card className="rounded-2xl"><CardContent className="p-4 sm:p-4 space-y-2">
        <p className="font-medium">RFID tags</p>
        <div className="grid grid-cols-2 gap-2">
          <div><Label htmlFor="t-raw">Tag number *</Label><Input id="t-raw" className="h-11 font-mono" autoComplete="off" value={tag.raw} onChange={(e) => setTag({ ...tag, raw: e.target.value })} /></div>
          <div><Label htmlFor="t-label">Label</Label><Input id="t-label" className="h-11" maxLength={60} value={tag.label} onChange={(e) => setTag({ ...tag, label: e.target.value })} placeholder="A-101 car" /></div>
        </div>
        <p className="text-xs text-muted-foreground">Only a scrambled form and the last 4 characters are stored. A tag works only in this society.</p>
        <Button className="min-h-11" disabled={busy || tag.raw.replace(/[^A-Za-z0-9]/g, "").length < 6} onClick={async () => {
          setBusy(true);
          const { error } = await supabase.rpc("admin_register_rfid", { _raw: tag.raw, _label: tag.label, _vehicle_id: null as unknown as string, _flat_id: null as unknown as string });
          setBusy(false);
          if (error) return toast.error(gateErrorMessage(error));
          toast.success("Tag registered"); setTag({ raw: "", label: "" }); refresh();
        }}>Register tag</Button>
        <ul className="space-y-1">
          {q.data!.tags.map((t) => (
            <li key={t.id} className={cn("flex items-center gap-2 rounded-xl border px-3 min-h-11", t.status !== "active" && "opacity-60")}>
              <span className="font-mono">••{t.last4}</span><span className="text-sm flex-1 truncate">{t.label}</span>
              {t.status === "active" ? <Button size="sm" variant="ghost" className="min-h-11 text-destructive" disabled={busy} onClick={async () => {
                const { error } = await supabase.rpc("admin_revoke_rfid", { _id: t.id });
                if (error) toast.error(gateErrorMessage(error)); else { toast.success("Tag revoked"); refresh(); }
              }}>Revoke</Button> : <span className="text-xs">Revoked</span>}
            </li>
          ))}
        </ul>
      </CardContent></Card>

      <Sheet open={!!secret} onOpenChange={(o) => !o && setSecret(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader><SheetTitle>Device key — shown once</SheetTitle></SheetHeader>
          {secret && (
            <div className="py-3 space-y-2 text-sm">
              <p>Give these to your hardware installer. The key can't be shown again; make a new one if it's lost.</p>
              <p className="text-xs text-muted-foreground">Device ID</p><code className="block break-all rounded-lg bg-muted p-2">{secret.id}</code>
              <p className="text-xs text-muted-foreground">Device key</p><code className="block break-all rounded-lg bg-muted p-2">{secret.key}</code>
              <p className="text-xs text-muted-foreground">Endpoint: POST {typeof window !== "undefined" ? window.location.origin : ""}/api/public/gate/device-event</p>
              <Button variant="outline" className="min-h-11" onClick={() => { void navigator.clipboard?.writeText(secret.key); toast.success("Key copied"); }}><Copy className="h-4 w-4 mr-1" />Copy key</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

/* ---------- Safety alert history ---------- */
interface SafetyHist { id: string; kind: string; status: string; subject_name: string | null; created_at: string; resolved_at: string | null; resolution_note: string | null }
export function SafetyAlertHistory({ societyId }: { societyId: string }) {
  const q = useQuery({
    queryKey: ["admin-safety", societyId],
    queryFn: async () => {
      const { data, error } = await supabase.from("safety_alerts").select("id, kind, status, subject_name, created_at, resolved_at, resolution_note")
        .eq("society_id", societyId).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as SafetyHist[];
    },
  });
  if (q.isLoading) return <Spin />;
  if (q.isError) return <Err e={q.error} retry={() => q.refetch()} />;
  if (!q.data?.length) return <p className="text-sm text-muted-foreground text-center py-4">No child or elder safety alerts yet.</p>;
  return (
    <ul className="space-y-2">
      {q.data.map((a) => (
        <li key={a.id} className="rounded-2xl border p-3">
          <p className="font-medium capitalize">{a.kind} alert{a.subject_name ? ` · ${a.subject_name}` : ""}</p>
          <p className="text-xs text-muted-foreground">{fmtTime(a.created_at)} · {a.status === "resolved" ? `Resolved ${fmtTime(a.resolved_at)}${a.resolution_note ? ` — ${a.resolution_note}` : ""}` : a.status === "acknowledged" ? "Guard responding" : "Open"}</p>
        </li>
      ))}
    </ul>
  );
}
