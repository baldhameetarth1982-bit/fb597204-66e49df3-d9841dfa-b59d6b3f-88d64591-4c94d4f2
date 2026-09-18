import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertCircle, BarChart3, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSocietyId } from "@/hooks/useSocietyId";
import { getFinanceOverview, getReceivablesAgeing } from "@/lib/finance-stage3d.functions";

export const Route = createFileRoute("/_society/society/reports")({
  head: () => ({ meta: [{ title: "Reports — SociyoHub" }] }),
  component: () => <FeatureGate feature="advanced_reports"><ReportsPage /></FeatureGate>,
});

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const initialDate = new Date();

function ReportsPage() {
  const { societyId } = useSocietyId();
  const overviewFn = useServerFn(getFinanceOverview);
  const ageingFn = useServerFn(getReceivablesAgeing);
  const [from, setFrom] = useState(`${initialDate.getFullYear()}-01-01`);
  const [to, setTo] = useState(initialDate.toISOString().slice(0, 10));
  const overview = useQuery({ queryKey: ["finance-report", societyId, from, to], enabled: !!societyId, queryFn: () => overviewFn({ data: { societyId: societyId!, from, to } }), retry: false });
  const ageing = useQuery({ queryKey: ["finance-ageing", societyId, to], enabled: !!societyId, queryFn: () => ageingFn({ data: { societyId: societyId!, asOf: to } }), retry: false });
  const o = overview.data;
  const heroValue = (value: number | undefined) => overview.isSuccess && value !== undefined ? INR.format(value) : "—";

  return <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
    <MobileHero eyebrow="Accounts Center" title="Financial reports" subtitle="Server-authoritative totals from the canonical journal." icon={BarChart3} variant="teal" stats={<StatPillRow><StatPill label="Income" value={heroValue(o?.income)} icon={TrendingUp}/><StatPill label="Expense" value={heroValue(o?.expense)} icon={TrendingDown}/><StatPill label="Net" value={heroValue(o?.net_movement)}/></StatPillRow>}/>
    <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
      <AccountsCenterTabs/>
      <SectionCard title="Report period" description="Maximum two years"><div className="grid grid-cols-2 gap-3"><div><Label>From</Label><Input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div><div><Label>To</Label><Input type="date" value={to} onChange={e=>setTo(e.target.value)}/></div></div></SectionCard>
      {overview.isLoading ? <div className="p-10 grid place-items-center" aria-label="Loading financial report"><Loader2 className="animate-spin"/></div> : overview.error ? <SectionCard title="Report unavailable"><p className="text-sm text-destructive">{(overview.error as Error).message}</p><Button className="mt-3" variant="outline" onClick={()=>void overview.refetch()}>Retry</Button></SectionCard> : <div className="grid sm:grid-cols-2 gap-3"><SectionCard title="Cash"><p className="text-2xl font-bold">{INR.format(o!.cash_balance)}</p></SectionCard><SectionCard title="Bank"><p className="text-2xl font-bold">{INR.format(o!.bank_balance)}</p></SectionCard></div>}
      <SectionCard icon={AlertCircle} title="Receivables ageing" description={`Outstanding bills as of ${to}`} bodyClassName="p-0">
        {ageing.isLoading ? <div className="p-8 grid place-items-center" aria-label="Loading receivables ageing"><Loader2 className="animate-spin"/></div> : ageing.error ? <div className="p-5"><p className="text-sm text-destructive">{(ageing.error as Error).message}</p><Button className="mt-3" variant="outline" onClick={()=>void ageing.refetch()}>Retry</Button></div> : <ListCardGroup>{["current","1_30","31_60","61_90","90_plus"].map(bucket=>{const row=ageing.data?.rows.find(x=>x.bucket===bucket);return <ListCard key={bucket} title={bucket==="current"?"Current":bucket.replace("_","–")+" days"} subtitle={`${row?.bill_count??0} bills`} trailing={<span className="font-semibold">{INR.format(row?.amount??0)}</span>}/>})}</ListCardGroup>}
      </SectionCard>
      <p className="text-xs text-muted-foreground">Legacy ledger rows are intentionally excluded until explicitly reconciled.</p>
    </div>
  </div>;
}