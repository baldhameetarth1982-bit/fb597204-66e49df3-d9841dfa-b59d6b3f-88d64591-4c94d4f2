import { useEffect, useMemo, useState } from "react";
import { askText } from "@/components/system/AskTextDialog";
import { GraduationCap, Loader2, UserPlus, X, CheckCircle2, QrCode } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { amenityError } from "@/lib/amenities";
import { tu } from "@/lib/i18n";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
type Cls = { id: string; amenity_id: string; instructor_id: string | null; title: string; description: string | null; weekdays: number[]; start_time: string; duration_minutes: number; capacity: number; starts_on: string; ends_on: string | null; status: string; cancel_reason: string | null };
type Enr = { id: string; class_id: string; user_id: string; flat_id: string; status: string; created_at: string };
type Instr = { id: string; name: string; specialty: string | null; is_active: boolean };
type Amen = { id: string; name: string; capacity: number };

function classError(e: unknown) {
  const m = String((e as { message?: string })?.message ?? "");
  if (m.includes("already_enrolled")) return "You're already in this class.";
  if (m.includes("checkin_closed")) return "Check-in opens 15 minutes before the class and closes when it ends.";
  if (m.includes("invalid_code")) return "This check-in code has expired or isn't valid. Ask for a fresh one.";
  if (m.includes("reason_required")) return "Please give a reason.";
  if (m.includes("invalid_instructor")) return "Choose an active instructor.";
  return amenityError(e);
}
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

