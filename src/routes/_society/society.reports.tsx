import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, subMonths } from "date-fns";
import {
  BarChart3, Download, FileDown, Loader2, Printer,
  TrendingUp, TrendingDown, ArrowUpDown,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from "recharts";
import { PageHeader, PageShell, EmptyState } from "@/components/shared/PageHeader";
import { FinanceTabs } from "@/components/shared/FinanceTabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";

export const Route = createFileRoute("/_society/society/reports")({
  head: () => ({ meta: [{ title: "Reports — SocioHub" }] }),
  component: ReportsPage,
});

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 0,
});

type Txn = {
  id: string;
  date: string;
  kind: "income" | "expense";
  category: string;
  description: string;
  amount: number;
  source: "payment" | "ledger" | "expense";
};

function ReportsPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const today = new Date();
  const [from, setFrom] = useState(format(subMonths(today, 5), "yyyy-MM-01"));
  const [to, setTo] = useState(format(today, "yyyy-MM-dd"));

  const { data, isLoading } = useQuery({
    enabled: !!societyId,
    queryKey: ["accounting-report", societyId, from, to],
    staleTime: 60_000,
    queryFn: async () => {
      const [payRes, ledRes, expRes] = await Promise.all([
        supabase.from("payments").select("id, paid_at, amount, method, notes, status")
          .eq("society_id", societyId!).eq("status", "success")
          .gte("paid_at", from).lte("paid_at", to + "T23:59:59"),
        supabase.from("ledger_entries").select("id, entry_date, kind, category, description, amount")
          .eq("society_id", societyId!).gte("entry_date", from).lte("entry_date", to),
        supabase.from("expenses").select("id, spent_on, category, note, amount")
          .eq("society_id", societyId!).gte("spent_on", from).lte("spent_on", to),
      ]);
      const txns: Txn[] = [];
      for (const p of payRes.data ?? []) txns.push({
        id: `p-${p.id}`, date: (p.paid_at ?? "").slice(0, 10),
        kind: "income", category: "Maintenance", description: p.notes || `Payment · ${p.method}`,
        amount: Number(p.amount), source: "payment",
      });
      for (const l of ledRes.data ?? []) txns.push({
        id: `l-${l.id}`, date: l.entry_date, kind: (l.kind as "income" | "expense"),
        category: l.category || "Other", description: l.description || "",
        amount: Number(l.amount), source: "ledger",
      });
      for (const e of expRes.data ?? []) txns.push({
        id: `e-${e.id}`, date: e.spent_on, kind: "expense",
        category: e.category, description: e.note || "",
        amount: Number(e.amount), source: "expense",
      });
      txns.sort((a, b) => (a.date < b.date ? 1 : -1));
      return txns;
    },
  });

  const txns = data ?? [];

  const summary = useMemo(() => {
    let income = 0, expense = 0;
    const monthly: Record<string, { month: string; income: number; expense: number }> = {};
    for (const t of txns) {
      const m = format(startOfMonth(new Date(t.date)), "MMM yy");
      monthly[m] ??= { month: m, income: 0, expense: 0 };
      if (t.kind === "income") { income += t.amount; monthly[m].income += t.amount; }
      else { expense += t.amount; monthly[m].expense += t.amount; }
    }
    const chart = Object.values(monthly).reverse();
    const net = income - expense;
    const ratio = income > 0 ? ((net / income) * 100) : 0;
    return { income, expense, net, ratio, chart };
  }, [txns]);

  function exportCsv() {
    const rows = [
      ["Date", "Type", "Category", "Description", "Amount (INR)", "Source"],
      ...txns.map((t) => [
        t.date, t.kind, t.category, t.description.replace(/"/g, '""'),
        t.amount.toFixed(2), t.source,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = document.createElement("a");
    a.href = url; a.download = `sociohub-report-${from}-to-${to}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const netTone =
    summary.net > 0 ? "text-emerald-600" :
    summary.net < 0 ? "text-rose-600" : "text-foreground";

  if (sidLoading) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <PageShell>
      <PageHeader
        title="Reports"
        description="Income, expenses & net position — export for accountant or audit."
        actions={
          <div className="flex gap-2 print:hidden">
            <Button variant="outline" className="rounded-xl" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1.5" />
      <FinanceTabs /> PDF
            </Button>
            <Button className="rounded-xl" onClick={exportCsv} disabled={!txns.length}>
              <FileDown className="h-4 w-4 mr-1.5" /> Excel (CSV)
            </Button>
          </div>
        }
      />

      <Card className="rounded-2xl mb-4 print:hidden">
        <CardContent className="p-4 grid sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <Card className="rounded-2xl bg-emerald-500/5 border-emerald-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-emerald-600">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs font-medium">Total Income</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{INR.format(summary.income)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl bg-rose-500/5 border-rose-500/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-rose-600">
              <TrendingDown className="h-4 w-4" />
              <span className="text-xs font-medium">Total Expense</span>
            </div>
            <p className="mt-1 text-2xl font-bold">{INR.format(summary.expense)}</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground">
              <ArrowUpDown className="h-4 w-4" />
              <span className="text-xs font-medium">Net</span>
            </div>
            <p className={`mt-1 text-2xl font-bold ${netTone}`}>{INR.format(summary.net)}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {summary.income > 0 ? `${summary.ratio.toFixed(1)}% margin` : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {summary.chart.length > 0 && (
        <Card className="rounded-2xl mb-4">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="h-4 w-4" /> Monthly breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.chart}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey="month" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip formatter={(v: number) => INR.format(v)} />
                <Legend />
                <Bar dataKey="income" fill="hsl(142 71% 45%)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="expense" fill="hsl(0 72% 51%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base">Transactions ({txns.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
          ) : txns.length === 0 ? (
            <EmptyState icon={Download} title="No transactions in this range"
              description="Try widening the date range or add income/expenses." />
          ) : (
            <ul className="divide-y divide-border">
              {txns.slice(0, 300).map((t) => (
                <li key={t.id} className="px-4 py-3 flex items-center gap-3">
                  <Badge variant="outline" className={`rounded-full ${
                    t.kind === "income"
                      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                      : "bg-rose-500/10 text-rose-600 border-rose-500/20"
                  }`}>
                    {t.kind}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.description || t.category}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {format(new Date(t.date), "dd MMM yyyy")} · {t.category} · {t.source}
                    </p>
                  </div>
                  <p className={`text-sm font-semibold ${
                    t.kind === "income" ? "text-emerald-600" : "text-rose-600"
                  }`}>
                    {t.kind === "income" ? "+" : "−"}{INR.format(t.amount)}
                  </p>
                </li>
              ))}
              {txns.length > 300 && (
                <li className="p-3 text-center text-xs text-muted-foreground">
                  Showing 300 of {txns.length}. Export CSV for full data.
                </li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
