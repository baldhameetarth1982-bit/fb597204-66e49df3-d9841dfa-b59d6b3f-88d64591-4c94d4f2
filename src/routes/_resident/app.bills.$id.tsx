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
import { formatDate } from "@/utils/format";
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

/**
 * Resident bill detail — Stage 3B read-only.
 *
 * NEVER exposes a payment button, gateway order, or "Payment successful"
 * copy. Ownership is enforced server-side by getResidentBillDetail via the
 * caller's active flat_residents link; unauthorized reads surface as
 * "Bill not found".
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
  const overdue = bill.due_date ? new Date(bill.due_date) < new Date() : false;
  const tone: "success" | "danger" | "warning" | "neutral" =
    bill.status === "paid" ? "success" :
    bill.status === "cancelled" ? "neutral" :
    overdue ? "danger" : "warning";

  return (
    <div className="px-5 py-6 space-y-4">
      <Button asChild variant="ghost" size="sm" className="rounded-lg -ml-2">
        <Link to="/app/bills"><ArrowLeft className="h-4 w-4 mr-1" />Back to bills</Link>
      </Button>

      <Card className="rounded-2xl">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                {bill.bill_number ?? "Bill"}
              </p>
              <h1 className="text-xl font-semibold">{bill.period_label ?? "Society bill"}</h1>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                <Home className="h-3.5 w-3.5" />
                <span>Your flat</span>
              </p>
            </div>
            <StatusChip tone={tone}>{(bill.status ?? "").toUpperCase()}</StatusChip>
          </div>

          <div className="mt-5 flex items-baseline gap-1">
            <IndianRupee className="h-5 w-5 text-muted-foreground" />
            <span className="text-3xl font-bold tabular-nums">
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

      {lines.length > 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">
              Charges
            </p>
            <ul className="divide-y">
              {lines.map((l) => (
                <li key={l.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="truncate">{l.description ?? l.kind ?? "Charge"}</span>
                  <span className="font-medium tabular-nums">
                    ₹{Number(l.amount ?? 0).toLocaleString("en-IN")}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 pt-3 border-t flex items-center justify-between">
              <span className="text-sm font-semibold">Total payable</span>
              <span className="text-base font-semibold tabular-nums">
                ₹{amount.toLocaleString("en-IN")}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl border-primary/10 bg-primary/5">
        <CardContent className="p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-primary shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">Online payments are coming soon</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Please pay your society admin offline for now. Once online payments are enabled, you'll see a Pay button here.
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
