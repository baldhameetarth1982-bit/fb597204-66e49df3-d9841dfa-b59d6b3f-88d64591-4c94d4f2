import { useQueries } from "@tanstack/react-query";
import { History, Trophy } from "lucide-react";
import { govRpc, type ElectionResults } from "@/lib/governance";

type Item = { id: string; title: string; status: string };

/**
 * Committee history: who was elected to each post in every published election.
 * Reads only the server-computed published totals (election_results); never ballots.
 */
export function CommitteeHistory({ elections }: { elections: Item[] }) {
  const done = elections.filter((e) => e.status === "results_published" || e.status === "archived").slice(0, 20);
  const results = useQueries({
    queries: done.map((e) => ({
      queryKey: ["election-results", e.id],
      queryFn: () => govRpc<ElectionResults>("election_results", { _election: e.id }),
      staleTime: 60_000,
    })),
  });
  if (!done.length) return null;
  return (
    <section aria-label="Committee history" className="mt-6 space-y-3">
      <h2 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-primary" aria-hidden />Committee history</h2>
      <ul className="space-y-3">
        {done.map((e, i) => {
          const r = results[i]?.data;
          const ts = r?.published_at ? new Date(r.published_at).toLocaleDateString("en-IN") : null;
          return (
            <li key={e.id} className="rounded-2xl border bg-card p-3">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium">{e.title}</span>
                {ts && <span className="shrink-0 text-xs text-muted-foreground">{ts}</span>}
              </div>
              {results[i]?.isLoading ? <p className="mt-1 text-xs text-muted-foreground">Loading…</p>
                : results[i]?.isError || !r || r.hidden ? <p className="mt-1 text-xs text-muted-foreground">Results unavailable.</p>
                : (
                  <dl className="mt-2 space-y-1 text-sm">
                    {(r.posts ?? []).map((p) => {
                      const won = p.candidates.filter((c) => c.outcome === "elected").map((c) => c.name);
                      return (
                        <div key={p.post_id} className="flex flex-wrap gap-x-2">
                          <dt className="text-muted-foreground">{p.post}:</dt>
                          <dd className="flex items-center gap-1 font-medium">
                            {won.length ? <><Trophy className="h-3.5 w-3.5 text-success" aria-hidden />{won.join(", ")}</> : <span className="text-warning-foreground">Undecided</span>}
                          </dd>
                        </div>
                      );
                    })}
                  </dl>
                )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
