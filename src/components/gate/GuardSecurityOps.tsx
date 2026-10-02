// Guard-side patrol rounds, child/elder safety alerts and hardware review.
// Ad-free critical surfaces. Every action is re-authorized server-side.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Baby, CheckCircle2, Circle, Footprints, Loader2, Phone, PersonStanding, Camera, XCircle, DoorOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { fmtTime, gateErrorMessage } from "@/lib/visitors";

/* ---------- Child / elder safety alerts ---------- */
interface SafetyRow { id: string; kind: "child" | "elder"; status: string; flat: string | null; subject: string | null; note: string | null; last_seen: string | null; created_at: string; escalated: boolean; contacts: { name: string; relation: string | null; phone: string }[] }
export function GateSafetyAlerts() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["gate-safety"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("gate_safety_alerts");
      if (error) throw error;
      return (data ?? []) as unknown as SafetyRow[];
    },
  });
  async function act(id: string, action: "ack" | "resolve") {
    setBusy(id);
    const { error } = await supabase.rpc("safety_alert_update", { _id: id, _action: action, _note: action === "resolve" ? "Resolved at gate" : undefined });
    setBusy(null);
    if (error) toast.error(gateErrorMessage(error)); else toast.success(action === "ack" ? "Family told you're responding" : "Alert closed");
    qc.invalidateQueries({ queryKey: ["gate-safety"] });
  }
  if (q.isError) return <p className="text-xs text-destructive" role="alert">Couldn't load safety alerts. {gateErrorMessage(q.error)}</p>;
  if (!q.data?.length) return null;
  return (
    <section aria-label="Safety alerts" className="space-y-2">
      {q.data.map((a) => (
        <Card key={a.id} className="rounded-2xl border-destructive bg-destructive/10"><CardContent className="p-4 sm:p-4 space-y-3">
          <div className="flex items-start gap-2">
            {a.kind === "child" ? <Baby className="h-5 w-5 text-destructive shrink-0" /> : <PersonStanding className="h-5 w-5 text-destructive shrink-0" />}
            <div className="min-w-0">
              <p className="font-semibold text-destructive">{a.kind === "child" ? "Child" : "Elder"} safety · {a.flat ? `House ${a.flat}` : "Resident"}</p>
              {a.subject && <p className="text-sm font-medium">{a.subject}</p>}
              {a.note && <p className="text-sm">{a.note}</p>}
              {a.last_seen && <p className="text-sm">Last seen: {a.last_seen}</p>}
              <p className="text-xs text-muted-foreground">{fmtTime(a.created_at)} · {a.status === "raised" ? "Not yet seen" : "Acknowledged"}{a.escalated ? " · Committee alerted" : ""}</p>
            </div>
          </div>
          {a.contacts.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {a.contacts.map((c, i) => (
                <li key={i}><a href={`tel:${c.phone}`} className="inline-flex min-h-11 items-center gap-1 rounded-xl border bg-background px-3 text-sm"><Phone className="h-4 w-4" />{c.name}{c.relation ? ` (${c.relation})` : ""}</a></li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            {a.status === "raised" && <Button variant="destructive" className="flex-1 h-12 rounded-xl" disabled={busy === a.id} onClick={() => act(a.id, "ack")}>I'm on it</Button>}
            <Button variant="outline" className="flex-1 h-12 rounded-xl" disabled={busy === a.id} onClick={() => act(a.id, "resolve")}>Found safe</Button>
          </div>
        </CardContent></Card>
      ))}
    </section>
  );
}

/* ---------- Patrol rounds ---------- */
interface Cp { id: string; name: string; needs_code: boolean; status: string; completed_at: string | null }
interface Round { id: string; route: string; status: string; scheduled_start: string; due_by: string; checkpoints: Cp[] | null }
const ROUND_LABEL: Record<string, string> = { scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", partial: "Finished with misses", missed: "Missed", cancelled: "Cancelled" };

export function GuardPatrolCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [cp, setCp] = useState<{ round: string; cp: Cp } | null>(null);
  const [code, setCode] = useState("");
  const [note, setNote] = useState("");
  const [sev, setSev] = useState<"" | "low" | "medium" | "high">("");
  const q = useQuery({
    queryKey: ["guard-patrol"],
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("guard_patrol_list");
      if (error) throw error;
      return (data ?? []) as unknown as Round[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["guard-patrol"] });
  async function call(fn: () => PromiseLike<{ error: unknown }>, ok: string) {
    setBusy(true);
    const { error } = await fn();
    setBusy(false);
    if (error) { toast.error(gateErrorMessage(error)); refresh(); return false; }
    toast.success(ok); refresh(); return true;
  }
  if (q.isLoading) return null;
  if (q.isError) return <p className="text-xs text-destructive" role="alert">Couldn't load patrol rounds. {gateErrorMessage(q.error)} <button className="underline min-h-11" onClick={() => q.refetch()}>Retry</button></p>;
  if (!q.data?.length) return null;
  return (
    <section aria-labelledby="patrol-h" className="space-y-2">
      <h2 id="patrol-h" className="text-sm font-semibold flex items-center gap-2"><Footprints className="h-4 w-4" />Patrol rounds</h2>
      {q.data.map((r) => {
        const late = r.status === "scheduled" && new Date(r.scheduled_start) < new Date();
        return (
          <Card key={r.id} className="rounded-2xl"><CardContent className="p-4 sm:p-4 space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold">{r.route}</p>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", r.status === "completed" ? "bg-success/15 text-success" : r.status === "missed" || r.status === "partial" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
                {late ? "Due now" : ROUND_LABEL[r.status]}
              </span>
              <span className="text-xs text-muted-foreground ml-auto">{fmtTime(r.scheduled_start)} – {fmtTime(r.due_by)}</span>
            </div>
            {r.status === "in_progress" && (
              <ul className="space-y-1">
                {(r.checkpoints ?? []).map((c) => (
                  <li key={c.id}>
                    <button disabled={c.status !== "pending" || busy} onClick={() => { setCp({ round: r.id, cp: c }); setCode(""); setNote(""); setSev(""); }}
                      className="w-full min-h-11 rounded-xl border px-3 flex items-center gap-2 text-left disabled:opacity-70">
                      {c.status === "done" ? <CheckCircle2 className="h-5 w-5 text-success" /> : c.status === "missed" ? <XCircle className="h-5 w-5 text-destructive" /> : <Circle className="h-5 w-5 text-muted-foreground" />}
                      <span className="flex-1">{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.status === "done" ? fmtTime(c.completed_at) : c.needs_code ? "Code" : "Tap"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {r.status === "scheduled" && <Button className="w-full h-12 rounded-xl" disabled={busy} onClick={() => call(() => supabase.rpc("guard_patrol_start", { _round_id: r.id }), "Round started")}>Start round</Button>}
            {r.status === "in_progress" && <Button variant="outline" className="w-full h-11 rounded-xl" disabled={busy} onClick={() => call(() => supabase.rpc("guard_patrol_finish", { _round_id: r.id }), "Round finished")}>Finish round</Button>}
          </CardContent></Card>
        );
      })}
      <Sheet open={!!cp} onOpenChange={(o) => !o && setCp(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader><SheetTitle>{cp?.cp.name}</SheetTitle></SheetHeader>
          <div className="space-y-3 py-3">
            {cp?.cp.needs_code && (
              <div><Label htmlFor="cp-code">Checkpoint code *</Label><Input id="cp-code" className="h-11 font-mono uppercase" autoComplete="off" maxLength={12} value={code} onChange={(e) => setCode(e.target.value)} /></div>
            )}
            <div><Label htmlFor="cp-note">Note</Label><Input id="cp-note" className="h-11" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="All clear" /></div>
            <div>
              <Label>Report a problem here?</Label>
              <div className="grid grid-cols-4 gap-1 mt-1">
                {(["", "low", "medium", "high"] as const).map((s) => (
                  <button key={s || "none"} onClick={() => setSev(s)} className={cn("min-h-11 rounded-xl border text-sm capitalize", sev === s && "border-primary bg-primary/10")}>{s || "No"}</button>
                ))}
              </div>
            </div>
            <Button className="w-full h-12 rounded-xl" disabled={busy || (cp?.cp.needs_code && code.trim().length < 4) || (!!sev && note.trim().length < 5)}
              onClick={async () => {
                if (!cp) return;
                const ok = await call(() => supabase.rpc("guard_patrol_checkpoint", { _round_id: cp.round, _checkpoint_id: cp.cp.id, _code: code || undefined, _note: note || undefined, _incident_severity: sev || undefined }), sev ? "Checkpoint done · incident reported" : "Checkpoint done");
                if (ok) setCp(null);
              }}>Mark checked</Button>
            <p className="text-xs text-muted-foreground">Location isn't tracked. Checkpoints with a code need the code printed at that spot.</p>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}

/* ---------- Camera / RFID review + barrier ---------- */
interface HwEvent { id: string; kind: string; plate: string | null; confidence: number | null; result: string; created_at: string; device_id: string }
interface Device { id: string; kind: string; name: string; gate_label: string | null; status: string; last_seen_at: string | null }
export function GateHardwareCard({ societyId }: { societyId: string | null }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["gate-hw", societyId],
    enabled: !!societyId,
    refetchInterval: 20_000,
    queryFn: async () => {
      const [dev, ev] = await Promise.all([
        supabase.from("gate_devices").select("id, kind, name, gate_label, status, last_seen_at").eq("society_id", societyId!).neq("status", "disabled"),
        supabase.from("gate_hardware_events").select("id, kind, plate, confidence, result, created_at, device_id").eq("society_id", societyId!)
          .eq("result", "needs_review").is("reviewed_at", null).order("created_at", { ascending: false }).limit(10),
      ]);
      if (dev.error) throw dev.error;
      if (ev.error) throw ev.error;
      return { devices: (dev.data ?? []) as Device[], events: (ev.data ?? []) as HwEvent[] };
    },
  });
  if (!q.data || (!q.data.devices.length && !q.data.events.length)) return null;
  const barriers = q.data.devices.filter((d) => d.kind === "barrier");
  async function review(id: string, decision: "allow" | "deny") {
    setBusy(true);
    const { error } = await supabase.rpc("gate_review_hardware_event", { _id: id, _decision: decision });
    setBusy(false);
    if (error) toast.error(gateErrorMessage(error));
    qc.invalidateQueries({ queryKey: ["gate-hw"] });
  }
  async function openBarrier(d: Device) {
    setBusy(true);
    const { data, error } = await supabase.rpc("gate_request_barrier_open", { _device_id: d.id, _reason: "Opened by guard", _request_id: crypto.randomUUID() });
    setBusy(false);
    if (error) return toast.error(gateErrorMessage(error));
    const r = data as { status?: string; message?: string } | null;
    if (r?.status === "queued") toast.success("Open request sent to the barrier. Watch it open; open it by hand if it doesn't.");
    else toast.error(r?.message ?? "Barrier unavailable. Open it manually.");
  }
  return (
    <Card className="rounded-2xl"><CardContent className="p-4 sm:p-4 space-y-3">
      <p className="text-sm font-semibold flex items-center gap-2"><Camera className="h-4 w-4" />Gate devices</p>
      {q.data.events.map((e) => (
        <div key={e.id} className="rounded-xl border p-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-mono font-medium">{e.plate ?? "Plate unreadable"}</p>
            <p className="text-xs text-muted-foreground">{fmtTime(e.created_at)}{e.confidence != null ? ` · ${Math.round(Number(e.confidence) * 100)}% sure` : ""} · not registered</p>
          </div>
          <Button size="sm" className="min-h-11" disabled={busy} onClick={() => review(e.id, "allow")}>Allow</Button>
          <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={() => review(e.id, "deny")}>Deny</Button>
        </div>
      ))}
      {barriers.map((d) => {
        const live = d.status === "active" && d.last_seen_at && Date.now() - new Date(d.last_seen_at).getTime() < 120_000;
        return (
          <Button key={d.id} variant="outline" className="w-full h-12 rounded-xl justify-start" disabled={busy} onClick={() => openBarrier(d)}>
            {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <DoorOpen className="h-4 w-4 mr-2" />}
            Open {d.name}{d.gate_label ? ` · ${d.gate_label}` : ""}
            <span className={cn("ml-auto text-xs", live ? "text-success" : "text-muted-foreground")}>{live ? "Connected" : "Not connected"}</span>
          </Button>
        );
      })}
    </CardContent></Card>
  );
}
