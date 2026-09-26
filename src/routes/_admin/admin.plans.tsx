import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Sparkles, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_admin/admin/plans")({
  head: () => ({ meta: [{ title: "Plans — Super Admin" }] }),
  component: PlansAdmin,
});

function PlansAdmin() {
  const { data: plans, isLoading } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async () => (await supabase.from("plans").select("*").order("sort_order")).data ?? [],
  });

  const { data: stats } = useQuery({
    queryKey: ["admin-plan-stats"],
    queryFn: async () => {
      const { data } = await supabase.from("societies").select("plan_id");
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { m[r.plan_id ?? "trial"] = (m[r.plan_id ?? "trial"] ?? 0) + 1; });
      return m;
    },
  });

  return (
    <div className="container-page space-y-6 py-6 md:py-10">
      <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-[28px] md:leading-[34px]">Plans & Pricing</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live plans powering checkout, transaction fees and ad gating.
          </p>
        </div>
        <Button asChild variant="outline" className="rounded-xl">
          <Link to="/pricing">View public page <ArrowRight className="h-4 w-4 ml-1" /></Link>
        </Button>
      </header>

      {isLoading ? (
        <div className="py-12 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {(plans ?? []).map((p: any) => (
            <Card key={p.id} className={`rounded-2xl ${p.is_recommended ? "border-2 border-primary" : ""}`}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-semibold">{p.name}</h3>
                  {p.is_recommended && <Badge className="bg-primary"><Sparkles className="h-3 w-3 mr-1" /> Top</Badge>}
                </div>
                <div className="mt-3 text-3xl font-bold">
                  {p.price_monthly_inr === 0 ? "Free" : `₹${p.price_monthly_inr}`}
                  {p.price_monthly_inr > 0 && <span className="text-sm font-normal text-muted-foreground">/mo</span>}
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-muted-foreground">Txn fee</dt><dd className="font-medium">{p.txn_fee_pct}%</dd>
                  <dt className="text-muted-foreground">Ads</dt><dd className="font-medium">{p.ads_enabled ? "Yes" : "No"}</dd>
                  <dt className="text-muted-foreground">Trial</dt><dd className="font-medium">{p.trial_days || "—"} days</dd>
                  <dt className="text-muted-foreground">Societies</dt><dd className="font-medium">{stats?.[p.id] ?? 0}</dd>
                </dl>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="rounded-2xl bg-muted/40 border-dashed">
        <CardContent className="p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground mb-1">Razorpay integration</p>
          When you connect Razorpay keys, checkout will charge per-plan price and collect the transaction fee on resident payments.
          The 14-day trial requires no card and auto-converts to <strong>Basic</strong> if no plan is chosen.
        </CardContent>
      </Card>
    </div>
  );
}
