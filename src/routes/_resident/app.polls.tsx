import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Vote, CheckCircle2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { commErrorMessage } from "@/lib/notices";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { StatusChip, ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { CommPage, CommHeader, SectionLabel } from "@/components/comm/CommUI";

export const Route = createFileRoute("/_resident/app/polls")({
  head: () => ({
    meta: [
      { title: "Polls — SociyoHub" },
      { name: "description", content: "Vote on your society's decisions." },
      { property: "og:title", content: "Polls — SociyoHub" },
      { property: "og:description", content: "Vote on your society's decisions." },
    ],
  }),
  component: PollsPage,
});

interface Poll { id: string; title: string; description: string | null; status: string; closes_at: string | null }
interface Opt { id: string; poll_id: string; label: string; position: number }
interface Count { poll_id: string; option_id: string; votes: number }

function PollsPage() {
  const { user } = useAuth();
  const [polls, setPolls] = useState<Poll[]>([]);
  const [options, setOptions] = useState<Opt[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [mine, setMine] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [voting, setVoting] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true); setFailed(false);
    const { data: ps, error } = await supabase.from("polls").select("id,title,description,status,closes_at").order("created_at", { ascending: false });
    if (error) { setFailed(true); setLoading(false); return; }
    const list = (ps as Poll[]) ?? [];
    setPolls(list);
    if (list.length) {
      const ids = list.map((p) => p.id);
      const [os, vs, rs] = await Promise.all([
        supabase.from("poll_options").select("id,poll_id,label,position").in("poll_id", ids).order("position"),
        // Own votes only (RLS); aggregate counts come from poll_results — no voter identities.
        supabase.from("poll_votes").select("poll_id,option_id").in("poll_id", ids),
        supabase.rpc("poll_results", { _poll_ids: ids }),
      ]);
      if (os.error || vs.error || rs.error) { setFailed(true); setLoading(false); return; }
      setOptions((os.data as Opt[]) ?? []);
      const m = new Map<string, string>();
      if (user) for (const v of (vs.data ?? []) as { poll_id: string; option_id: string }[]) m.set(v.poll_id, v.option_id);
      setMine(m);
      setCounts(((rs.data ?? []) as Count[]).map((r) => ({ ...r, votes: Number(r.votes) })));
    } else { setOptions([]); setCounts([]); setMine(new Map()); }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function castVote(pollId: string) {
    const optionId = picked[pollId];
    if (!user || voting || !optionId) return;
    setVoting(pollId);
    const { error } = await supabase.rpc("poll_cast_vote", { _poll: pollId, _option: optionId });
    setVoting(null);
    if (error) { toast.error(commErrorMessage(error)); void load(); return; }
    toast.success("Vote recorded");
    void load();
  }

  const isClosed = (p: Poll) => p.status !== "open" || (!!p.closes_at && new Date(p.closes_at) < new Date());
  const open = useMemo(() => polls.filter((p) => !isClosed(p)), [polls]);
  const closed = useMemo(() => polls.filter(isClosed), [polls]);
  const needVote = open.filter((p) => !mine.has(p.id));
  const voted = open.filter((p) => mine.has(p.id));

  const card = (p: Poll) => {
    const opts = options.filter((o) => o.poll_id === p.id);
    const pc = counts.filter((c) => c.poll_id === p.id);
    const total = pc.reduce((s, c) => s + c.votes, 0);
    const my = mine.get(p.id);
    const done = isClosed(p);
    const showResults = !!my || done;
    return (
      <article key={p.id} className="rounded-2xl border border-border bg-card p-4 md:p-5">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          {done ? <StatusChip tone="muted">Closed</StatusChip> : my ? <StatusChip tone="success">You voted</StatusChip> : <StatusChip tone="primary">Open · your vote needed</StatusChip>}
          {p.closes_at && <span className="text-xs text-muted-foreground">{done ? "Closed" : "Closes"} {new Date(p.closes_at).toLocaleDateString()}</span>}
        </div>
        <h3 className="text-lg font-semibold leading-snug">{p.title}</h3>
        {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}

        {showResults ? (
          <ul className="mt-4 space-y-2" aria-label="Results">
            {opts.map((o) => {
              const c = pc.find((x) => x.option_id === o.id)?.votes ?? 0;
              const pct = total ? Math.round((c / total) * 100) : 0;
              const isMine = my === o.id;
              return (
                <li key={o.id} className={cn("relative overflow-hidden rounded-xl border px-3 py-3", isMine ? "border-primary" : "border-border")}>
                  <div className={cn("absolute inset-y-0 left-0", isMine ? "bg-primary/15" : "bg-muted")} style={{ width: `${pct}%` }} aria-hidden />
                  <div className="relative flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-2 font-medium">{isMine && <CheckCircle2 className="h-4 w-4 text-primary" aria-label="Your choice" />}{o.label}</span>
                    <span className="tabular-nums font-semibold">{pct}% <span className="font-normal text-muted-foreground">· {c}</span></span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <fieldset className="mt-4">
            <legend className="sr-only">Choose one option</legend>
            <div className="space-y-2">
              {opts.map((o) => {
                const sel = picked[p.id] === o.id;
                return (
                  <label key={o.id} className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm font-medium transition-colors",
                    sel ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60")}>
                    <input type="radio" name={`poll-${p.id}`} className="h-5 w-5 accent-[hsl(var(--primary))]" checked={sel}
                      onChange={() => setPicked((s) => ({ ...s, [p.id]: o.id }))} />
                    {o.label}
                  </label>
                );
              })}
            </div>
            <Button className="mt-3 h-12 w-full rounded-xl text-base" disabled={!picked[p.id] || voting === p.id} onClick={() => castVote(p.id)}>
              {voting === p.id ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Recording vote…</> : picked[p.id] ? "Submit vote" : "Choose an option to vote"}
            </Button>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3 w-3" aria-hidden />One vote per person. Results show after you vote; names are never shown.</p>
          </fieldset>
        )}
        {showResults && <p className="mt-3 text-xs text-muted-foreground">{total} vote{total === 1 ? "" : "s"} in total</p>}
      </article>
    );
  };

  return (
    <CommPage>
      <CommHeader title="Polls" subtitle="Vote on community decisions" />
      {loading ? <ListSkeleton rows={3} />
        : failed ? <LoadError title="We couldn't load polls." onRetry={load} />
        : polls.length === 0 ? <ListEmpty icon={Vote} title="No polls yet">When your committee opens a poll, it will appear here.</ListEmpty>
        : (
          <>
            {needVote.length > 0 && <><SectionLabel count={needVote.length}>Needs your vote</SectionLabel><div className="space-y-3">{needVote.map(card)}</div></>}
            {voted.length > 0 && <><SectionLabel>Open — you've voted</SectionLabel><div className="space-y-3">{voted.map(card)}</div></>}
            {closed.length > 0 && <><SectionLabel>Closed</SectionLabel><div className="space-y-3">{closed.map(card)}</div></>}
          </>
        )}
    </CommPage>
  );
}
