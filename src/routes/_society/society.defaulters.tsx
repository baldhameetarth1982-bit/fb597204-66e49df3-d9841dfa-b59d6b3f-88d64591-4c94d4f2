import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { EmptyState } from "@/components/shared/PageHeader";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { toSafeFinanceError } from "@/lib/finance-safe-error";
import { formatDate } from "@/utils/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_society/society/defaulters")({
  head: () => ({
    meta: [
      { title: "Outstanding dues — SociyoHub" },
      { name: "description", content: "Homes with unpaid and overdue society bills." },
    ],
  }),
  component: DefaultersPage,
});

type OpenBill = { id: string; period: string; due: string | null; outstanding: number; overdue: boolean };
type Home = { flatId: string; label: string; bills: OpenBill[]; total: number; overdueCount: number; oldestDue: string | null };

const INR = (v: number) => `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Defaulters — committee only. Amounts come from the get_outstanding_dues
 * server function, which authorizes the caller and sums payments over the
 * complete set for each bill it returns. Outstanding = bill total minus
 * VERIFIED payments; pending/rejected/reversed payments never reduce dues.
 * Cancelled and paid bills are excluded.
 */
function DefaultersPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [homes, setHomes] = useState<Home[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);

  async function load() {
    if (!societyId) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      // Server computes outstanding = bill total − verified payments over the
      // complete payment set, scoped to what this user may manage.
      const { data, error: rErr } = await supabase.rpc("get_outstanding_dues", { _society_id: societyId });
      if (rErr) throw rErr;
      const list = data ?? [];
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const map = new Map<string, Home>();
      for (const b of list) {
        const outstanding = Math.round(Number(b.outstanding) * 100) / 100;
        if (!b.flat_id || !Number.isFinite(outstanding) || outstanding <= 0) continue;
        const overdue = !!b.due_date && new Date(b.due_date) < today;
        const h = map.get(b.flat_id) ?? { flatId: b.flat_id, label: b.flat_label ?? "Home", bills: [], total: 0, overdueCount: 0, oldestDue: null };
        h.bills.push({ id: b.bill_id, period: b.period_label ?? "Bill", due: b.due_date, outstanding, overdue });
        h.total += outstanding;
        if (overdue) h.overdueCount++;
        if (b.due_date && (!h.oldestDue || b.due_date < h.oldestDue)) h.oldestDue = b.due_date;
        map.set(b.flat_id, h);
      }
      setHomes(Array.from(map.values()).sort((a, b) => b.overdueCount - a.overdueCount || b.total - a.total));
    } catch (e) {
      setHomes([]);
      setError(toSafeFinanceError(e).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [societyId]);

  const filtered = useMemo(() => homes.filter((h) => {
    if (onlyOverdue && h.overdueCount === 0) return false;
    return !q.trim() || h.label.toLowerCase().includes(q.trim().toLowerCase());
  }), [homes, q, onlyOverdue]);

  const ready = !sidLoading && !loading && !error;
  const totalDue = homes.reduce((s, h) => s + h.total, 0);
  const overdueHomes = homes.filter((h) => h.overdueCount > 0).length;

  return (
    <div className="pb-24">
      <MobileHero
        eyebrow="Billing centre"
        title="Outstanding dues"
        subtitle="Homes with unpaid bills, after verified payments."
        icon={AlertTriangle}
        variant="teal"
        stats={
          <StatPillRow>
            <StatPill label="Homes" value={ready ? homes.length : "—"} />
            <StatPill label="Overdue" value={ready ? overdueHomes : "—"} />
            <StatPill label="Outstanding" value={ready ? INR(totalDue) : "—"} />
          </StatPillRow>
        }
      />
      <div className="px-4 pt-4 space-y-4">
        <div className="rounded-2xl bg-card border shadow-sm"><BillingCenterTabs /></div>

        {sidLoading || loading ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading dues">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />)}
          </div>
        ) : error ? (
          <div role="alert" className="rounded-2xl border border-destructive/30 bg-card p-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button size="sm" variant="outline" className="min-h-11 shrink-0" onClick={() => void load()}>Try again</Button>
          </div>
        ) : homes.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="No outstanding dues" description="Every open bill you manage is settled by verified payments." />
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input aria-label="Search by house" placeholder="Search by house" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 rounded-xl h-11" />
              </div>
              <Button variant={onlyOverdue ? "default" : "outline"} className="min-h-11 rounded-xl" aria-pressed={onlyOverdue} onClick={() => setOnlyOverdue((v) => !v)}>
                Overdue only
              </Button>
            </div>
            {filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No homes match this search.</p>
            ) : (
              <ul className="space-y-3">
                {filtered.map((h) => (
                  <li key={h.flatId} className="rounded-2xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{h.label}</p>
                        <p className="text-xs text-muted-foreground">
                          {h.bills.length} open bill{h.bills.length > 1 ? "s" : ""}
                          {h.oldestDue ? ` · oldest due ${formatDate(h.oldestDue)}` : ""}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold tabular-nums">{INR(h.total)}</p>
                        {h.overdueCount > 0 ? (
                          <StatusChip tone="danger" className="mt-1">{h.overdueCount} overdue</StatusChip>
                        ) : (
                          <StatusChip tone="warning" className="mt-1">Due</StatusChip>
                        )}
                      </div>
                    </div>
                    <ul className="mt-3 divide-y border-t">
                      {h.bills.map((b) => (
                        <li key={b.id}>
                          <Link to="/society/bills/$id" params={{ id: b.id }} className="flex items-center gap-2 py-2 min-h-11 text-sm hover:bg-accent/40 rounded-lg px-1">
                            <span className="flex-1 min-w-0 truncate">{b.period}</span>
                            <span className={cn("text-xs", b.overdue ? "text-destructive" : "text-muted-foreground")}>
                              {b.due ? `${b.overdue ? "Overdue since" : "Due"} ${formatDate(b.due)}` : "No due date"}
                            </span>
                            <span className="tabular-nums font-medium">{INR(b.outstanding)}</span>
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
