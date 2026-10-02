import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Lock, Trophy } from "lucide-react";
import { ListSkeleton, LoadError } from "@/components/people/PeopleUI";
import { cn } from "@/lib/utils";
import { govRpc, type ElectionResults } from "@/lib/governance";

const OUTCOME: Record<string, { label: string; className: string }> = {
  elected: { label: "Elected", className: "bg-success/15 text-success" },
  tied: { label: "Tied", className: "bg-warning/15 text-warning-foreground" },
  unresolved: { label: "Unresolved", className: "bg-warning/15 text-warning-foreground" },
  not_elected: { label: "", className: "" },
};

/** Totals only, computed by the server from submitted ballots. Never shows who chose whom. */
export function ElectionResultsView({ electionId, admin = false }: { electionId: string; admin?: boolean }) {
  const q = useQuery({
    queryKey: ["election-results", electionId],
    queryFn: () => govRpc<ElectionResults>("election_results", { _election: electionId }),
    staleTime: 15_000,
  });
  if (q.isLoading) return <ListSkeleton rows={2} />;
  if (q.isError || !q.data) return <LoadError title="Results aren't available right now." onRetry={() => q.refetch()} />;
  const r = q.data;
  if (r.hidden) {
    return (
      <div className="space-y-2">
        {admin && r.eligible != null && <p className="text-sm tabular-nums">{r.participated ?? 0} of {r.eligible} eligible voted so far</p>}
        <p className="flex items-center gap-2 rounded-xl bg-muted p-3 text-sm text-muted-foreground"><Lock className="h-4 w-4 shrink-0" aria-hidden />
          {admin ? "Totals appear when voting closes." : "Results appear once the committee publishes them."}</p>
      </div>
    );
  }
  return (
    <section aria-label="Election results" className="space-y-4">
      <p className="text-sm tabular-nums">{r.participated ?? 0} of {r.eligible ?? 0} eligible voted
        {r.published ? ` · Published ${r.published_at ? new Date(r.published_at).toLocaleDateString("en-IN") : ""}` : " · Not yet published"}</p>
      {(r.posts ?? []).map((p) => (
        <div key={p.post_id} className="rounded-2xl border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="font-medium">{p.post}</h4>
            <span className="text-xs text-muted-foreground tabular-nums">{p.seats} {p.seats === 1 ? "seat" : "seats"} · {p.valid_votes} valid votes</span>
          </div>
          {p.state === "unresolved" && (
            <p className="mt-2 flex items-start gap-2 rounded-xl bg-warning/10 p-2 text-xs text-warning-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              No winner could be decided for every seat (a tie, or not enough votes). Nobody is picked automatically — the committee should follow the society's bye-laws, for example a tie-break vote at the next meeting, and record the decision as a resolution.
            </p>
          )}
          <ul className="mt-2 space-y-1.5">
            {p.candidates.map((c) => {
              const pct = p.valid_votes ? Math.round((c.votes / p.valid_votes) * 100) : 0;
              const o = OUTCOME[c.outcome];
              return (
                <li key={c.nomination_id}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-1.5 font-medium">
                      {c.outcome === "elected" && <Trophy className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />}
                      <span className="truncate">{c.name}</span>
                      {o?.label && <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px]", o.className)}>{o.label}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">{c.votes}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${pct / 100})` }} /></div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {r.hash && <p className="break-all text-[11px] text-muted-foreground">Result fingerprint: {r.hash}</p>}
    </section>
  );
}
