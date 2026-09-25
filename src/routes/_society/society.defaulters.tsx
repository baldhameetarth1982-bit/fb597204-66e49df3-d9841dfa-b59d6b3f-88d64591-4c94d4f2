import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { SummaryStrip, ListSkeleton, SearchField, SegmentedFilter, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
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
    <PageShell>
      <PageHeader title="Outstanding dues" description="Which homes still owe money, how much, and what is overdue — after verified payments only." />
      <div className="mb-5 rounded-2xl border border-border bg-card"><BillingCenterTabs /></div>

      <SummaryStrip items={[
        { label: "Total outstanding", value: ready ? INR(totalDue) : "—" },
        { label: "Homes owing", value: ready ? homes.length : "—" },
        { label: "Homes overdue", value: ready ? overdueHomes : "—" },
        { label: "Open bills", value: ready ? homes.reduce((n, h) => n + h.bills.length, 0) : "—" },
      ]} />

      {sidLoading || loading ? (
        <ListSkeleton />
      ) : error ? (
        <LoadError title={error} onRetry={() => void load()} />
      ) : homes.length === 0 ? (
        <ListEmpty icon={AlertTriangle} title="No outstanding dues">Every open bill you manage is settled by verified payments.</ListEmpty>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
            <SearchField label="Search by house" placeholder="Search by house" value={q} onChange={setQ} />
            <SegmentedFilter<"all" | "overdue"> label="Dues filter" value={onlyOverdue ? "overdue" : "all"} onChange={(k) => setOnlyOverdue(k === "overdue")} options={[
              { key: "all", label: "All homes", count: homes.length },
              { key: "overdue", label: "Overdue only", count: overdueHomes },
            ]} />
          </div>
          {filtered.length === 0 ? (
            <ListEmpty icon={AlertTriangle} title="No matching homes">Try another house or clear the overdue filter.</ListEmpty>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card" aria-label="Homes with dues">
              {filtered.map((h) => (
                <li key={h.flatId} className="relative">
                  <span className={cn("absolute inset-y-0 left-0 w-1", h.overdueCount > 0 ? "bg-destructive" : "bg-warning")} aria-hidden />
                  <details className="group">
                    <summary className="grid min-h-16 cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-3 pl-5 pr-4 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">{h.label}</span>
                        <span className="block text-xs text-muted-foreground">{h.bills.length} open bill{h.bills.length > 1 ? "s" : ""}{h.oldestDue ? ` · oldest due ${formatDate(h.oldestDue)}` : ""}</span>
                      </span>
                      <span className="text-right">
                        <span className="block font-semibold tabular-nums">{INR(h.total)}</span>
                        {h.overdueCount > 0 ? <StatusChip tone="danger" className="mt-1">{h.overdueCount} overdue</StatusChip> : <StatusChip tone="warning" className="mt-1">Due</StatusChip>}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden />
                    </summary>
                    <ul className="divide-y divide-border border-t border-border bg-muted/30">
                      {h.bills.map((b) => (
                        <li key={b.id}>
                          <Link to="/society/bills/$id" params={{ id: b.id }} className="grid min-h-11 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-2 pl-5 pr-4 text-sm hover:bg-muted/60 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                            <span className="truncate">{b.period}</span>
                            <span className="text-right font-medium tabular-nums sm:order-last">{INR(b.outstanding)}</span>
                            <span className={cn("col-span-2 text-xs sm:col-span-1", b.overdue ? "text-destructive" : "text-muted-foreground")}>
                              {b.due ? `${b.overdue ? "Overdue since" : "Due"} ${formatDate(b.due)}` : "No due date"}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </PageShell>
  );
}
