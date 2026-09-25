import { createFileRoute, Link } from "@tanstack/react-router";
import { Receipt, Clock, CheckCircle2, Home, Info, ChevronRight, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cacheSet, cacheGet } from "@/lib/offline-cache";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { ClaimFlatSheet } from "@/components/resident/ClaimFlatSheet";
import { useServerFn } from "@tanstack/react-start";
import { getResidentBills } from "@/lib/billing-generate.functions";
import { getBillDisplayStatus } from "@/lib/bill-display-status";
import { toSafeFinanceError } from "@/lib/finance-safe-error";

export const Route = createFileRoute("/_resident/app/bills")({
  head: () => ({ meta: [{ title: "Bills — SociyoHub" }] }),
  component: BillsScreen,
});

interface BillRow {
  id: string;
  title: string;
  amount: number;
  due: string;
  due_date: string | null;
  status: string;
  cancelled_at: string | null;
}

/**
 * Resident bills — Stage 3B read-only view.
 *
 * Stage 3B intentionally exposes NO payment surface: no CTA, no gateway
 * ordering, no "coming soon" promises. Display status is derived only
 * from canonical bill fields via `getBillDisplayStatus` — legacy payment
 * aliases like "success" or "captured" NEVER render as Paid.
 */
function BillsScreen() {
  const { profile } = useAuth();
  const listMyBills = useServerFn(getResidentBills);
  const [visibleBills, setVisibleBills] = useState<BillRow[]>([]);
  const [online, setOnline] = useState(true);
  const [loading, setLoading] = useState(true);
  const [noFlat, setNoFlat] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const isNowOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
      setOnline(isNowOnline);
      setLoadError(null);
      const cacheKey = profile?.id ? `bills:${profile.id}` : "bills";
      if (isNowOnline) {
        if (!profile?.id) {
          setVisibleBills([]);
          setLoading(false);
          return;
        }
        try {
          const res = await listMyBills({ data: { limit: 24 } });
          const rows: BillRow[] = (res.bills ?? []).map((b) => ({
            id: b.id as string,
            title: (b.period_label as string) ?? "Society bill",
            amount: Number((b.total_payable as number | null) ?? (b.amount as number | null) ?? 0),
            due: b.due_date ? new Date(b.due_date as string).toLocaleDateString() : "—",
            due_date: (b.due_date as string | null) ?? null,
            status: (b.status as string) ?? "unpaid",
            cancelled_at: (b.cancelled_at as string | null) ?? null,
          }));
          cacheSet(cacheKey, rows);
          if (!cancelled) {
            setNoFlat(res.hasLinkedFlat === false);
            setVisibleBills(rows);
          }
        } catch (e) {
          // Never show "no bills" after a failed load; keep last cached rows.
          if (!cancelled) {
            setLoadError(toSafeFinanceError(e).message);
            setVisibleBills(cacheGet<BillRow[]>(cacheKey) ?? []);
          }
        }
      } else {
        setVisibleBills(cacheGet<BillRow[]>(cacheKey) ?? []);
      }
      if (!cancelled) setLoading(false);
    };
    void sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      cancelled = true;
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, [profile?.id, profile?.society_id, listMyBills, reloadKey]);

  if (loading) {
    return (
      <div className="px-5 py-6 space-y-3" aria-busy="true" aria-label="Loading bills">
        <div className="h-8 w-32 rounded-lg bg-muted animate-pulse" />
        <div className="h-24 rounded-2xl bg-muted animate-pulse" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  const openBills = visibleBills.filter((b) => {
    const s = getBillDisplayStatus(b);
    return !s.isPaid && !s.isCancelled;
  });
  const overdueCount = openBills.filter((b) => getBillDisplayStatus(b).isOverdue).length;
  const outstanding = openBills.reduce((sum, b) => sum + b.amount, 0);
  // Only show a total when data is fresh — never a fake ₹0 after failure.
  const showSummary = !loadError && !noFlat && visibleBills.length > 0;

  const paidBills = visibleBills.filter((b) => getBillDisplayStatus(b).isPaid);
  const cancelledBills = visibleBills.filter((b) => getBillDisplayStatus(b).isCancelled);
  const groups = [
    { key: "open", title: "Open bills", rows: openBills },
    { key: "paid", title: "Paid", rows: paidBills },
    { key: "cancelled", title: "Cancelled", rows: cancelledBills },
  ];

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
          <p className="text-sm text-muted-foreground">What you owe and what's already paid{online ? "" : " · saved copy (offline)"}</p>
        </div>
        <Button asChild variant="outline" className="min-h-11 rounded-xl">
          <Link to="/app/receipts"><Receipt className="h-4 w-4 mr-1" />Receipts</Link>
        </Button>
      </header>

      {noFlat && (
        <section className="flex items-start gap-3 rounded-2xl bg-warning-container p-4 text-warning-container-foreground">
          <Home className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="font-medium text-sm">You're not linked to a house yet</p>
            <p className="text-sm opacity-80 mt-0.5">Pick your house so bills can reach you. Your society admin will approve it.</p>
            <Button className="mt-3 min-h-11 rounded-xl" onClick={() => setClaimOpen(true)}>Pick my house</Button>
          </div>
        </section>
      )}

      {/* Primary answer: amount owed */}
      {showSummary && (
        <section aria-labelledby="owed-h" className={`rounded-2xl border p-5 ${overdueCount > 0 ? "border-destructive/40 bg-danger-container text-danger-container-foreground" : "border-border bg-card"}`}>
          <p id="owed-h" className="text-sm opacity-80">{openBills.length === 0 ? "Nothing to pay" : "You owe"}</p>
          <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight break-words">₹{outstanding.toLocaleString("en-IN")}</p>
          <p className="mt-2 text-sm">
            {openBills.length === 0 ? "All your bills are settled." : `${openBills.length} open bill${openBills.length > 1 ? "s" : ""}`}
            {overdueCount > 0 && <span className="font-semibold"> · {overdueCount} overdue</span>}
          </p>
          <p className="mt-3 flex items-start gap-2 border-t border-current/15 pt-3 text-xs opacity-80">
            <Info className="h-4 w-4 shrink-0" />
            Pay by cash or bank transfer as instructed by your society office. Bills are marked paid only after the committee verifies your payment.
          </p>
        </section>
      )}

      {loadError && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-card p-4">
          <p className="text-sm text-muted-foreground">{loadError}{visibleBills.length > 0 ? " Showing your last saved bills." : ""}</p>
          <Button variant="outline" className="min-h-11 shrink-0 rounded-xl" onClick={() => setReloadKey((k) => k + 1)}>Retry</Button>
        </div>
      )}

      {visibleBills.length === 0 && !loadError && !noFlat && (
        <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center">
          <Receipt className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No bills yet</p>
          <p className="text-sm text-muted-foreground">Bills from your society will appear here.</p>
        </div>
      )}

      {groups.map((g) => g.rows.length > 0 && (
        <section key={g.key} aria-labelledby={`bills-${g.key}`}>
          <h2 id={`bills-${g.key}`} className="mb-2 flex items-baseline justify-between px-1 text-sm font-semibold">
            {g.title}<span className="text-xs font-normal text-muted-foreground tabular-nums">{g.rows.length}</span>
          </h2>
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {g.rows.map((b) => {
              const state = getBillDisplayStatus(b);
              const tone = state.code === "paid" ? "bg-success-container text-success-container-foreground"
                : state.code === "overdue" ? "bg-danger-container text-danger-container-foreground"
                : state.code === "cancelled" ? "bg-muted text-muted-foreground"
                : "bg-warning-container text-warning-container-foreground";
              const Icon = state.code === "paid" ? CheckCircle2 : state.code === "cancelled" ? Ban : Clock;
              return (
                <li key={b.id}>
                  <Link to="/app/bills/$id" params={{ id: b.id }} className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{b.title}</span>
                      <span className="block text-xs text-muted-foreground">Due {b.due}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className={`block font-semibold tabular-nums ${state.code === "cancelled" ? "line-through text-muted-foreground" : ""}`}>₹{b.amount.toLocaleString("en-IN")}</span>
                      <span className={`mt-1 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>{state.label}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {profile?.society_id && (
        <ClaimFlatSheet open={claimOpen} onOpenChange={setClaimOpen} societyId={profile.society_id} />
      )}
    </div>
  );
}
