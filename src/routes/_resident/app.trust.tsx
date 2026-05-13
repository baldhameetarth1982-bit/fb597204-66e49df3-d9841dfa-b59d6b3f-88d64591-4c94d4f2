import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, TrendingUp, TrendingDown, Loader2, PieChart, Lock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";

export const Route = createFileRoute("/_resident/app/trust")({
  head: () => ({ meta: [{ title: "Financial Trust — SocioHub" }] }),
  component: TrustScreen,
});

interface Entry {
  kind: "income" | "expense"; amount: number; category: string | null; description: string | null; entry_date: string; id: string;
}

const fmt = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function TrustScreen() {
  const { societyId } = useSocietyId();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!societyId) return;
    (async () => {
      const since = new Date(); since.setMonth(since.getMonth() - 12);
      const { data } = await supabase
        .from("ledger_entries")
        .select("id, kind, amount, category, description, entry_date")
        .eq("society_id", societyId)
        .gte("entry_date", since.toISOString().slice(0, 10))
        .order("entry_date", { ascending: false });
      setEntries((data as Entry[]) ?? []);
      setLoading(false);
    })();
  }, [societyId]);

  const { income, expense, balance, byCategory } = useMemo(() => {
    let inc = 0, exp = 0;
    const cats = new Map<string, number>();
    for (const e of entries) {
      const a = Number(e.amount);
      if (e.kind === "income") inc += a;
      else { exp += a; const k = e.category || "Other"; cats.set(k, (cats.get(k) ?? 0) + a); }
    }
    return { income: inc, expense: exp, balance: inc - exp,
      byCategory: [...cats.entries()].sort((a, b) => b[1] - a[1]) };
  }, [entries]);

  return (
    <div className="px-5 py-6 space-y-5 pb-24">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">
          <ShieldCheck className="h-3.5 w-3.5" /> Live transparency
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Financial Trust</h1>
        <p className="text-sm text-muted-foreground">
          Real-time view of every rupee that enters and leaves your society fund.
        </p>
      </header>

      {loading ? (
        <div className="text-center py-10"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></div>
      ) : (
        <>
          <Card className="rounded-3xl border-0 shadow-md bg-gradient-to-br from-primary to-primary/85 text-primary-foreground">
            <CardContent className="p-6">
              <p className="text-xs uppercase tracking-wider opacity-80">Society Balance · last 12 months</p>
              <p className="mt-1 text-4xl font-semibold tabular-nums">{fmt.format(balance)}</p>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-background/15 p-3">
                  <p className="text-xs opacity-80 flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Income</p>
                  <p className="font-semibold tabular-nums">{fmt.format(income)}</p>
                </div>
                <div className="rounded-xl bg-background/15 p-3">
                  <p className="text-xs opacity-80 flex items-center gap-1"><TrendingDown className="h-3 w-3" /> Expense</p>
                  <p className="font-semibold tabular-nums">{fmt.format(expense)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-success/20 bg-success/5">
            <CardContent className="p-4 flex items-start gap-3">
              <Lock className="h-5 w-5 text-success mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="font-semibold">Where your maintenance goes</p>
                <p className="text-muted-foreground text-xs mt-0.5">
                  <span className="font-semibold text-foreground">98.5%</span> goes directly to your Society Fund · <span className="font-semibold text-foreground">1.5%</span> covers SocioHub platform fees. No hidden charges.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <PieChart className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-semibold">Spending breakdown</p>
                <Badge variant="secondary" className="ml-auto rounded-full text-[10px]">12mo</Badge>
              </div>
              {byCategory.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No expenses recorded yet</p>
              ) : (
                <div className="space-y-3">
                  {byCategory.map(([cat, amt]) => {
                    const pct = expense ? Math.round((amt / expense) * 100) : 0;
                    return (
                      <div key={cat}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium">{cat}</span>
                          <span className="text-muted-foreground tabular-nums">
                            {fmt.format(amt)} · {pct}%
                          </span>
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
              <p className="text-sm font-semibold mb-3">Recent transactions</p>
              {entries.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nothing yet</p>
              ) : (
                <ul className="divide-y divide-border">
                  {entries.slice(0, 20).map((e) => (
                    <li key={e.id} className="py-2.5 flex items-center gap-3">
                      <span className={`h-8 w-8 rounded-xl grid place-items-center ${
                        e.kind === "income" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
                      }`}>
                        {e.kind === "income" ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{e.description || e.category || "—"}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {new Date(e.entry_date).toLocaleDateString()}
                        </p>
                      </div>
                      <p className={`text-sm font-semibold tabular-nums ${
                        e.kind === "income" ? "text-success" : "text-destructive"
                      }`}>
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
