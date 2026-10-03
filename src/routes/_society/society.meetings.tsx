import { MinutesCorrections } from "@/components/meetings/MinutesCorrections";
import { AISummaryCard } from "@/components/shared/AISummaryCard";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarDays, Loader2, Plus, MapPin, Link2, CheckCircle2, FileText } from "lucide-react";
import { ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { cn } from "@/lib/utils";
import { govRpc, govError, MEETING_STATUS, fmtDateTime } from "@/lib/governance";

export const Route = createFileRoute("/_society/society/meetings")({
  head: () => ({
    meta: [
      { title: "Meetings & Governance — SociyoHub" },
      { name: "description", content: "Plan society meetings, collect RSVPs, record attendance, minutes, action items and resolutions." },
      { property: "og:title", content: "Meetings & Governance — SociyoHub" },
      { property: "og:description", content: "Society meetings with RSVPs, attendance, minutes and resolutions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MeetingsAdmin,
});

type Meeting = { id: string; title: string; agenda: string; starts_at: string; ends_at: string | null; location: string | null; meeting_link: string | null; audience: string; status: string; minutes: string | null; cancel_reason: string | null };
const EMPTY = { id: null as string | null, title: "", agenda: "", starts: "", ends: "", location: "", link: "", audience: "all" };
const toLocal = (iso: string) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

function MeetingsAdmin() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["admin-meetings", societyId],
    enabled: !!societyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("meetings").select("id,title,agenda,starts_at,ends_at,location,meeting_link,audience,status,minutes,cancel_reason")
        .eq("society_id", societyId!).order("starts_at", { ascending: false }).limit(200);
      if (error) throw error;
      return (data ?? []) as Meeting[];
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-meetings"] });

  async function save() {
    setBusy(true);
    try {
      await govRpc("meeting_save", {
        _id: form.id, _title: form.title, _agenda: form.agenda,
        _starts_at: form.starts ? new Date(form.starts).toISOString() : null,
        _ends_at: form.ends ? new Date(form.ends).toISOString() : null,
        _location: form.location, _link: form.link, _audience: form.audience,
      });
      toast.success(form.id ? "Meeting updated" : "Meeting saved as draft");
      setEditing(false); refresh();
    } catch (e) { toast.error(govError(e)); } finally { setBusy(false); }
  }

  const rows = q.data ?? [];
  const upcoming = rows.filter((m) => ["draft", "scheduled"].includes(m.status));
  const past = rows.filter((m) => !["draft", "scheduled"].includes(m.status));
  const open = rows.find((m) => m.id === openId) ?? null;

  const item = (m: Meeting) => (
    <li key={m.id}>
      <button onClick={() => setOpenId(m.id)} className="flex w-full min-h-14 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <CalendarDays className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{m.title}</span>
          <span className="block text-xs text-muted-foreground">{fmtDateTime(m.starts_at)} · {m.audience === "committee" ? "Committee only" : "All residents"}</span>
        </span>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-medium", MEETING_STATUS[m.status]?.className)}>{MEETING_STATUS[m.status]?.label}</span>
      </button>
    </li>
  );

  return (
    <PageShell>
      <PageHeader title="Meetings" description="Plan meetings, record attendance, minutes and resolutions"
        actions={<Button className="rounded-xl min-h-11" onClick={() => { setForm(EMPTY); setEditing(true); }}><Plus className="h-4 w-4 mr-2" />New meeting</Button>} />
      {q.isLoading ? <ListSkeleton rows={4} />
        : q.isError ? <LoadError title="We couldn't load meetings." onRetry={() => q.refetch()} />
        : rows.length === 0 ? <ListEmpty icon={CalendarDays} title="No meetings yet">Create a meeting to share its agenda and collect RSVPs.</ListEmpty>
        : (
          <div className="space-y-5">
            {upcoming.length > 0 && <section><h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Upcoming & drafts</h2><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{upcoming.map(item)}</ul></section>}
            {past.length > 0 && <section><h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Past</h2><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{past.map(item)}</ul></section>}
          </div>
        )}

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          <SheetHeader><SheetTitle>{form.id ? "Edit meeting" : "New meeting"}</SheetTitle></SheetHeader>
          <div className="mx-auto max-w-2xl space-y-4 py-4">
            <div><Label htmlFor="m-title">Title *</Label><Input id="m-title" className="h-11" maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
            <div><Label htmlFor="m-agenda">Agenda</Label><Textarea id="m-agenda" rows={5} maxLength={5000} value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="m-start">Starts *</Label><Input id="m-start" type="datetime-local" className="h-11" value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} /></div>
              <div><Label htmlFor="m-end">Ends</Label><Input id="m-end" type="datetime-local" className="h-11" value={form.ends} onChange={(e) => setForm({ ...form, ends: e.target.value })} /></div>
              <div><Label htmlFor="m-loc">Location</Label><Input id="m-loc" className="h-11" maxLength={200} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Clubhouse" /></div>
              <div><Label htmlFor="m-link">Meeting link</Label><Input id="m-link" className="h-11" maxLength={500} value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://" /></div>
            </div>
            <div><Label>Who is invited</Label>
              <Select value={form.audience} onValueChange={(v) => setForm({ ...form, audience: v })}>
                <SelectTrigger aria-label="Who is invited" className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="all">All residents</SelectItem><SelectItem value="committee">Committee only</SelectItem></SelectContent>
              </Select>
            </div>
            <Button className="h-12 w-full rounded-xl" disabled={busy} onClick={save}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}</Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          {open && <MeetingDetail m={open} societyId={societyId!} onChanged={refresh} onEdit={() => {
            setForm({ id: open.id, title: open.title, agenda: open.agenda, starts: toLocal(open.starts_at), ends: open.ends_at ? toLocal(open.ends_at) : "", location: open.location ?? "", link: open.meeting_link ?? "", audience: open.audience });
            setOpenId(null); setEditing(true);
          }} />}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

function MeetingDetail({ m, societyId, onChanged, onEdit }: { m: Meeting; societyId: string; onChanged: () => void; onEdit: () => void }) {
  const qc = useQueryClient();
  const [minutes, setMinutes] = useState(m.minutes ?? "");
  const [act, setAct] = useState({ title: "", owner: "", due: "" });
  const [res, setRes] = useState({ text: "", outcome: "passed", poll: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const d = useQuery({
    queryKey: ["meeting-detail", m.id, m.status],
    queryFn: async () => {
      const [r, a, rs, docs, kn, votes] = await Promise.all([
        m.status === "draft" || m.status === "cancelled" ? Promise.resolve({ data: [] }) : (supabase.rpc as any)("meeting_member_roster", { _id: m.id }),
        supabase.from("meeting_action_items").select("id,title,owner_name,due_on,status").eq("meeting_id", m.id).order("created_at"),
        supabase.from("meeting_resolutions").select("id,seq,text,outcome,poll_id").eq("meeting_id", m.id).order("seq"),
        supabase.from("meeting_documents").select("source_id").eq("meeting_id", m.id),
        supabase.from("society_knowledge_sources").select("id,title,audience").eq("society_id", societyId).eq("kind", "document").neq("status", "archived").limit(200),
        supabase.from("polls").select("id,title").eq("society_id", societyId).eq("kind", "vote").eq("status", "closed").limit(100),
      ]);
      return {
        roster: (r.data ?? []) as { user_id: string; full_name: string; homes: string; rsvp: string | null; present: boolean | null }[],
        actions: (a.data ?? []) as any[], resolutions: (rs.data ?? []) as any[],
        linked: new Set(((docs.data ?? []) as any[]).map((x) => x.source_id as string)),
        docs: (kn.data ?? []) as { id: string; title: string; audience: string }[],
        votes: (votes.data ?? []) as { id: string; title: string }[],
      };
    },
  });
  const reload = () => { qc.invalidateQueries({ queryKey: ["meeting-detail", m.id] }); onChanged(); };

  async function run(key: string, fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(key);
    try { await govRpc(fn, args); toast.success(ok); reload(); return true; }
    catch (e) { toast.error(govError(e)); return false; }
    finally { setBusy(null); }
  }
  const status = (s: string, label: string) => {
    let reason: string | null = null;
    if (s === "cancelled") { reason = prompt("Reason for cancelling (residents will be told it was cancelled):"); if (!reason) return; }
    return run(s, "meeting_set_status", { _id: m.id, _status: s, _reason: reason }, label);
  };
  const rsvpCount = (v: string) => d.data?.roster.filter((r) => r.rsvp === v).length ?? 0;

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-6">
      <SheetHeader>
        <span className={cn("w-fit rounded px-1.5 py-0.5 text-xs font-medium", MEETING_STATUS[m.status]?.className)}>{MEETING_STATUS[m.status]?.label}</span>
        <SheetTitle className="text-left text-xl">{m.title}</SheetTitle>
      </SheetHeader>
      <AISummaryCard key={m.id} target={{ kind: "meeting", id: m.id }} />
      <div className="space-y-1 text-sm">
        <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />{fmtDateTime(m.starts_at)}</p>
        {m.location && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />{m.location}</p>}
        {m.meeting_link && <p className="flex items-center gap-2 break-all"><Link2 className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />{m.meeting_link}</p>}
        {m.cancel_reason && <p className="text-destructive">Cancelled: {m.cancel_reason}</p>}
      </div>
      {m.agenda && <div><h3 className="text-sm font-semibold">Agenda</h3><p className="whitespace-pre-wrap text-sm text-muted-foreground">{m.agenda}</p></div>}

      <div className="flex flex-wrap gap-2">
        {["draft", "scheduled"].includes(m.status) && <Button variant="outline" className="min-h-11 rounded-xl" onClick={onEdit}>Edit</Button>}
        {m.status === "draft" && <Button className="min-h-11 rounded-xl" disabled={!!busy} onClick={() => status("scheduled", "Meeting scheduled — invitees are notified")}>Schedule & notify</Button>}
        {m.status === "scheduled" && <Button className="min-h-11 rounded-xl" disabled={!!busy || new Date(m.starts_at) > new Date()} onClick={() => status("held", "Marked as held")}>Mark as held</Button>}
        {["draft", "scheduled"].includes(m.status) && <Button variant="ghost" className="min-h-11 rounded-xl text-destructive" disabled={!!busy} onClick={() => status("cancelled", "Meeting cancelled")}>Cancel meeting</Button>}
      </div>

      {m.status !== "draft" && m.status !== "cancelled" && (
        <section>
          <h3 className="text-sm font-semibold">RSVP & attendance</h3>
          <p className="text-xs text-muted-foreground tabular-nums">{rsvpCount("yes")} yes · {rsvpCount("maybe")} maybe · {rsvpCount("no")} no · {(d.data?.roster.length ?? 0) - rsvpCount("yes") - rsvpCount("maybe") - rsvpCount("no")} no reply</p>
          {d.isLoading ? <Loader2 className="mt-2 h-4 w-4 animate-spin" /> : (
            <ul className="mt-2 max-h-72 divide-y overflow-y-auto rounded-xl border">
              {d.data?.roster.map((r) => (
                <li key={r.user_id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.full_name}</span><span className="block text-xs text-muted-foreground">{r.homes} · RSVP {r.rsvp ?? "—"}</span></span>
                  {["held", "minutes_published"].includes(m.status) && (
                    m.status === "held" ? (
                      <label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" className="h-5 w-5" checked={!!r.present} disabled={busy === r.user_id}
                        onChange={(e) => run(r.user_id, "meeting_record_attendance", { _id: m.id, _user: r.user_id, _present: e.target.checked }, "Attendance saved")} />Present</label>
                    ) : <span className="text-xs">{r.present ? "Present" : r.present === false ? "Absent" : "Not recorded"}</span>
                  )}
                </li>
              ))}
              {d.data?.roster.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No current residents found.</li>}
            </ul>
          )}
        </section>
      )}

      {["held", "minutes_published"].includes(m.status) && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Minutes</h3>
          {m.status === "held" ? (
            <>
              <Textarea rows={6} maxLength={20000} value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="What was discussed and decided" />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" className="min-h-11 rounded-xl" disabled={!!busy} onClick={() => run("min", "meeting_save_minutes", { _id: m.id, _minutes: minutes }, "Minutes saved")}>Save minutes</Button>
                <Button className="min-h-11 rounded-xl" disabled={!!busy || !m.minutes} onClick={() => confirm("Publish minutes? They can't be edited afterwards.") && status("minutes_published", "Minutes published — invitees are notified")}>Publish minutes</Button>
              </div>
            </>
          ) : (
            <>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{m.minutes}</p>
              <MinutesCorrections meetingId={m.id} canAdd />
            </>
          )}
        </section>
      )}

      {["held", "minutes_published"].includes(m.status) && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Action items</h3>
          <ul className="divide-y rounded-xl border">
            {d.data?.actions.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1"><span className={cn("block font-medium", a.status !== "open" && "line-through text-muted-foreground")}>{a.title}</span><span className="block text-xs text-muted-foreground">{[a.owner_name, a.due_on && `due ${a.due_on}`].filter(Boolean).join(" · ") || "No owner"}</span></span>
                {a.status === "open" ? <Button size="sm" variant="outline" className="min-h-11" disabled={!!busy} onClick={() => run(a.id, "meeting_set_action_status", { _id: a.id, _status: "done" }, "Marked done")}><CheckCircle2 className="h-4 w-4 mr-1" />Done</Button>
                  : <span className="text-xs capitalize">{a.status}</span>}
              </li>
            ))}
            {d.data?.actions.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No action items yet.</li>}
          </ul>
          <div className="grid gap-2 sm:grid-cols-[1fr_10rem_9rem_auto]">
            <Input className="h-11" placeholder="New action item" value={act.title} onChange={(e) => setAct({ ...act, title: e.target.value })} />
            <Input className="h-11" placeholder="Owner" value={act.owner} onChange={(e) => setAct({ ...act, owner: e.target.value })} />
            <Input className="h-11" type="date" aria-label="Due date" value={act.due} onChange={(e) => setAct({ ...act, due: e.target.value })} />
            <Button className="min-h-11 rounded-xl" disabled={!!busy} onClick={async () => { if (await run("act", "meeting_add_action", { _meeting: m.id, _title: act.title, _owner: act.owner, _due: act.due || null }, "Action item added")) setAct({ title: "", owner: "", due: "" }); }}>Add</Button>
          </div>
        </section>
      )}

      {["held", "minutes_published"].includes(m.status) && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Resolutions</h3>
          <p className="text-xs text-muted-foreground">Resolutions are permanent records and can't be edited once recorded.</p>
          <ol className="divide-y rounded-xl border">
            {d.data?.resolutions.map((r) => (
              <li key={r.id} className="px-3 py-2 text-sm"><span className="font-medium">R{r.seq}. </span>{r.text} <span className="text-xs capitalize text-muted-foreground">— {r.outcome}{r.poll_id ? " (by formal vote)" : ""}</span></li>
            ))}
            {d.data?.resolutions.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No resolutions recorded.</li>}
          </ol>
          {m.status === "held" && (
            <div className="space-y-2">
              <Textarea rows={2} maxLength={2000} placeholder="Resolution text" value={res.text} onChange={(e) => setRes({ ...res, text: e.target.value })} />
              <div className="grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
                <Select value={res.outcome} onValueChange={(v) => setRes({ ...res, outcome: v })}><SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="passed">Passed</SelectItem><SelectItem value="rejected">Rejected</SelectItem><SelectItem value="deferred">Deferred</SelectItem></SelectContent></Select>
                <Select value={res.poll || "none"} onValueChange={(v) => setRes({ ...res, poll: v === "none" ? "" : v })}><SelectTrigger className="h-11"><SelectValue placeholder="Link a closed vote" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">No linked vote</SelectItem>{d.data?.votes.map((v) => <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>)}</SelectContent></Select>
                <Button className="min-h-11 rounded-xl" disabled={!!busy} onClick={async () => { if (await run("res", "meeting_add_resolution", { _meeting: m.id, _text: res.text, _outcome: res.outcome, _poll: res.poll || null }, "Resolution recorded")) setRes({ text: "", outcome: "passed", poll: "" }); }}>Record</Button>
              </div>
            </div>
          )}
        </section>
      )}

      {m.status !== "cancelled" && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Supporting documents</h3>
          <p className="text-xs text-muted-foreground">Residents can open only documents shared with residents.</p>
          <ul className="divide-y rounded-xl border">
            {d.data?.docs.map((doc) => (
              <li key={doc.id} className="flex items-center gap-3 px-3 py-1 text-sm">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">{doc.title}{doc.audience === "committee" && <span className="text-xs text-muted-foreground"> · committee only</span>}</span>
                <label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" className="h-5 w-5" checked={d.data.linked.has(doc.id)} disabled={!!busy}
                  onChange={(e) => run(doc.id, "meeting_link_document", { _meeting: m.id, _source: doc.id, _linked: e.target.checked }, e.target.checked ? "Document attached" : "Document removed")} />Attach</label>
              </li>
            ))}
            {d.data?.docs.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">Upload documents in Documents & FAQs first.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}
