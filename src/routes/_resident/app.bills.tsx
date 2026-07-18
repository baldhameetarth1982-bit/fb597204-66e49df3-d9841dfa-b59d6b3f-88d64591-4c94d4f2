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

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const isNowOnline = typeof navigator !== "undefined" ? navigator.onLine : true;
      setOnline(isNowOnline);
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
            setNoFlat(rows.length === 0 && !profile.society_id ? true : false);
            setVisibleBills(rows);
          }
        } catch {
          if (!cancelled) setVisibleBills([]);
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
  }, [profile?.id, profile?.society_id, listMyBills]);

  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

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
          {visibleBills.length === 0 ? (
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
                          variant={state.code === "paid" ? "secondary" : "outline"}
                          className="mt-1 rounded-full text-[10px]"
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
