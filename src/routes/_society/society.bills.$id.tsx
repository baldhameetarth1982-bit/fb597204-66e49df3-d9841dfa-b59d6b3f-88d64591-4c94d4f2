import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Loader2, ArrowLeft, Receipt, IndianRupee, Calendar, Home,
  XCircle, FileDown, Share2, Ban, Info,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useServerFn } from "@tanstack/react-start";
import { cancelBill, getAdminBillDetail, type AdminBillDetail } from "@/lib/billing-generate.functions";
import { getBillDisplayStatus } from "@/lib/bill-display-status";
import { toast } from "sonner";
import { shareBillAsImage } from "@/components/billing/BillCardImage";
import { formatDate } from "@/utils/format";

export const Route = createFileRoute("/_society/society/bills/$id")({
  head: () => ({ meta: [{ title: "Bill Detail — SociyoHub" }] }),
  component: BillDetailPage,
});

/**
 * Admin bill detail — Stage 3B.
 *
 * All reads go through getAdminBillDetail (server-authoritative). The UI
 * never joins bills, flats, societies, payments or profiles directly from
 * the browser client, and never renders "payment received" copy: Stage 3B
 * has no payments module. Cancellation is blocked when a verified payment
 * exists (payment_summary.has_verified_payment).
 */
function BillDetailPage() {
  const { id } = Route.useParams();
  const { user, hasRole } = useAuth();
  const loadDetail = useServerFn(getAdminBillDetail);
  const cancelBillFn = useServerFn(cancelBill);
  const [detail, setDetail] = useState<AdminBillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const isAdmin = hasRole?.("society_admin") || hasRole?.("super_admin");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // societyId is intentionally omitted — RLS scopes bills to the
        // caller's society admin / super admin rows. The server returns
        // bill_not_found for cross-society reads.
        const res = await loadDetail({ data: { billId: id } });
        if (!cancelled) setDetail(res);
      } catch (e) {
        if (!cancelled) toast.error((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, loadDetail]);

  async function onCancel() {
    if (!detail) return;
    setCancelBusy(true);
    try {
      await cancelBillFn({
        data: {
          societyId: detail.bill.society_id,
          billId: detail.bill.id,
          reason: cancelReason.trim() || undefined,
        },
      });
      toast.success("Bill cancelled");
      setCancelOpen(false);
      // Refresh detail server-authoritatively.
      const fresh = await loadDetail({
        data: { societyId: detail.bill.society_id, billId: detail.bill.id },
      });
      setDetail(fresh);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCancelBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-[60vh] grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!detail) {
    return (
      <PageShell>
        <p className="text-muted-foreground">Bill not found.</p>
        <Button asChild variant="ghost" className="mt-4">
          <Link to="/society/billing"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
        </Button>
      </PageShell>
    );
  }

  const bill = detail.bill;
  const flatLabel = `${detail.flat?.block_name ? detail.flat.block_name + "-" : ""}${detail.flat?.flat_number ?? "—"}`;
  const state = getBillDisplayStatus(bill);

  const canCancel = !!isAdmin && detail.can_cancel;
  const hasVerifiedPayment = detail.payment_summary.has_verified_payment;
  const amount = Number(bill.total_payable ?? bill.amount ?? 0);

  return (
    <PageShell>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm" className="rounded-lg -ml-2">
          <Link to="/society/billing"><ArrowLeft className="h-4 w-4 mr-1" />Billing Center</Link>
        </Button>
      </div>

      <Card className="rounded-2xl mb-4">
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                {bill.bill_number ?? "Bill"}
              </p>
              <h1 className="text-xl font-semibold">{bill.period_label ?? "Society bill"}</h1>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                <Home className="h-3.5 w-3.5" />{flatLabel}
                {detail.resident?.full_name && <> · {detail.resident.full_name}</>}
              </p>
            </div>
            <StatusChip tone={state.tone}>{state.label}</StatusChip>
          </div>

          <div className="mt-5 flex items-baseline gap-1">
            <IndianRupee className="h-5 w-5 text-muted-foreground" />
            <span className="text-3xl font-bold tabular-nums">{amount.toLocaleString("en-IN")}</span>
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
                <p className="font-medium">{formatDate(bill.due_date)}</p>
              </div>
            )}
            {bill.cancelled_at && (
              <div>
                <p className="text-xs text-muted-foreground">Cancelled on</p>
                <p className="font-medium">{formatDate(bill.cancelled_at)}</p>
              </div>
            )}
            {detail.resident?.phone && (
              <div>
                <p className="text-xs text-muted-foreground">Mobile</p>
                <p className="font-medium">{detail.resident.phone}</p>
              </div>
            )}
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="rounded-xl"
              onClick={async () => {
                try {
                  await shareBillAsImage({
                    societyName: detail.society?.name ?? "Society",
                    flatLabel,
                    residentName: detail.resident?.full_name ?? undefined,
                    period: bill.period_label ?? "Bill",
                    amount,
                    dueDate: bill.due_date ? formatDate(bill.due_date) : "—",
                    status: state.code === "paid" ? "paid" : state.code === "cancelled" ? "cancelled" : state.code === "overdue" ? "overdue" : "due",
                    adminSignature: user?.email?.split("@")[0],
                  });
                } catch (e) {
                  toast.error((e as Error)?.message ?? "Could not share");
                }
              }}
            >
              <Share2 className="h-4 w-4 mr-2" />Share
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="rounded-xl"
              onClick={() => window.print()}
            >
              <FileDown className="h-4 w-4 mr-2" />Print / PDF
            </Button>
            {canCancel && (
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl text-destructive border-destructive/40 hover:bg-destructive/10"
                onClick={() => setCancelOpen(true)}
              >
                <Ban className="h-4 w-4 mr-2" />Cancel bill
              </Button>
            )}
          </div>

          {isAdmin && hasVerifiedPayment && !bill.cancelled_at && (
            <p className="mt-3 text-xs text-muted-foreground">
              This bill has verified payment records and cannot be cancelled.
            </p>
          )}
        </CardContent>
      </Card>

      {detail.lines.length > 0 && (
        <Card className="rounded-2xl mb-4">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Charges</p>
            <ul className="divide-y">
              {detail.lines.map((l) => (
                <li key={String(l.id)} className="flex items-center justify-between py-2 text-sm">
                  <span className="truncate">
                    {(l.description as string | null) ?? (l.kind as string | null) ?? "Charge"}
                  </span>
                  <span className="font-medium tabular-nums">
                    ₹{Number(l.amount ?? 0).toLocaleString("en-IN")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl mb-4">
        <CardContent className="p-5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-3">Timeline</p>
          <ol className="space-y-3">
            {bill.bill_date && (
              <li className="flex items-start gap-3">
                <span className="h-8 w-8 rounded-full grid place-items-center bg-primary/10 text-primary shrink-0">
                  <Receipt className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">Bill generated</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />{formatDate(bill.bill_date)}
                  </p>
                </div>
              </li>
            )}
            {bill.cancelled_at && (
              <li className="flex items-start gap-3">
                <span className="h-8 w-8 rounded-full grid place-items-center bg-danger-container text-danger-container-foreground shrink-0">
                  <XCircle className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">
                    Cancelled{bill.cancel_reason ? ` — ${bill.cancel_reason}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" />{formatDate(bill.cancelled_at)}
                  </p>
                </div>
              </li>
            )}
          </ol>
          <div className="mt-4 rounded-xl bg-muted/40 p-3 flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Payment records and receipts are part of Stage 3C. Stage 3B tracks bill generation and cancellation only.
            </p>
          </div>
        </CardContent>
      </Card>

      <Dialog open={cancelOpen} onOpenChange={(v) => (cancelBusy ? null : setCancelOpen(v))}>
        <DialogContent>
          <DialogHeader><DialogTitle>Cancel this bill?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will mark bill <span className="font-medium">{bill.bill_number ?? String(bill.id).slice(0, 8)}</span> as cancelled and log an audit entry. It cannot be undone. If verified payments are later recorded, cancellation is blocked.
          </p>
          <Textarea
            placeholder="Reason (optional)"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            maxLength={500}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)} disabled={cancelBusy}>Keep</Button>
            <Button variant="destructive" onClick={onCancel} disabled={cancelBusy}>
              {cancelBusy ? "Cancelling…" : "Cancel bill"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
