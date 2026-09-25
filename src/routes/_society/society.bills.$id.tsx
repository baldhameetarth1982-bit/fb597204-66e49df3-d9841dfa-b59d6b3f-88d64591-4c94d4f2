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
import { toSafeFinanceError } from "@/lib/finance-safe-error";
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelBusy, setCancelBusy] = useState(false);
  const isAdmin = hasRole?.("society_admin") || hasRole?.("super_admin");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        // societyId is intentionally omitted — RLS scopes bills to the
        // caller's society admin / super admin rows. The server returns
        // bill_not_found for cross-society reads.
        const res = await loadDetail({ data: { billId: id } });
        if (!cancelled) setDetail(res);
      } catch (e) {
        if (!cancelled && toSafeFinanceError(e).kind !== "not_found") setLoadError(toSafeFinanceError(e).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, loadDetail, reloadKey]);

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
      toast.error(toSafeFinanceError(e).message);
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
        {loadError ? (<div role="alert" className="rounded-2xl border border-destructive/30 p-4 flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{loadError}</p><Button size="sm" variant="outline" className="min-h-11 shrink-0" onClick={() => setReloadKey((k) => k + 1)}>Try again</Button></div>) : (<p className="text-muted-foreground">This bill is not available in your society.</p>)}
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

  const statusBand = state.code === "paid" ? "bg-success-container text-success-container-foreground"
    : state.code === "overdue" ? "bg-danger-container text-danger-container-foreground"
    : state.code === "cancelled" ? "bg-muted text-muted-foreground"
    : "bg-warning-container text-warning-container-foreground";
  const onShare = async () => {
    try {
      await shareBillAsImage({
        societyName: detail.society?.name ?? "Society", flatLabel,
        residentName: detail.resident?.full_name ?? undefined,
        period: bill.period_label ?? "Bill", amount,
        dueDate: bill.due_date ? formatDate(bill.due_date) : "—",
        status: state.code === "paid" ? "paid" : state.code === "cancelled" ? "cancelled" : state.code === "overdue" ? "overdue" : "due",
        adminSignature: user?.email?.split("@")[0],
      });
    } catch { toast.error("Could not share this bill."); }
  };

  return (
    <PageShell>
      <Button asChild variant="ghost" className="mb-3 min-h-11 -ml-2 rounded-xl">
        <Link to="/society/billing"><ArrowLeft className="h-4 w-4 mr-1" />Bill history</Link>
      </Button>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
        <article className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card" aria-labelledby="bill-title">
          <div className={`flex items-center justify-between gap-3 px-5 py-2.5 text-sm font-medium ${statusBand}`}>
            <span>{state.label}</span>
            <span className="font-mono text-xs opacity-80">{bill.bill_number ?? "Bill"}</span>
          </div>
          <div className="p-5">
            <h1 id="bill-title" className="type-section">{bill.period_label ?? "Society bill"}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground"><Home className="h-4 w-4" />House {flatLabel}{detail.resident?.full_name && <> · {detail.resident.full_name}</>}</p>
            <div className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-5">
              <div>
                <p className="text-xs text-muted-foreground">Amount</p>
                <p className={`text-3xl font-semibold tabular-nums ${state.code === "cancelled" ? "line-through text-muted-foreground" : ""}`}>₹{amount.toLocaleString("en-IN")}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Due date</p>
                <p className={`text-lg font-semibold ${state.code === "overdue" ? "text-destructive" : ""}`}>{bill.due_date ? formatDate(bill.due_date) : "—"}</p>
              </div>
            </div>
          </div>

          {detail.lines.length > 0 && (
            <details className="group border-t border-border">
              <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-5 text-sm font-medium hover:bg-muted/40">Charges ({detail.lines.length})<span className="text-xs text-muted-foreground group-open:hidden">Show</span></summary>
              <ul className="divide-y divide-border px-5 pb-3">
                {detail.lines.map((l) => (
                  <li key={String(l.id)} className="flex items-center justify-between py-2 text-sm">
                    <span className="truncate">{(l.description as string | null) ?? (l.kind as string | null) ?? "Charge"}</span>
                    <span className="font-medium tabular-nums">₹{Number(l.amount ?? 0).toLocaleString("en-IN")}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          <details className="group border-t border-border">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-5 text-sm font-medium hover:bg-muted/40">History & details<span className="text-xs text-muted-foreground group-open:hidden">Show</span></summary>
            <div className="space-y-4 px-5 pb-5">
              <ol className="space-y-3">
                {bill.bill_date && (
                  <li className="flex items-start gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-container text-primary-container-foreground"><Receipt className="h-4 w-4" /></span>
                    <div><p className="text-sm font-medium">Bill generated</p><p className="flex items-center gap-1 text-xs text-muted-foreground"><Calendar className="h-3 w-3" />{formatDate(bill.bill_date)}</p></div>
                  </li>
                )}
                {bill.cancelled_at && (
                  <li className="flex items-start gap-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-danger-container text-danger-container-foreground"><XCircle className="h-4 w-4" /></span>
                    <div><p className="text-sm font-medium">Cancelled{bill.cancel_reason ? ` — ${bill.cancel_reason}` : ""}</p><p className="flex items-center gap-1 text-xs text-muted-foreground"><Calendar className="h-3 w-3" />{formatDate(bill.cancelled_at)}</p></div>
                  </li>
                )}
              </ol>
              {detail.resident?.phone && <p className="text-sm"><span className="text-muted-foreground">Resident mobile: </span>{detail.resident.phone}</p>}
              <p className="flex items-start gap-2 rounded-xl bg-muted/40 p-3 text-xs text-muted-foreground"><Info className="h-4 w-4 shrink-0" />Payments for this bill are verified on the Payments page. Verified payments issue receipts; pending ones don't change the bill.</p>
            </div>
          </details>
        </article>

        <aside className="space-y-2" aria-label="Bill actions">
          <Button className="h-11 w-full rounded-xl" onClick={() => void onShare()}><Share2 className="h-4 w-4 mr-2" />Share with resident</Button>
          <Button variant="outline" className="h-11 w-full rounded-xl" onClick={() => window.print()}><FileDown className="h-4 w-4 mr-2" />Print / PDF</Button>
          {state.code !== "paid" && state.code !== "cancelled" && (
            <Button asChild variant="outline" className="h-11 w-full rounded-xl"><Link to="/society/payments">Record or verify a payment</Link></Button>
          )}
          {canCancel && (
            <Button variant="ghost" className="h-11 w-full rounded-xl text-destructive" onClick={() => setCancelOpen(true)}><Ban className="h-4 w-4 mr-2" />Cancel bill</Button>
          )}
          {isAdmin && hasVerifiedPayment && !bill.cancelled_at && (
            <p className="px-1 text-xs text-muted-foreground">This bill has verified payments and can't be cancelled.</p>
          )}
        </aside>
      </div>

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
