import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ArrowLeft, Loader2, Receipt, Home, Calendar, IndianRupee, Info,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { useServerFn } from "@tanstack/react-start";
import { getResidentBillDetail } from "@/lib/billing-generate.functions";
import { getBillDisplayStatus } from "@/lib/bill-display-status";
import { formatDate } from "@/utils/format";
import { OfflinePaymentSubmitCard } from "@/components/billing/OfflinePaymentSubmitCard";
import { toast } from "sonner";
import { toSafeFinanceError } from "@/lib/finance-safe-error";

export const Route = createFileRoute("/_resident/app/bills/$id")({
  head: () => ({ meta: [{ title: "Bill — SociyoHub" }] }),
  component: ResidentBillDetail,
});

type Bill = {
  id: string;
  bill_number: string | null;
  bill_date: string | null;
  period_label: string | null;
  period_start: string | null;
  period_end: string | null;
  due_date: string | null;
  current_charges: number | null;
  previous_balance: number | null;
  penalties: number | null;
  adjustments: number | null;
  tax_amount: number | null;
  total_payable: number | null;
  amount: number | null;
  status: string;
  cancelled_at: string | null;
};

type Line = { id: string; kind: string | null; description: string | null; amount: number | null };

const INR = (v: number | null | undefined) =>
  `₹${Number(v ?? 0).toLocaleString("en-IN")}`;

/**
 * Resident bill detail — Stage 3B read-only.
 *
 * NEVER exposes a payment button, gateway order, or "coming soon" payment
 * copy. Ownership is enforced server-side by getResidentBillDetail via the
 * caller's active flat_residents link; unauthorized reads surface as
 * "Bill not found". Display status is derived only from canonical bill
 * fields via `getBillDisplayStatus`.
 */
