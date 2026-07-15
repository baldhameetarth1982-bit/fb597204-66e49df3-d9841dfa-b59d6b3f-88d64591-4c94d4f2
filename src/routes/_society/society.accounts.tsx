import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useEffect, useMemo, useState } from "react";
import {
  Calculator, Download, Loader2, TrendingUp, TrendingDown, Wallet, Landmark, Receipt, AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const Route = createFileRoute("/_society/society/accounts")({
  head: () => ({ meta: [{ title: "Accounts Center — SociyoHub" }] }),
  component: () => (<FeatureGate feature="ledger"><AccountsPage /></FeatureGate>),
});

function fyRange(startMonth: number, anchor: Date) {
  const m = anchor.getMonth() + 1;
  const y = anchor.getFullYear();
  const startYear = m >= startMonth ? y : y - 1;
  const start = new Date(startYear, startMonth - 1, 1);
  const end = new Date(startYear + 1, startMonth - 1, 0);
  return { start, end };
}
const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

function AccountsPage() {
  const { societyId } = useSocietyId();
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<{ opening_cash: number; opening_bank: number; financial_year_start_month: number } | null>(null);
  const [mode, setMode] = useState<"fy" | "month" | "custom">("fy");
  const [anchor, setAnchor] = useState(new Date());
  const [from, setFrom] = useState(fmtDate(new Date(new Date().getFullYear(), 0, 1)));
  const [to, setTo] = useState(fmtDate(new Date()));
  const [payments, setPayments] = useState<{ paid_at: string; amount: number; method: string; flat_id: string }[]>([]);
  const [expenses, setExpenses] = useState<{ spent_on: string; amount: number; category: string; note: string | null }[]>([]);
  const [bills, setBills] = useState<{ id: string; amount: number; flat_id: string; status: string }[]>([]);
  const [paidByBill, setPaidByBill] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!societyId) return;
    (async () => {
      const { data, error } = await supabase.from("society_settings").select("opening_cash,opening_bank,financial_year_start_month").eq("society_id", societyId).maybeSingle();
      if (error) toast.error(error.message);
      setSettings({
        opening_cash: Number(data?.opening_cash ?? 0),
        opening_bank: Number(data?.opening_bank ?? 0),
        financial_year_start_month: data?.financial_year_start_month ?? 4,
      });
    })();
  }, [societyId]);

  const range = useMemo(() => {
    if (mode === "fy" && settings) return fyRange(settings.financial_year_start_month, anchor);
    if (mode === "month") return { start: new Date(anchor.getFullYear(), anchor.getMonth(), 1), end: new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0) };
    return { start: new Date(from), end: new Date(to) };
  }, [mode, anchor, from, to, settings]);

  useEffect(() => {
    if (!societyId || !settings) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      const s = fmtDate(range.start), e = fmtDate(range.end);
      const [p, ex, b] = await Promise.all([
        supabase.from("payments").select("paid_at,amount,method,flat_id").eq("society_id", societyId).eq("status", "success").gte("paid_at", s).lte("paid_at", `${e}T23:59:59`),
        supabase.from("expenses").select("spent_on,amount,category,note").eq("society_id", societyId).gte("spent_on", s).lte("spent_on", e),
        supabase.from("bills").select("id,amount,flat_id,status").eq("society_id", societyId),
      ]);
      if (cancel) return;
      if (p.error || ex.error) toast.error(p.error?.message || ex.error?.message || "Failed");
      setPayments(((p.data ?? []) as any[]).map((x) => ({ ...x, amount: Number(x.amount) })));
      setExpenses(((ex.data ?? []) as any[]).map((x) => ({ ...x, amount: Number(x.amount) })));
      setBills(((b.data ?? []) as any[]).map((x) => ({ ...x, amount: Number(x.amount) })));
      const billIds = (b.data ?? []).map((x: any) => x.id);
      const pay2 = billIds.length ? await supabase.from("payments").select("bill_id,amount").in("bill_id", billIds).eq("status", "success") : { data: [] as any[] };
      const map: Record<string, number> = {};
      for (const x of pay2.data ?? []) map[x.bill_id] = (map[x.bill_id] ?? 0) + Number(x.amount);
      setPaidByBill(map);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [societyId, settings, range.start.getTime(), range.end.getTime()]);

  const totals = useMemo(() => {
    const income = payments.reduce((s, p) => s + p.amount, 0);
    const expense = expenses.reduce((s, x) => s + x.amount, 0);
    const cashIn = payments.filter((p) => p.method === "cash").reduce((s, p) => s + p.amount, 0);
    const bankIn = income - cashIn;
    const cash = (settings?.opening_cash ?? 0) + cashIn;
    const bank = (settings?.opening_bank ?? 0) + bankIn - expense;
    const outstanding = bills.filter((b) => b.status !== "cancelled").reduce((s, b) => s + Math.max(0, b.amount - (paidByBill[b.id] ?? 0)), 0);
    return { income, expense, net: income - expense, cash, bank, outstanding };
  }, [payments, expenses, bills, paidByBill, settings]);

  async function saveOpening() {
    if (!societyId || !settings) return;
    const { error } = await supabase.from("society_settings").upsert({
      society_id: societyId,
      opening_cash: settings.opening_cash,
      opening_bank: settings.opening_bank,
      financial_year_start_month: settings.financial_year_start_month,
    }, { onConflict: "society_id" });
    if (error) toast.error(error.message);
    else toast.success("Saved");
  }

  function exportExcel() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(payments.map((p) => ({ Date: p.paid_at.slice(0, 10), Method: p.method, Amount: p.amount }))), "Income");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expenses.map((e) => ({ Date: e.spent_on, Category: e.category, Note: e.note ?? "", Amount: e.amount }))), "Expense");
    XLSX.writeFile(wb, `accounts-${fmtDate(range.start)}-${fmtDate(range.end)}.xlsx`);
  }

  function exportPdf() {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(`Income & Expense  ${fmtDate(range.start)} → ${fmtDate(range.end)}`, 14, 16);
    doc.setFontSize(10);
    doc.text(`Income ${inr(totals.income)}   Expense ${inr(totals.expense)}   Net ${inr(totals.net)}`, 14, 24);
    autoTable(doc, { startY: 30, head: [["Date", "Method", "Amount"]], body: payments.map((p) => [p.paid_at.slice(0, 10), p.method, inr(p.amount)]) });
    autoTable(doc, { head: [["Date", "Category", "Note", "Amount"]], body: expenses.map((e) => [e.spent_on, e.category, e.note ?? "", inr(e.amount)]) });
    doc.save(`accounts-${fmtDate(range.start)}-${fmtDate(range.end)}.pdf`);
  }

  const recentPayments = payments.slice(0, 6);
  const recentExpenses = expenses.slice(0, 6);

  return (
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <MobileHero
        eyebrow="Accounts Center"
        title="Society finances"
        subtitle="Opening balances, FY filter and exports — all in one view."
        icon={Calculator}
        variant="teal"
        stats={
          <StatPillRow>
            <StatPill label="Income" value={inr(totals.income)} icon={TrendingUp} />
            <StatPill label="Expense" value={inr(totals.expense)} icon={TrendingDown} />
            <StatPill label={totals.net >= 0 ? "Surplus" : "Deficit"} value={inr(Math.abs(totals.net))} icon={Receipt} />
            <StatPill label="Outstanding" value={inr(totals.outstanding)} icon={AlertCircle} />
          </StatPillRow>
        }
      />

      <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
        <AccountsCenterTabs />

        <div className="grid grid-cols-2 gap-3">
          <SectionCard icon={Wallet} title="Cash balance">
            <p className="text-2xl font-bold tabular-nums">{inr(totals.cash)}</p>
            <p className="text-xs text-muted-foreground mt-1">Opening + cash collections</p>
          </SectionCard>
          <SectionCard icon={Landmark} title="Bank balance">
            <p className="text-2xl font-bold tabular-nums">{inr(totals.bank)}</p>
            <p className="text-xs text-muted-foreground mt-1">Opening + online − expenses</p>
          </SectionCard>
        </div>

        <SectionCard title="Opening balances" description="Starting cash and bank at FY beginning">
          <div className="grid sm:grid-cols-4 gap-3">
            <div><Label className="text-xs">Opening cash</Label><Input type="number" value={settings?.opening_cash ?? 0} onChange={(e) => setSettings((s) => s && { ...s, opening_cash: Number(e.target.value) })} /></div>
            <div><Label className="text-xs">Opening bank</Label><Input type="number" value={settings?.opening_bank ?? 0} onChange={(e) => setSettings((s) => s && { ...s, opening_bank: Number(e.target.value) })} /></div>
            <div>
              <Label className="text-xs">FY start month</Label>
              <Select value={String(settings?.financial_year_start_month ?? 4)} onValueChange={(v) => setSettings((s) => s && { ...s, financial_year_start_month: Number(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{Array.from({ length: 12 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>{new Date(2000, i, 1).toLocaleString(undefined, { month: "long" })}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-end"><Button onClick={saveOpening} className="w-full rounded-xl">Save</Button></div>
          </div>
        </SectionCard>

        <SectionCard title="Period & exports">
          <div className="space-y-3">
            <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
              <TabsList className="w-full"><TabsTrigger value="fy" className="flex-1">Financial year</TabsTrigger><TabsTrigger value="month" className="flex-1">Month</TabsTrigger><TabsTrigger value="custom" className="flex-1">Custom</TabsTrigger></TabsList>
            </Tabs>
            <div className="flex flex-wrap gap-2 items-center">
              {mode !== "custom" && <Input type="month" value={`${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}`} onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); setAnchor(new Date(y, m - 1, 15)); }} className="w-44" />}
              {mode === "custom" && <><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></>}
              <div className="ml-auto flex gap-2">
                <Button variant="outline" size="sm" onClick={exportExcel} className="rounded-xl"><Download className="h-4 w-4 mr-1" /> Excel</Button>
                <Button variant="outline" size="sm" onClick={exportPdf} className="rounded-xl"><Download className="h-4 w-4 mr-1" /> PDF</Button>
              </div>
            </div>
          </div>
        </SectionCard>

        {loading ? (
          <div className="grid place-items-center h-32"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <SectionCard icon={TrendingUp} title="Recent income" description={`${payments.length} in period`} bodyClassName="p-0">
              {recentPayments.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No income in this period.</p>
              ) : (
                <ListCardGroup>
                  {recentPayments.map((p, i) => (
                    <ListCard
                      key={i}
                      title={inr(p.amount)}
                      subtitle={`${p.paid_at.slice(0, 10)} · ${p.method}`}
                    />
                  ))}
                </ListCardGroup>
              )}
            </SectionCard>
            <SectionCard icon={TrendingDown} title="Recent expenses" description={`${expenses.length} in period`} bodyClassName="p-0">
              {recentExpenses.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No expenses in this period.</p>
              ) : (
                <ListCardGroup>
                  {recentExpenses.map((e, i) => (
                    <ListCard
                      key={i}
                      title={inr(e.amount)}
                      subtitle={`${e.spent_on} · ${e.category}`}
                    />
                  ))}
                </ListCardGroup>
              )}
            </SectionCard>
          </div>
        )}
      </div>
    </div>
  );
}
