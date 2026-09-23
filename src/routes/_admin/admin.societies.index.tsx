import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, Search, Loader2, ChevronRight, AlertCircle, Users, Home } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { StatusChip } from "@/components/system/StatusChip";
import { saasState, planName, type SaasState } from "@/lib/super-admin-ui";

export const Route = createFileRoute("/_admin/admin/societies/")({
  head: () => ({ meta: [{ title: "Societies — Super Admin · SociyoHub" }, { name: "description", content: "All societies, their plans, trials and status." }] }),
  component: SocietiesPage,
});

type Row = {
  id: string; name: string; city: string | null; plan_id: string | null; plan_status: string | null;
  plan_expires_at: string | null; trial_ends_at: string | null; status: string | null; created_at: string;
  unit_count: number; member_count: number; admin_count: number;
};
type Filter = "all" | "paid" | "trial" | "attention" | "suspended";

function bucket(st: SaasState): Filter {
  if (st.key === "suspended") return "suspended";
  if (st.key === "active") return "paid";
  if (st.key === "trial") return "trial";
  return "attention";
}

function SocietiesPage() {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const query = useQuery({
    queryKey: ["admin-societies-v2"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_societies_v2");
      if (error) throw new Error("load_failed");
      return ((data ?? []) as Row[]).map((r) => ({ ...r, st: saasState(r) }));
    },
    staleTime: 30_000,
  });
  const rows = query.data ?? [];

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: rows.length, paid: 0, trial: 0, attention: 0, suspended: 0 };
    for (const r of rows) c[bucket(r.st)]++;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return rows.filter((r) =>
      (filter === "all" || bucket(r.st) === filter) &&
      (!s || r.name.toLowerCase().includes(s) || (r.city ?? "").toLowerCase().includes(s)),
    );
  }, [rows, q, filter]);

  const chips: { key: Filter; label: string }[] = [
    { key: "all", label: "All" }, { key: "paid", label: "Paid" }, { key: "trial", label: "Trial" },
    { key: "attention", label: "Needs attention" }, { key: "suspended", label: "Suspended" },
  ];

  return (
    <div className="min-h-dvh bg-muted/30 pb-[max(6rem,calc(env(safe-area-inset-bottom)+5rem))]">
      <MobileHero
        eyebrow="Super Admin" title="Societies" icon={Building2} variant="navy"
        subtitle="Plans, trials and lifecycle for every society on SociyoHub."
        stats={
          <StatPillRow>
            <StatPill label="Total" value={query.isLoading ? "—" : counts.all} />
            <StatPill label="Paid" value={query.isLoading ? "—" : counts.paid} />
            <StatPill label="Trial" value={query.isLoading ? "—" : counts.trial} />
            <StatPill label="Attention" value={query.isLoading ? "—" : counts.attention} />
          </StatPillRow>
        }
      />
      <div className="mx-auto max-w-5xl space-y-4 px-4 pt-4">
        <div className="space-y-3 rounded-3xl border bg-card p-3 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search societies" placeholder="Search by name or city" value={q} onChange={(e) => setQ(e.target.value)} className="min-h-11 rounded-xl border-0 bg-muted/60 pl-9" />
          </div>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 no-scrollbar" role="tablist" aria-label="Filter societies">
            {chips.map((c) => (
              <button
                key={c.key} role="tab" aria-selected={filter === c.key} onClick={() => setFilter(c.key)}
                className={`min-h-9 shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors ${filter === c.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"}`}
              >
                {c.label} · {counts[c.key]}
              </button>
            ))}
          </div>
        </div>

        <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
          {query.isLoading ? (
            <div className="divide-y">{[0, 1, 2, 3].map((i) => <div key={i} className="p-4"><Skeleton className="h-12" /></div>)}</div>
          ) : query.error ? (
            <div className="p-8 text-center">
              <AlertCircle className="mx-auto mb-2 h-6 w-6 text-destructive" />
              <p className="font-medium">Couldn't load societies</p>
              <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
              <Button variant="outline" className="mt-3 min-h-11" disabled={query.isFetching} onClick={() => query.refetch()}>
                {query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Retry"}
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {rows.length === 0 ? "No societies have signed up yet." : "No societies match this search or filter."}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {filtered.map((r) => (
                <li key={r.id}>
                  <Link
                    to="/admin/societies/$id" params={{ id: r.id }}
                    className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-4 transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold">{r.name}</span>
                        <StatusChip tone={r.st.tone}>{r.st.label}</StatusChip>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span>Plan <span className="font-medium text-foreground">{planName(r.plan_id)}</span></span>
                        <span className="inline-flex items-center gap-1"><Home className="h-3 w-3" />{r.unit_count} units</span>
                        <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{r.member_count} members</span>
                        {r.city && <span>{r.city}</span>}
                        {r.admin_count === 0 && <span className="font-medium text-warning">No admin</span>}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
