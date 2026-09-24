import { createFileRoute, Link } from "@tanstack/react-router";
import { Receipt, Clock, CheckCircle2, Loader2, Home, Info, ChevronRight, Ban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

  return (
    <div className="px-5 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Bills</h1>
        <p className="text-sm text-muted-foreground">
          Your maintenance & society dues{online ? "" : " · offline cache"}
        </p>
      </header>

      {noFlat && (
        <Card className="rounded-2xl border-amber-500/30 bg-amber-500/10">
          <CardContent className="p-4 flex items-start gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-500/20 grid place-items-center shrink-0">
              <Home className="h-5 w-5 text-amber-700 dark:text-amber-200" />
            </div>
            <div className="flex-1">
              <p className="font-medium text-sm">You're not linked to a flat yet</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Pick your flat so bills can reach you. Your society admin will approve it.
              </p>
              <Button size="sm" className="mt-3 rounded-lg" onClick={() => setClaimOpen(true)}>
                Pick my flat
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {showSummary && (
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Outstanding (bill totals)</p>
            <p className="text-2xl font-semibold tabular-nums mt-1 break-words">
              ₹{outstanding.toLocaleString("en-IN")}
            </p>
            <p className="text-xs mt-1 text-muted-foreground">
              {openBills.length === 0
                ? "No open bills. You're all settled."
                : `${openBills.length} open bill${openBills.length > 1 ? "s" : ""}`}
              {overdueCount > 0 && (
                <span className="text-destructive font-medium"> · {overdueCount} overdue</span>
              )}
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-primary/10 bg-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">Read-only bill view</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Contact your society office for the currently approved payment
              instructions. Payment recording and receipt verification are
              handled separately.
            </p>
          </div>
        </CardContent>
      </Card>

      <section>
        <h2 className="px-1 mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Your bills
        </h2>
        <div className="space-y-3">
          {loadError && (
            <Card className="rounded-2xl border-destructive/30" role="alert">
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  {loadError}
                  {visibleBills.length > 0 ? " Showing your last saved bills." : ""}
                </p>
                <Button size="sm" variant="outline" className="min-h-11 shrink-0" onClick={() => setReloadKey((k) => k + 1)}>
                  Retry
                </Button>
              </CardContent>
            </Card>
          )}
          {visibleBills.length === 0 && loadError ? null : visibleBills.length === 0 ? (
            <Card className="rounded-2xl">
              <CardContent className="p-6 text-center text-sm text-muted-foreground">
                No bills found for your flat yet.
              </CardContent>
            </Card>
          ) : (
            visibleBills.map((b) => {
              const state = getBillDisplayStatus(b);
              const iconTone =
                state.code === "paid"
                  ? "bg-success/10 text-success"
                  : state.code === "cancelled"
                    ? "bg-muted text-muted-foreground"
                    : state.code === "overdue"
                      ? "bg-destructive/10 text-destructive"
                      : "bg-primary/10 text-primary";
              const Icon =
                state.code === "paid"
                  ? CheckCircle2
                  : state.code === "cancelled"
                    ? Ban
                    : Clock;
              return (
                <Link
                  key={b.id}
                  to="/app/bills/$id"
                  params={{ id: b.id }}
                  className="block"
                >
                  <Card className="rounded-2xl hover:bg-accent/40 transition-colors">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className={`h-11 w-11 rounded-xl grid place-items-center ${iconTone}`}>
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{b.title}</p>
                        <p className="text-xs text-muted-foreground">Due {b.due}</p>
                      </div>
                      <div className="text-right shrink-0 max-w-[110px]">
                        <p className="font-semibold tabular-nums truncate">
                          ₹{b.amount.toLocaleString("en-IN")}
                        </p>
                        <Badge
                          variant="outline"
                          className={`mt-1 rounded-full text-[10px] ${
                            state.code === "paid"
                              ? "border-success/40 bg-success/10 text-success"
                              : state.code === "overdue"
                                ? "border-destructive/40 bg-destructive/10 text-destructive"
                                : state.code === "cancelled"
                                  ? "text-muted-foreground line-through"
                                  : ""
                          }`}
                        >
                          {state.label}
                        </Badge>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </CardContent>
                  </Card>
                </Link>
              );
            })
          )}
        </div>
      </section>

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Receipt className="h-3.5 w-3.5" />
        Powered by SociyoHub
      </div>

      {profile?.society_id && (
        <ClaimFlatSheet
          open={claimOpen}
          onOpenChange={setClaimOpen}
          societyId={profile.society_id}
        />
      )}
    </div>
  );
}
