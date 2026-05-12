import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";

export const Route = createFileRoute("/_resident/app/ledger")({
  head: () => ({ meta: [{ title: "Financial Summary — SocioHub" }] }),
  component: ResidentLedger,
});

interface Entry {
  id: string;
  entry_date: string;
  kind: "income" | "expense";
  category: string | null;
  description: string | null;
  amount: number;
}

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function ResidentLedger() {
  const { societyId } = useSocietyId();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!societyId) return;
    (async () => {
      const start = new Date();
      start.setDate(1);
      const { data } = await supabase
        .from("ledger_entries")
        .select("id,entry_date,kind,category,description,amount")
        .eq("society_id", societyId)
        .gte("entry_date", start.toISOString().slice(0, 10))
        .order("entry_date", { ascending: false });
      setEntries((data as Entry[]) ?? []);
      setLoading(false);
    })();
  }, [societyId]);

  const { income, expense, byCategory } = useMemo(() => {
    let inc = 0, exp = 0;
    const cats = new Map<string, number>();
    for (const e of entries) {
      const amt = Number(e.amount);
      if (e.kind === "income") inc += amt;
      else {
        exp += amt;
        const k = e.category || "Other";
        cats.set(k, (cats.get(k) ?? 0) + amt);
      }
    }
    return {
      income: inc,
      expense: exp,
      byCategory: [...cats.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [entries]);

  const monthLabel = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div className="px-5 py-6 space-y-4 pb-24">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Financial Summary</h1>
        <p className="text-sm text-muted-foreground">{monthLabel} · where your money goes</p>
      </header>

      {loading ? (
        <div className="text-center py-10"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Card className="rounded-2xl bg-success/5 border-success/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-success">
                  <TrendingUp className="h-4 w-4" />
                  <span className="text-xs font-medium">Income</span>
                </div>
                <p className="mt-1 text-xl font-bold">{fmt.format(income)}</p>
              </CardContent>
            </Card>
            <Card className="rounded-2xl bg-destructive/5 border-destructive/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-destructive">
                  <TrendingDown className="h-4 w-4" />
                  <span className="text-xs font-medium">Expense</span>
                </div>
                <p className="mt-1 text-xl font-bold">{fmt.format(expense)}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <p className="text-sm font-semibold mb-3">Spending breakdown</p>
              {byCategory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No expenses recorded</p>
              ) : (
                <div className="space-y-3">
                  {byCategory.map(([cat, amt]) => {
                    const pct = expense ? Math.round((amt / expense) * 100) : 0;
                    return (
                      <div key={cat}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium">{cat}</span>
                          <span className="text-muted-foreground">{fmt.format(amt)} · {pct}%</span>
                        </div>
                        <div className="h-2 bg-secondary rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <p className="text-sm font-semibold mb-3">Recent entries</p>
              {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nothing yet</p>
              ) : (
                <ul className="divide-y divide-border">
                  {entries.slice(0, 15).map((e) => (
                    <li key={e.id} className="py-2.5 flex items-center gap-3">
                      <span className={`h-8 w-8 rounded-xl grid place-items-center ${e.kind === "income" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                        {e.kind === "income" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{e.description || e.category || "—"}</p>
                        <p className="text-[11px] text-muted-foreground">{new Date(e.entry_date).toLocaleDateString()}{e.category ? ` · ${e.category}` : ""}</p>
                      </div>
                      <p className={`text-sm font-semibold ${e.kind === "income" ? "text-success" : "text-destructive"}`}>
                        {e.kind === "income" ? "+" : "−"}{fmt.format(Number(e.amount))}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
