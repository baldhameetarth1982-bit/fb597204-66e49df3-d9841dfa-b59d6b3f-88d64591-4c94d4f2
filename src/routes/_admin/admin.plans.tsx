import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { ErrorState } from "@/components/system/ErrorState";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";

export const Route = createFileRoute("/_admin/admin/plans")({
  head: () => ({ meta: [{ title: "Plans — Super Admin" }] }),
  component: PlansAdmin,
});

const inr = (n: number) => (n === 0 ? "Free" : `₹${Number(n).toLocaleString("en-IN")}`);

function PlansAdmin() {
  const { data: plans, isLoading, isError, refetch } = useQuery({
    queryKey: ["admin-plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("*").order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
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
  const totalSoc = Object.values(stats ?? {}).reduce((a, b) => a + b, 0);

  return (
    <PageShell>
      <PageHeader
        title="Plans & Pricing"
        description="Live SociyoHub subscription plans and how many societies use each."
        actions={
          <Button asChild variant="outline" className="h-11 rounded-xl">
            <Link to="/pricing">Public pricing page <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        }
      />

      {isLoading ? (
        <div className="h-64 animate-pulse rounded-2xl bg-muted" aria-busy="true" />
      ) : isError ? (
        <ErrorState onRetry={() => refetch()} showSupport={false} />
      ) : (
        <div className="space-y-5">
          {/* Desktop: comparison table */}
          <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Plan</th>
                  <th className="px-4 py-3 text-right font-medium">Monthly</th>
                  <th className="px-4 py-3 text-right font-medium">Txn fee</th>
                  <th className="px-4 py-3 font-medium">Ads</th>
                  <th className="px-4 py-3 text-right font-medium">Trial</th>
                  <th className="px-4 py-3 font-medium">Societies</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(plans ?? []).map((p: any) => {
                  const n = stats?.[p.id] ?? 0;
                  const pct = totalSoc ? Math.round((n / totalSoc) * 100) : 0;
                  return (
                    <tr key={p.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 font-medium">{p.name}{p.is_recommended && <StatusChip tone="primary">Recommended</StatusChip>}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">{inr(p.price_monthly_inr)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.txn_fee_pct}%</td>
                      <td className="px-4 py-3">{p.ads_enabled ? "Yes" : "No"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{p.trial_days ? `${p.trial_days} d` : "—"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
                          <span className="tabular-nums">{n}</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: compact rows */}
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card md:hidden">
            {(plans ?? []).map((p: any) => (
              <li key={p.id} className="px-4 py-3">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{p.name}</span>
                    {p.is_recommended && <StatusChip tone="primary">Top</StatusChip>}
                  </div>
                  <span className="font-semibold tabular-nums">{inr(p.price_monthly_inr)}{p.price_monthly_inr > 0 && <span className="text-xs font-normal text-muted-foreground">/mo</span>}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Fee {p.txn_fee_pct}% · Ads {p.ads_enabled ? "on" : "off"} · Trial {p.trial_days || "—"}d · <span className="tabular-nums">{stats?.[p.id] ?? 0}</span> societies
                </p>
              </li>
            ))}
          </ul>

          <div className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Razorpay is used only for SociyoHub subscriptions. The 14-day trial needs no card and moves to <strong className="text-foreground">Basic</strong> if no plan is chosen.</p>
          </div>
        </div>
      )}
    </PageShell>
  );
}
