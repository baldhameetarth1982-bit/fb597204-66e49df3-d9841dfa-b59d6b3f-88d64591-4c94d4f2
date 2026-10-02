// Gate/security building blocks shared by the guard and admin screens.
// Critical security surfaces: never render ads, services or sponsored content here.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, CloudOff, Loader2, ParkingSquare, Repeat, ShieldAlert, Siren, Trash2, WifiOff, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { categoryLabel, fmtTime, gateErrorMessage } from "@/lib/visitors";
import { clearFinished, flushQueue, loadQueue, removeItem, type QueueItem } from "@/lib/gate-offline";

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

/* ---------- SOS alerts (guard + admin) ---------- */
interface SosRow { id: string; flat_label: string | null; note: string | null; status: string; created_at: string }
export function SosAlertsCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["gate-sos"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gate_sos_open");
      if (error) throw error;
      return (data ?? []) as SosRow[];
    },
  });
  async function act(id: string, action: "acknowledge" | "resolve") {
    if (busy) return;
    setBusy(id);
    const { error } = await supabase.rpc("sos_update", { _id: id, _action: action });
    setBusy(null);
    if (error) toast.error(gateErrorMessage(error));
    else toast.success(action === "acknowledge" ? "Resident told help is coming" : "SOS closed");
    qc.invalidateQueries({ queryKey: ["gate-sos"] });
  }
  if (q.isError) return <p className="text-xs text-destructive" role="alert">Couldn't load SOS alerts. {gateErrorMessage(q.error)}</p>;
  const rows = q.data ?? [];
  if (!rows.length) return null;
  return (
    <section aria-label="SOS alerts" className="space-y-2">
      {rows.map((a) => (
        <Card key={a.id} className="rounded-2xl border-destructive bg-destructive/10">
          <CardContent className="p-4 sm:p-4 space-y-3">
            <div className="flex items-start gap-2">
              <Siren className="h-5 w-5 text-destructive shrink-0" />
              <div className="min-w-0">
                <p className="font-semibold text-destructive">SOS · {a.flat_label ? `House ${a.flat_label}` : "Resident"}</p>
                <p className="text-sm">{a.note || "Resident needs urgent help"}</p>
                <p className="text-xs text-muted-foreground">{fmtTime(a.created_at)} · {a.status === "raised" ? "Not yet seen" : "Acknowledged"}</p>
              </div>
            </div>
            <div className="flex gap-2">
              {a.status === "raised" && (
                <Button className="flex-1 h-12 rounded-xl" variant="destructive" disabled={busy === a.id} onClick={() => act(a.id, "acknowledge")}>I'm on it</Button>
              )}
              <Button className="flex-1 h-12 rounded-xl" variant="outline" disabled={busy === a.id} onClick={() => act(a.id, "resolve")}>Resolved</Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

/* ---------- Regular (recurring) visitor check-in ---------- */
interface PassRow { id: string; visitor_name: string; phone_last4: string | null; category: string; flat_label: string; start_time: string; end_time: string; valid_now: boolean; inside: boolean }
export function RecurringSheet({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["gate-recurring", q],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("guard_recurring_list", { _q: q.trim() || undefined });
      if (error) throw error;
      return (data ?? []) as PassRow[];
    },
  });
  async function checkin(id: string) {
    if (busy) return;
    setBusy(id);
    const { error } = await supabase.rpc("guard_checkin_recurring", { _pass_id: id });
    setBusy(null);
    if (error) toast.error(gateErrorMessage(error));
    else { toast.success("Checked in"); onDone(); }
    list.refetch();
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
        <SheetHeader><SheetTitle>Regular visitors today</SheetTitle></SheetHeader>
        <div className="py-3 space-y-3">
          <Input aria-label="Search regular visitors" placeholder="Name, house or last 4 digits" value={q} onChange={(e) => setQ(e.target.value)} className="h-12" />
          {list.isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : list.isError ? (
            <p className="text-sm text-destructive">{gateErrorMessage(list.error)}</p>
          ) : !list.data?.length ? (
            <p className="text-sm text-muted-foreground text-center py-4">No regular passes for today.</p>
          ) : (
            <ul className="space-y-2">
              {list.data.map((p) => (
                <li key={p.id} className="rounded-2xl border p-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold truncate">{p.visitor_name}</p>
                    <p className="text-xs text-muted-foreground">House {p.flat_label} · {categoryLabel(p.category)} · {p.start_time.slice(0, 5)}–{p.end_time.slice(0, 5)}</p>
                    {!p.valid_now && <p className="text-xs text-warning-foreground">Outside allowed hours</p>}
                  </div>
                  {p.inside ? <span className="text-xs font-medium text-success">Inside</span> : (
                    <Button className="h-11 rounded-xl" disabled={!p.valid_now || busy === p.id} onClick={() => checkin(p.id)}>
                      {busy === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Let in"}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- Reason dialog (overrides) ---------- */
export function ReasonSheet({ title, hint, open, onOpenChange, onSubmit, min = 10 }: {
  title: string; hint: string; open: boolean; onOpenChange: (o: boolean) => void; onSubmit: (reason: string) => Promise<boolean>; min?: number;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setReason(""); }}>
      <SheetContent side="bottom" className="rounded-t-3xl">
        <SheetHeader><SheetTitle>{title}</SheetTitle></SheetHeader>
        <form className="space-y-3 py-4" onSubmit={async (e) => {
          e.preventDefault();
          if (busy || reason.trim().length < min) return;
          setBusy(true);
          const ok = await onSubmit(reason.trim());
          setBusy(false);
          if (ok) { setReason(""); onOpenChange(false); }
        }}>
          <p className="text-sm text-muted-foreground">{hint}</p>
          <Label htmlFor="reason">Reason (recorded in activity history)</Label>
          <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} rows={3} />
          <p className="text-xs text-muted-foreground">{reason.trim().length}/{min} characters minimum</p>
          <Button type="submit" className="w-full h-12 rounded-xl" disabled={busy || reason.trim().length < min}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- Visitor parking ---------- */
interface SlotRow { id: string; label: string; occupied: boolean; visitor_name: string | null }
export function ParkingSheet({ visitorId, current, onOpenChange, onDone }: { visitorId: string | null; current: string | null; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const slots = useQuery({
    queryKey: ["gate-parking"],
    enabled: !!visitorId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gate_visitor_parking_list");
      if (error) throw error;
      return (data ?? []) as SlotRow[];
    },
  });
  async function assign(slot: string | null) {
    if (!visitorId || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("gate_assign_visitor_parking", { _visitor_id: visitorId, _slot_id: slot as string });
    setBusy(false);
    if (error) { toast.error(gateErrorMessage(error)); slots.refetch(); return; }
    toast.success(slot ? "Parking assigned" : "Parking released");
    onDone();
    onOpenChange(false);
  }
  const free = (slots.data ?? []).filter((s) => !s.occupied).length;
  return (
    <Sheet open={!!visitorId} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[80vh] overflow-y-auto">
        <SheetHeader><SheetTitle>Visitor parking</SheetTitle></SheetHeader>
        <div className="py-3 space-y-3">
          {slots.isLoading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : slots.isError ? (
            <p className="text-sm text-destructive">{gateErrorMessage(slots.error)}</p>
          ) : !slots.data?.length ? (
            <p className="text-sm text-muted-foreground">No visitor slots set up. The committee can add them in Parking.</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">{free} of {slots.data.length} free · released automatically at check-out</p>
              <div className="grid grid-cols-3 gap-2">
                {slots.data.map((s) => (
                  <button key={s.id} type="button" disabled={busy || s.occupied} onClick={() => assign(s.id)}
                    className={cn("min-h-12 rounded-xl border text-sm font-medium", s.occupied ? "bg-muted text-muted-foreground" : "border-primary text-primary", current === s.label && "bg-primary text-primary-foreground")}>
                    {s.label}{s.occupied && <span className="block text-[10px] truncate px-1">{s.visitor_name}</span>}
                  </button>
                ))}
              </div>
            </>
          )}
          {current && <Button variant="outline" className="w-full h-12 rounded-xl" disabled={busy} onClick={() => assign(null)}>Release {current}</Button>}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- Incident report ---------- */
const KINDS = ["suspicious", "trespass", "argument", "theft", "damage", "medical", "fire", "other"] as const;
export function IncidentSheet({ open, onOpenChange, visitorId }: { open: boolean; onOpenChange: (o: boolean) => void; visitorId?: string | null }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<string>("suspicious");
  const [severity, setSeverity] = useState("medium");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("incident_create", { _kind: kind, _severity: severity, _note: note, _visitor_id: (visitorId ?? null) as string });
    setBusy(false);
    if (error) return toast.error(gateErrorMessage(error));
    toast.success("Incident reported to the committee");
    setNote("");
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["incidents"] });
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
        <SheetHeader><SheetTitle>Report an incident</SheetTitle></SheetHeader>
        <form onSubmit={submit} className="space-y-4 py-4">
          <div className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button type="button" key={k} onClick={() => setKind(k)}
                className={cn("min-h-11 px-4 rounded-full border text-sm font-medium capitalize", kind === k ? "bg-primary text-primary-foreground border-primary" : "border-border")}>{k}</button>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {["low", "medium", "high"].map((s) => (
              <button type="button" key={s} onClick={() => setSeverity(s)}
                className={cn("min-h-11 rounded-xl border text-sm capitalize", severity === s ? (s === "high" ? "bg-destructive text-destructive-foreground border-destructive" : "bg-primary text-primary-foreground border-primary") : "border-border")}>{s}</button>
            ))}
          </div>
          <div><Label htmlFor="inc-note">What happened *</Label><Textarea id="inc-note" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">Reports never change dues, residents or permissions.</p>
          <Button type="submit" className="w-full h-12 rounded-xl" disabled={busy || note.trim().length < 5}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send report"}</Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/* ---------- Offline queue panel ---------- */
const STATE_META: Record<string, { label: string; cls: string }> = {
  waiting: { label: "Waiting for connection", cls: "bg-warning/15 text-warning-foreground" },
  sending: { label: "Sending", cls: "bg-primary/10 text-primary" },
  sent: { label: "Confirmed", cls: "bg-success/15 text-success" },
  conflict: { label: "Conflict", cls: "bg-destructive/10 text-destructive" },
  failed: { label: "Failed", cls: "bg-destructive/10 text-destructive" },
};
export function OfflineQueuePanel({ onSynced }: { onSynced: () => void }) {
  const online = useOnline();
  const [items, setItems] = useState<QueueItem[]>([]);
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    const load = () => setItems(loadQueue());
    load();
    window.addEventListener("gate-queue", load);
    return () => window.removeEventListener("gate-queue", load);
  }, []);
  async function sync() {
    setSyncing(true);
    const r = await flushQueue();
    setSyncing(false);
    if (r.sent) { toast.success(`${r.sent} offline action${r.sent > 1 ? "s" : ""} confirmed`); onSynced(); }
    if (r.conflicts || r.failed) toast.error("Some offline actions need your attention");
  }
  useEffect(() => { if (online && loadQueue().some((i) => i.state === "waiting")) void sync(); }, [online]); // eslint-disable-line react-hooks/exhaustive-deps
  if (online && !items.length) return null;
  return (
    <Card className={cn("rounded-2xl", !online && "border-warning/50 bg-warning/10")}>
      <CardContent className="p-4 sm:p-4 space-y-3">
        <div className="flex items-center gap-2">
          {online ? <CloudOff className="h-4 w-4 text-muted-foreground" /> : <WifiOff className="h-4 w-4 text-warning-foreground" />}
          <p className="text-sm font-semibold flex-1">{online ? "Offline actions" : "You're offline"}</p>
          {online && items.some((i) => i.state === "waiting" || i.state === "failed") && (
            <Button size="sm" variant="outline" className="min-h-11" disabled={syncing} onClick={sync}>{syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send now"}</Button>
          )}
        </div>
        {!online && <p className="text-xs">Only walk-ins with a house number and check-outs can be saved. Approvals, overrides, parking and SOS need a connection.</p>}
        {items.length > 0 && (
          <ul className="space-y-1.5">
            {items.slice().reverse().map((i) => (
              <li key={i.op_id} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate">{i.kind === "walkin" ? "Walk-in" : "Check-out"} · {i.label}</span>
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATE_META[i.state].cls)} title={i.message}>{STATE_META[i.state].label}</span>
                {(i.state === "conflict" || i.state === "failed" || i.state === "sent") && (
                  <button type="button" aria-label="Dismiss" className="h-11 w-11 grid place-items-center" onClick={() => removeItem(i.op_id)}><Trash2 className="h-4 w-4 text-muted-foreground" /></button>
                )}
              </li>
            ))}
          </ul>
        )}
        {items.some((i) => i.state === "sent") && <Button size="sm" variant="ghost" className="min-h-11" onClick={clearFinished}>Clear confirmed</Button>}
      </CardContent>
    </Card>
  );
}

/* ---------- Hardware boundary ---------- */
export function HardwareNote() {
  return (
    <div className="rounded-2xl border border-dashed p-3 flex gap-2 text-xs text-muted-foreground">
      <Cpu className="h-4 w-4 shrink-0" />
      <p>Number-plate cameras, RFID readers and boom barriers work only once a real device is added under Devices and sends data. Smart locks aren't supported. Manual check-in and plate lookup always keep working.</p>
    </div>
  );
}

export { AlertTriangle, CheckCircle2, ParkingSquare, Repeat, ShieldAlert };
