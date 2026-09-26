import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Wallet, Building2, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_admin/admin/income")({
  head: () => ({ meta: [{ title: "Income — Super Admin" }] }),
  component: IncomePage,
});

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function IncomePage() {
  const { data } = useQuery({
    queryKey: ["admin-income"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_income_summary" as any).maybeSingle();
      if (error) throw error;
      return data as any;
    },
  });

  const subRev = Number(data?.subscription_mrr ?? 0);
  const txnRev = Number(data?.transaction_fee_revenue ?? 0);
  const total = Number(data?.total_revenue ?? subRev + txnRev);
  const plans = Array.isArray(data?.plans) ? data.plans : [];

  return (
    <div className="container-page space-y-6 py-6 md:py-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight md:text-[28px] md:leading-[34px]">Income & Analytics
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Platform-wide revenue summary.</p>
      </header>

      <div className="grid sm:grid-cols-3 gap-4">
        <Stat icon={Wallet} title="Total revenue (MRR)" value={INR.format(total)} tone="primary" />
        <Stat icon={TrendingUp} title="Subscriptions" value={INR.format(subRev)} tone="emerald" />
        <Stat icon={Building2} title="Transaction fees" value={INR.format(txnRev)} tone="violet" />
      </div>

      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-base">Societies by plan</CardTitle></CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-3">
            {plans.map((p: any) => {
              const count = Number(p.society_count ?? 0);
              return (
                <div key={p.id} className="flex items-center justify-between rounded-xl border p-3">
                  <div>
                    <p className="font-medium">{p.name}</p>
                    <p className="text-xs text-muted-foreground">₹{p.price_monthly_inr}/mo · {p.txn_fee_pct}% fee</p>
                  </div>
                  <p className="text-2xl font-bold tabular-nums">{count}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, title, value, tone }: any) {
  const toneCls = tone === "emerald" ? "bg-emerald-500/10 text-emerald-500"
    : tone === "violet" ? "bg-violet-500/10 text-violet-500" : "bg-primary/10 text-primary";
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5">
        <div className={`h-10 w-10 rounded-xl grid place-items-center ${toneCls} mb-3`}><Icon className="h-5 w-5" /></div>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