function ResidentBillDetail() {
  const { id } = Route.useParams();
  const load = useServerFn(getResidentBillDetail);
  const [bill, setBill] = useState<Bill | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const res = await load({ data: { billId: id } });
        if (cancelled) return;
        setBill(res.bill as unknown as Bill);
        setLines((res.lines ?? []) as unknown as Line[]);
      } catch (e) {
        if (cancelled) return;
        const safe = toSafeFinanceError(e);
        // "not found" stays as the not-found screen; other failures offer retry.
        if (safe.kind !== "not_found") setLoadError(safe.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, load, reloadKey]);

  if (loading) {
    return (
      <div className="px-5 py-6 space-y-3" aria-busy="true" aria-label="Loading bill">
        <div className="h-8 w-28 rounded-lg bg-muted animate-pulse" />
        <div className="h-40 rounded-2xl bg-muted animate-pulse" />
        <div className="h-28 rounded-2xl bg-muted animate-pulse" />
      </div>
    );
  }

  if (!bill) {
    return (
      <div className="px-5 py-6 space-y-4">
        {loadError ? (
          <div role="alert" className="rounded-2xl border border-destructive/30 p-4 flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button size="sm" variant="outline" className="min-h-11 shrink-0" onClick={() => setReloadKey((k) => k + 1)}>
              Try again
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground">This bill isn't available for your home.</p>
        )}
        <Button asChild variant="ghost" className="min-h-11">
          <Link to="/app/bills"><ArrowLeft className="h-4 w-4 mr-2" />Back to bills</Link>
        </Button>
      </div>
    );
  }

  const amount = Number(bill.total_payable ?? bill.amount ?? 0);
  const state = getBillDisplayStatus(bill);

  const showBreakdown =
    (bill.current_charges ?? 0) !== 0 ||
    (bill.previous_balance ?? 0) !== 0 ||
    (bill.penalties ?? 0) !== 0 ||
    (bill.adjustments ?? 0) !== 0 ||
    (bill.tax_amount ?? 0) !== 0;

  const band = state.code === "paid" ? "bg-success-container text-success-container-foreground"
    : state.code === "overdue" ? "bg-danger-container text-danger-container-foreground"
    : state.isCancelled ? "bg-muted text-muted-foreground"
    : "bg-warning-container text-warning-container-foreground";
  const open = !state.isCancelled && !state.isPaid;
  const row = (label: string, v: any) => (
    <li className="flex items-center justify-between gap-3"><span>{label}</span><span className="tabular-nums font-medium">{INR(v)}</span></li>
  );

  return (
    <div className="mx-auto max-w-2xl px-5 py-6 space-y-5">
      <Button asChild variant="ghost" className="-ml-2 min-h-11 rounded-xl">
        <Link to="/app/bills"><ArrowLeft className="h-4 w-4 mr-1" />Bills</Link>
      </Button>

      <article className="overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby="rb-title">
        <div className={`flex items-center justify-between gap-3 px-5 py-2.5 text-sm font-medium ${band}`}>
          <span>{state.label}</span><span className="font-mono text-xs opacity-80">{bill.bill_number ?? "Bill"}</span>
        </div>
        <div className="p-5">
          <h1 id="rb-title" className="type-section">{bill.period_label ?? "Society bill"}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Home className="h-4 w-4" />Your house</p>
          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-5">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{open ? "Amount to pay" : "Amount"}</p>
              <p className={`truncate text-3xl font-semibold tabular-nums ${state.isCancelled ? "line-through text-muted-foreground" : ""}`}>₹{amount.toLocaleString("en-IN")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Due date</p>
              <p className={`flex items-center gap-1 text-lg font-semibold ${state.code === "overdue" ? "text-destructive" : ""}`}><Calendar className="h-4 w-4 opacity-60" />{bill.due_date ? formatDate(bill.due_date) : "—"}</p>
            </div>
          </div>
          {state.isCancelled && <p className="mt-4 text-sm text-muted-foreground">This bill was cancelled and isn't payable. It stays here for your records.</p>}
          {state.isPaid && <p className="mt-4 text-sm text-muted-foreground">Payment verified by the committee. Your receipt is in <Link to="/app/receipts" className="font-medium text-foreground underline underline-offset-2">My receipts</Link>.</p>}
        </div>

        {(showBreakdown || lines.length > 0) && (
          <details className="group border-t border-border">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-5 text-sm font-medium hover:bg-muted/40">How this amount is made up<span className="text-xs text-muted-foreground group-open:hidden">Show</span></summary>
            <div className="space-y-4 px-5 pb-5 text-sm">
              {showBreakdown && (
                <ul className="space-y-2">
                  {(bill.current_charges ?? 0) !== 0 && row("Current charges", bill.current_charges)}
                  {(bill.previous_balance ?? 0) !== 0 && row("Previous balance", bill.previous_balance)}
                  {(bill.penalties ?? 0) !== 0 && row("Penalties", bill.penalties)}
                  {(bill.adjustments ?? 0) !== 0 && row(`Adjustments (${Number(bill.adjustments) >= 0 ? "credit" : "debit"})`, bill.adjustments)}
                  {(bill.tax_amount ?? 0) !== 0 && row("Taxes", bill.tax_amount)}
                </ul>
              )}
              {lines.length > 0 && (
                <ul className="divide-y divide-border border-t border-border">
                  {lines.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 py-2"><span className="truncate">{l.description ?? l.kind ?? "Charge"}</span><span className="shrink-0 font-medium tabular-nums">{INR(l.amount)}</span></li>
                  ))}
                </ul>
              )}
              <div className="flex items-center justify-between border-t border-border pt-3 font-semibold"><span>Total payable</span><span className="tabular-nums">{INR(amount)}</span></div>
            </div>
          </details>
        )}
      </article>

      {open && (
        <section aria-labelledby="pay-h" className="space-y-3">
          <div>
            <h2 id="pay-h" className="font-semibold">Paid this bill?</h2>
            <p className="text-sm text-muted-foreground">Tell the committee about your Cash or Bank Transfer payment. The bill stays unpaid until they verify it and issue a receipt.</p>
          </div>
          <OfflinePaymentSubmitCard billId={bill.id} billAmount={amount} billStatus={bill.status} cancelled={!!bill.cancelled_at} />
        </section>
      )}
    </div>
  );
}
