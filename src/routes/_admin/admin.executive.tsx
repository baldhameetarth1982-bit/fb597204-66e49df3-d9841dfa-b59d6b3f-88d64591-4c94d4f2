import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Wallet, Users, Building2, UserCheck, MessageSquare, Receipt, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricGroup, LeadFigure, MetricsSkeleton } from "@/components/shared/MetricGroup";
import { StatusChip } from "@/components/system/StatusChip";
import { ErrorState } from "@/components/system/ErrorState";

export const Route = createFileRoute("/_admin/admin/executive")({
  head: () => ({ meta: [{ title: "Executive Dashboard — Super Admin" }] }),
  component: ExecutiveDashboard,
});

const fmt = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

function ExecutiveDashboard() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["exec-dashboard"],
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      const [summary, plans, socs, visitors30, postsCount, residentsCount] = await Promise.all([
        supabase.rpc("admin_platform_summary"),
        supabase.from("plans").select("id, price_monthly_inr"),
        supabase.from("societies").select("plan_id, plan_status, created_at"),
        supabase.from("visitors").select("id", { count: "exact", head: true }).gte("created_at", since),
        supabase.from("posts").select("id", { count: "exact", head: true }).gte("created_at", since),
        supabase.from("flat_residents").select("id", { count: "exact", head: true }),
      ]);
      if (summary.error) throw summary.error;
      const priceMap = new Map<string, number>((plans.data ?? []).map((p: any) => [p.id, p.price_monthly_inr ?? 0]));
      let mrr = 0;
      let newSocieties30 = 0;
      for (const s of socs.data ?? []) {
        if (s.plan_status === "active") mrr += priceMap.get(s.plan_id ?? "") ?? 0;
        if (s.created_at && new Date(s.created_at).getTime() > Date.now() - 30 * 86400_000) newSocieties30++;
      }
      const total = (socs.data ?? []).length || 1;
      const growth30 = (newSocieties30 / total) * 100;
      return {
        s: (summary.data?.[0] ?? {}) as Record<string, any>,
        mrr, arr: mrr * 12,
        visitors30: visitors30.count ?? 0,
        posts30: postsCount.count ?? 0,
        residents: residentsCount.count ?? 0,
        newSocieties30, growth30,
      };
    },
  });

  const header = <PageHeader title="Executive dashboard" description="Live snapshot across every society." />;

  if (error) return <div className="container-page py-6 md:py-10">{header}<ErrorState title="Couldn't load the dashboard" onRetry={() => refetch()} /></div>;
  if (isLoading || !data) return <div className="container-page py-6 md:py-10">{header}<MetricsSkeleton /></div>;

  const paid = Number(data.s.successful_payment_total ?? 0);
  const unpaid = Number(data.s.unpaid_bill_total ?? 0);
  const collectionPct = paid + unpaid > 0 ? Math.round((paid / (paid + unpaid)) * 100) : 0;

  const signals = [
    { label: "Collection", pts: collectionPct >= 70 ? 25 : collectionPct >= 40 ? 15 : 5, max: 25 },
    { label: "Revenue", pts: data.mrr > 0 ? 25 : 5, max: 25 },
    { label: "Engagement", pts: data.posts30 > 10 ? 20 : data.posts30 > 0 ? 10 : 0, max: 20 },
    { label: "Active societies", pts: (data.s.active_societies ?? 0) > 0 ? 20 : 0, max: 20 },
    { label: "Growth", pts: data.growth30 > 5 ? 10 : 5, max: 10 },
  ];
  const health = Math.min(100, signals.reduce((a, s) => a + s.pts, 0));
  const healthLabel = health >= 85 ? "Excellent" : health >= 70 ? "Good" : health >= 50 ? "Needs attention" : "Critical";
  const healthTone = health >= 70 ? "success" : health >= 50 ? "warning" : "danger";

  return (
    <div className="container-page space-y-6 py-6 md:py-10">
      {header}

      <LeadFigure
        label="Platform health score"
        value={<span>{health}<span className="text-lg font-medium text-muted-foreground"> / 100</span></span>}
        hint={<StatusChip tone={healthTone as any}>{healthLabel}</StatusChip>}
        aside={
          <ul className="grid w-full gap-2 md:w-72">
            {signals.map((s) => (
              <li key={s.label} className="grid grid-cols-[7rem_minmax(0,1fr)_2.5rem] items-center gap-2 text-xs">
                <span className="truncate text-muted-foreground">{s.label}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${s.pts / s.max})` }} />
                </span>
                <span className="text-right tabular-nums">{s.pts}/{s.max}</span>
              </li>
            ))}
          </ul>
        }
      />

      <MetricGroup
        title="Subscription revenue"
        description="Active paid plans"
        cols={3}
        items={[
          { label: "MRR", value: fmt(data.mrr), icon: TrendingUp },
          { label: "ARR", value: fmt(data.arr), icon: TrendingUp },
          { label: "Collection rate", value: collectionPct + "%", icon: Wallet, hint: "Paid vs unpaid bills" },
        ]}
      />

      <MetricGroup
        title="Societies"
        items={[
          { label: "Active", value: String(data.s.active_societies ?? 0), icon: Building2 },
          { label: "On trial", value: String(data.s.trialing_societies ?? 0), icon: Building2 },
          { label: "New · 30 days", value: String(data.newSocieties30), icon: Building2 },
          { label: "Growth · 30 days", value: data.growth30.toFixed(1) + "%", icon: Activity },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <MetricGroup
          title="Community activity"
          cols={3}
          items={[
            { label: "Residents", value: String(data.residents), icon: Users },
            { label: "Visitors · 30d", value: String(data.visitors30), icon: UserCheck },
            { label: "Posts · 30d", value: String(data.posts30), icon: MessageSquare },
          ]}
        />
        <MetricGroup
          title="Maintenance money (all societies)"
          cols={2}
          items={[
            { label: "Payments received", value: fmt(paid), icon: Receipt, hint: "All time" },
            { label: "Outstanding", value: fmt(unpaid), icon: Wallet, hint: "Unpaid bills" },
          ]}
        />
      </div>
    </div>
  );
}
