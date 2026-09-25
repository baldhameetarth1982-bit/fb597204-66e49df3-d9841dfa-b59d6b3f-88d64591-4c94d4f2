import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Loader2, Vote, X, Lock, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PageShell, PageHeader } from "@/components/shared/PageHeader";
import { StatusChip, SummaryStrip, ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { SectionLabel } from "@/components/comm/CommUI";
import { commErrorMessage } from "@/lib/notices";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";

export const Route = createFileRoute("/_society/society/polls")({
  head: () => ({
    meta: [
      { title: "Manage polls — SociyoHub" },
      { name: "description", content: "Create society polls, follow results and close voting." },
      { property: "og:title", content: "Manage polls — SociyoHub" },
      { property: "og:description", content: "Create society polls, follow results and close voting." },
    ],
  }),
  component: () => (<FeatureGate feature="polls"><AdminPolls /></FeatureGate>),
});

interface Poll { id: string; title: string; description: string | null; status: string; closes_at: string | null; created_at: string }
interface Opt { id: string; poll_id: string; label: string; position: number }

function AdminPolls() {
  const { user } = useAuth();
  const { societyId } = useSocietyId();
  const [polls, setPolls] = useState<Poll[]>([]);
  const [options, setOptions] = useState<Opt[]>([]);
  const [optVotes, setOptVotes] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [closing, setClosing] = useState<Poll | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({ title: "", description: "", options: ["", ""] });

  async function load() {
    if (!societyId) return;
    setLoading(true); setFailed(false);
    const { data: ps, error } = await supabase
      .from("polls").select("id,title,description,status,closes_at,created_at")
      .eq("society_id", societyId).order("created_at", { ascending: false });
    if (error) { setFailed(true); setLoading(false); return; }
    const list = (ps as Poll[]) ?? [];
    setPolls(list);
    if (list.length) {
      const ids = list.map((p) => p.id);
      // Aggregate counts only — voter identities are never shown.
      const [os, rs] = await Promise.all([
        supabase.from("poll_options").select("id,poll_id,label,position").in("poll_id", ids).order("position"),
        supabase.rpc("poll_results", { _poll_ids: ids }),
      ]);
      if (os.error || rs.error) { setFailed(true); setLoading(false); return; }
      setOptions((os.data as Opt[]) ?? []);
      const c: Record<string, number> = {};
      ((rs.data ?? []) as { option_id: string; votes: number }[]).forEach((r) => { c[r.option_id] = Number(r.votes); });
      setOptVotes(c);
    }
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [societyId]);

  async function createPoll(e: React.FormEvent) {
    e.preventDefault();
    if (!societyId || !user || submitting) return;
    const opts = form.options.map((s) => s.trim()).filter(Boolean);
    if (!form.title.trim() || opts.length < 2) { toast.error("Add a question and at least 2 choices"); return; }
    setSubmitting(true);
    const { data: poll, error } = await supabase.from("polls").insert({
      society_id: societyId, title: form.title.trim(), description: form.description.trim() || null, created_by: user.id,
    }).select("id").single();
    if (error || !poll) { setSubmitting(false); return toast.error(commErrorMessage(error)); }
    const { error: oerr } = await supabase.from("poll_options").insert(opts.map((label, i) => ({ poll_id: poll.id, label, position: i })));
    setSubmitting(false);
    if (oerr) return toast.error(commErrorMessage(oerr));
    toast.success("Poll opened for residents");
    setForm({ title: "", description: "", options: ["", ""] });
    setOpen(false);
    void load();
  }

  async function closePoll(id: string) {
    const { error } = await supabase.from("polls").update({ status: "closed" }).eq("id", id);
    setClosing(null);
    if (error) return toast.error(commErrorMessage(error));
    toast.success("Voting closed");
    void load();
  }

  const isClosed = (p: Poll) => p.status !== "open" || (!!p.closes_at && new Date(p.closes_at) < new Date());
  const live = useMemo(() => polls.filter((p) => !isClosed(p)), [polls]);
  const closed = useMemo(() => polls.filter(isClosed), [polls]);
  const totalFor = (id: string) => options.filter((o) => o.poll_id === id).reduce((s, o) => s + (optVotes[o.id] ?? 0), 0);

  const row = (p: Poll) => {
    const opts = options.filter((o) => o.poll_id === p.id);
    const total = totalFor(p.id);
    const done = isClosed(p);
    const leader = [...opts].sort((a, b) => (optVotes[b.id] ?? 0) - (optVotes[a.id] ?? 0))[0];
    const isOpen = expanded === p.id;
    return (
      <li key={p.id}>
        <div className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_10rem_auto] md:items-center md:gap-4">
          <button type="button" onClick={() => setExpanded(isOpen ? null : p.id)} aria-expanded={isOpen}
            className="flex min-h-11 min-w-0 items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                {done ? <StatusChip tone="muted">Closed</StatusChip> : <StatusChip tone="success">Open for voting</StatusChip>}
                <span className="text-xs text-muted-foreground">Created {new Date(p.created_at).toLocaleDateString()}{p.closes_at ? ` · ${done ? "closed" : "closes"} ${new Date(p.closes_at).toLocaleDateString()}` : ""}</span>
              </span>
              <span className="mt-0.5 block font-medium">{p.title}</span>
            </span>
            <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} aria-hidden />
          </button>
          <p className="text-sm text-muted-foreground md:text-right">
            <span className="font-semibold tabular-nums text-foreground">{total}</span> vote{total === 1 ? "" : "s"}
            {total > 0 && leader && <span className="block truncate text-xs">Leading: {leader.label}</span>}
          </p>
          {!done && (
            <Button variant="outline" className="h-11 rounded-xl" onClick={() => setClosing(p)}>
              <Lock className="mr-1 h-4 w-4" /> Close voting
            </Button>
          )}
        </div>
        {isOpen && (
          <div className="border-t bg-muted/30 px-4 py-3">
            {p.description && <p className="mb-3 text-sm text-muted-foreground">{p.description}</p>}
            <ul className="space-y-2" aria-label="Results">
              {opts.map((o) => {
                const c = optVotes[o.id] ?? 0;
                const pct = total ? Math.round((c / total) * 100) : 0;
                return (
                  <li key={o.id} className="relative overflow-hidden rounded-lg border bg-card px-3 py-2 text-sm">
                    <div className="absolute inset-y-0 left-0 bg-primary/10" style={{ width: `${pct}%` }} aria-hidden />
                    <div className="relative flex justify-between gap-2"><span>{o.label}</span><span className="tabular-nums font-medium">{pct}% · {c}</span></div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">Counts only — who voted is never shown.</p>
          </div>
        )}
      </li>
    );
  };

  return (
    <PageShell>
      <PageHeader
        title="Polls"
        description="Ask residents to vote and follow results."
        actions={
          <Dialog open={open} onOpenChange={(o) => !submitting && setOpen(o)}>
            <DialogTrigger asChild><Button className="h-11 rounded-xl"><Plus className="mr-1 h-4 w-4" /> New poll</Button></DialogTrigger>
            <DialogContent className="max-h-[90dvh] overflow-y-auto">
              <DialogHeader><DialogTitle>New poll</DialogTitle></DialogHeader>
              <form onSubmit={createPoll} className="space-y-4">
                <div className="space-y-1.5"><Label htmlFor="pq">Question</Label>
                  <Input id="pq" className="h-11" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. New paint colour for the lobby" required /></div>
                <div className="space-y-1.5"><Label htmlFor="pd">Details <span className="font-normal text-muted-foreground">(optional)</span></Label>
                  <Textarea id="pd" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Choices</legend>
                  {form.options.map((o, i) => (
                    <div key={i} className="flex gap-2">
                      <Input className="h-11" aria-label={`Choice ${i + 1}`} value={o} placeholder={`Choice ${i + 1}`}
                        onChange={(e) => { const n = [...form.options]; n[i] = e.target.value; setForm({ ...form, options: n }); }} />
                      {form.options.length > 2 && (
                        <Button type="button" size="icon" variant="ghost" className="h-11 w-11" aria-label={`Remove choice ${i + 1}`}
                          onClick={() => setForm({ ...form, options: form.options.filter((_, x) => x !== i) })}><X className="h-4 w-4" /></Button>
                      )}
                    </div>
                  ))}
                  <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => setForm({ ...form, options: [...form.options, ""] })}>
                    <Plus className="mr-1 h-4 w-4" /> Add choice
                  </Button>
                </fieldset>
                <p className="text-xs text-muted-foreground">The poll opens to residents as soon as you create it.</p>
                <Button type="submit" className="h-12 w-full rounded-xl" disabled={submitting}>
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Open poll"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        }
      />

      {loading ? <ListSkeleton rows={4} />
        : failed ? <LoadError title="We couldn't load polls." onRetry={load} />
        : polls.length === 0 ? <ListEmpty icon={Vote} title="No polls yet">Create a poll to ask residents a question.</ListEmpty>
        : (
          <>
            <SummaryStrip items={[
              { label: "Open", value: live.length },
              { label: "Closed", value: closed.length },
              { label: "Votes on open polls", value: live.reduce((s, p) => s + totalFor(p.id), 0) },
              { label: "Total polls", value: polls.length },
            ]} />
            {live.length > 0 && <><SectionLabel count={live.length}>Open for voting</SectionLabel><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{live.map(row)}</ul></>}
            {closed.length > 0 && <><SectionLabel count={closed.length}>Closed</SectionLabel><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{closed.map(row)}</ul></>}
          </>
        )}

      <AlertDialog open={!!closing} onOpenChange={(o) => !o && setClosing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close voting?</AlertDialogTitle>
            <AlertDialogDescription>“{closing?.title}” will stop accepting votes. Residents will see the final results.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Keep open</AlertDialogCancel>
            <AlertDialogAction className="h-11" onClick={() => closing && closePoll(closing.id)}>Close voting</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
