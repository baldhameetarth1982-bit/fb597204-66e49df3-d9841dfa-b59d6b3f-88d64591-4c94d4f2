import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Calculator, Download, Loader2, TrendingUp, TrendingDown, Wallet, Landmark, Receipt, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { FinanceTabs } from "@/components/shared/FinanceTabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const Route = createFileRoute("/_society/society/accounts")({
  head: () => ({ meta: [{ title: "Income & Expense Accounts — SocioHub" }] }),
  component: AccountsPage,
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
  const [flats, setFlats] = useState<{ id: string; flat_number: string; block_id: string }[]>([]);
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
      const [p, ex, f, b] = await Promise.all([
        supabase.from("payments").select("paid_at,amount,method,flat_id").eq("society_id", societyId).eq("status", "success").gte("paid_at", s).lte("paid_at", `${e}T23:59:59`),
        supabase.from("expenses").select("spent_on,amount,category,note").eq("society_id", societyId).gte("spent_on", s).lte("spent_on", e),
        supabase.from("flats").select("id,flat_number,block_id").eq("society_id", societyId),
        supabase.from("bills").select("id,amount,flat_id,status").eq("society_id", societyId),
      ]);
      if (cancel) return;
      if (p.error || ex.error) toast.error(p.error?.message || ex.error?.message || "Failed");
      setPayments(((p.data ?? []) as any[]).map((x) => ({ ...x, amount: Number(x.amount) })));
      setExpenses(((ex.data ?? []) as any[]).map((x) => ({ ...x, amount: Number(x.amount) })));
      setFlats((f.data ?? []) as any);
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
    const cashOut = 0; // expenses don't track mode here yet
    const cash = (settings?.opening_cash ?? 0) + cashIn - cashOut;
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

  return (
    <PageShell>
      <PageHeader title="Income & Expense Accounts" description="Society finances with opening balances, FY filter & exports" />
      <FinanceTabs />

      {/* Opening balances */}
      <Card className="rounded-2xl">
        <CardContent className="p-5 grid sm:grid-cols-4 gap-3">
          <div><Label>Opening cash</Label><Input type="number" value={settings?.opening_cash ?? 0} onChange={(e) => setSettings((s) => s && { ...s, opening_cash: Number(e.target.value) })} /></div>
          <div><Label>Opening bank</Label><Input type="number" value={settings?.opening_bank ?? 0} onChange={(e) => setSettings((s) => s && { ...s, opening_bank: Number(e.target.value) })} /></div>
          <div>
            <Label>FY start month</Label>
            <Select value={String(settings?.financial_year_start_month ?? 4)} onValueChange={(v) => setSettings((s) => s && { ...s, financial_year_start_month: Number(v) })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from({ length: 12 }, (_, i) => <SelectItem key={i + 1} value={String(i + 1)}>{new Date(2000, i, 1).toLocaleString(undefined, { month: "long" })}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-end"><Button onClick={saveOpening} className="w-full">Save</Button></div>
        </CardContent>
      </Card>

      {/* Filter */}
      <Card className="rounded-2xl">
        <CardContent className="p-5 flex flex-wrap gap-3 items-end">
          <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
            <TabsList><TabsTrigger value="fy">Financial year</TabsTrigger><TabsTrigger value="month">Month</TabsTrigger><TabsTrigger value="custom">Custom</TabsTrigger></TabsList>
          </Tabs>
          {mode !== "custom" && <Input type="month" value={`${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}`} onChange={(e) => { const [y, m] = e.target.value.split("-").map(Number); setAnchor(new Date(y, m - 1, 15)); }} className="w-44" />}
          {mode === "custom" && <><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></>}
          <div className="ml-auto flex gap-2">
            <Button variant="outline" onClick={exportExcel}><Download className="h-4 w-4 mr-1" /> Excel</Button>
            <Button variant="outline" onClick={exportPdf}><Download className="h-4 w-4 mr-1" /> PDF</Button>
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={TrendingUp} label="Income" value={inr(totals.income)} tone="emerald" />
        <Kpi icon={TrendingDown} label="Expense" value={inr(totals.expense)} tone="rose" />
        <Kpi icon={Receipt} label={totals.net >= 0 ? "Surplus" : "Deficit"} value={inr(Math.abs(totals.net))} tone={totals.net >= 0 ? "emerald" : "rose"} />
        <Kpi icon={AlertCircle} label="Outstanding" value={inr(totals.outstanding)} tone="amber" />
        <Kpi icon={Wallet} label="Cash balance" value={inr(totals.cash)} />
        <Kpi icon={Landmark} label="Bank balance" value={inr(totals.bank)} />
      </div>

      {loading ? <div className="grid place-items-center h-32"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div> : (
        <div className="grid lg:grid-cols-2 gap-4">
          <Card className="rounded-2xl"><CardContent className="p-0">
            <p className="p-4 font-semibold">Income</p>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Method</th><th className="text-right p-3">Amount</th></tr></thead>
              <tbody>{payments.map((p, i) => <tr key={i} className="border-t"><td className="p-3">{p.paid_at.slice(0, 10)}</td><td className="p-3 capitalize">{p.method}</td><td className="p-3 text-right">{inr(p.amount)}</td></tr>)}{!payments.length && <tr><td colSpan={3} className="p-3 text-muted-foreground">No income in this period.</td></tr>}</tbody>
            </table>
          </CardContent></Card>
          <Card className="rounded-2xl"><CardContent className="p-0">
            <p className="p-4 font-semibold">Expenses</p>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr><th className="text-left p-3">Date</th><th className="text-left p-3">Category</th><th className="text-right p-3">Amount</th></tr></thead>
              <tbody>{expenses.map((e, i) => <tr key={i} className="border-t"><td className="p-3">{e.spent_on}</td><td className="p-3 capitalize">{e.category}</td><td className="p-3 text-right">{inr(e.amount)}</td></tr>)}{!expenses.length && <tr><td colSpan={3} className="p-3 text-muted-foreground">No expenses in this period.</td></tr>}</tbody>
            </table>
          </CardContent></Card>
        </div>
      )}
    </PageShell>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "emerald" | "amber" | "rose" }) {
  const c = tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : tone === "rose" ? "text-rose-600" : "text-foreground";
  return (
    <Card className="rounded-2xl"><CardContent className="p-4">
      <div className="flex items-center justify-between"><p className="text-xs text-muted-foreground">{label}</p><Icon className={cn("h-4 w-4", c)} /></div>
      <p className={cn("mt-1 text-xl font-semibold", c)}>{value}</p>
    </CardContent></Card>
  );
}
