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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await load({ data: { billId: id } });
        if (cancelled) return;
        setBill(res.bill as unknown as Bill);
        setLines((res.lines ?? []) as unknown as Line[]);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, load]);

  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!bill) {
    return (
      <div className="px-5 py-6">
        <p className="text-muted-foreground">Bill not found.</p>
        <Button asChild variant="ghost" className="mt-4">
          <Link to="/app/bills"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
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

  return (
    <div className="px-5 py-6 space-y-4">
      <Button asChild variant="ghost" size="sm" className="rounded-lg -ml-2">
        <Link to="/app/bills"><ArrowLeft className="h-4 w-4 mr-1" />Back to bills</Link>
      </Button>

      <Card className="rounded-2xl">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                {bill.bill_number ?? "Bill"}
              </p>
              <h1 className="text-xl font-semibold truncate">{bill.period_label ?? "Society bill"}</h1>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                <Home className="h-3.5 w-3.5" />
                <span>Your flat</span>
              </p>
            </div>
            <StatusChip tone={state.tone}>{state.label}</StatusChip>
          </div>

          {state.isCancelled && (
            <p className="mt-3 text-xs text-muted-foreground">
              This bill has been cancelled and is not an active bill.
            </p>
          )}

          <div className="mt-5 flex items-baseline gap-1 min-w-0">
            <IndianRupee className="h-5 w-5 text-muted-foreground shrink-0" />
            <span className="text-3xl font-bold tabular-nums truncate">
              {amount.toLocaleString("en-IN")}
            </span>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            {bill.bill_date && (
              <div>
                <p className="text-xs text-muted-foreground">Generated</p>
                <p className="font-medium">{formatDate(bill.bill_date)}</p>
              </div>
            )}
            {bill.due_date && (
              <div>
                <p className="text-xs text-muted-foreground">Due date</p>
                <p className="font-medium flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                  {formatDate(bill.due_date)}
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {showBreakdown && (
        <Card className="rounded-2xl">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
              Breakdown
            </p>
            <ul className="space-y-2 text-sm">
              {(bill.current_charges ?? 0) !== 0 && (
                <li className="flex items-center justify-between gap-3">
                  <span>Current charges</span>
                  <span className="tabular-nums font-medium">{INR(bill.current_charges)}</span>
                </li>
              )}
              {(bill.previous_balance ?? 0) !== 0 && (
                <li className="flex items-center justify-between gap-3">
                  <span>Previous balance</span>
                  <span className="tabular-nums font-medium">{INR(bill.previous_balance)}</span>
                </li>
              )}
              {(bill.penalties ?? 0) !== 0 && (
                <li className="flex items-center justify-between gap-3">
                  <span>Penalties</span>
                  <span className="tabular-nums font-medium">{INR(bill.penalties)}</span>
                </li>
              )}
              {(bill.adjustments ?? 0) !== 0 && (
                <li className="flex items-center justify-between gap-3">
                  <span>
                    Adjustments{" "}
                    <span className="text-xs text-muted-foreground">
                      ({Number(bill.adjustments) >= 0 ? "credit" : "debit"})
                    </span>
                  </span>
                  <span className="tabular-nums font-medium">{INR(bill.adjustments)}</span>
                </li>
              )}
              {(bill.tax_amount ?? 0) !== 0 && (
                <li className="flex items-center justify-between gap-3">
                  <span>Taxes</span>
                  <span className="tabular-nums font-medium">{INR(bill.tax_amount)}</span>
                </li>
              )}
            </ul>
            <div className="mt-3 pt-3 border-t flex items-center justify-between">
              <span className="text-sm font-semibold">Total payable</span>
              <span className="text-base font-semibold tabular-nums">{INR(amount)}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {lines.length > 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
              Line items
            </p>
            <ul className="divide-y">
              {lines.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate">{l.description ?? l.kind ?? "Charge"}</span>
                  <span className="font-medium tabular-nums shrink-0">{INR(l.amount)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-primary/10 bg-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">Read-only bill</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Payment recording and receipt verification are handled
              separately. This bill cannot be changed from this screen.
              Contact your society office for the currently approved
              payment instructions.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
        <Receipt className="h-3.5 w-3.5" />
        Powered by SociyoHub
      </div>
    </div>
  );
}
