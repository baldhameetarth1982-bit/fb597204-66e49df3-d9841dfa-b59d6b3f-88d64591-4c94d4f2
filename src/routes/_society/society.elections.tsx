import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Vote, Loader2, Plus, Pencil, Trash2, Check, X, Lock, FileText } from "lucide-react";
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
import { govRpc, govError, fmtDateTime, ELECTION_STATUS, NOMINATION_STATUS, ELECTION_ELIGIBILITY, localToIso, isoToLocal } from "@/lib/governance";
import { ElectionResultsView } from "@/components/governance/ElectionResultsView";

export const Route = createFileRoute("/_society/society/elections")({
  head: () => ({
    meta: [
      { title: "Elections — SociyoHub" },
      { name: "description", content: "Run society elections: posts and seats, nominations with review, secret ballots and auditable results." },
      { property: "og:title", content: "Elections — SociyoHub" },
      { property: "og:description", content: "Society elections with nominations, secret ballots and auditable results." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ElectionsAdmin,
});

type Election = {
  id: string; title: string; purpose: string; instructions: string | null; eligibility: string; secret_ballot: boolean; status: string;
  nomination_opens_at: string; nomination_closes_at: string; voting_opens_at: string; voting_closes_at: string;
  rules_source_id: string | null; agm_id: string | null; archive_reason: string | null;
};
type Post = { id: string; election_id: string; seq: number; name: string; seats: number; description: string | null; candidate_rule: string; requirements: string | null };
type Nomination = { id: string; post_id: string; candidate_id: string; candidate_name: string; statement: string | null; status: string; review_reason: string | null; created_at: string };

const PURPOSE: Record<string, string> = { committee: "Managing committee", office_bearers: "Office bearers", by_election: "By-election (vacancy)", other: "Other" };
const RULE: Record<string, string> = { resident: "Any current resident", owner: "Current owners only" };
const EMPTY = { title: "", purpose: "committee", instructions: "", eligibility: "home", secret: true, nomOpen: "", nomClose: "", voteOpen: "", voteClose: "", rules: "none", agm: "none" };
const EMPTY_POST = { id: null as string | null, name: "", seats: "1", description: "", rule: "resident", requirements: "" };

/** Next forward step per state; exceptional paths (reopen) need a reason. */
const NEXT: Record<string, { to: string; label: string; confirm: string }[]> = {
  draft: [{ to: "nomination_open", label: "Open nominations", confirm: "Open nominations? Eligibility, ballot type and posts will be locked, and residents will be notified." }],
  nomination_open: [{ to: "nomination_review", label: "Close nominations for review", confirm: "Stop accepting new nominations and move to review?" }],
  nomination_review: [{ to: "voting_open", label: "Open voting", confirm: "Open voting now? Approved candidates become final and eligible voters are notified." }],
  voting_open: [{ to: "voting_closed", label: "Close voting", confirm: "Close voting now? No more ballots will be accepted." }],
  voting_closed: [{ to: "results_published", label: "Publish results", confirm: "Publish results? They are frozen permanently and shared with residents." }],
  results_published: [{ to: "archived", label: "Archive", confirm: "Archive this election? It stays readable as a record." }],
};

function ElectionsAdmin() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [post, setPost] = useState<typeof EMPTY_POST | null>(null);
  const [reason, setReason] = useState<{ kind: "reject"; id: string } | { kind: "status"; to: string; label: string } | null>(null);
  const [reasonText, setReasonText] = useState("");

  const list = useQuery({
    queryKey: ["admin-elections", societyId],
    enabled: !!societyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("elections").select("*").eq("society_id", societyId!).order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as Election[];
    },
  });
  const refs = useQuery({
    queryKey: ["election-refs", societyId],
    enabled: !!societyId && formOpen,
    queryFn: async () => {
      const [docs, agms] = await Promise.all([
        supabase.from("society_knowledge_sources").select("id,title").eq("society_id", societyId!).is("archived_at", null).neq("kind", "faq").order("title").limit(200),
        supabase.from("agms").select("id,title,financial_year").eq("society_id", societyId!).neq("status", "archived").order("created_at", { ascending: false }).limit(50),
      ]);
      return { docs: (docs.data ?? []) as { id: string; title: string }[], agms: (agms.data ?? []) as { id: string; title: string; financial_year: string }[] };
    },
  });
  const open = list.data?.find((e) => e.id === openId) ?? null;
  const detail = useQuery({
    queryKey: ["admin-election", openId],
    enabled: !!openId,
    queryFn: async () => {
      const [p, n] = await Promise.all([
        supabase.from("election_posts").select("*").eq("election_id", openId!).order("seq"),
        supabase.from("election_nominations").select("id,post_id,candidate_id,candidate_name,statement,status,review_reason,created_at").eq("election_id", openId!).order("created_at"),
      ]);
      if (p.error) throw p.error;
      if (n.error) throw n.error;
      return { posts: (p.data ?? []) as Post[], noms: (n.data ?? []) as Nomination[] };
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin-elections"] }); qc.invalidateQueries({ queryKey: ["admin-election"] }); qc.invalidateQueries({ queryKey: ["election-results"] }); };

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    try { await fn(); toast.success(ok); refresh(); return true; }
    catch (e) { toast.error(govError(e)); return false; }
    finally { setBusy(false); }
  }

  function startEdit(e?: Election) {
    setEditingId(e?.id ?? null);
    setForm(e ? { title: e.title, purpose: e.purpose, instructions: e.instructions ?? "", eligibility: e.eligibility, secret: e.secret_ballot,
      nomOpen: isoToLocal(e.nomination_opens_at), nomClose: isoToLocal(e.nomination_closes_at), voteOpen: isoToLocal(e.voting_opens_at), voteClose: isoToLocal(e.voting_closes_at),
      rules: e.rules_source_id ?? "none", agm: e.agm_id ?? "none" } : EMPTY);
    setFormOpen(true);
  }
  async function save() {
    const ok = await run(() => govRpc("election_save", {
      _id: editingId, _title: form.title, _purpose: form.purpose, _instructions: form.instructions, _eligibility: form.eligibility, _secret: form.secret,
      _nom_open: localToIso(form.nomOpen), _nom_close: localToIso(form.nomClose), _vote_open: localToIso(form.voteOpen), _vote_close: localToIso(form.voteClose),
      _rules_source: form.rules === "none" ? null : form.rules, _agm: form.agm === "none" ? null : form.agm,
    }), editingId ? "Election updated" : "Election saved as draft. Add the posts next.");
    if (ok) setFormOpen(false);
  }
  async function savePost() {
    if (!post || !open) return;
    const ok = await run(() => govRpc("election_post_save", { _election: open.id, _post: post.id, _name: post.name, _seats: Number(post.seats), _description: post.description, _rule: post.rule, _requirements: post.requirements }), "Post saved");
    if (ok) setPost(null);
  }
  async function setStatus(to: string, r: string | null) {
    if (!open) return;
    const ok = await run(() => govRpc("election_set_status", { _id: open.id, _status: to, _reason: r }), ELECTION_STATUS[to]?.label ?? "Updated");
    if (ok) { setReason(null); setReasonText(""); }
  }
  async function submitReason() {
    if (!reason) return;
    if (reason.kind === "reject") {
      const ok = await run(() => govRpc("election_review_nomination", { _nomination: reason.id, _approve: false, _reason: reasonText }), "Nomination not accepted — the candidate is told why");
      if (ok) { setReason(null); setReasonText(""); }
    } else await setStatus(reason.to, reasonText);
  }

  const posts = detail.data?.posts ?? [];
  const noms = detail.data?.noms ?? [];

  return (
    <PageShell>
      <PageHeader title="Elections" description="Committee and office-bearer elections with nominations, review and secret ballots."
        actions={<Button className="rounded-xl min-h-11" onClick={() => startEdit()}><Plus className="h-4 w-4 mr-2" />New election</Button>} />
      {list.isLoading ? <ListSkeleton rows={3} />
        : list.isError ? <LoadError title="We couldn't load elections." onRetry={() => list.refetch()} />
        : !list.data?.length ? <ListEmpty icon={Vote} title="No elections yet">Create an election, add the posts to fill, then open nominations.</ListEmpty>
        : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {list.data.map((e) => (
              <li key={e.id}>
                <button onClick={() => setOpenId(e.id)} className="flex w-full min-h-14 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <Vote className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{e.title}</span>
                    <span className="block text-xs text-muted-foreground">{ELECTION_ELIGIBILITY[e.eligibility]}{e.secret_ballot ? " · Secret ballot" : ""} · voting {fmtDateTime(e.voting_opens_at)}</span>
                  </span>
                  <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-medium", ELECTION_STATUS[e.status]?.className)}>{ELECTION_STATUS[e.status]?.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

      {/* Create / edit (draft only) */}
      <Sheet open={formOpen} onOpenChange={setFormOpen}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          <SheetHeader><SheetTitle>{editingId ? "Edit election" : "New election"}</SheetTitle></SheetHeader>
          <div className="mx-auto max-w-2xl space-y-4 py-4">
            <div><Label htmlFor="e-title">Title *</Label><Input id="e-title" className="h-11" maxLength={140} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Managing Committee Election 2026" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Type</Label>
                <Select value={form.purpose} onValueChange={(v) => setForm({ ...form, purpose: v })}><SelectTrigger aria-label="Type" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(PURPOSE).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Who can vote</Label>
                <Select value={form.eligibility} onValueChange={(v) => setForm({ ...form, eligibility: v })}><SelectTrigger aria-label="Who can vote" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(ELECTION_ELIGIBILITY).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select>
                <p className="mt-1 text-xs text-muted-foreground">Only current residents of an active home can vote. Former residents can't.</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="e-no">Nominations open *</Label><Input id="e-no" type="datetime-local" className="h-11" value={form.nomOpen} onChange={(e) => setForm({ ...form, nomOpen: e.target.value })} /></div>
              <div><Label htmlFor="e-nc">Nominations close *</Label><Input id="e-nc" type="datetime-local" className="h-11" value={form.nomClose} onChange={(e) => setForm({ ...form, nomClose: e.target.value })} /></div>
              <div><Label htmlFor="e-vo">Voting opens *</Label><Input id="e-vo" type="datetime-local" className="h-11" value={form.voteOpen} onChange={(e) => setForm({ ...form, voteOpen: e.target.value })} /></div>
              <div><Label htmlFor="e-vc">Voting closes *</Label><Input id="e-vc" type="datetime-local" className="h-11" value={form.voteClose} onChange={(e) => setForm({ ...form, voteClose: e.target.value })} /></div>
            </div>
            <div><Label htmlFor="e-ins">Instructions for residents</Label><Textarea id="e-ins" rows={3} maxLength={4000} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label>Election rules document</Label>
                <Select value={form.rules} onValueChange={(v) => setForm({ ...form, rules: v })}><SelectTrigger aria-label="Election rules document" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">None</SelectItem>{refs.data?.docs.map((d) => <SelectItem key={d.id} value={d.id}>{d.title}</SelectItem>)}</SelectContent></Select></div>
              <div><Label>Held at AGM</Label>
                <Select value={form.agm} onValueChange={(v) => setForm({ ...form, agm: v })}><SelectTrigger aria-label="Held at AGM" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Not linked</SelectItem>{refs.data?.agms.map((a) => <SelectItem key={a.id} value={a.id}>{a.title} ({a.financial_year})</SelectItem>)}</SelectContent></Select></div>
            </div>
            <label className="flex min-h-11 items-center gap-3 rounded-xl border px-3 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.checked })} />
              <span><span className="block font-medium">Secret ballot</span><span className="block text-xs text-muted-foreground">Nobody, including the committee, can see who voted for whom. Only totals are shown.</span></span>
            </label>
            <Button className="h-12 w-full rounded-xl" disabled={busy} onClick={save}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save draft"}</Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Detail */}
      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          {open && (
            <div className="mx-auto max-w-2xl space-y-5 pb-6">
              <SheetHeader>
                <span className={cn("w-fit rounded px-1.5 py-0.5 text-xs font-medium", ELECTION_STATUS[open.status]?.className)}>{ELECTION_STATUS[open.status]?.label}</span>
                <SheetTitle className="text-left text-xl">{open.title}</SheetTitle>
              </SheetHeader>
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <div><dt className="text-xs text-muted-foreground">Type</dt><dd>{PURPOSE[open.purpose]}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Voting</dt><dd>{ELECTION_ELIGIBILITY[open.eligibility]}{open.secret_ballot ? " · Secret" : " · Open ballot"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Nominations</dt><dd>{fmtDateTime(open.nomination_opens_at)} – {fmtDateTime(open.nomination_closes_at)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Voting window</dt><dd>{fmtDateTime(open.voting_opens_at)} – {fmtDateTime(open.voting_closes_at)}</dd></div>
              </dl>
              {open.instructions && <p className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm">{open.instructions}</p>}
              {open.rules_source_id && <p className="flex items-center gap-2 text-sm text-muted-foreground"><FileText className="h-4 w-4" aria-hidden />Rules document attached (in Documents)</p>}
              {open.status !== "draft" && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" aria-hidden />Eligibility, ballot type and posts are locked.</p>}
              {open.archive_reason && <p className="text-sm text-muted-foreground">Note: {open.archive_reason}</p>}

              {detail.isLoading ? <ListSkeleton rows={2} /> : detail.isError ? <LoadError title="We couldn't load posts." onRetry={() => detail.refetch()} /> : (
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold">Posts and candidates</h3>
                    {open.status === "draft" && <Button size="sm" variant="outline" className="min-h-11 rounded-xl" onClick={() => setPost({ ...EMPTY_POST })}><Plus className="h-4 w-4 mr-1" />Add post</Button>}
                  </div>
                  {!posts.length && <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">No posts yet. Add each post to fill, e.g. Chairman (1 seat) or Committee member (5 seats).</p>}
                  {posts.map((p) => {
                    const pn = noms.filter((n) => n.post_id === p.id);
                    return (
                      <div key={p.id} className="rounded-2xl border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium">{p.name} <span className="text-xs font-normal text-muted-foreground">· {p.seats} {p.seats === 1 ? "seat" : "seats"} · {RULE[p.candidate_rule]}</span></p>
                            {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                            {p.requirements && <p className="text-xs text-muted-foreground">Requirements: {p.requirements}</p>}
                          </div>
                          {open.status === "draft" && (
                            <div className="flex shrink-0">
                              <Button variant="ghost" className="h-11 w-11 p-0" aria-label={`Edit ${p.name}`} onClick={() => setPost({ id: p.id, name: p.name, seats: String(p.seats), description: p.description ?? "", rule: p.candidate_rule, requirements: p.requirements ?? "" })}><Pencil className="h-4 w-4" /></Button>
                              <Button variant="ghost" className="h-11 w-11 p-0" aria-label={`Remove ${p.name}`} disabled={busy} onClick={() => confirm(`Remove ${p.name}?`) && run(() => govRpc("election_post_remove", { _post: p.id }), "Post removed")}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          )}
                        </div>
                        {open.status !== "draft" && (
                          <ul className="mt-2 space-y-2">
                            {!pn.length && <li className="text-xs text-muted-foreground">No nominations yet.</li>}
                            {pn.map((n) => (
                              <li key={n.id} className="rounded-xl bg-muted/50 p-2.5">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate text-sm font-medium">{n.candidate_name}</span>
                                  <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium", NOMINATION_STATUS[n.status]?.className)}>{NOMINATION_STATUS[n.status]?.label}</span>
                                </div>
                                {n.statement && <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{n.statement}</p>}
                                {n.review_reason && <p className="mt-1 text-xs">Reason: {n.review_reason}</p>}
                                {n.status === "pending" && ["nomination_open", "nomination_review"].includes(open.status) && (
                                  <div className="mt-2 flex gap-2">
                                    <Button size="sm" className="min-h-11 flex-1 rounded-xl" disabled={busy} onClick={() => run(() => govRpc("election_review_nomination", { _nomination: n.id, _approve: true, _reason: null }), "Nomination approved")}><Check className="h-4 w-4 mr-1" />Approve</Button>
                                    <Button size="sm" variant="outline" className="min-h-11 flex-1 rounded-xl" disabled={busy} onClick={() => { setReason({ kind: "reject", id: n.id }); setReasonText(""); }}><X className="h-4 w-4 mr-1" />Reject</Button>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                </section>
              )}

              {["voting_open", "voting_closed", "results_published", "archived"].includes(open.status) && (
                <section className="space-y-2"><h3 className="font-semibold">Results</h3><ElectionResultsView electionId={open.id} admin /></section>
              )}

              <div className="flex flex-col gap-2">
                {open.status === "draft" && <Button variant="outline" className="h-12 rounded-xl" onClick={() => startEdit(open)}>Edit details</Button>}
                {(NEXT[open.status] ?? []).map((s) => (
                  <Button key={s.to} className="h-12 rounded-xl" disabled={busy} onClick={() => confirm(s.confirm) && setStatus(s.to, null)}>{s.label}</Button>
                ))}
                {open.status === "nomination_review" && <Button variant="outline" className="h-12 rounded-xl" disabled={busy} onClick={() => { setReason({ kind: "status", to: "nomination_open", label: "Reopen nominations" }); setReasonText(""); }}>Reopen nominations…</Button>}
                {open.status === "voting_closed" && <Button variant="outline" className="h-12 rounded-xl" disabled={busy} onClick={() => { setReason({ kind: "status", to: "voting_open", label: "Reopen voting (correction)" }); setReasonText(""); }}>Reopen voting (correction)…</Button>}
                {open.status === "draft" && <Button variant="ghost" className="h-12 rounded-xl text-destructive" disabled={busy} onClick={() => { setReason({ kind: "status", to: "archived", label: "Cancel election" }); setReasonText(""); }}>Cancel election…</Button>}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Post editor */}
      <Sheet open={!!post} onOpenChange={(o) => !o && setPost(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
          <SheetHeader><SheetTitle>{post?.id ? "Edit post" : "Add post"}</SheetTitle></SheetHeader>
          {post && (
            <div className="mx-auto max-w-2xl space-y-4 py-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
                <div><Label htmlFor="p-name">Post name *</Label><Input id="p-name" className="h-11" maxLength={80} value={post.name} onChange={(e) => setPost({ ...post, name: e.target.value })} placeholder="Treasurer" /></div>
                <div><Label htmlFor="p-seats">Seats *</Label><Input id="p-seats" type="number" min={1} max={25} inputMode="numeric" className="h-11" value={post.seats} onChange={(e) => setPost({ ...post, seats: e.target.value })} /></div>
              </div>
              <div><Label>Who can stand</Label>
                <Select value={post.rule} onValueChange={(v) => setPost({ ...post, rule: v })}><SelectTrigger aria-label="Who can stand" className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(RULE).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent></Select></div>
              <div><Label htmlFor="p-desc">Description</Label><Textarea id="p-desc" rows={2} maxLength={1000} value={post.description} onChange={(e) => setPost({ ...post, description: e.target.value })} /></div>
              <div><Label htmlFor="p-req">Other requirements</Label><Textarea id="p-req" rows={2} maxLength={1000} value={post.requirements} onChange={(e) => setPost({ ...post, requirements: e.target.value })} placeholder="e.g. No outstanding dues (checked by the committee during review)" /></div>
              <Button className="h-12 w-full rounded-xl" disabled={busy} onClick={savePost}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save post"}</Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Reason dialog */}
      <Sheet open={!!reason} onOpenChange={(o) => !o && setReason(null)}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader><SheetTitle>{reason?.kind === "reject" ? "Reject nomination" : reason?.label}</SheetTitle></SheetHeader>
          <div className="mx-auto max-w-2xl space-y-3 py-4">
            <Label htmlFor="r-text">Reason *</Label>
            <Textarea id="r-text" rows={3} maxLength={500} value={reasonText} onChange={(e) => setReasonText(e.target.value)} />
            <p className="text-xs text-muted-foreground">{reason?.kind === "reject" ? "The candidate will see this reason." : "This is recorded permanently in the election history."}</p>
            <Button className="h-12 w-full rounded-xl" disabled={busy || reasonText.trim().length < 5} onClick={submitReason}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm"}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
