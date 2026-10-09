import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Landmark, Loader2, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";
import { EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSocietyId } from "@/hooks/useSocietyId";
import { getFinanceOverview, listFinanceBook, seedFinanceAccounts, type bookRowSchema } from "@/lib/finance-stage3d.functions";
import { toSafeFinanceError } from "@/lib/finance-safe-error";
import type { z } from "zod";
import { toast } from "sonner";
import { tu } from "@/lib/i18n";
import { ensureDefaultAccountCategories } from "@/lib/accounts-documents.functions";

export const Route = createFileRoute("/_society/society/accounts")({
  head: () => ({ meta: [
    { title: "Accounts Center — SociyoHub" },
    { name: "description", content: "Review canonical society balances, cash book, and bank book." },
    { property: "og:title", content: "Accounts Center — SociyoHub" },
    { property: "og:description", content: "Canonical society balances, cash book, and bank book." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: () => <FeatureGate feature="accounts_center"><AccountsPage /></FeatureGate>,
});

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
type BookRow = z.infer<typeof bookRowSchema>;
const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;

function AccountsPage() {
  const { societyId } = useSocietyId();
  const overviewFn = useServerFn(getFinanceOverview);
  const bookFn = useServerFn(listFinanceBook);
  const seedFn = useServerFn(seedFinanceAccounts);
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(today);
  const [book, setBook] = useState<"cash" | "bank">("cash");
  const [offset, setOffset] = useState(0);
  const pageSize = 50;

  const overview = useQuery({
    queryKey: ["finance-overview", societyId, from, to], enabled: !!societyId,
    queryFn: () => overviewFn({ data: { societyId: societyId!, from, to } }), retry: false,
  });
  const bookQ = useQuery({
    queryKey: ["finance-book", societyId, book, from, to, offset], enabled: !!societyId,
    queryFn: () => bookFn({ data: { societyId: societyId!, book, from, to, limit: pageSize, offset } }), retry: false,
  });
  const rows = (bookQ.data?.rows ?? []) as BookRow[];
  const o = overview.data;
  const error = overview.error || bookQ.error;
  const safeError = error ? toSafeFinanceError(error, typeof navigator === "undefined" || navigator.onLine) : null;
  const canInitialize = safeError?.kind === "not_initialized";
  const loading = overview.isLoading || bookQ.isLoading;
  const balance = useMemo(() => rows.length ? rows[0].running_balance : null, [rows]);
  const heroValue = (value: number | undefined) => overview.isSuccess && value !== undefined ? INR.format(value) : "—";
  const [initializing, setInitializing] = useState(false);
  // Add the most common income/expense heads once (idempotent; adds only missing ones).
  const seedHeads = useServerFn(ensureDefaultAccountCategories);
  const seeded = useRef(false);
  useEffect(() => {
    if (!societyId || seeded.current || !overview.isSuccess) return;
    seeded.current = true;
    void seedHeads({ data: { societyId } }).catch(() => { /* permission/plan errors: page still works */ });
  }, [societyId, overview.isSuccess, seedHeads]);

  async function initialize() {
    if (!societyId || initializing) return;
    setInitializing(true);
    try { await seedFn({ data: { societyId } }); await Promise.all([overview.refetch(), bookQ.refetch()]); toast.success(tu("op.chart_of_accounts_is_ready")); }
    catch (e) { toast.error(toSafeFinanceError(e).message); }
    finally { setInitializing(false); }
  }

  return <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
    <MobileHero eyebrow={tu("accountsTabs.label")} title={tu("op.canonical_finances")} subtitle={tu("op.journal_backed_balances_cash_book")} icon={Calculator} variant="teal"
      stats={<StatPillRow><StatPill label={tu("nav.income")} value={heroValue(o?.income)} icon={TrendingUp}/><StatPill label={tu("acc.expense")} value={heroValue(o?.expense)} icon={TrendingDown}/><StatPill label={tu("acc.net")} value={heroValue(o?.net_movement)}/></StatPillRow>} />
    <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
      <AccountsCenterTabs />
      <SectionCard title={tu("op.reporting_period")} description={tu("op.canonical_journal_only")}>
        <div className="grid grid-cols-2 gap-3"><div><Label>{tu("common.from")}</Label><Input aria-label={tu("common.from")} type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div><div><Label>To</Label><Input aria-label="To" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div></div>
      </SectionCard>
      {safeError ? <SectionCard title={safeError.title}><p className="text-sm text-muted-foreground" role="alert">{safeError.message}</p><div className="mt-3 flex gap-2">{canInitialize&&<Button className="min-h-11" disabled={initializing} onClick={initialize}>{initializing ? tu("op.initializing") : tu("op.initialize_accounts")}</Button>}{safeError.retryable&&<Button variant="outline" className="min-h-11" disabled={overview.isFetching||bookQ.isFetching} onClick={()=>void Promise.all([overview.refetch(),bookQ.refetch()])}>{tu("common.retry")}</Button>}</div></SectionCard> : <>
        <div className="grid grid-cols-2 gap-3"><SectionCard icon={Wallet} title={tu("op.cash_balance")}><p className="text-2xl font-bold">{heroValue(o?.cash_balance)}</p></SectionCard><SectionCard icon={Landmark} title={tu("op.bank_balance")}><p className="text-2xl font-bold">{heroValue(o?.bank_balance)}</p></SectionCard></div>
         <SectionCard title={book === "cash" ? tu("op.cash_book") : tu("op.bank_book")} description={balance === null ? tu("op.running_balance_unavailable") : `Running balance ${INR.format(balance)}`} action={<div className="flex gap-1"><Button size="sm" variant={book==="cash"?"default":"outline"} onClick={()=>{setBook("cash");setOffset(0)}}>{tu("common.cash")}</Button><Button size="sm" variant={book==="bank"?"default":"outline"} onClick={()=>{setBook("bank");setOffset(0)}}>{tu("rep.bank")}</Button></div>} bodyClassName="p-0">
          {loading ? <div className="p-10 grid place-items-center"><Loader2 className="animate-spin"/></div> : rows.length===0 ? <div className="p-6"><EmptyState icon={Wallet} title={tu("op.no_posted_transactions")} description={tu("op.verified_collections_and_posted_expenses")}/></div> : <ListCardGroup>{rows.map(r=><ListCard key={r.entry_id} title={r.description} subtitle={`${r.transaction_date} · ${r.source_type}`} trailing={<span className="font-semibold tabular-nums">{INR.format(r.debit-r.credit)}</span>}/>)}</ListCardGroup>}
           {!loading && (offset > 0 || rows.length === pageSize) && <div className="flex items-center justify-between border-t p-3"><Button size="sm" variant="outline" disabled={offset===0} onClick={()=>setOffset(value=>Math.max(0,value-pageSize))}>{tu("acc.previous")}</Button><span className="text-xs text-muted-foreground">{tu("op.page")} {Math.floor(offset/pageSize)+1}</span><Button size="sm" variant="outline" disabled={rows.length<pageSize} onClick={()=>setOffset(value=>value+pageSize)}>{tu("acc.next")}</Button></div>}
        </SectionCard>
      </>}
    </div>
  </div>;
}
