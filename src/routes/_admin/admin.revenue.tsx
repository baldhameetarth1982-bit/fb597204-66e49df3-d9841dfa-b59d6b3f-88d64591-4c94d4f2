import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, TrendingUp, Wallet, Megaphone, CreditCard, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_admin/admin/revenue")({
  head: () => ({ meta: [{ title: "Revenue — Super Admin" }] }),
  component: RevenuePage,
});

function fmt(n: number) {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

function RevenuePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-revenue"],
    queryFn: async () => {
      const [summary, societies, plans, ads] = await Promise.all([
        supabase.rpc("admin_platform_summary"),
        supabase.from("societies").select("plan_id, plan_status").eq("plan_status", "active"),
        supabase.from("plans").select("id, price_monthly_inr"),
        supabase.from("ads").select("id, is_active").eq("is_active", true).limit(1),
      ]);
      const priceMap = new Map<string, number>((plans.data ?? []).map((p: any) => [p.id, p.price_monthly_inr ?? 0]));
      let mrr = 0, activePaid = 0;
      for (const s of societies.data ?? []) {
        const price = priceMap.get(s.plan_id ?? "") ?? 0;
        if (price > 0) { mrr += price; activePaid++; }
      }
      return {
        summary: summary.data?.[0] ?? null,
        mrr,
        arr: mrr * 12,
        activePaid,
        activeAds: (ads.data ?? []).length,
      };
    },
  });

  if (isLoading) {
    return <div className="min-h-[40vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const s = data?.summary;

  return (
    <div className="px-6 py-8 space-y-6 max-w-7xl">
      <header className="flex items-center gap-3">
        <BarChart3 className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Platform Revenue</h1>
          <p className="text-sm text-muted-foreground">Live subscription revenue, transaction fees and ad income.</p>
        </div>
      </header>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric title="MRR" value={fmt(data?.mrr ?? 0)} icon={TrendingUp} tone="primary" />
        <Metric title="ARR" value={fmt(data?.arr ?? 0)} icon={TrendingUp} tone="primary" />
        <Metric title="Paid societies" value={String(data?.activePaid ?? 0)} icon={Wallet} />
        <Metric title="Payments 30d" value={fmt(Number(s?.successful_payment_total ?? 0))} icon={CreditCard} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="rounded-2xl">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Wallet className="h-4 w-4" /> Outstanding</div>
            <div className="mt-2 text-3xl font-bold">{fmt(Number(s?.unpaid_bill_total ?? 0))}</div>
            <p className="text-xs text-muted-foreground mt-1">Total unpaid / overdue bills across every society.</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Megaphone className="h-4 w-4" /> Advertisement</div>
            <div className="mt-2 text-3xl font-bold">{data?.activeAds ?? 0} active</div>
            <p className="text-xs text-muted-foreground mt-1">Ad campaigns currently running across the platform.</p>
          </CardContent>
        </Card>
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
        <div>
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
