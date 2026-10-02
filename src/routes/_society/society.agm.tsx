import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Landmark, Loader2, Plus, ArrowUp, ArrowDown, Trash2, Check, X } from "lucide-react";
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
import { govRpc, govError, fmtDateTime, AGM_STATUS, RESOLUTION_STATUS, localToIso, isoToLocal } from "@/lib/governance";
import { QuorumPanel, AgendaList, AGENDA_KIND, type AgendaItem, type Resolution, type MinutesVersion } from "@/components/governance/AgmRecord";

export const Route = createFileRoute("/_society/society/agm")({
  head: () => ({
    meta: [
      { title: "Annual General Meeting — SociyoHub" },
      { name: "description", content: "Plan and record the AGM: notice, agenda, attendance and quorum, resolutions and versioned minutes." },
      { property: "og:title", content: "Annual General Meeting — SociyoHub" },
      { property: "og:description", content: "AGM notice, agenda, quorum, resolutions and minutes in one record." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AgmAdmin,
});

type Agm = { id: string; meeting_id: string; title: string; financial_year: string; notice_date: string | null; quorum_basis: string; quorum_type: string; quorum_value: number; status: string; archive_reason: string | null };
type Meeting = { id: string; starts_at: string; location: string | null; meeting_link: string | null; agenda: string | null };
type Roster = { user_id: string; full_name: string; homes: string; present: boolean | null };

const fyNow = () => { const d = new Date(); const y = d.getMonth() >= 3 ? d.getFullYear() - 1 : d.getFullYear() - 2; return `${y}-${String((y + 1) % 100).padStart(2, "0")}`; };
const EMPTY = { title: "", fy: fyNow(), starts: "", location: "", link: "", agenda: "", basis: "home", qtype: "percent", qvalue: "33" };
const EMPTY_ITEM = { id: null as string | null, title: "", description: "", kind: "discussion", poll: "none", election: "none", source: "none" };

const NEXT: Record<string, { to: string; label: string; confirm: string }[]> = {
  draft: [{ to: "notice_published", label: "Publish AGM notice", confirm: "Publish the AGM notice? Residents get a notice with the agenda and the date can no longer be edited." }],
  notice_published: [{ to: "scheduled", label: "Confirm schedule", confirm: "Confirm the AGM is scheduled as announced?" }],
  scheduled: [{ to: "in_progress", label: "Start AGM", confirm: "Start the AGM now? Attendance can then be recorded." }],
  in_progress: [{ to: "completed", label: "End AGM", confirm: "End the AGM? Quorum is calculated from recorded attendance and frozen." }],
  completed: [{ to: "minutes_pending", label: "Send minutes for review", confirm: "Send the draft minutes for review?" }],
  minutes_pending: [{ to: "minutes_published", label: "Publish minutes", confirm: "Publish the minutes? Published minutes can't be edited — only corrected with a new version." }],
  minutes_published: [{ to: "archived", label: "Archive", confirm: "Archive this AGM record?" }],
};

function AgmAdmin() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [item, setItem] = useState<typeof EMPTY_ITEM | null>(null);
  const [resForm, setResForm] = useState<{ title: string; body: string; agenda: string; poll: string } | null>(null);
  const [minutes, setMinutes] = useState<{ body: string; reason: string } | null>(null);
  const [reason, setReason] = useState<{ title: string; action: (r: string) => Promise<boolean> } | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [busy, setBusy] = useState(false);

  const list = useQuery({
    queryKey: ["admin-agms", societyId],
    enabled: !!societyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("agms").select("*").eq("society_id", societyId!).order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as Agm[];
    },
  });
  const open = list.data?.find((a) => a.id === openId) ?? null;
  const detail = useQuery({
    queryKey: ["admin-agm", openId, open?.status],
    enabled: !!open,
    queryFn: async () => {
      const a = open!;
      const [m, ag, rs, mv, docs, roster] = await Promise.all([
        supabase.from("meetings").select("id,starts_at,location,meeting_link,agenda").eq("id", a.meeting_id).maybeSingle(),
        supabase.from("agm_agenda_items").select("*").eq("agm_id", a.id).order("seq"),
        supabase.from("agm_resolutions").select("*").eq("agm_id", a.id).order("seq"),
        supabase.from("agm_minutes_versions").select("*").eq("agm_id", a.id).order("version", { ascending: false }),
        supabase.from("meeting_documents").select("source_id").eq("meeting_id", a.meeting_id),
        ["in_progress", "completed", "minutes_pending"].includes(a.status) ? (supabase.rpc as any)("meeting_member_roster", { _id: a.meeting_id }) : Promise.resolve({ data: [] }),
      ]);
      if (m.error) throw m.error;
      return { meeting: m.data as Meeting | null, agenda: (ag.data ?? []) as AgendaItem[], resolutions: (rs.data ?? []) as Resolution[], minutes: (mv.data ?? []) as MinutesVersion[],
        docIds: new Set(((docs.data ?? []) as { source_id: string }[]).map((d) => d.source_id)), roster: ((roster as any).data ?? []) as Roster[] };
    },
  });
  const refs = useQuery({
    queryKey: ["agm-refs", societyId],
    enabled: !!societyId && !!open,
    queryFn: async () => {
      const [votes, els, docs] = await Promise.all([
        supabase.from("polls").select("id,title,status").eq("society_id", societyId!).eq("kind", "vote").order("created_at", { ascending: false }).limit(100),
        supabase.from("elections").select("id,title,status").eq("society_id", societyId!).neq("status", "archived").order("created_at", { ascending: false }).limit(50),
        supabase.from("society_knowledge_sources").select("id,title").eq("society_id", societyId!).is("archived_at", null).neq("kind", "faq").order("title").limit(200),
      ]);
      return { votes: (votes.data ?? []) as { id: string; title: string; status: string }[], elections: (els.data ?? []) as { id: string; title: string }[], docs: (docs.data ?? []) as { id: string; title: string }[] };
    },
  });
  const refresh = () => { ["admin-agms", "admin-agm", "agm-quorum"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); };
  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); refresh(); return true; }
    catch (e) { toast.error(govError(e)); return false; }
    finally { setBusy(false); }
  }
  const askReason = (title: string, action: (r: string) => Promise<boolean>) => { setReason({ title, action }); setReasonText(""); };

  function startEdit(a?: Agm) {
    const m = a && detail.data?.meeting;
    setEditingId(a?.id ?? null);
    setForm(a ? { title: a.title, fy: a.financial_year, starts: isoToLocal(m?.starts_at), location: m?.location ?? "", link: m?.meeting_link ?? "", agenda: m?.agenda ?? "",
      basis: a.quorum_basis, qtype: a.quorum_type, qvalue: String(a.quorum_value) } : EMPTY);
    setFormOpen(true);
  }
  async function save() {
    const ok = await run(() => govRpc("agm_save", { _id: editingId, _title: form.title, _fy: form.fy, _starts: localToIso(form.starts), _location: form.location, _link: form.link,
      _agenda: form.agenda, _basis: form.basis, _qtype: form.qtype, _qvalue: Number(form.qvalue) }), editingId ? "AGM updated" : "AGM created as draft. Add the agenda next.");
    if (ok) setFormOpen(false);
  }
  async function saveItem() {
    if (!item || !open) return;
    const ok = await run(() => govRpc("agm_agenda_save", { _agm: open.id, _item: item.id, _title: item.title, _description: item.description, _kind: item.kind,
      _poll: item.poll === "none" ? null : item.poll, _election: item.election === "none" ? null : item.election, _source: item.source === "none" ? null : item.source }), "Agenda item saved");
    if (ok) setItem(null);
  }
  async function saveRes() {
    if (!resForm || !open) return;
    const ok = await run(() => govRpc("agm_resolution_add", { _agm: open.id, _agenda_item: resForm.agenda === "none" ? null : resForm.agenda, _title: resForm.title, _body: resForm.body, _poll: resForm.poll === "none" ? null : resForm.poll }), "Resolution proposed");
    if (ok) setResForm(null);
  }
  async function saveMinutes() {
    if (!minutes || !open) return;
    const ok = await run(() => govRpc("agm_minutes_save", { _agm: open.id, _body: minutes.body, _correction_reason: minutes.reason || null }), "Minutes draft saved");
    if (ok) setMinutes(null);
  }

  const d = detail.data;
  const draftMinutes = d?.minutes.find((m) => m.status === "draft");
  const published = d?.minutes.filter((m) => m.status === "published") ?? [];
  const canEditAgenda = open && ["draft", "notice_published", "scheduled"].includes(open.status);
  const canAttend = open && ["in_progress", "completed", "minutes_pending"].includes(open.status);
  const canResolve = open && !["minutes_published", "archived"].includes(open.status);
  const canDecide = open && ["in_progress", "completed", "minutes_pending"].includes(open.status);
  const canMinutes = open && ["completed", "minutes_pending", "minutes_published"].includes(open.status);

  return (
    <PageShell>
      <PageHeader title="Annual General Meeting" description="Notice, agenda, attendance and quorum, resolutions and minutes — one official record per AGM."
        actions={<Button className="rounded-xl min-h-11" onClick={() => startEdit()}><Plus className="h-4 w-4 mr-2" />New AGM</Button>} />
      {list.isLoading ? <ListSkeleton rows={3} />
        : list.isError ? <LoadError title="We couldn't load AGMs." onRetry={() => list.refetch()} />
        : !list.data?.length ? <ListEmpty icon={Landmark} title="No AGM records yet">Create the AGM for a financial year, add its agenda, then publish the notice.</ListEmpty>
        : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {list.data.map((a) => (
              <li key={a.id}>
                <button onClick={() => setOpenId(a.id)} className="flex w-full min-h-14 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <Landmark className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{a.title}</span>
                    <span className="block text-xs text-muted-foreground">FY {a.financial_year}{a.notice_date ? ` · notice ${new Date(a.notice_date).toLocaleDateString("en-IN")}` : ""}</span></span>
                  <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-medium", AGM_STATUS[a.status]?.className)}>{AGM_STATUS[a.status]?.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          <SheetHeader><SheetTitle>{editingId ? "Edit AGM" : "New AGM"}</SheetTitle></SheetHeader>
          <div className="mx-auto max-w-2xl space-y-4 py-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
              <div><Label htmlFor="a-title">Title *</Label><Input id="a-title" className="h-11" maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Annual General Meeting" /></div>
              <div><Label htmlFor="a-fy">Financial year *</Label><Input id="a-fy" className="h-11" maxLength={7} value={form.fy} onChange={(e) => setForm({ ...form, fy: e.target.value })} placeholder="2025-26" /></div>
            </div>
            <div><Label htmlFor="a-when">Date and time *</Label><Input id="a-when" type="datetime-local" className="h-11" value={form.starts} onChange={(e) => setForm({ ...form, starts: e.target.value })} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="a-loc">Venue</Label><Input id="a-loc" className="h-11" maxLength={200} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Clubhouse" /></div>
              <div><Label htmlFor="a-link">Online link</Label><Input id="a-link" className="h-11" inputMode="url" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://" /></div>
            </div>
            <div><Label htmlFor="a-notes">Notes for residents</Label><Textarea id="a-notes" rows={2} value={form.agenda} onChange={(e) => setForm({ ...form, agenda: e.target.value })} /></div>
            <fieldset className="space-y-2 rounded-2xl border p-3">
              <legend className="px-1 text-sm font-medium">Quorum</legend>
              <div className="grid gap-3 sm:grid-cols-3">
                <div><Label>Counted by</Label>
                  <Select value={form.basis} onValueChange={(v) => setForm({ ...form, basis: v })}><SelectTrigger aria-label="Counted by" className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="home">Homes</SelectItem><SelectItem value="person">Residents</SelectItem></SelectContent></Select></div>
                <div><Label>Rule</Label>
                  <Select value={form.qtype} onValueChange={(v) => setForm({ ...form, qtype: v })}><SelectTrigger aria-label="Rule" className="h-11"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="percent">Percentage</SelectItem><SelectItem value="count">Fixed number</SelectItem></SelectContent></Select></div>
                <div><Label htmlFor="a-q">{form.qtype === "percent" ? "Percent needed" : "Number needed"}</Label><Input id="a-q" type="number" inputMode="decimal" min={1} className="h-11" value={form.qvalue} onChange={(e) => setForm({ ...form, qvalue: e.target.value })} /></div>
              </div>
              <p className="text-xs text-muted-foreground">Use the figure in your society's bye-laws. The app calculates quorum from recorded attendance.</p>
            </fieldset>
            <Button className="h-12 w-full rounded-xl" disabled={busy} onClick={save}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save draft"}</Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          {open && (
            <div className="mx-auto max-w-2xl space-y-5 pb-6">
              <SheetHeader>
                <span className={cn("w-fit rounded px-1.5 py-0.5 text-xs font-medium", AGM_STATUS[open.status]?.className)}>{AGM_STATUS[open.status]?.label}</span>
                <SheetTitle className="text-left text-xl">{open.title} · FY {open.financial_year}</SheetTitle>
              </SheetHeader>
              {detail.isLoading ? <ListSkeleton rows={3} /> : detail.isError || !d ? <LoadError title="We couldn't load this AGM." onRetry={() => detail.refetch()} /> : (
                <>
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="text-xs text-muted-foreground">When</dt><dd>{d.meeting ? fmtDateTime(d.meeting.starts_at) : "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Where</dt><dd className="break-words">{d.meeting?.location ?? (d.meeting?.meeting_link ? "Online" : "—")}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Notice</dt><dd>{open.notice_date ? new Date(open.notice_date).toLocaleDateString("en-IN") : "Not published"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Quorum rule</dt><dd>{open.quorum_type === "percent" ? `${open.quorum_value}%` : open.quorum_value} of {open.quorum_basis === "home" ? "homes" : "residents"}</dd></div>
                  </dl>
                  {open.archive_reason && <p className="text-sm text-muted-foreground">Note: {open.archive_reason}</p>}

                  <section className="space-y-2">
                    <div className="flex items-center justify-between"><h3 className="font-semibold">Agenda</h3>
                      {canEditAgenda && <Button size="sm" variant="outline" className="min-h-11 rounded-xl" onClick={() => setItem({ ...EMPTY_ITEM })}><Plus className="h-4 w-4 mr-1" />Add item</Button>}</div>
                    {canEditAgenda ? (
                      !d.agenda.length ? <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No agenda items yet. The notice can't be published without an agenda.</p> : (
                        <ol className="space-y-2">
                          {d.agenda.map((i, idx) => (
                            <li key={i.id} className="flex items-start gap-2 rounded-xl bg-muted/40 p-2.5 text-sm">
                              <button className="min-w-0 flex-1 text-left" onClick={() => setItem({ id: i.id, title: i.title, description: i.description ?? "", kind: i.kind, poll: i.poll_id ?? "none", election: i.election_id ?? "none", source: i.source_id ?? "none" })}>
                                <span className="font-medium">{idx + 1}. {i.title}</span> <span className="text-xs text-muted-foreground">· {AGENDA_KIND[i.kind]}</span>
                                {i.description && <span className="block text-xs text-muted-foreground">{i.description}</span>}
                              </button>
                              <Button variant="ghost" className="h-11 w-11 p-0" aria-label={`Move ${i.title} up`} disabled={busy || idx === 0} onClick={() => run(() => govRpc("agm_agenda_move", { _item: i.id, _dir: -1 }), "Moved")}><ArrowUp className="h-4 w-4" /></Button>
                              <Button variant="ghost" className="h-11 w-11 p-0" aria-label={`Move ${i.title} down`} disabled={busy || idx === d.agenda.length - 1} onClick={() => run(() => govRpc("agm_agenda_move", { _item: i.id, _dir: 1 }), "Moved")}><ArrowDown className="h-4 w-4" /></Button>
                              {open.status === "draft" && <Button variant="ghost" className="h-11 w-11 p-0" aria-label={`Remove ${i.title}`} disabled={busy} onClick={() => confirm("Remove this agenda item?") && run(() => govRpc("agm_agenda_remove", { _item: i.id }), "Removed")}><Trash2 className="h-4 w-4" /></Button>}
                            </li>
                          ))}
                        </ol>
                      )
                    ) : <AgendaList items={d.agenda} />}
                  </section>

                  {open.status !== "draft" && open.status !== "notice_published" && open.status !== "scheduled" && (
                    <section className="space-y-2"><h3 className="font-semibold">Attendance and quorum</h3>
                      <QuorumPanel agmId={open.id} />
                      {canAttend && (
                        <ul className="max-h-80 divide-y overflow-y-auto rounded-2xl border">
                          {!d.roster.length && <li className="p-3 text-sm text-muted-foreground">No current members found.</li>}
                          {d.roster.map((r) => (
                            <li key={r.user_id} className="flex items-center gap-2 px-3 py-2 text-sm">
                              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.full_name}</span><span className="block truncate text-xs text-muted-foreground">{r.homes}</span></span>
                              <Button size="sm" variant={r.present ? "default" : "outline"} className="min-h-11 rounded-xl" disabled={busy} aria-pressed={!!r.present}
                                onClick={() => {
                                  const act = (rs: string | null) => run(() => govRpc("agm_record_attendance", { _agm: open.id, _user: r.user_id, _present: !r.present, _reason: rs }), r.present ? "Marked absent" : "Marked present");
                                  if (open.status === "in_progress") act(null); else askReason(`Correct attendance for ${r.full_name}`, (rs) => act(rs));
                                }}>{r.present ? "Present" : "Mark present"}</Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )}

                  <section className="space-y-2">
                    <div className="flex items-center justify-between"><h3 className="font-semibold">Resolutions</h3>
                      {canResolve && <Button size="sm" variant="outline" className="min-h-11 rounded-xl" onClick={() => setResForm({ title: "", body: "", agenda: "none", poll: "none" })}><Plus className="h-4 w-4 mr-1" />Propose</Button>}</div>
                    {!d.resolutions.length ? <p className="text-sm text-muted-foreground">No resolutions yet.</p> : (
                      <ul className="space-y-2">
                        {d.resolutions.map((r) => (
                          <li key={r.id} className="rounded-xl border p-3 text-sm">
                            <div className="flex items-center justify-between gap-2"><p className="font-medium">R{r.seq}. {r.title}</p>
                              <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", RESOLUTION_STATUS[r.status]?.className)}>{RESOLUTION_STATUS[r.status]?.label}</span></div>
                            <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{r.body}</p>
                            {r.poll_id && <p className="text-xs text-muted-foreground">Linked formal vote: {refs.data?.votes.find((v) => v.id === r.poll_id)?.title ?? "—"}</p>}
                            {r.status === "proposed" && canResolve && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {canDecide && <Button size="sm" className="min-h-11 rounded-xl" disabled={busy} onClick={() => confirm("Record as passed? This can't be changed.") && run(() => govRpc("agm_resolution_decide", { _resolution: r.id, _status: "passed" }), "Recorded as passed")}><Check className="h-4 w-4 mr-1" />Passed</Button>}
                                {canDecide && <Button size="sm" variant="outline" className="min-h-11 rounded-xl" disabled={busy} onClick={() => confirm("Record as rejected? This can't be changed.") && run(() => govRpc("agm_resolution_decide", { _resolution: r.id, _status: "rejected" }), "Recorded as rejected")}><X className="h-4 w-4 mr-1" />Rejected</Button>}
                                {canDecide && <Button size="sm" variant="outline" className="min-h-11 rounded-xl" disabled={busy} onClick={() => run(() => govRpc("agm_resolution_decide", { _resolution: r.id, _status: "deferred" }), "Deferred")}>Defer</Button>}
                                <Button size="sm" variant="ghost" className="min-h-11 rounded-xl" disabled={busy} onClick={() => confirm("Withdraw this resolution?") && run(() => govRpc("agm_resolution_decide", { _resolution: r.id, _status: "withdrawn" }), "Withdrawn")}>Withdraw</Button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  {canMinutes && (
                    <section className="space-y-2">
                      <div className="flex items-center justify-between"><h3 className="font-semibold">Minutes</h3>
                        <Button size="sm" variant="outline" className="min-h-11 rounded-xl" onClick={() => setMinutes({ body: draftMinutes?.body ?? published[0]?.body ?? "", reason: draftMinutes?.correction_reason ?? "" })}>
                          {draftMinutes ? "Edit draft" : published.length ? "Draft a correction" : "Write minutes"}</Button></div>
                      {draftMinutes && <div className="rounded-xl border border-dashed p-3 text-sm"><p className="text-xs font-medium text-muted-foreground">Draft · version {draftMinutes.version}{draftMinutes.correction_reason ? ` · correction: ${draftMinutes.correction_reason}` : ""}</p><p className="mt-1 line-clamp-4 whitespace-pre-wrap">{draftMinutes.body}</p></div>}
                      {published.map((m, i) => (
                        <details key={m.id} className="rounded-xl border p-3 text-sm" open={i === 0}>
                          <summary className="cursor-pointer font-medium">Version {m.version} · published {m.published_at ? fmtDateTime(m.published_at) : ""}{i > 0 ? " (superseded)" : ""}</summary>
                          {m.correction_reason && <p className="mt-1 text-xs text-muted-foreground">Correction: {m.correction_reason}</p>}
                          <p className="mt-2 whitespace-pre-wrap">{m.body}</p>
                        </details>
                      ))}
                    </section>
                  )}

                  <section className="space-y-2">
                    <h3 className="font-semibold">Supporting documents</h3>
                    {!refs.data?.docs.length ? <p className="text-sm text-muted-foreground">Upload documents under Documents first, then attach them here.</p> : (
                      <ul className="max-h-56 divide-y overflow-y-auto rounded-2xl border">
                        {refs.data.docs.map((doc) => (
                          <li key={doc.id} className="flex min-h-11 items-center gap-2 px-3 text-sm">
                            <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                            <label className="flex min-h-11 items-center gap-2"><input type="checkbox" className="h-5 w-5" checked={d.docIds.has(doc.id)} disabled={busy || open.status === "archived"}
                              onChange={(e) => run(() => govRpc("meeting_link_document", { _meeting: open.meeting_id, _source: doc.id, _linked: e.target.checked }), e.target.checked ? "Document attached" : "Document removed")} />Attach</label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  <div className="flex flex-col gap-2">
                    {open.status === "draft" && <Button variant="outline" className="h-12 rounded-xl" onClick={() => startEdit(open)}>Edit details</Button>}
                    {(NEXT[open.status] ?? []).map((s) => (
                      <Button key={s.to} className="h-12 rounded-xl" disabled={busy} onClick={() => confirm(s.confirm) && run(() => govRpc("agm_set_status", { _id: open.id, _status: s.to, _reason: null }), AGM_STATUS[s.to]?.label ?? "Updated")}>{s.label}</Button>
                    ))}
                    {open.status === "minutes_published" && draftMinutes?.correction_reason && (
                      <Button variant="outline" className="h-12 rounded-xl" disabled={busy} onClick={() => run(() => govRpc("agm_set_status", { _id: open.id, _status: "minutes_pending", _reason: null }), "Correction sent for review")}>Send correction for review</Button>
                    )}
                    {["draft", "notice_published", "scheduled"].includes(open.status) && (
                      <Button variant="ghost" className="h-12 rounded-xl text-destructive" disabled={busy}
                        onClick={() => askReason("Cancel this AGM", (rs) => run(() => govRpc("agm_set_status", { _id: open.id, _status: "archived", _reason: rs }), "AGM cancelled"))}>Cancel AGM…</Button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!item} onOpenChange={(o) => !o && setItem(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          <SheetHeader><SheetTitle>{item?.id ? "Edit agenda item" : "Add agenda item"}</SheetTitle></SheetHeader>
          {item && (
            <div className="mx-auto max-w-2xl space-y-4 py-4">
              <div><Label htmlFor="i-title">Title *</Label><Input id="i-title" className="h-11" maxLength={200} value={item.title} onChange={(e) => setItem({ ...item, title: e.target.value })} placeholder="Adoption of audited accounts" /></div>
              <div><Label htmlFor="i-desc">Description</Label><Textarea id="i-desc" rows={3} maxLength={3000} value={item.description} onChange={(e) => setItem({ ...item, description: e.target.value })} /></div>
              <div><Label>Type</Label>
                <Select value={item.kind} onValueChange={(v) => setItem({ ...item, kind: v })}><SelectTrigger aria-label="Type" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(AGENDA_KIND).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
              {item.kind === "vote" && <div><Label>Linked formal vote</Label>
                <Select value={item.poll} onValueChange={(v) => setItem({ ...item, poll: v })}><SelectTrigger aria-label="Linked formal vote" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">None</SelectItem>{refs.data?.votes.map((v) => <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>)}</SelectContent></Select></div>}
              {item.kind === "election" && <div><Label>Linked election</Label>
                <Select value={item.election} onValueChange={(v) => setItem({ ...item, election: v })}><SelectTrigger aria-label="Linked election" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">None</SelectItem>{refs.data?.elections.map((v) => <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>)}</SelectContent></Select></div>}
              <div><Label>Supporting document</Label>
                <Select value={item.source} onValueChange={(v) => setItem({ ...item, source: v })}><SelectTrigger aria-label="Supporting document" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">None</SelectItem>{refs.data?.docs.map((v) => <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>)}</SelectContent></Select></div>
              <Button className="h-12 w-full rounded-xl" disabled={busy} onClick={saveItem}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save item"}</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!resForm} onOpenChange={(o) => !o && setResForm(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          <SheetHeader><SheetTitle>Propose a resolution</SheetTitle></SheetHeader>
          {resForm && (
            <div className="mx-auto max-w-2xl space-y-4 py-4">
              <div><Label htmlFor="r-title">Title *</Label><Input id="r-title" className="h-11" maxLength={200} value={resForm.title} onChange={(e) => setResForm({ ...resForm, title: e.target.value })} /></div>
              <div><Label htmlFor="r-body">Resolution text *</Label><Textarea id="r-body" rows={4} maxLength={5000} value={resForm.body} onChange={(e) => setResForm({ ...resForm, body: e.target.value })} placeholder="RESOLVED THAT…" /></div>
              <div><Label>Agenda item</Label>
                <Select value={resForm.agenda} onValueChange={(v) => setResForm({ ...resForm, agenda: v })}><SelectTrigger aria-label="Agenda item" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">None</SelectItem>{d?.agenda.map((a) => <SelectItem key={a.id} value={a.id}>{a.title}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Decided by formal vote (optional)</Label>
                <Select value={resForm.poll} onValueChange={(v) => setResForm({ ...resForm, poll: v })}><SelectTrigger aria-label="Decided by formal vote" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">No — decided at the meeting</SelectItem>{refs.data?.votes.map((v) => <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>)}</SelectContent></Select></div>
              <Button className="h-12 w-full rounded-xl" disabled={busy} onClick={saveRes}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Propose"}</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!minutes} onOpenChange={(o) => !o && setMinutes(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          <SheetHeader><SheetTitle>{published.length ? "Correct the minutes" : "Minutes"}</SheetTitle></SheetHeader>
          {minutes && (
            <div className="mx-auto max-w-2xl space-y-4 py-4">
              {published.length > 0 && <div><Label htmlFor="m-reason">Reason for correction *</Label><Input id="m-reason" className="h-11" maxLength={300} value={minutes.reason} onChange={(e) => setMinutes({ ...minutes, reason: e.target.value })} />
                <p className="mt-1 text-xs text-muted-foreground">The published version stays on record. Your correction becomes a new version.</p></div>}
              <div><Label htmlFor="m-body">Minutes *</Label><Textarea id="m-body" rows={12} maxLength={50000} value={minutes.body} onChange={(e) => setMinutes({ ...minutes, body: e.target.value })} /></div>
              <Button className="h-12 w-full rounded-xl" disabled={busy} onClick={saveMinutes}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save draft"}</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!reason} onOpenChange={(o) => !o && setReason(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader><SheetTitle>{reason?.title}</SheetTitle></SheetHeader>
          <div className="mx-auto max-w-2xl space-y-3 py-4">
            <Label htmlFor="ar-text">Reason *</Label>
            <Textarea id="ar-text" rows={3} maxLength={500} value={reasonText} onChange={(e) => setReasonText(e.target.value)} />
            <p className="text-xs text-muted-foreground">Recorded permanently in the AGM history (10 characters or more).</p>
            <Button className="h-12 w-full rounded-xl" disabled={busy || reasonText.trim().length < 10} onClick={async () => { if (reason && (await reason.action(reasonText))) setReason(null); }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
