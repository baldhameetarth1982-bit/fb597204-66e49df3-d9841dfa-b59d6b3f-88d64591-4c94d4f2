import { useTranslation } from "react-i18next";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { toSafeFinanceMessage } from "@/lib/finance-safe-error";
import { useState } from "react";
import { AlertCircle, BarChart3, Download, Loader2, TrendingDown, TrendingUp } from "lucide-react";
import { writeSafeWorkbook } from "@/lib/spreadsheet-safety";
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
import { getAccountsDocumentTotals } from "@/lib/accounts-documents.functions";

export const Route = createFileRoute("/_society/society/reports")({
  head: () => ({ meta: [
    { title: "Financial Reports — SociyoHub" },
    { name: "description", content: "Review canonical society financial totals and receivables ageing." },
    { property: "og:title", content: "Financial Reports — SociyoHub" },
    { property: "og:description", content: "Canonical society financial totals and receivables ageing." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
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
  const totalsFn = useServerFn(getAccountsDocumentTotals);
  const rangeOk = !!from && !!to && from <= to;
  const totals = useQuery({ queryKey: ["accounts-doc-totals", societyId, from, to], enabled: !!societyId && rangeOk, retry: false, queryFn: () => totalsFn({ data: { societyId: societyId!, from, to } }) });
  const o = overview.data;
  const { t } = useTranslation();
  const heroValue = (value: number | undefined) => overview.isSuccess && value !== undefined ? INR.format(value) : "—";

  return <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
    <MobileHero eyebrow={t("acc.eyebrow")} title={t("rep.title")} subtitle={t("rep.subtitle")} icon={BarChart3} variant="teal" stats={<StatPillRow><StatPill label={t("acc.income")} value={heroValue(o?.income)} icon={TrendingUp}/><StatPill label={t("acc.expense")} value={heroValue(o?.expense)} icon={TrendingDown}/><StatPill label={t("acc.net")} value={heroValue(o?.net_movement)}/></StatPillRow>}/>
    <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
      <AccountsCenterTabs/>
      <SectionCard title={t("rep.period")} description={t("rep.maxTwoYears")}><div className="grid grid-cols-2 gap-3"><div><Label>{t("common.from")}</Label><Input aria-label={t("common.from")} type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div><div><Label>{t("common.to")}</Label><Input aria-label={t("common.to")} type="date" value={to} onChange={e=>setTo(e.target.value)}/></div></div></SectionCard>
      {(overview.isLoading || (!o && !overview.error)) ? <div className="p-10 grid place-items-center" aria-label={t("rep.loading")}><Loader2 className="animate-spin"/></div> : overview.error ? <SectionCard title={t("rep.unavailable")}><p className="text-sm text-destructive">{toSafeFinanceMessage(overview.error,t("rep.loadFailed"))}</p><Button className="mt-3" variant="outline" onClick={()=>void overview.refetch()}>{t("common.retry")}</Button></SectionCard> : <div className="grid sm:grid-cols-2 gap-3"><SectionCard title={t("common.cash")}><p className="text-2xl font-bold">{INR.format(o!.cash_balance)}</p></SectionCard><SectionCard title={t("rep.bank")}><p className="text-2xl font-bold">{INR.format(o!.bank_balance)}</p></SectionCard></div>}
      <SectionCard title={t("rep.totalsTitle")} description={rangeOk ? t("rep.totalsDesc", { from, to }) : t("rep.chooseRange")} bodyClassName="p-0">
        {!rangeOk ? null : (totals.isLoading || (!totals.data && !totals.error)) ? <div className="p-8 grid place-items-center"><Loader2 className="animate-spin" aria-label={t("rep.loadingTotals")}/></div>
          : totals.error ? <div className="p-5"><p className="text-sm text-destructive" role="alert">{t("rep.totalsFailed")}</p><Button className="mt-3" variant="outline" onClick={()=>void totals.refetch()}>{t("common.retry")}</Button></div>
          : <ListCardGroup>
            <ListCard title={t("rep.incomeCash")} trailing={<span className="font-semibold tabular-nums whitespace-nowrap">{INR.format(totals.data!.income.cash)}</span>}/>
            <ListCard title={t("rep.incomeBank")} trailing={<span className="font-semibold tabular-nums whitespace-nowrap">{INR.format(totals.data!.income.bank)}</span>}/>
            <ListCard title={t("rep.incomeTotal")} trailing={<span className="font-bold tabular-nums whitespace-nowrap">{INR.format(totals.data!.income.total)}</span>}/>
            <ListCard title={t("rep.expenseCash")} trailing={<span className="font-semibold tabular-nums whitespace-nowrap">{INR.format(totals.data!.expense.cash)}</span>}/>
            <ListCard title={t("rep.expenseBank")} trailing={<span className="font-semibold tabular-nums whitespace-nowrap">{INR.format(totals.data!.expense.bank)}</span>}/>
            <ListCard title={t("rep.expenseTotal")} trailing={<span className="font-bold tabular-nums whitespace-nowrap">{INR.format(totals.data!.expense.total)}</span>}/>
            <ListCard title={t("rep.billsIssued")} subtitle={t("rep.billsCount", { count: totals.data!.bills.count })} trailing={<span className="font-semibold tabular-nums whitespace-nowrap">{INR.format(totals.data!.bills.amount)}</span>}/>
            <ListCard title={t("rep.vouchersIssued")} subtitle={t("rep.vouchersCount", { count: totals.data!.vouchers.count })} trailing={<span className="font-semibold tabular-nums whitespace-nowrap">{INR.format(totals.data!.vouchers.amount)}</span>}/>
          </ListCardGroup>}
      </SectionCard>
      <SectionCard icon={AlertCircle} title={t("rep.ageing")} description={t("rep.ageingAsOf", { date: to })} bodyClassName="p-0">
        {ageing.isLoading ? <div className="p-8 grid place-items-center" aria-label={t("rep.loadingAgeing")}><Loader2 className="animate-spin"/></div> : ageing.error ? <div className="p-5"><p className="text-sm text-destructive">{toSafeFinanceMessage(ageing.error,t("rep.ageingFailed"))}</p><Button className="mt-3" variant="outline" onClick={()=>void ageing.refetch()}>{t("common.retry")}</Button></div> : <ListCardGroup>{["current","1_30","31_60","61_90","90_plus"].map(bucket=>{const row=ageing.data?.rows.find(x=>x.bucket===bucket);return <ListCard key={bucket} title={bucket==="current"?t("rep.current"):t("rep.days",{range:bucket.replace("_","–").replace("90–plus","90+")})} subtitle={t("rep.bills",{count:row?.bill_count??0})} trailing={<span className="font-semibold">{INR.format(row?.amount??0)}</span>}/>})}</ListCardGroup>}
      </SectionCard>
      <Button variant="outline" className="w-full min-h-11 sm:w-auto" disabled={!overview.isSuccess || !ageing.isSuccess || !totals.isSuccess} onClick={()=>{
        const rows: Record<string, string | number>[] = [
          { Section: "Period", Item: `${from} to ${to}`, "Bills": "", "Amount (Rs.)": "" },
          { Section: "Totals", Item: "Income", "Bills": "", "Amount (Rs.)": o!.income },
          { Section: "Totals", Item: "Expense", "Bills": "", "Amount (Rs.)": o!.expense },
          { Section: "Totals", Item: "Net movement", "Bills": "", "Amount (Rs.)": o!.net_movement },
          { Section: "Balances", Item: "Cash", "Bills": "", "Amount (Rs.)": o!.cash_balance },
          { Section: "Balances", Item: "Bank", "Bills": "", "Amount (Rs.)": o!.bank_balance },
          { Section: "By mode", Item: "Income cash", "Bills": "", "Amount (Rs.)": totals.data!.income.cash },
          { Section: "By mode", Item: "Income bank transfer", "Bills": "", "Amount (Rs.)": totals.data!.income.bank },
          { Section: "By mode", Item: "Expense cash", "Bills": "", "Amount (Rs.)": totals.data!.expense.cash },
          { Section: "By mode", Item: "Expense bank transfer", "Bills": "", "Amount (Rs.)": totals.data!.expense.bank },
          { Section: "Documents", Item: "Income bills", "Bills": totals.data!.bills.count, "Amount (Rs.)": totals.data!.bills.amount },
          { Section: "Documents", Item: "Expense vouchers", "Bills": totals.data!.vouchers.count, "Amount (Rs.)": totals.data!.vouchers.amount },
          ...["current","1_30","31_60","61_90","90_plus"].map(bucket=>{const r=ageing.data?.rows.find(x=>x.bucket===bucket);return { Section: "Receivables ageing", Item: bucket==="current"?"Current":bucket.replace("_","-")+" days", "Bills": r?.bill_count??0, "Amount (Rs.)": r?.amount??0 };}),
        ];
        writeSafeWorkbook(rows, "Report", `financial-report-${from}-to-${to}.xlsx`);
      }}><Download className="h-4 w-4"/>{t("rep.download")}</Button>
      <p className="text-xs text-muted-foreground">{t("rep.legacyNote")}</p>
    </div>
  </div>;
}