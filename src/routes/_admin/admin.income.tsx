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
      const [{ data: societies }, { data: payments }, { data: plans }] = await Promise.all([
        supabase.from("societies").select("id, plan_id, status"),
        supabase.from("payments").select("amount, status, created_at, society_id"),
        supabase.from("plans").select("id, name, price_monthly_inr, txn_fee_pct"),
      ]);
      return { societies: societies ?? [], payments: payments ?? [], plans: plans ?? [] };
    },
  });

  const planMap: Record<string, any> = Object.fromEntries((data?.plans ?? []).map((p: any) => [p.id, p]));
  const subRev = (data?.societies ?? []).reduce((s: number, soc: any) => {
    const p = soc.plan_id ? planMap[soc.plan_id] : null;
    return s + (p ? Number(p.price_monthly_inr) : 0);
  }, 0);
  const txnRev = (data?.payments ?? []).reduce((s: number, pmt: any) => {
    if (pmt.status !== "success") return s;
    const soc = (data?.societies ?? []).find((x: any) => x.id === pmt.society_id);
    const plan = soc?.plan_id ? planMap[soc.plan_id] : null;
    const pct = plan ? Number(plan.txn_fee_pct) : 1.5;
    return s + (Number(pmt.amount) * pct) / 100;
  }, 0);

  const total = subRev + txnRev;

  return (
    <div className="px-6 py-8 space-y-6 max-w-5xl">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
          <BarChart3 className="h-7 w-7 text-primary" /> Income & Analytics
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
            {(data?.plans ?? []).map((p: any) => {
              const count = (data?.societies ?? []).filter((s: any) => s.plan_id === p.id).length;
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
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
