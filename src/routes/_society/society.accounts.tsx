import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
import type { z } from "zod";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/accounts")({
  head: () => ({ meta: [{ title: "Accounts Center — SociyoHub" }] }),
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

  const overview = useQuery({
    queryKey: ["finance-overview", societyId, from, to], enabled: !!societyId,
    queryFn: () => overviewFn({ data: { societyId: societyId!, from, to } }), retry: false,
  });
  const bookQ = useQuery({
    queryKey: ["finance-book", societyId, book, from, to], enabled: !!societyId,
    queryFn: () => bookFn({ data: { societyId: societyId!, book, from, to, limit: 50, offset: 0 } }), retry: false,
  });
  const rows = (bookQ.data?.rows ?? []) as BookRow[];
  const o = overview.data;
  const error = overview.error || bookQ.error;
  const loading = overview.isLoading || bookQ.isLoading;
  const balance = useMemo(() => rows.length ? rows[0].running_balance : 0, [rows]);

  async function initialize() {
    if (!societyId) return;
    try { await seedFn({ data: { societyId } }); await Promise.all([overview.refetch(), bookQ.refetch()]); toast.success("Chart of accounts is ready"); }
    catch (e) { toast.error((e as Error).message); }
  }

  return <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
    <MobileHero eyebrow="Accounts Center" title="Canonical finances" subtitle="Journal-backed balances, cash book and bank book." icon={Calculator} variant="teal"
      stats={<StatPillRow><StatPill label="Income" value={INR.format(o?.income ?? 0)} icon={TrendingUp}/><StatPill label="Expense" value={INR.format(o?.expense ?? 0)} icon={TrendingDown}/><StatPill label="Net" value={INR.format(o?.net_movement ?? 0)}/></StatPillRow>} />
    <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
      <AccountsCenterTabs />
      <SectionCard title="Reporting period" description="Canonical journal only">
        <div className="grid grid-cols-2 gap-3"><div><Label>From</Label><Input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div><div><Label>To</Label><Input type="date" value={to} onChange={e=>setTo(e.target.value)}/></div></div>
      </SectionCard>
      {error ? <SectionCard title="Finance unavailable"><p className="text-sm text-destructive">{(error as Error).message}</p><Button className="mt-3" onClick={initialize}>Initialize accounts</Button></SectionCard> : <>
        <div className="grid grid-cols-2 gap-3"><SectionCard icon={Wallet} title="Cash balance"><p className="text-2xl font-bold">{INR.format(o?.cash_balance ?? 0)}</p></SectionCard><SectionCard icon={Landmark} title="Bank balance"><p className="text-2xl font-bold">{INR.format(o?.bank_balance ?? 0)}</p></SectionCard></div>
        <SectionCard title={book === "cash" ? "Cash book" : "Bank book"} description={`Running balance ${INR.format(balance)}`} action={<div className="flex gap-1"><Button size="sm" variant={book==="cash"?"default":"outline"} onClick={()=>setBook("cash")}>Cash</Button><Button size="sm" variant={book==="bank"?"default":"outline"} onClick={()=>setBook("bank")}>Bank</Button></div>} bodyClassName="p-0">
          {loading ? <div className="p-10 grid place-items-center"><Loader2 className="animate-spin"/></div> : rows.length===0 ? <div className="p-6"><EmptyState icon={Wallet} title="No posted transactions" description="Verified collections and posted expenses will appear here."/></div> : <ListCardGroup>{rows.map(r=><ListCard key={r.entry_id} title={r.description} subtitle={`${r.transaction_date} · ${r.source_type}`} trailing={<span className="font-semibold tabular-nums">{INR.format(r.debit-r.credit)}</span>}/>)}</ListCardGroup>}
        </SectionCard>
      </>}
    </div>
  </div>;
}
