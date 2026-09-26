import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Wallet, Megaphone, CreditCard, Building2, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/shared/PageHeader";
import { MetricGroup, LeadFigure, MetricsSkeleton } from "@/components/shared/MetricGroup";
import { ErrorState } from "@/components/system/ErrorState";

export const Route = createFileRoute("/_admin/admin/revenue")({
  head: () => ({ meta: [{ title: "Revenue — Super Admin" }] }),
  component: RevenuePage,
});

const fmt = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

function RevenuePage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-revenue"],
    queryFn: async () => {
      const [summary, societies, plans, ads] = await Promise.all([
        supabase.rpc("admin_platform_summary"),
        supabase.from("societies").select("plan_id, plan_status").eq("plan_status", "active"),
        supabase.from("plans").select("id, price_monthly_inr"),
        supabase.from("ads").select("id, active").eq("active", true),
      ]);
      if (summary.error) throw summary.error;
      const priceMap = new Map<string, number>((plans.data ?? []).map((p: any) => [p.id, p.price_monthly_inr ?? 0]));
      let mrr = 0, activePaid = 0;
      for (const s of societies.data ?? []) {
        const price = priceMap.get(s.plan_id ?? "") ?? 0;
        if (price > 0) { mrr += price; activePaid++; }
      }
      return { summary: summary.data?.[0] ?? null, mrr, arr: mrr * 12, activePaid, activeAds: (ads.data ?? []).length };
    },
  });

  const header = <PageHeader title="Platform revenue" description="SociyoHub subscription income and ad activity." />;
  if (error) return <div className="container-page py-6 md:py-10">{header}<ErrorState title="Couldn't load revenue" onRetry={() => refetch()} /></div>;
  if (isLoading || !data) return <div className="container-page py-6 md:py-10">{header}<MetricsSkeleton /></div>;

  const s: any = data.summary;
  const arpu = data.activePaid > 0 ? data.mrr / data.activePaid : 0;

  return (
    <div className="container-page space-y-6 py-6 md:py-10">
      {header}

      <LeadFigure
        label="Monthly recurring revenue"
        value={fmt(data.mrr)}
        hint={`${fmt(data.arr)} a year from ${data.activePaid} paid ${data.activePaid === 1 ? "society" : "societies"}`}
        aside={
          <Link to="/admin/income" className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-border px-4 text-sm font-medium hover:bg-muted">
            Breakdown by plan <ChevronRight className="h-4 w-4" />
          </Link>
        }
      />

      <MetricGroup
        title="Subscriptions"
        cols={3}
        items={[
          { label: "ARR", value: fmt(data.arr), icon: TrendingUp },
          { label: "Paid societies", value: String(data.activePaid), icon: Building2 },
          { label: "Average per society", value: fmt(arpu), icon: CreditCard, hint: "Per month" },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <MetricGroup
          title="Society maintenance (not SociyoHub income)"
          cols={2}
          items={[
            { label: "Payments recorded", value: fmt(Number(s?.successful_payment_total ?? 0)), icon: Wallet },
            { label: "Outstanding", value: fmt(Number(s?.unpaid_bill_total ?? 0)), icon: Wallet, hint: "Unpaid bills" },
          ]}
        />
        <MetricGroup
          title="Advertising"
          cols={2}
          items={[{ label: "Active campaigns", value: String(data.activeAds), icon: Megaphone, hint: "Running now" }]}
        />
      </div>
    </div>
  );
}
