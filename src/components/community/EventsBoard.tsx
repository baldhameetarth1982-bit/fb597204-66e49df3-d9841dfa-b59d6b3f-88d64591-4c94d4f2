import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, MapPin, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { tu } from "@/lib/i18n";

type Ev = { id: string; title: string; description: string | null; venue: string | null; starts_at: string; ends_at: string | null; capacity: number | null; status: string; cancel_reason: string | null };

export function EventsBoard({ societyId, mode }: { societyId: string; mode: "admin" | "resident" }) {
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [cancelFor, setCancelFor] = useState<Ev | null>(null);
  const [peopleFor, setPeopleFor] = useState<Ev | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const key = ["community-events", societyId];

  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const { data: evs, error } = await supabase.from("community_events")
        .select("id,title,description,venue,starts_at,ends_at,capacity,status,cancel_reason")
        .eq("society_id", societyId).gte("starts_at", since).order("starts_at").limit(200);
      if (error) throw error;
      const ids = (evs ?? []).map((e) => e.id);
      const [c, mine] = await Promise.all([
        ids.length ? supabase.rpc("event_counts", { _event_ids: ids }) : Promise.resolve({ data: [], error: null }),
        mode === "resident" && ids.length ? supabase.from("community_event_rsvps").select("event_id,status").in("event_id", ids) : Promise.resolve({ data: [], error: null }),
      ]);
      if (c.error) throw c.error; if (mine.error) throw mine.error;
      const counts = new Map((c.data ?? []).map((r: { event_id: string; going: number; waitlist: number }) => [r.event_id, r]));
      const my = new Map((mine.data ?? []).map((r: { event_id: string; status: string }) => [r.event_id, r.status]));
      return { evs: evs as Ev[], counts, my };
    },
  });

  async function rsvp(e: Ev, going: boolean) {
    if (busy) return; setBusy(e.id);
    const { data, error } = await supabase.rpc("event_rsvp", { _event_id: e.id, _going: going });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(data === "going" ? "You're going" : data === "waitlist" ? "Event is full — you're on the waitlist" : "RSVP removed");
    qc.invalidateQueries({ queryKey: key });
  }

  const now = Date.now();
  return (
    <div>
      {mode === "admin" && <div className="mb-4 flex justify-end"><Button className="min-h-11" onClick={() => setCreating(true)}><Plus className="mr-1 h-4 w-4" />{tu("op.new_event")}</Button></div>}
      {q.isLoading ? <p className="text-muted-foreground">{tu("op.loading_events")}</p>
        : q.isError ? <div className="rounded-lg border p-4"><p>{tu("op.couldn_t_load_events")}</p><Button variant="outline" className="mt-2" onClick={() => q.refetch()}>{tu("common.tryAgain")}</Button></div>
        : q.data!.evs.length === 0 ? <div className="rounded-lg border p-8 text-center text-muted-foreground"><CalendarDays className="mx-auto mb-2 h-6 w-6" />{tu("op.no_upcoming_events")}</div>
        : (
          <ul className="space-y-3">
            {q.data!.evs.map((e) => {
              const c = q.data!.counts.get(e.id); const mine = q.data!.my.get(e.id);
              const past = new Date(e.starts_at).getTime() < now; const cancelled = e.status === "cancelled";
              return (
                <li key={e.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{e.title}{cancelled && <span className="ml-2 text-sm text-destructive">{tu("rbills.cancelled")}</span>}{past && !cancelled && <span className="ml-2 text-sm text-muted-foreground">{tu("hd.tab.past")}</span>}</p>
                      <p className="text-sm text-muted-foreground"><CalendarDays className="mr-1 inline h-3 w-3" />{new Date(e.starts_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}{e.venue && <><MapPin className="ml-2 mr-1 inline h-3 w-3" />{e.venue}</>}</p>
                      <p className="text-sm text-muted-foreground"><Users className="mr-1 inline h-3 w-3" />{c?.going ?? 0} {tu("op.going")}{e.capacity ? ` of ${e.capacity}` : ""}{c?.waitlist ? ` · ${c.waitlist} waiting` : ""}</p>
                      {e.description && <p className="mt-2 whitespace-pre-line text-sm">{e.description}</p>}
                      {cancelled && e.cancel_reason && <p className="mt-1 text-sm text-muted-foreground">{tu("op.reason")} {e.cancel_reason}</p>}
                    </div>
                    {mode === "resident" && !cancelled && !past && (
                      mine ? <Button variant="outline" className="min-h-11" disabled={busy === e.id} onClick={() => rsvp(e, false)}>{mine === "waitlist" ? tu("op.leave_waitlist") : tu("op.not_going")}</Button>
                        : <Button className="min-h-11" disabled={busy === e.id} onClick={() => rsvp(e, true)}>{tu("op.i_m_going")}</Button>
                    )}
                    {mode === "admin" && <Button variant="outline" className="min-h-11" onClick={() => setPeopleFor(e)}>{tu("op.attendees")}</Button>}
                    {mode === "admin" && !cancelled && !past && <Button variant="outline" className="min-h-11" onClick={() => setCancelFor(e)}>{tu("op.cancel_event")}</Button>}
                  </div>
                  {mine && <p className="mt-2 text-sm font-medium text-primary">{mine === "going" ? tu("op.you_re_going") : tu("op.you_re_on_the_waitlist")}</p>}
                </li>
              );
            })}
          </ul>
        )}
      {creating && <CreateDialog societyId={societyId} onClose={() => setCreating(false)} onDone={() => qc.invalidateQueries({ queryKey: key })} />}
      {cancelFor && <CancelDialog ev={cancelFor} onClose={() => setCancelFor(null)} onDone={() => qc.invalidateQueries({ queryKey: key })} />}
      {peopleFor && <AttendeesDialog ev={peopleFor} onClose={() => setPeopleFor(null)} />}
    </div>
  );
}

function AttendeesDialog({ ev, onClose }: { ev: Ev; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["event-attendees", ev.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_event_attendees", { _event_id: ev.id });
      if (error) throw error;
      return data ?? [];
    },
  });
  function download() {
    const cell = (x: unknown) => { let s = x == null ? "" : String(x); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
    const rows = [["Name", "House", "Status", "Guests", "Responded"], ...(q.data ?? []).map((r) => [r.full_name, r.homes, r.status, r.guests, new Date(r.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })])];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.map((r) => r.map(cell).join(",")).join("\n")], { type: "text/csv" }));
    a.download = `attendees-${ev.title.replace(/[^\w-]+/g, "_").slice(0, 40)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{tu("op.attendees_2")} {ev.title}</DialogTitle></DialogHeader>
        {q.isLoading ? <p className="text-sm text-muted-foreground">{tu("common.loading")}</p>
          : q.isError ? <div><p className="text-sm">{tu("op.couldn_t_load_attendees")}</p><Button variant="outline" className="mt-2 min-h-11" onClick={() => q.refetch()}>{tu("common.tryAgain")}</Button></div>
          : q.data!.length === 0 ? <p className="text-sm text-muted-foreground">{tu("op.no_one_has_responded_yet")}</p>
          : <ul className="divide-y rounded-lg border text-sm" aria-label={tu("op.attendees")}>
              {q.data!.map((r, i) => (
                <li key={i} className="flex items-center justify-between gap-2 p-3">
                  <span className="min-w-0"><b>{r.full_name || tu("inc.k.resident")}</b>{r.homes && <span className="text-muted-foreground"> · House {r.homes}</span>}{r.guests > 0 && <span className="text-muted-foreground"> · +{r.guests}</span>}</span>
                  <span className={r.status === "going" ? "text-primary" : "text-muted-foreground"}>{r.status === "going" ? tu("op.going_2") : tu("op.waitlist")}</span>
                </li>
              ))}
            </ul>}
        <DialogFooter><Button variant="outline" className="min-h-11" disabled={!q.data?.length} onClick={download}>{tu("exp.downloadList")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateDialog({ societyId, onClose, onDone }: { societyId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: "", description: "", venue: "", start: "", end: "", capacity: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  async function save() {
    if (f.title.trim().length < 3 || !f.start || busy) return toast.error(tu("op.add_a_title_and_start"));
    setBusy(true);
    const { error } = await supabase.rpc("admin_create_event", {
      _society_id: societyId, _title: f.title, _description: f.description, _venue: f.venue,
      _starts_at: new Date(f.start).toISOString(), _ends_at: (f.end ? new Date(f.end).toISOString() : null) as string,
      _capacity: (f.capacity ? Number(f.capacity) : null) as number,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(tu("op.event_created")); onDone(); onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{tu("op.new_event")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="et">{tu("cm.fTitle")}</Label><Input id="et" maxLength={120} value={f.title} onChange={set("title")} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="es">{tu("op.starts_2")}</Label><Input id="es" type="datetime-local" value={f.start} onChange={set("start")} /></div>
            <div><Label htmlFor="ee">{tu("op.ends_optional")}</Label><Input id="ee" type="datetime-local" value={f.end} onChange={set("end")} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="ev">{tu("op.venue")}</Label><Input id="ev" maxLength={120} value={f.venue} onChange={set("venue")} /></div>
            <div><Label htmlFor="ec">{tu("op.capacity_optional")}</Label><Input id="ec" inputMode="numeric" value={f.capacity} onChange={set("capacity")} /></div>
          </div>
          <div><Label htmlFor="ed">{tu("hd.details")}</Label><Textarea id="ed" maxLength={2000} value={f.description} onChange={set("description")} /></div>
        </div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{tu("common.close")}</Button><Button disabled={busy} onClick={save}>{busy ? tu("cm.saving") : tu("common.create")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ ev, onClose, onDone }: { ev: Ev; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false);
  async function save() {
    if (reason.trim().length < 3 || busy) return; setBusy(true);
    const { error } = await supabase.rpc("admin_cancel_event", { _event_id: ev.id, _reason: reason });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success(tu("op.event_cancelled")); onDone(); onClose();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{tu("op.cancel")}{ev.title}”?</DialogTitle></DialogHeader>
        <div><Label htmlFor="cr">{tu("op.reason_shown_to_residents")}</Label><Input id="cr" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        <DialogFooter><Button variant="outline" onClick={onClose}>{tu("op.keep_event")}</Button><Button variant="destructive" disabled={busy || reason.trim().length < 3} onClick={save}>{tu("op.cancel_event")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
