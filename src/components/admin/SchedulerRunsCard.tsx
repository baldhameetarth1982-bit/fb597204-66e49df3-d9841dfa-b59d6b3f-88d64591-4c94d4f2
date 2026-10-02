import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type Run = { id: string; job: string; status: string; started_at: string; attempts: number; processed: number; skip_count: number; recovered_count: number; error: string | null };

/** Super Admin view of the shared scheduler run log (RLS: super admins only). */
export function SchedulerRunsCard() {
  const q = useQuery({
    queryKey: ["scheduler-runs"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scheduler_job_runs")
        .select("id,job,status,started_at,attempts,processed,skip_count,recovered_count,error")
        .order("started_at", { ascending: false })
        .limit(12);
      if (error) throw error;
      return (data ?? []) as Run[];
    },
  });
  const stale = (r: Run) => r.status === "running" && Date.now() - new Date(r.started_at).getTime() > 30 * 60_000;
  return (
    <section aria-labelledby="sched-h" className="rounded-xl border bg-card p-4">
      <h2 id="sched-h" className="text-sm font-semibold">Scheduled jobs</h2>
      {q.isLoading ? <p className="mt-2 text-sm text-muted-foreground">Loading…</p>
        : q.isError ? <p className="mt-2 text-sm text-muted-foreground">Couldn't load job history.</p>
        : !q.data?.length ? <p className="mt-2 text-sm text-muted-foreground">No runs recorded yet.</p>
        : (
          <ul className="mt-2 divide-y text-sm">
            {q.data.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate">{r.job} <span className="text-xs text-muted-foreground">{new Date(r.started_at).toLocaleString()}</span></span>
                <span className={r.status === "failed" || stale(r) ? "text-destructive" : "text-muted-foreground"}>
                  {stale(r) ? "stalled" : r.status}{r.attempts > 1 ? ` · try ${r.attempts}` : ""}{r.status === "succeeded" ? ` · ${r.processed} done` : ""}{r.recovered_count > 0 ? " · recovered" : ""}{r.skip_count > 0 ? ` · ${r.skip_count} duplicate skipped` : ""}
                </span>
                {r.status === "failed" && r.error && <span className="w-full truncate text-xs text-muted-foreground">{r.error}</span>}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
