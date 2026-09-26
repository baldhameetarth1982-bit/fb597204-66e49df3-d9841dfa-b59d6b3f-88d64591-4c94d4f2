import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Building2, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, EmptyState } from "@/components/shared/PageHeader";
import { MetricGroup, LeadFigure, MetricsSkeleton } from "@/components/shared/MetricGroup";
import { ErrorState } from "@/components/system/ErrorState";

export const Route = createFileRoute("/_admin/admin/income")({
  head: () => ({ meta: [{ title: "Income — Super Admin" }] }),
  component: IncomePage,
});

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function IncomePage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-income"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_income_summary" as any).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const header = <PageHeader title="Income & analytics" description="SociyoHub revenue by source and plan." />;
  if (error) return <div className="container-page py-6 md:py-10">{header}<ErrorState title="Couldn't load income" onRetry={() => refetch()} /></div>;
  if (isLoading) return <div className="container-page py-6 md:py-10">{header}<MetricsSkeleton /></div>;

  const subRev = Number(data?.subscription_mrr ?? 0);
  const collectedTotal = Number(data?.collected_total ?? 0);
  const collected30 = Number(data?.collected_30d ?? 0);
  const total = subRev;
  const plans: any[] = Array.isArray(data?.plans) ? data.plans : [];
  const totalSocieties = plans.reduce((a, p) => a + Number(p.society_count ?? 0), 0);

  return (
    <div className="container-page space-y-6 py-6 md:py-10">
      {header}

      <LeadFigure label="Monthly recurring revenue" value={INR.format(total)} hint={`${totalSocieties} societies across ${plans.length} plans`} />

      <MetricGroup
        title="Verified subscription payments"
        cols={2}
        items={[
          { label: "Last 30 days", value: INR.format(collected30), icon: TrendingUp },
          { label: "All time", value: INR.format(collectedTotal), icon: Layers },
        ]}
      />


      <section className="space-y-2">
        <h2 className="px-1 text-sm font-semibold tracking-tight">Societies by plan</h2>
        {plans.length === 0 ? (
          <EmptyState icon={Building2} title="No plans yet" description="Plans appear here once they are created." />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="hidden grid-cols-[minmax(0,1fr)_8rem_6rem_10rem] gap-4 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground sm:grid">
              <span>Plan</span><span className="text-right">Price / month</span><span className="text-right">Societies</span><span>Share</span>
            </div>
            <ul className="divide-y divide-border">
              {plans.map((p) => {
                const count = Number(p.society_count ?? 0);
                const share = totalSocieties > 0 ? count / totalSocieties : 0;
                return (
                  <li key={p.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_8rem_6rem_10rem]">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground sm:hidden">{INR.format(Number(p.price_monthly_inr ?? 0))}/mo · {p.txn_fee_pct}% fee</p>
                    </div>
                    <p className="hidden text-right text-sm tabular-nums sm:block">{INR.format(Number(p.price_monthly_inr ?? 0))}</p>
                    <p className="text-right text-lg font-semibold tabular-nums">{count}</p>
                    <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${share})` }} />
                      </span>
                      <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{Math.round(share * 100)}%</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}
