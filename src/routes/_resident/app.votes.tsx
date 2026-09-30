import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Gavel, Loader2, CheckCircle2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { CommPage, CommHeader, SectionLabel } from "@/components/comm/CommUI";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { govRpc, govError, ELIGIBILITY, fmtDateTime } from "@/lib/governance";
import { VoteResults } from "@/components/governance/VoteResults";

export const Route = createFileRoute("/_resident/app/votes")({
  head: () => ({
    meta: [
      { title: "Society Votes — SociyoHub" },
      { name: "description", content: "Cast your vote on formal society decisions and see final results." },
      { property: "og:title", content: "Society Votes — SociyoHub" },
      { property: "og:description", content: "Formal society votes and results." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResidentVotes,
});

type Vote = { id: string; title: string; description: string | null; status: string; closes_at: string; eligibility: string; secret_ballot: boolean };
type Mine = { poll_id: string; voted: boolean; eligible: boolean; my_option: string | null };

function ResidentVotes() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["resident-votes", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("polls").select("id,title,description,status,closes_at,eligibility,secret_ballot")
        .eq("kind", "vote").neq("status", "draft").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      const votes = (data ?? []) as Vote[];
      const ids = votes.map((v) => v.id);
      const [mine, opts] = await Promise.all([
        ids.length ? govRpc<Mine[]>("vote_status_for_me", { _poll_ids: ids }) : Promise.resolve([] as Mine[]),
        ids.length ? supabase.from("poll_options").select("id,poll_id,label,position").in("poll_id", ids).order("position") : Promise.resolve({ data: [] as any[] }),
      ]);
      return { votes, mine: new Map(mine.map((m) => [m.poll_id, m])), options: ((opts as any).data ?? []) as { id: string; poll_id: string; label: string }[] };
    },
  });
  const open = q.data?.votes.find((v) => v.id === openId) ?? null;
  const me = open ? q.data?.mine.get(open.id) : undefined;
  const isOpen = (v: Vote) => v.status === "open" && new Date(v.closes_at) > new Date();

  async function cast() {
    if (!open || !choice) return;
    if (!confirm("Submit your vote? It can't be changed afterwards.")) return;
    setBusy(true);
    try { await govRpc("vote_cast", { _poll: open.id, _option: choice }); toast.success("Your vote is recorded"); setChoice(null); await qc.invalidateQueries({ queryKey: ["resident-votes"] }); qc.invalidateQueries({ queryKey: ["vote-results", open.id] }); }
    catch (e) { toast.error(govError(e)); } finally { setBusy(false); }
  }

  const rows = q.data?.votes ?? [];
  const active = rows.filter(isOpen);
  const closed = rows.filter((v) => !isOpen(v));
  const item = (v: Vote) => {
    const m = q.data?.mine.get(v.id);
    return (
      <li key={v.id}>
        <button onClick={() => { setOpenId(v.id); setChoice(null); }} className="flex w-full min-h-14 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          <Gavel className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          <span className="min-w-0 flex-1"><span className="block truncate font-medium">{v.title}</span>
            <span className="block text-xs text-muted-foreground">{isOpen(v) ? `Closes ${fmtDateTime(v.closes_at)}` : "Voting closed"}{m?.voted ? " · You voted" : isOpen(v) && !m?.eligible ? " · Not eligible" : ""}</span></span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </li>
    );
  };

  return (
    <CommPage>
      <CommHeader title="Votes" subtitle="Formal decisions for your society" />
      {q.isLoading ? <ListSkeleton rows={3} />
        : q.isError ? <LoadError title="We couldn't load votes." onRetry={() => q.refetch()} />
        : rows.length === 0 ? <ListEmpty icon={Gavel} title="No votes yet">Formal society votes will appear here.</ListEmpty>
        : (
          <>
            {active.length > 0 && <><SectionLabel count={active.length}>Voting open</SectionLabel><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{active.map(item)}</ul></>}
            {closed.length > 0 && <><SectionLabel>Closed</SectionLabel><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{closed.map(item)}</ul></>}
          </>
        )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[88vh] max-w-2xl overflow-y-auto rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {open && (
            <div className="space-y-4">
              <SheetHeader><SheetTitle className="text-left text-xl">{open.title}</SheetTitle></SheetHeader>
              {open.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{open.description}</p>}
              <p className="text-xs text-muted-foreground">{ELIGIBILITY[open.eligibility]}{open.secret_ballot ? " · Secret ballot — nobody can see your choice" : ""}</p>
              {isOpen(open) && !me?.voted && me?.eligible && (
                <div role="radiogroup" aria-label="Your choice" className="space-y-2">
                  {q.data?.options.filter((o) => o.poll_id === open.id).map((o) => (
                    <button key={o.id} role="radio" aria-checked={choice === o.id} onClick={() => setChoice(o.id)}
                      className={cn("flex w-full min-h-12 items-center rounded-xl border px-4 text-left text-sm font-medium", choice === o.id ? "border-primary bg-primary/10" : "border-border")}>{o.label}</button>
                  ))}
                  <Button className="h-12 w-full rounded-xl" disabled={!choice || busy} onClick={cast}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit vote"}</Button>
                </div>
              )}
              {me?.voted && <p className="flex items-center gap-2 rounded-xl bg-success/10 p-3 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />Your vote is recorded{!open.secret_ballot && me.my_option ? `: ${q.data?.options.find((o) => o.id === me.my_option)?.label}` : ""}.</p>}
              {isOpen(open) && !me?.voted && !me?.eligible && <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">{open.eligibility === "home" ? "Someone from your home has already voted, or you have no active home here." : "You aren't eligible for this vote."}</p>}
              <VoteResults pollId={open.id} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </CommPage>
  );
}
