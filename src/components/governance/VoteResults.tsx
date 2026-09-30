import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { govRpc } from "@/lib/governance";
import { ListSkeleton } from "@/components/people/PeopleUI";

type Row = { option_id: string; label: string; votes: number | null; total_cast: number; eligible_count: number; visible: boolean };

/** Totals only — computed by the server. Secret ballots reveal totals only after close. */
export function VoteResults({ pollId }: { pollId: string }) {
  const q = useQuery({ queryKey: ["vote-results", pollId], queryFn: () => govRpc<Row[]>("vote_results", { _poll: pollId }), staleTime: 15_000 });
  if (q.isLoading) return <ListSkeleton rows={2} />;
  if (q.isError || !q.data?.length) return <p className="text-sm text-muted-foreground">Results aren't available right now.</p>;
  const first = q.data[0];
  const cast = Number(first.total_cast);
  return (
    <section aria-label="Results" className="space-y-2">
      <p className="text-sm tabular-nums">{cast} of {Number(first.eligible_count)} eligible {cast === 1 ? "vote" : "votes"} cast</p>
      {!first.visible ? (
        <p className="flex items-center gap-2 rounded-xl bg-muted p-3 text-sm text-muted-foreground"><Lock className="h-4 w-4" aria-hidden />Totals appear when voting closes.</p>
      ) : (
        <ul className="space-y-2">
          {q.data.map((r) => {
            const n = Number(r.votes ?? 0);
            const pct = cast ? Math.round((n / cast) * 100) : 0;
            return (
              <li key={r.option_id}>
                <div className="flex justify-between text-sm"><span className="font-medium">{r.label}</span><span className="tabular-nums">{n} · {pct}%</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${pct / 100})` }} /></div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
