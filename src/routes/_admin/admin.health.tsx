import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, EmptyState } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/system/ErrorState";
import { StatusChip } from "@/components/system/StatusChip";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_admin/admin/health")({
  head: () => ({ meta: [{ title: "Society Health — Super Admin" }] }),
  component: HealthPage,
});

type Row = {
  id: string; name: string; score: number; label: string;
  paid: number; unpaid: number; residents: number; complaints: number; planActive: boolean;
};

function scoreFor(paid: number, unpaid: number, residents: number, complaints: number, planActive: boolean): number {
  let s = 0;
  const total = paid + unpaid;
  const collection = total > 0 ? paid / total : 0;
  s += collection >= 0.8 ? 30 : collection >= 0.5 ? 20 : collection >= 0.2 ? 10 : 0;
  s += residents >= 30 ? 25 : residents >= 10 ? 15 : residents > 0 ? 8 : 0;
  s += complaints <= 5 ? 20 : complaints <= 20 ? 10 : 0;
  s += planActive ? 25 : 5;
  return Math.min(100, s);
}
function labelFor(n: number) {
  if (n >= 85) return "Excellent";
  if (n >= 70) return "Good";
  if (n >= 50) return "Needs attention";
  return "Critical";
}

function HealthPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-health"],
    queryFn: async () => {
      const [socs, bills, resAgg, posts] = await Promise.all([
        supabase.rpc("admin_list_societies"),
        supabase.from("bills").select("society_id, amount, status"),
        supabase.from("flat_residents").select("flat_id, flats!inner(society_id)"),
        supabase.from("posts").select("society_id"),
      ]);
      if (socs.error || bills.error || resAgg.error || posts.error) throw new Error("health_load_failed");
      const paidBy = new Map<string, number>();
      const unpaidBy = new Map<string, number>();
      for (const b of bills.data ?? []) {
        if (!b.society_id) continue;
        if (b.status === "paid") paidBy.set(b.society_id, (paidBy.get(b.society_id) ?? 0) + Number(b.amount ?? 0));
        else if (b.status === "unpaid" || b.status === "overdue") unpaidBy.set(b.society_id, (unpaidBy.get(b.society_id) ?? 0) + Number(b.amount ?? 0));
      }
      const residentsBy = new Map<string, number>();
      for (const r of (resAgg.data ?? []) as any[]) {
        const sid = r.flats?.society_id;
        if (sid) residentsBy.set(sid, (residentsBy.get(sid) ?? 0) + 1);
      }
      const postsBy = new Map<string, number>();
      for (const p of (posts.data ?? []) as any[]) {
        if (p.society_id) postsBy.set(p.society_id, (postsBy.get(p.society_id) ?? 0) + 1);
      }
      return (socs.data ?? []).map((s: any): Row => {
        const paid = paidBy.get(s.id) ?? 0;
        const unpaid = unpaidBy.get(s.id) ?? 0;
        const residents = residentsBy.get(s.id) ?? 0;
        const complaints = postsBy.get(s.id) ?? 0;
        const planActive = s.plan_status === "active";
        const score = scoreFor(paid, unpaid, residents, complaints, planActive);
        return { id: s.id, name: s.name, score, label: labelFor(score), paid, unpaid, residents, complaints, planActive };
      });
    },
  });

  const [filter, setFilter] = useState<string>("all");
  const rows = useMemo(() => (data ?? []).slice().sort((a, b) => a.score - b.score), [data]);
  const labels = ["Critical", "Needs attention", "Good", "Excellent"];
  const byLabel = Object.fromEntries(labels.map((l) => [l, rows.filter((r) => r.label === l).length]));
  const shown = filter === "all" ? rows : rows.filter((r) => r.label === filter);
  const tone = (l: string) => (l === "Excellent" || l === "Good" ? "success" : l === "Needs attention" ? "warning" : "danger") as "success" | "warning" | "danger";

  return (
    <div className="container-page space-y-6 py-6 md:py-10">
      <PageHeader title="Society health" description="Weakest societies first, so you can see who needs help." />

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4" role="tablist" aria-label="Filter by rating">
        {labels.map((l) => (
          <button
            key={l}
            role="tab"
            aria-selected={filter === l}
            onClick={() => setFilter(filter === l ? "all" : l)}
            className={cn("min-w-0 bg-card p-4 text-left hover:bg-muted/60", filter === l && "bg-primary/5 ring-2 ring-inset ring-primary")}
          >
            <StatusChip tone={tone(l)}>{l}</StatusChip>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{byLabel[l]}</p>
          </button>
        ))}
      </div>

      {error ? (
        <ErrorState title="Couldn't load society health" onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div>
      ) : shown.length === 0 ? (
        <EmptyState icon={Heart} title={filter === "all" ? "No societies yet" : `No societies rated ${filter}`} />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {shown.map((r) => {
            const total = r.paid + r.unpaid;
            const pct = total > 0 ? Math.round((r.paid / total) * 100) : 0;
            return (
              <li key={r.id}>
                <Link to="/admin/societies/$id" params={{ id: r.id }} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-muted/60">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-muted text-base font-semibold tabular-nums">{r.score}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {pct}% collected · {r.residents} residents · {r.complaints} posts · plan {r.planActive ? "active" : "inactive"}
                    </span>
                  </span>
                  <StatusChip tone={tone(r.label)} className="hidden sm:inline-flex">{r.label}</StatusChip>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
