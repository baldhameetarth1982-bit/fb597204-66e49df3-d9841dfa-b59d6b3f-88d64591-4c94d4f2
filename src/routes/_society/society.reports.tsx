import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
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
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";
import { EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_society/society/reports")({
  head: () => ({ meta: [{ title: "Reports — SociyoHub" }] }),
  component: () => (<FeatureGate feature="advanced_reports"><ReportsPage /></FeatureGate>),
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

  async function exportPdf() {
    const [{ default: jsPDF }, autoTable] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable").then((m) => m.default),
    ]);
    const doc = new jsPDF({ orientation: "landscape" });
    doc.setFontSize(16);
    doc.text("SociyoHub — Financial Report", 14, 14);
    doc.setFontSize(10);
    doc.text(`Period: ${from} to ${to}`, 14, 22);
    doc.text(`Income: ${INR.format(summary.income)}   Expense: ${INR.format(summary.expense)}   Net: ${INR.format(summary.net)}`, 14, 28);
    autoTable(doc, {
      startY: 34,
      head: [["Date", "Type", "Category", "Description", "Amount", "Source"]],
      body: txns.map((t) => [
        t.date, t.kind, t.category, t.description,
        (t.kind === "income" ? "+" : "-") + INR.format(t.amount), t.source,
      ]),
      styles: { fontSize: 8 },
      headStyles: { fillColor: [14, 165, 233] },
    });
    doc.save(`sociohub-report-${from}-to-${to}.pdf`);
  }

  if (sidLoading) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const y = today.getFullYear();
  const fyStart = today.getMonth() >= 3 ? y : y - 1;
  const presets = [
    { label: "This month", from: format(startOfMonth(today), "yyyy-MM-dd"), to: format(today, "yyyy-MM-dd") },
    { label: "Last 3 months", from: format(subMonths(today, 2), "yyyy-MM-01"), to: format(today, "yyyy-MM-dd") },
    { label: "Last 6 months", from: format(subMonths(today, 5), "yyyy-MM-01"), to: format(today, "yyyy-MM-dd") },
    { label: `FY ${fyStart}-${String(fyStart + 1).slice(2)}`, from: `${fyStart}-04-01`, to: `${fyStart + 1}-03-31` },
    { label: `FY ${fyStart - 1}-${String(fyStart).slice(2)}`, from: `${fyStart - 1}-04-01`, to: `${fyStart}-03-31` },
  ];

  return (
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <MobileHero
        eyebrow="Accounts Center"
        title="Reports"
        subtitle="Income, expenses & net position — export for accountant or audit."
        icon={BarChart3}
        variant="teal"
        stats={
          <StatPillRow>
            <StatPill label="Income" value={INR.format(summary.income)} icon={TrendingUp} />
            <StatPill label="Expense" value={INR.format(summary.expense)} icon={TrendingDown} />
            <StatPill label={summary.net >= 0 ? "Net surplus" : "Net deficit"} value={INR.format(Math.abs(summary.net))} icon={ArrowUpDown} />
            <StatPill label="Margin" value={summary.income > 0 ? `${summary.ratio.toFixed(0)}%` : "—"} />
          </StatPillRow>
        }
      />

      <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
        <AccountsCenterTabs />

        <SectionCard title="Period" description="Presets & custom range">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <Button key={p.label} variant="outline" size="sm" className="rounded-full h-8 text-xs"
                  onClick={() => { setFrom(p.from); setTo(p.to); }}>
                  {p.label}
                </Button>
              ))}
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">From</Label>
                <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">To</Label>
                <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" className="rounded-xl" size="sm" onClick={exportPdf} disabled={!txns.length}>
                <Printer className="h-4 w-4 mr-1.5" /> PDF
              </Button>
              <Button className="rounded-xl" size="sm" onClick={exportCsv} disabled={!txns.length}>
                <FileDown className="h-4 w-4 mr-1.5" /> Excel (CSV)
              </Button>
            </div>
          </div>
        </SectionCard>

        {summary.chart.length > 0 && (
          <SectionCard icon={BarChart3} title="Monthly breakdown">
            <div className="h-64">
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
            </div>
          </SectionCard>
        )}

        <SectionCard title={`Transactions · ${txns.length}`} bodyClassName="p-0">
          {isLoading ? (
            <div className="p-10 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : txns.length === 0 ? (
            <div className="p-6">
              <EmptyState icon={Download} title="No transactions in this range" description="Try widening the date range or record income/expenses first." />
            </div>
          ) : (
            <ListCardGroup>
              {txns.slice(0, 300).map((t) => (
                <ListCard
                  key={t.id}
                  leading={
                    <span className={cn("h-10 w-10 rounded-xl grid place-items-center", t.kind === "income" ? "bg-emerald-500/10 text-emerald-600" : "bg-rose-500/10 text-rose-600")}>
                      {t.kind === "income" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    </span>
                  }
                  title={t.description || t.category}
                  subtitle={`${format(new Date(t.date), "dd MMM yyyy")} · ${t.category} · ${t.source}`}
                  trailing={
                    <span className={cn("text-sm font-semibold tabular-nums", t.kind === "income" ? "text-emerald-600" : "text-rose-600")}>
                      {t.kind === "income" ? "+" : "−"}{INR.format(t.amount)}
                    </span>
                  }
                />
              ))}
              {txns.length > 300 && (
                <div className="p-3 text-center text-xs text-muted-foreground">
                  Showing 300 of {txns.length}. Export CSV for full data.
                </div>
              )}
            </ListCardGroup>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
