import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { localeTag } from "@/lib/i18n";
import { AlertTriangle, Lock, Trophy } from "lucide-react";
import { ListSkeleton, LoadError } from "@/components/people/PeopleUI";
import { cn } from "@/lib/utils";
import { govRpc, type ElectionResults } from "@/lib/governance";

const OUTCOME: Record<string, { label: string; className: string }> = {
  elected: { label: "el.r.elected", className: "bg-success/15 text-success" },
  tied: { label: "el.r.tied", className: "bg-warning/15 text-warning-foreground" },
  unresolved: { label: "el.r.unresolved", className: "bg-warning/15 text-warning-foreground" },
  not_elected: { label: "", className: "" },
};

/** Totals only, computed by the server from submitted ballots. Never shows who chose whom. */
export function ElectionResultsView({ electionId, admin = false }: { electionId: string; admin?: boolean }) {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: ["election-results", electionId],
    queryFn: () => govRpc<ElectionResults>("election_results", { _election: electionId }),
    staleTime: 15_000,
  });
  if (q.isLoading) return <ListSkeleton rows={2} />;
  if (q.isError || !q.data) return <LoadError title={t("el.r.unavailable")} onRetry={() => q.refetch()} />;
  const r = q.data;
  if (r.hidden) {
    return (
      <div className="space-y-2">
        {admin && r.eligible != null && <p className="text-sm tabular-nums">{t("el.r.soFar", { done: r.participated ?? 0, total: r.eligible })}</p>}
        <p className="flex items-center gap-2 rounded-xl bg-muted p-3 text-sm text-muted-foreground"><Lock className="h-4 w-4 shrink-0" aria-hidden />
          {admin ? t("el.r.adminHidden") : t("el.r.residentHidden")}</p>
      </div>
    );
  }
  return (
    <section aria-label={t("el.r.aria")} className="space-y-4">
      <p className="text-sm tabular-nums">{t("el.r.voted", { done: r.participated ?? 0, total: r.eligible ?? 0 })}
        {r.published ? ` · ${t("el.r.published", { date: r.published_at ? new Date(r.published_at).toLocaleDateString(localeTag(), { numberingSystem: "latn" }) : "" })}` : ` · ${t("el.r.notPublished")}`}</p>
      {(r.posts ?? []).map((p) => (
        <div key={p.post_id} className="rounded-2xl border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <h4 className="font-medium">{p.post}</h4>
            <span className="text-xs text-muted-foreground tabular-nums">{t("el.seats", { n: p.seats })} · {t("el.r.validVotes", { n: p.valid_votes })}</span>
          </div>
          {p.state === "unresolved" && (
            <p className="mt-2 flex items-start gap-2 rounded-xl bg-warning/10 p-2 text-xs text-warning-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              {t("el.r.unresolvedNote")}
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
                      {o?.label && <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[11px]", o.className)}>{t(o.label)}</span>}
                    </span>
                    <span className="shrink-0 tabular-nums">{c.votes}</span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full origin-left rtl:origin-right rounded-full bg-primary" style={{ transform: `scaleX(${pct / 100})` }} /></div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {r.hash && <p className="break-all text-[11px] text-muted-foreground">{t("el.r.hash", { hash: r.hash })}</p>}
    </section>
  );
}
