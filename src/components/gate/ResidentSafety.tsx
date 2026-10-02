// Resident-side: SOS (ad-free, fails visibly) and regular visitor passes.
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Siren, Plus, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { RECURRING_CATEGORIES, categoryLabel, gateErrorMessage } from "@/lib/visitors";

interface SosRow { id: string; status: string; created_at: string }

export function SosButton({ online }: { online: boolean }) {
  const qc = useQueryClient();
  const [holding, setHolding] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mine = useQuery({
    queryKey: ["my-sos"],
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("sos_alerts").select("id, status, created_at")
        .neq("status", "resolved").gte("created_at", new Date(Date.now() - 6 * 3600_000).toISOString())
        .order("created_at", { ascending: false }).limit(1);
      if (error) throw error;
      return ((data ?? []) as SosRow[])[0] ?? null;
    },
  });
  async function send() {
    setHolding(false);
    if (sending) return;
    if (!online) { setFailed("You're offline, so the alert can't reach security. Call 112 or a number below."); return; }
    setSending(true); setFailed(null);
    const { error } = await supabase.rpc("sos_raise", { _note: "" });
    setSending(false);
    if (error) { setFailed(`${gateErrorMessage(error)} Call 112 or a number below.`); return; }
    toast.success("SOS sent to security and the committee");
    qc.invalidateQueries({ queryKey: ["my-sos"] });
  }
  const start = () => { if (sending) return; setHolding(true); timer.current = setTimeout(send, 1500); };
  const cancel = () => { setHolding(false); if (timer.current) clearTimeout(timer.current); };
  const active = mine.data;
  return (
    <Card className="rounded-3xl border-destructive/40">
      <CardContent className="p-5 sm:p-5 space-y-3">
        {active ? (
          <div role="status" className="rounded-2xl bg-destructive/10 p-4 text-sm">
            <p className="font-semibold text-destructive">{active.status === "raised" ? "SOS sent — waiting for security to respond" : "Security has seen your SOS and is responding"}</p>
            <p className="text-xs text-muted-foreground mt-1">Keep your phone near you. Call 112 if it's life-threatening.</p>
          </div>
        ) : (
          <>
            <button type="button" onPointerDown={start} onPointerUp={cancel} onPointerLeave={cancel} onKeyDown={(e) => e.key === "Enter" && void send()}
              aria-label="Hold to send SOS to society security"
              className={cn("w-full min-h-16 rounded-2xl bg-destructive text-destructive-foreground font-semibold text-lg flex items-center justify-center gap-2 select-none transition-transform motion-reduce:transition-none", holding && "scale-95")}>
              {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Siren className="h-5 w-5" />}
              {sending ? "Sending…" : holding ? "Keep holding…" : "Hold to send SOS"}
            </button>
            <p className="text-xs text-muted-foreground text-center">Alerts your society's guards and committee. It doesn't call the police.</p>
          </>
        )}
        {failed && <p role="alert" className="text-sm text-destructive font-medium">{failed}</p>}
      </CardContent>
    </Card>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
interface PassRow { id: string; visitor_name: string; category: string; days: number[]; start_time: string; end_time: string; valid_until: string; status: string }
const EMPTY = { name: "", phone: "", category: "staff", days: [1, 2, 3, 4, 5, 6] as number[], start: "07:00", end: "11:00", until: "" };

export function RecurringPasses() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["my-recurring"],
    queryFn: async () => {
      const { data, error } = await supabase.from("visitor_recurring_passes")
        .select("id, visitor_name, category, days, start_time, end_time, valid_until, status").neq("status", "revoked").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as PassRow[];
    },
  });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const until = form.until || new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
    const { error } = await supabase.rpc("resident_upsert_recurring_pass", {
      _id: null as unknown as string, _name: form.name, _phone: form.phone, _category: form.category, _days: form.days, _start: form.start, _end: form.end, _until: until,
    });
    setBusy(false);
    if (error) return toast.error(gateErrorMessage(error));
    toast.success("Regular pass created");
    setForm(EMPTY); setOpen(false);
    qc.invalidateQueries({ queryKey: ["my-recurring"] });
  }
  async function setStatus(id: string, status: "active" | "paused" | "revoked") {
    const { error } = await supabase.rpc("resident_set_recurring_pass_status", { _id: id, _status: status });
    if (error) return toast.error(gateErrorMessage(error));
    toast.success(status === "revoked" ? "Pass removed" : status === "paused" ? "Pass paused" : "Pass resumed");
    qc.invalidateQueries({ queryKey: ["my-recurring"] });
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <section aria-label="Regular visitors" className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold flex items-center gap-2"><Repeat className="h-4 w-4" />Regular visitors</h2>
        <Button size="sm" variant="outline" className="min-h-11 rounded-xl" onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" />Add</Button>
      </div>
      {q.isError ? <p className="text-sm text-destructive">{gateErrorMessage(q.error)}</p> : !q.data?.length ? (
        <p className="text-xs text-muted-foreground">Add your maid, cook, driver or milkman so the guard can let them in on their days.</p>
      ) : (
        <ul className="space-y-2">
          {q.data.map((p) => {
            const expired = p.valid_until < today;
            return (
              <li key={p.id}><Card className="rounded-2xl"><CardContent className="p-3 sm:p-3 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{p.visitor_name} <span className="text-xs text-muted-foreground">· {categoryLabel(p.category)}</span></p>
                  <p className="text-xs text-muted-foreground">{p.days.map((d) => DAYS[d]).join(", ")} · {p.start_time.slice(0, 5)}–{p.end_time.slice(0, 5)} · {expired ? "Expired" : p.status === "paused" ? "Paused" : `Till ${p.valid_until}`}</p>
                </div>
                {!expired && <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setStatus(p.id, p.status === "paused" ? "active" : "paused")}>{p.status === "paused" ? "Resume" : "Pause"}</Button>}
                <Button size="sm" variant="ghost" className="min-h-11" onClick={() => setStatus(p.id, "revoked")}>Remove</Button>
              </CardContent></Card></li>
            );
          })}
        </ul>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          <SheetHeader><SheetTitle>Regular visitor pass</SheetTitle></SheetHeader>
          <form onSubmit={save} className="space-y-4 py-4">
            <div className="flex flex-wrap gap-2">
              {RECURRING_CATEGORIES.map((c) => (
                <button type="button" key={c.value} onClick={() => setForm({ ...form, category: c.value })}
                  className={cn("min-h-11 px-4 rounded-full border text-sm font-medium", form.category === c.value ? "bg-primary text-primary-foreground border-primary" : "border-border")}>{c.label}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label htmlFor="rp-name">Name *</Label><Input id="rp-name" className="h-12" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
              <div><Label htmlFor="rp-phone">Phone</Label><Input id="rp-phone" className="h-12" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            </div>
            <div>
              <Label>Days</Label>
              <div className="grid grid-cols-7 gap-1 mt-1">
                {DAYS.map((d, i) => (
                  <button type="button" key={d} aria-pressed={form.days.includes(i)}
                    onClick={() => setForm({ ...form, days: form.days.includes(i) ? form.days.filter((x) => x !== i) : [...form.days, i] })}
                    className={cn("min-h-11 rounded-lg border text-xs", form.days.includes(i) ? "bg-primary text-primary-foreground border-primary" : "border-border")}>{d}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div><Label htmlFor="rp-s">From</Label><Input id="rp-s" type="time" className="h-12" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
              <div><Label htmlFor="rp-e">To</Label><Input id="rp-e" type="time" className="h-12" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></div>
              <div><Label htmlFor="rp-u">Until</Label><Input id="rp-u" type="date" className="h-12" min={today} value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} /></div>
            </div>
            <p className="text-xs text-muted-foreground">Guards can only let them in on these days and hours. Leave "Until" empty for 90 days.</p>
            <Button type="submit" className="w-full h-14 rounded-xl text-base" disabled={busy || !form.days.length}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create pass"}</Button>
          </form>
        </SheetContent>
      </Sheet>
    </section>
  );
}

/* ---------- Child / elder safety alert (resident household only) ---------- */
interface MyAlert { id: string; kind: string; status: string; subject_name: string | null; created_at: string }
interface Contact { id: string; name: string; relation: string | null; phone: string; is_active: boolean }
export function SafetyAlertPanel({ online }: { online: boolean }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<"child" | "elder" | null>(null);
  const [form, setForm] = useState({ subject: "", lastSeen: "", note: "" });
  const [contact, setContact] = useState({ name: "", relation: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const q = useQuery({
    queryKey: ["my-safety"],
    refetchInterval: 20_000,
    queryFn: async () => {
      const [a, c] = await Promise.all([
        supabase.from("safety_alerts").select("id, kind, status, subject_name, created_at").neq("status", "resolved").order("created_at", { ascending: false }).limit(5),
        supabase.from("safety_contacts").select("id, name, relation, phone, is_active").eq("is_active", true).order("created_at"),
      ]);
      if (a.error) throw a.error;
      if (c.error) throw c.error;
      return { alerts: (a.data ?? []) as MyAlert[], contacts: (c.data ?? []) as Contact[] };
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["my-safety"] });
  async function raise() {
    if (!open || busy) return;
    setBusy(true);
    const { error } = await supabase.rpc("safety_alert_raise", { _kind: open, _subject: form.subject, _note: form.note, _last_seen: form.lastSeen });
    setBusy(false);
    if (error) return toast.error(`${gateErrorMessage(error)} Call 112 or the guard directly.`);
    toast.success("Guards and the committee have been alerted");
    setOpen(null); setForm({ subject: "", lastSeen: "", note: "" }); refresh();
  }
  return (
    <Card className="rounded-2xl"><CardContent className="p-4 sm:p-4 space-y-3">
      <div>
        <p className="font-semibold">Child or elder missing?</p>
        <p className="text-sm text-muted-foreground">Alerts the guards and committee of your society only. Your contacts are shown to guards only while an alert is open.</p>
      </div>
      {!online && <p className="text-sm text-warning-foreground" role="status">You're offline. Call 112 or the gate directly.</p>}
      {q.data?.alerts.map((a) => (
        <div key={a.id} className="rounded-xl border border-destructive/40 bg-destructive/5 p-3 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="font-medium capitalize">{a.kind} alert{a.subject_name ? ` · ${a.subject_name}` : ""}</p>
            <p className="text-xs text-muted-foreground">{a.status === "acknowledged" ? "A guard is responding" : "Waiting for a guard"}</p>
          </div>
          <Button size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={async () => {
            const { error } = await supabase.rpc("safety_alert_update", { _id: a.id, _action: "resolve", _note: "Found safe (family)" });
            if (error) toast.error(gateErrorMessage(error)); else { toast.success("Marked safe"); refresh(); }
          }}>Found safe</Button>
        </div>
      ))}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="destructive" className="h-12 rounded-xl" disabled={!online} onClick={() => setOpen("child")}>Child alert</Button>
        <Button variant="destructive" className="h-12 rounded-xl" disabled={!online} onClick={() => setOpen("elder")}>Elder alert</Button>
      </div>
      <details className="rounded-xl border p-3">
        <summary className="cursor-pointer min-h-11 flex items-center text-sm font-medium">Safety contacts ({q.data?.contacts.length ?? 0}/5)</summary>
        <ul className="space-y-1 mt-2">
          {q.data?.contacts.map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-sm min-h-11">
              <span className="flex-1">{c.name}{c.relation ? ` (${c.relation})` : ""} · ••{c.phone.slice(-4)}</span>
              <Button size="sm" variant="ghost" className="min-h-11" onClick={async () => {
                const { error } = await supabase.rpc("resident_set_safety_contact", { _id: c.id, _name: c.name, _relation: c.relation ?? "", _phone: c.phone, _active: false });
                if (error) toast.error(gateErrorMessage(error)); else refresh();
              }}>Remove</Button>
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div><Label htmlFor="sc-name">Name</Label><Input id="sc-name" className="h-11" maxLength={80} value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} /></div>
          <div><Label htmlFor="sc-rel">Relation</Label><Input id="sc-rel" className="h-11" maxLength={40} value={contact.relation} onChange={(e) => setContact({ ...contact, relation: e.target.value })} /></div>
          <div className="col-span-2"><Label htmlFor="sc-phone">Phone</Label><Input id="sc-phone" className="h-11" inputMode="tel" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} /></div>
        </div>
        <Button className="min-h-11 mt-2" disabled={contact.name.trim().length < 2 || !/^\+?[0-9]{10,13}$/.test(contact.phone.replace(/[\s-]/g, ""))} onClick={async () => {
          const { error } = await supabase.rpc("resident_set_safety_contact", { _id: null as unknown as string, _name: contact.name, _relation: contact.relation, _phone: contact.phone, _active: true });
          if (error) return toast.error(gateErrorMessage(error));
          setContact({ name: "", relation: "", phone: "" }); refresh();
        }}><Plus className="h-4 w-4 mr-1" />Add contact</Button>
      </details>
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader><SheetTitle>{open === "child" ? "Child safety alert" : "Elder safety alert"}</SheetTitle></SheetHeader>
          <div className="space-y-3 py-3">
            <div><Label htmlFor="sa-name">Name</Label><Input id="sa-name" className="h-11" maxLength={80} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
            <div><Label htmlFor="sa-seen">Last seen where?</Label><Input id="sa-seen" className="h-11" maxLength={120} value={form.lastSeen} onChange={(e) => setForm({ ...form, lastSeen: e.target.value })} placeholder="Near the park, 10 min ago" /></div>
            <div><Label htmlFor="sa-note">What are they wearing?</Label><Input id="sa-note" className="h-11" maxLength={300} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></div>
            <Button variant="destructive" className="w-full h-12 rounded-xl" disabled={busy || !online} onClick={raise}>{busy ? <Loader2 className="h-5 w-5 animate-spin" /> : "Alert guards now"}</Button>
            <p className="text-xs text-muted-foreground">If this fails, call 112 and the gate directly.</p>
          </div>
        </SheetContent>
      </Sheet>
    </CardContent></Card>
  );
}
