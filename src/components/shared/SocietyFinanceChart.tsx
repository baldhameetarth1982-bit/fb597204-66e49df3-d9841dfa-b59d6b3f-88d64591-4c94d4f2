import { useQuery } from "@tanstack/react-query";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, CartesianGrid,
} from "recharts";

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

type Bucket = { month: string; income: number; expense: number };

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function monthLabel(k: string) {
  const [y, m] = k.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleString("en-IN", { month: "short" });
}

export function SocietyFinanceChart({ societyId }: { societyId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["society-finance", societyId],
    queryFn: async () => {
      const since = new Date();
      since.setMonth(since.getMonth() - 5);
      since.setDate(1);
      since.setHours(0, 0, 0, 0);
      const [{ data: payments }, { data: expenses }] = await Promise.all([
        supabase.from("payments").select("amount, status, paid_at, created_at")
          .eq("society_id", societyId).gte("created_at", since.toISOString()),
        supabase.from("expenses").select("amount, spent_on")
          .eq("society_id", societyId).gte("spent_on", since.toISOString().slice(0, 10)),
      ]);

      const buckets: Record<string, Bucket> = {};
      for (let i = 0; i < 6; i++) {
        const d = new Date(); d.setMonth(d.getMonth() - (5 - i)); d.setDate(1);
        const k = monthKey(d);
        buckets[k] = { month: monthLabel(k), income: 0, expense: 0 };
      }
      (payments ?? []).forEach((p: any) => {
        if (p.status !== "success") return;
        const d = new Date(p.paid_at ?? p.created_at);
        const k = monthKey(d);
        if (buckets[k]) buckets[k].income += Number(p.amount ?? 0);
      });
      (expenses ?? []).forEach((e: any) => {
        const k = monthKey(new Date(e.spent_on));
        if (buckets[k]) buckets[k].expense += Number(e.amount ?? 0);
      });
      return Object.values(buckets);
    },
  });

  const series = data ?? [];
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const lastNet = last ? last.income - last.expense : 0;
  const prevNet = prev ? prev.income - prev.expense : 0;
  const pct = prevNet === 0 ? (lastNet === 0 ? 0 : 100) : ((lastNet - prevNet) / Math.abs(prevNet)) * 100;
  const tone = lastNet > prevNet ? "growth" : lastNet < prevNet ? "loss" : "flat";

  const totalIncome = series.reduce((s, b) => s + b.income, 0);
  const totalExpense = series.reduce((s, b) => s + b.expense, 0);
  const profit = totalIncome - totalExpense;

  return (
    <Card className="rounded-2xl">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base">Income vs Expenses (last 6 months)</CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Net this month: <span className="font-medium text-foreground">{INR.format(lastNet)}</span>
          </p>
        </div>
        <div
          className={[
            "px-3 py-1.5 rounded-xl text-sm font-semibold flex items-center gap-1.5",
            tone === "growth" ? "bg-emerald-500/10 text-emerald-500"
              : tone === "loss" ? "bg-red-500/10 text-red-500"
              : "bg-muted text-foreground",
          ].join(" ")}
        >
          {tone === "growth" ? <TrendingUp className="h-4 w-4" />
            : tone === "loss" ? <TrendingDown className="h-4 w-4" />
            : <Minus className="h-4 w-4" />}
          {pct === 0 ? "0%" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? <div className="h-64 grid place-items-center text-sm text-muted-foreground">Loading…</div>
          : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12}
                  tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`} />
                <Tooltip
                  formatter={(v: number) => INR.format(v)}
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="income" name="Income" fill="hsl(142 71% 45%)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="expense" name="Expense" fill="hsl(0 72% 51%)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3 mt-4 text-center text-sm">
          <div className="rounded-xl bg-emerald-500/5 p-3">
            <p className="text-xs text-muted-foreground">Income</p>
            <p className="font-semibold text-emerald-500">{INR.format(totalIncome)}</p>
          </div>
          <div className="rounded-xl bg-red-500/5 p-3">
            <p className="text-xs text-muted-foreground">Expense</p>
            <p className="font-semibold text-red-500">{INR.format(totalExpense)}</p>
          </div>
          <div className={`rounded-xl p-3 ${profit > 0 ? "bg-emerald-500/5" : profit < 0 ? "bg-red-500/5" : "bg-muted"}`}>
            <p className="text-xs text-muted-foreground">Net</p>
            <p className={`font-semibold ${profit > 0 ? "text-emerald-500" : profit < 0 ? "text-red-500" : "text-foreground"}`}>
              {INR.format(profit)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
