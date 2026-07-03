import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Wallet, Users, Building2, UserCheck, MessageSquare, Receipt, Loader2, Activity } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_admin/admin/executive")({
  head: () => ({ meta: [{ title: "Executive Dashboard — Super Admin" }] }),
  component: ExecutiveDashboard,
});

const fmt = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

function ExecutiveDashboard() {
  const { data, isLoading } = useQuery({
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

  if (isLoading || !data) return <div className="min-h-[40vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const collectionPct = (() => {
    const paid = Number(data.s.successful_payment_total ?? 0);
    const unpaid = Number(data.s.unpaid_bill_total ?? 0);
    const denom = paid + unpaid;
    return denom > 0 ? Math.round((paid / denom) * 100) : 0;
  })();

  const health = (() => {
    let score = 0;
    if (collectionPct >= 70) score += 25; else if (collectionPct >= 40) score += 15; else score += 5;
    if (data.mrr > 0) score += 25; else score += 5;
    if (data.posts30 > 10) score += 20; else if (data.posts30 > 0) score += 10;
    if ((data.s.active_societies ?? 0) > 0) score += 20;
    if (data.growth30 > 5) score += 10; else score += 5;
    return Math.min(100, score);
  })();

  const healthLabel = health >= 85 ? "Excellent" : health >= 70 ? "Good" : health >= 50 ? "Needs attention" : "Critical";
  const healthTone = health >= 70 ? "text-emerald-600" : health >= 50 ? "text-amber-600" : "text-destructive";

  return (
    <div className="px-6 py-8 space-y-6 max-w-7xl">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
          <TrendingUp className="h-7 w-7 text-primary" /> Executive Dashboard
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Live snapshot across every society.</p>
      </header>

      <Card className="rounded-2xl border-primary/30">
        <CardContent className="p-6 flex items-center gap-6">
          <div className="h-16 w-16 rounded-2xl bg-primary text-primary-foreground grid place-items-center text-3xl font-bold">
            {health}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Platform health score</p>
            <p className={`text-2xl font-bold ${healthTone}`}>{healthLabel}</p>
            <p className="text-xs text-muted-foreground">Composite of collection, revenue, engagement and growth signals.</p>
          </div>
        </CardContent>
      </Card>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric title="MRR" value={fmt(data.mrr)} icon={TrendingUp} tone="primary" />
        <Metric title="ARR" value={fmt(data.arr)} icon={TrendingUp} tone="primary" />
        <Metric title="Collection rate" value={collectionPct + "%"} icon={Wallet} />
        <Metric title="Growth 30d" value={data.growth30.toFixed(1) + "%"} icon={Activity} />
        <Metric title="Active societies" value={String(data.s.active_societies ?? 0)} icon={Building2} />
        <Metric title="Trials" value={String(data.s.trialing_societies ?? 0)} icon={Building2} />
        <Metric title="Residents" value={String(data.residents)} icon={Users} />
        <Metric title="Visitors 30d" value={String(data.visitors30)} icon={UserCheck} />
        <Metric title="Complaints/Posts 30d" value={String(data.posts30)} icon={MessageSquare} />
        <Metric title="Payments (all-time)" value={fmt(Number(data.s.successful_payment_total ?? 0))} icon={Receipt} />
        <Metric title="Outstanding" value={fmt(Number(data.s.unpaid_bill_total ?? 0))} icon={Wallet} />
        <Metric title="New societies 30d" value={String(data.newSocieties30)} icon={Building2} />
      </div>
    </div>
  );
}

function Metric({ title, value, icon: Icon, tone }: { title: string; value: string; icon: any; tone?: "primary" }) {
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`h-10 w-10 rounded-xl grid place-items-center ${tone === "primary" ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold tabular-nums truncate">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
