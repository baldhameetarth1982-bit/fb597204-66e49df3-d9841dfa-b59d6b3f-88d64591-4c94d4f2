import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Lock, Loader2, PieChart, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSocietyId } from "@/hooks/useSocietyId";
import { getResidentFinanceTransparency } from "@/lib/finance-stage3d.functions";
import { toSafeFinanceError } from "@/lib/finance-safe-error";

export const Route = createFileRoute("/_resident/app/trust")({
  head: () => ({ meta: [
    { title: "Financial Trust — SociyoHub" },
    { name: "description", content: "View privacy-controlled society income, expenses, and recent canonical transactions." },
    { property: "og:title", content: "Financial Trust — SociyoHub" },
    { property: "og:description", content: "Privacy-controlled society finances sourced from the canonical journal." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: TrustScreen,
});

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const today = () => new Date().toISOString().slice(0, 10);
const yearAgo = () => { const date = new Date(); date.setFullYear(date.getFullYear() - 1); return date.toISOString().slice(0, 10); };

function TrustScreen() {
  const { societyId } = useSocietyId();
  const transparencyFn = useServerFn(getResidentFinanceTransparency);
  const report = useQuery({
    queryKey: ["resident-finance-transparency", societyId],
    enabled: !!societyId,
    queryFn: () => transparencyFn({ data: { societyId: societyId!, from: yearAgo(), to: today(), limit: 20 } }),
    retry: false,
  });

  return <div className="px-5 py-6 space-y-5 pb-24">
    <header className="space-y-2">
      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold"><ShieldCheck className="h-3.5 w-3.5"/> Verified transparency</div>
      <h1 className="text-2xl font-semibold tracking-tight">Financial Trust</h1>
      <p className="text-sm text-muted-foreground">A privacy-controlled view sourced from your society&apos;s canonical journal.</p>
    </header>

    {!societyId ? <StateCard title="Society unavailable" message="Your active society could not be determined."/> : report.isLoading ? <div className="text-center py-10" role="status" aria-label="Loading financial transparency"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground"/></div> : report.error ? (() => { const safe = toSafeFinanceError(report.error, typeof navigator === "undefined" || navigator.onLine); return <StateCard title={safe.title} message={safe.message} action={safe.retryable ? <Button variant="outline" className="min-h-11" disabled={report.isFetching} onClick={()=>void report.refetch()}>{report.isFetching ? "Retrying…" : "Retry"}</Button> : undefined}/>; })() : report.data ? <>
      <Card className="rounded-3xl border-0 shadow-md bg-gradient-to-br from-primary to-primary/85 text-primary-foreground"><CardContent className="p-6">
        <p className="text-xs uppercase tracking-wider opacity-80">Net movement · last 12 months</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums">{fmt.format(report.data.net_movement)}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm"><div className="rounded-xl bg-background/15 p-3"><p className="text-xs opacity-80 flex items-center gap-1"><TrendingUp className="h-3 w-3"/> Income</p><p className="font-semibold tabular-nums">{fmt.format(report.data.income)}</p></div><div className="rounded-xl bg-background/15 p-3"><p className="text-xs opacity-80 flex items-center gap-1"><TrendingDown className="h-3 w-3"/> Expense</p><p className="font-semibold tabular-nums">{fmt.format(report.data.expense)}</p></div></div>
      </CardContent></Card>

      <Card className="rounded-2xl border-success/20 bg-success/5"><CardContent className="p-4 flex items-start gap-3"><Lock className="h-5 w-5 text-success mt-0.5 shrink-0"/><div className="text-sm"><p className="font-semibold">Privacy-controlled details</p><p className="text-muted-foreground text-xs mt-0.5">Your society selected {report.data.visibility} visibility. Internal identifiers, references, and vendor contacts are never shown here.</p></div></CardContent></Card>

      <Card className="rounded-2xl"><CardContent className="p-4"><div className="flex items-center gap-2 mb-3"><PieChart className="h-4 w-4 text-muted-foreground"/><p className="text-sm font-semibold">Spending breakdown</p><Badge variant="secondary" className="ml-auto rounded-full text-[10px]">12mo</Badge></div>{report.data.categories.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No posted expenses in this period</p> : <div className="space-y-3">{report.data.categories.map(item=>{const pct=report.data.expense ? Math.round(item.amount/report.data.expense*100) : 0;return <div key={item.category}><div className="flex justify-between text-xs mb-1"><span className="font-medium">{item.category}</span><span className="text-muted-foreground tabular-nums">{fmt.format(item.amount)} · {pct}%</span></div><div className="h-2 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full" style={{width:`${Math.max(0,Math.min(100,pct))}%`}}/></div></div>})}</div>}</CardContent></Card>

      {report.data.visibility !== "summary" && <Card className="rounded-2xl"><CardContent className="p-4"><p className="text-sm font-semibold mb-3">Recent transactions</p>{report.data.transactions.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">No posted transactions in this period</p> : <ul className="divide-y divide-border">{report.data.transactions.map((entry,index)=>{const positive=entry.amount>=0;return <li key={`${entry.transaction_date}-${entry.source_type}-${index}`} className="py-2.5 flex items-center gap-3"><span className={`h-8 w-8 rounded-xl grid place-items-center ${positive?"bg-success/10 text-success":"bg-destructive/10 text-destructive"}`}>{positive?<TrendingUp className="h-4 w-4"/>:<TrendingDown className="h-4 w-4"/>}</span><div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{entry.description}</p><p className="text-[11px] text-muted-foreground">{new Date(`${entry.transaction_date}T00:00:00`).toLocaleDateString()} · {entry.source_type}</p></div><p className={`text-sm font-semibold tabular-nums ${positive?"text-success":"text-destructive"}`}>{positive?"+":"−"}{fmt.format(Math.abs(entry.amount))}</p></li>})}</ul>}</CardContent></Card>}
    </> : null}
  </div>;
}

function StateCard({ title, message, action }: { title: string; message: string; action?: React.ReactNode }) {
  return <Card className="rounded-2xl"><CardContent className="p-6 text-center"><Lock className="h-6 w-6 mx-auto text-muted-foreground"/><h2 className="mt-3 font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{message}</p>{action && <div className="mt-4">{action}</div>}</CardContent></Card>;
}