export function ClassesBoard({ societyId, mode }: { societyId: string | null; mode: "admin" | "resident" }) {
  const [classes, setClasses] = useState<Cls[]>([]);
  const [enr, setEnr] = useState<Enr[]>([]);
  const [att, setAtt] = useState<{ enrollment_id: string; session_date: string }[]>([]);
  const [instr, setInstr] = useState<Instr[]>([]);
  const [amen, setAmen] = useState<Amen[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [addInstr, setAddInstr] = useState(false);
  const [attFor, setAttFor] = useState<Cls | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [qr, setQr] = useState<{ token: string; expires: string; title: string } | null>(null);

  async function load() {
    setLoading(true); setFailed(false);
    const { data: u } = await supabase.auth.getUser(); setUid(u.user?.id ?? null);
    const reqs = [
      supabase.from("amenity_classes").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("amenity_class_enrollments").select("id,class_id,user_id,flat_id,status,created_at").neq("status", "cancelled").limit(2000),
      supabase.from("amenity_class_attendance").select("enrollment_id,session_date").gte("session_date", new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)).limit(5000),
      supabase.from("amenities").select("id,name,capacity").eq("is_active", true).order("name"),
      mode === "admin" ? supabase.from("amenity_instructors").select("id,name,specialty,is_active").order("name") : Promise.resolve({ data: [], error: null }),
    ] as const;
    const [c, e, a, am, i] = await Promise.all(reqs);
    if (c.error || e.error || a.error || am.error || i.error) { setFailed(true); setLoading(false); return; }
    setClasses((c.data ?? []) as Cls[]); setEnr((e.data ?? []) as Enr[]); setAtt(a.data ?? []); setAmen((am.data ?? []) as Amen[]); setInstr((i.data ?? []) as Instr[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, [societyId]);

  // Resident arrived by scanning a class check-in QR: the server decides class, society and session.
  useEffect(() => {
    if (mode !== "resident") return;
    const url = new URL(window.location.href);
    const tok = url.searchParams.get("ci");
    if (!tok) return;
    url.searchParams.delete("ci");
    window.history.replaceState(null, "", url.pathname + url.search);
    void (async () => {
      const { data, error } = await supabase.rpc("check_in_class_qr", { _token: tok });
      if (error) return void toast.error(classError(error));
      const [state, ...t] = String(data).split(":");
      toast.success(state === "already_checked_in" ? `You're already checked in to ${t.join(":")}` : `Checked in to ${t.join(":")}`);
      void load();
    })();
  }, [mode]);

  const amenName = useMemo(() => Object.fromEntries(amen.map((a) => [a.id, a.name])), [amen]);
  const instrName = useMemo(() => Object.fromEntries(instr.map((a) => [a.id, a.name])), [instr]);

  async function run(key: string, fn: () => PromiseLike<{ error: unknown; data?: unknown }>, ok: string | ((d: unknown) => string)) {
    setBusy(key);
    const { error, data } = await fn();
    setBusy(null);
    if (error) return toast.error(classError(error));
    toast.success(typeof ok === "string" ? ok : ok(data)); void load();
  }

  if (loading) return <p className="text-sm text-muted-foreground">{tu("op.loading_classes")}</p>;
  if (failed) return <div role="alert" className="rounded-2xl border p-4 text-sm">{tu("op.we_couldn_t_load_classes")} <Button variant="outline" className="ml-2 min-h-11" onClick={() => void load()}>{tu("common.tryAgain")}</Button></div>;

  const visible = mode === "resident" ? classes.filter((c) => c.status === "active") : classes;

  return (
    <div className="space-y-4">
      {mode === "admin" && (
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" onClick={() => setCreating(true)} disabled={amen.length === 0}><GraduationCap className="mr-1.5 h-4 w-4" />{tu("op.new_class")}</Button>
          <Button variant="outline" className="min-h-11" onClick={() => setAddInstr(true)}><UserPlus className="mr-1.5 h-4 w-4" />{tu("op.add_instructor")}</Button>
          {amen.length === 0 && <p className="text-sm text-muted-foreground">{tu("op.add_an_amenity_first_every")}</p>}
        </div>
      )}
      {mode === "admin" && instr.length > 0 && (
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="mb-2 font-semibold">{tu("op.instructors")}</h2>
          <ul className="flex flex-wrap gap-2">{instr.map((i) => (
            <li key={i.id} className="flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm">
              <span className={i.is_active ? "" : "text-muted-foreground line-through"}>{i.name}{i.specialty ? ` · ${i.specialty}` : ""}</span>
              <Button size="sm" variant="ghost" className="min-h-9" disabled={busy === i.id}
                onClick={() => void run(i.id, () => supabase.rpc("admin_save_instructor", { _id: i.id, _society_id: societyId!, _name: i.name, _specialty: i.specialty ?? "", _phone: "", _active: !i.is_active }), i.is_active ? "Instructor paused" : "Instructor active")}>
                {i.is_active ? tu("cm.pause") : tu("op.activate")}
              </Button>
            </li>))}</ul>
        </section>
      )}
      {visible.length === 0 ? <p className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">{tu("op.no_classes_yet")}</p> : (
        <div className="grid gap-3 sm:grid-cols-2">{visible.map((c) => {
          const rows = enr.filter((e) => e.class_id === c.id);
          const enrolled = rows.filter((e) => e.status === "enrolled");
          const waiting = rows.filter((e) => e.status === "waitlisted");
          const mine = rows.find((e) => e.user_id === uid);
          const sessions30 = new Set(att.filter((a) => enrolled.some((e) => e.id === a.enrollment_id)).map((a) => a.session_date)).size;
          const checks30 = att.filter((a) => enrolled.some((e) => e.id === a.enrollment_id)).length;
          const usage = sessions30 && enrolled.length ? Math.round((checks30 / (sessions30 * c.capacity)) * 100) : null;
          const checkedToday = mine && att.some((a) => a.enrollment_id === mine.id && a.session_date === today());
          return (
            <article key={c.id} className="rounded-2xl border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><h3 className="font-semibold">{c.title}</h3>
                  <p className="text-xs text-muted-foreground">{amenName[c.amenity_id] ?? tu("am.amenity")}{c.instructor_id && instrName[c.instructor_id] ? ` · ${instrName[c.instructor_id]}` : ""}</p></div>
                <span className={`rounded-full px-2 py-0.5 text-xs ${c.status === "active" ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{c.status === "active" ? tu("op.running") : tu("rbills.cancelled")}</span>
              </div>
              <p className="mt-2 text-sm">{c.weekdays.map((d) => DAYS[d]).join(", ")} · {c.start_time.slice(0, 5)} · {c.duration_minutes} {tu("op.min")}</p>
              <p className="text-xs text-muted-foreground">{tu("common.from")} {c.starts_on}{c.ends_on ? ` to ${c.ends_on}` : ""}</p>
              {c.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{c.description}</p>}
              {c.cancel_reason && <p className="mt-2 text-sm text-destructive">{tu("op.cancelled")} {c.cancel_reason}</p>}
              <p className="mt-2 text-sm tabular-nums">{enrolled.length}/{c.capacity} {tu("op.enrolled")}{waiting.length ? ` · ${waiting.length} waiting` : ""}</p>
              {mode === "admin" && usage !== null && <p className="text-xs text-muted-foreground">{tu("op.last_30_days")} {sessions30} {tu("op.sessions")} {usage}% of places used</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {mode === "resident" && !mine && <Button className="min-h-11" disabled={busy === c.id} onClick={() => void run(c.id, () => supabase.rpc("enroll_class", { _class_id: c.id }), (d) => d === "waitlisted" ? "Class is full — you're on the waitlist" : "You're enrolled")}>{busy === c.id && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{tu("op.join_class")}</Button>}
                {mode === "resident" && mine && <>
                  <span className="self-center text-sm font-medium">{mine.status === "enrolled" ? tu("op.you_re_enrolled") : tu("op.you_re_on_the_waitlist")}</span>
                  {mine.status === "enrolled" && (checkedToday ? <span className="flex items-center gap-1 self-center text-sm text-success"><CheckCircle2 className="h-4 w-4" />{tu("op.checked_in_today")}</span> :
                    <Button variant="outline" className="min-h-11" disabled={busy === c.id + "ci"} onClick={() => void run(c.id + "ci", () => supabase.rpc("check_in_class", { _class_id: c.id }), "Checked in")}>{tu("op.check_in")}</Button>)}
                  <Button variant="ghost" className="min-h-11" disabled={busy === c.id} onClick={() => void run(c.id, () => supabase.rpc("leave_class", { _class_id: c.id }), "You've left the class")}>{tu("op.leave")}</Button>
                </>}
                {mode === "admin" && c.status === "active" && <>
                  <Button variant="outline" className="min-h-11" onClick={() => setAttFor(c)} disabled={enrolled.length === 0}>{tu("op.attendance")}</Button>
                  <Button variant="outline" className="min-h-11" disabled={busy === c.id + "qr"} onClick={async () => {
                    setBusy(c.id + "qr");
                    const { data, error } = await supabase.rpc("admin_issue_class_checkin_code", { _class_id: c.id });
                    setBusy(null);
                    if (error) return void toast.error(classError(error));
                    const d = data as { token: string; expires_at: string };
                    setQr({ token: d.token, expires: d.expires_at, title: c.title });
                  }}><QrCode className="mr-1 h-4 w-4" />{tu("op.check_in_qr")}</Button>
                  <Button variant="ghost" className="min-h-11 text-destructive" disabled={busy === c.id} onClick={async () => {
                    const r = await askText(tu("ln.q.cancelClass"));
                    if (r) void run(c.id, () => supabase.rpc("admin_cancel_class", { _class_id: c.id, _reason: r }), "Class cancelled");
                  }}><X className="mr-1 h-4 w-4" />{tu("op.cancel_class")}</Button>
                </>}
              </div>
            </article>
          );
        })}</div>
      )}

      {mode === "admin" && <>
        <CreateClassDialog open={creating} onClose={() => setCreating(false)} amen={amen} instr={instr.filter((i) => i.is_active)} onDone={() => { setCreating(false); void load(); }} />
        <InstructorDialog open={addInstr} onClose={() => setAddInstr(false)} societyId={societyId} onDone={() => { setAddInstr(false); void load(); }} />
        <AttendanceDialog cls={attFor} onClose={() => setAttFor(null)} enrolled={enr.filter((e) => e.class_id === attFor?.id && e.status === "enrolled")} att={att} onDone={() => { setAttFor(null); void load(); }} />
        <Dialog open={!!qr} onOpenChange={(o) => { if (!o) { setQr(null); void load(); } }}>
          <DialogContent>
            <DialogHeader><DialogTitle>{tu("op.check_in_code")} {qr?.title}</DialogTitle></DialogHeader>
            {qr && <div className="flex flex-col items-center gap-3">
              <div className="rounded-xl bg-background p-3"><QRCodeSVG value={`${window.location.origin}/app/classes?ci=${qr.token}`} size={240} /></div>
              <p className="text-center text-sm text-muted-foreground">{tu("op.enrolled_residents_scan_this_with")} {new Date(qr.expires).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}.</p>
            </div>}
          </DialogContent>
        </Dialog>
      </>}
    </div>
  );
}

function InstructorDialog({ open, onClose, societyId, onDone }: { open: boolean; onClose: () => void; societyId: string | null; onDone: () => void }) {
  const [name, setName] = useState(""); const [spec, setSpec] = useState(""); const [phone, setPhone] = useState(""); const [saving, setSaving] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (!societyId || saving) return; setSaving(true);
    const { error } = await supabase.rpc("admin_save_instructor", { _id: null as unknown as string, _society_id: societyId, _name: name, _specialty: spec, _phone: phone, _active: true });
    setSaving(false); if (error) return toast.error(classError(error));
    toast.success(tu("op.instructor_added")); setName(""); setSpec(""); setPhone(""); onDone();
  }
  return <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}><DialogContent><DialogHeader><DialogTitle>{tu("op.add_instructor")}</DialogTitle></DialogHeader>
    <form className="space-y-3" onSubmit={save}>
      <div className="space-y-1.5"><Label htmlFor="in-name">{tu("common.name")}</Label><Input id="in-name" className="h-11" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="in-spec">{tu("op.teaches_optional")}</Label><Input id="in-spec" className="h-11" maxLength={80} placeholder={tu("op.yoga_swimming")} value={spec} onChange={(e) => setSpec(e.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="in-phone">{tu("op.phone_optional_committee_only")}</Label><Input id="in-phone" className="h-11" inputMode="tel" pattern="[0-9+ ]{7,16}" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
      <Button type="submit" className="h-12 w-full" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{tu("common.save")}</Button>
    </form></DialogContent></Dialog>;
}

function CreateClassDialog({ open, onClose, amen, instr, onDone }: { open: boolean; onClose: () => void; amen: Amen[]; instr: Instr[]; onDone: () => void }) {
  const [f, setF] = useState({ amenity: "", instructor: "", title: "", desc: "", time: "07:00", dur: 60, cap: 10, from: today(), to: "" });
  const [days, setDays] = useState<number[]>([1, 3, 5]); const [saving, setSaving] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (saving || !f.amenity || days.length === 0) return; setSaving(true);
    const { error } = await supabase.rpc("admin_create_class", {
      _amenity_id: f.amenity, _instructor_id: (f.instructor || null) as unknown as string, _title: f.title, _description: f.desc,
      _weekdays: days, _start_time: f.time, _duration: f.dur, _capacity: f.cap, _starts_on: f.from, _ends_on: (f.to || null) as unknown as string,
    });
    setSaving(false); if (error) return toast.error(classError(error));
    toast.success(tu("op.class_created")); onDone();
  }
  const sel = "h-11 w-full rounded-md border bg-background px-3 text-sm";
  return <Dialog open={open} onOpenChange={(o) => !o && !saving && onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>{tu("op.new_class")}</DialogTitle></DialogHeader>
    <form className="space-y-3" onSubmit={save}>
      <div className="space-y-1.5"><Label htmlFor="c-title">{tu("op.class_name")}</Label><Input id="c-title" className="h-11" required minLength={3} maxLength={100} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
      <div className="space-y-1.5"><Label htmlFor="c-am">{tu("op.where_amenity")}</Label><select id="c-am" className={sel} required value={f.amenity} onChange={(e) => setF({ ...f, amenity: e.target.value })}><option value="">{tu("op.choose")}</option>{amen.map((a) => <option key={a.id} value={a.id}>{a.name} {tu("op.up_to")} {a.capacity})</option>)}</select>
        <p className="text-xs text-muted-foreground">{tu("op.who_can_join_follows_this")}</p></div>
      <div className="space-y-1.5"><Label htmlFor="c-in">{tu("op.instructor")}</Label><select id="c-in" className={sel} value={f.instructor} onChange={(e) => setF({ ...f, instructor: e.target.value })}><option value="">{tu("op.none_yet")}</option>{instr.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
      <fieldset><legend className="mb-1.5 text-sm font-medium">{tu("rgp.days")}</legend><div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => (
        <button type="button" key={d} aria-pressed={days.includes(i)} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}
          className={`min-h-11 min-w-11 rounded-xl border px-2 text-sm ${days.includes(i) ? "border-primary bg-primary text-primary-foreground" : ""}`}>{d}</button>))}</div></fieldset>
      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5"><Label htmlFor="c-time">{tu("op.starts_2")}</Label><Input id="c-time" type="time" className="h-11" required value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="c-dur">{tu("mt.minutes")}</Label><Input id="c-dur" type="number" className="h-11" min={15} max={240} required value={f.dur} onChange={(e) => setF({ ...f, dur: Number(e.target.value) })} /></div>
        <div className="space-y-1.5"><Label htmlFor="c-cap">{tu("op.places")}</Label><Input id="c-cap" type="number" className="h-11" min={1} max={200} required value={f.cap} onChange={(e) => setF({ ...f, cap: Number(e.target.value) })} /></div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5"><Label htmlFor="c-from">{tu("op.first_day")}</Label><Input id="c-from" type="date" className="h-11" required value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
        <div className="space-y-1.5"><Label htmlFor="c-to">{tu("op.last_day_optional")}</Label><Input id="c-to" type="date" className="h-11" min={f.from} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
      </div>
      <div className="space-y-1.5"><Label htmlFor="c-desc">{tu("op.details_optional")}</Label><Textarea id="c-desc" maxLength={1000} value={f.desc} onChange={(e) => setF({ ...f, desc: e.target.value })} /></div>
      <Button type="submit" className="h-12 w-full" disabled={saving || days.length === 0}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{tu("op.create_class")}</Button>
    </form></DialogContent></Dialog>;
}

function AttendanceDialog({ cls, onClose, enrolled, att, onDone }: { cls: Cls | null; onClose: () => void; enrolled: Enr[]; att: { enrollment_id: string; session_date: string }[]; onDone: () => void }) {
  const [date, setDate] = useState(today()); const [picked, setPicked] = useState<string[]>([]); const [saving, setSaving] = useState(false);
  useEffect(() => { setPicked([]); }, [cls, date]);
  if (!cls) return null;
  const done = new Set(att.filter((a) => a.session_date === date).map((a) => a.enrollment_id));
  async function save() {
    if (!cls || saving || picked.length === 0) return; setSaving(true);
    const { error, data } = await supabase.rpc("admin_mark_class_attendance", { _class_id: cls.id, _session_date: date, _enrollment_ids: picked });
    setSaving(false); if (error) return toast.error(classError(error));
    toast.success(`${data ?? 0} marked present`); onDone();
  }
  return <Dialog open onOpenChange={(o) => !o && !saving && onClose()}><DialogContent><DialogHeader><DialogTitle>{tu("op.attendance_2")} {cls.title}</DialogTitle></DialogHeader>
    <div className="space-y-3">
      <div className="space-y-1.5"><Label htmlFor="att-date">{tu("op.session_date")}</Label><Input id="att-date" type="date" className="h-11" max={today()} value={date} onChange={(e) => setDate(e.target.value)} /></div>
      <ul className="max-h-72 space-y-1 overflow-y-auto">{enrolled.map((e, i) => (
        <li key={e.id}><label className="flex min-h-11 items-center gap-3 rounded-xl border px-3">
          <input type="checkbox" className="h-5 w-5" disabled={done.has(e.id)} checked={done.has(e.id) || picked.includes(e.id)} onChange={(ev) => setPicked(ev.target.checked ? [...picked, e.id] : picked.filter((x) => x !== e.id))} />
          <span className="text-sm">{tu("op.member")} {i + 1}{done.has(e.id) ? tu("op.present_3") : ""}</span></label></li>))}</ul>
      <p className="text-xs text-muted-foreground">{tu("op.saved_attendance_can_t_be")}</p>
      <Button className="h-12 w-full" disabled={saving || picked.length === 0} onClick={() => void save()}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{tu("op.mark_present")}</Button>
    </div></DialogContent></Dialog>;
}
