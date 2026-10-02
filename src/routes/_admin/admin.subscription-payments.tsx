import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { CreditCard, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ErrorState } from "@/components/system/ErrorState";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  listAdminSaasSubscriptionPayments,
  refundSaasSubscriptionPayment,
} from "@/lib/saas-subscription-lifecycle.functions";

export const Route = createFileRoute("/_admin/admin/subscription-payments")({
  head: () => ({
    meta: [
      { title: "Subscription payments — SociyoHub Super Admin" },
      { name: "description", content: "Review and reconcile SociyoHub subscription payments and refunds." },
      { property: "og:title", content: "Subscription payments — SociyoHub Super Admin" },
      { property: "og:description", content: "Review and reconcile SociyoHub subscription payments and refunds." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SubscriptionPaymentsPage,
});

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function SubscriptionPaymentsPage() {
  const listPayments = useServerFn(listAdminSaasSubscriptionPayments);
  const refundPayment = useServerFn(refundSaasSubscriptionPayment);
  const [target, setTarget] = useState<{ id: string; society: string; amount: number } | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const requestIds = useRef(new Map<string, string>());
  const payments = useQuery({
    queryKey: ["admin-saas-subscription-payments"],
    queryFn: () => listPayments(),
  });

  async function refund() {
    if (!target) return;
    setBusy(true);
    const requestId = requestIds.current.get(target.id) ?? crypto.randomUUID();
    requestIds.current.set(target.id, requestId);
    try {
      const result = await refundPayment({
        data: { paymentId: target.id, requestId, reason },
      });
      if (result.status === "refunded") {
        toast.success("Refund confirmed and subscription history updated.");
        requestIds.current.delete(target.id);
      } else {
        toast.info("Refund submitted. It remains pending until Razorpay confirms it.");
      }
      setTarget(null);
      setReason("");
      await payments.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Refund could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Subscription payments"
        description="SociyoHub plan payments only. Society maintenance collections and ledgers are not changed here."
      />
      {payments.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : payments.isError ? (
        <ErrorState description="Payment history could not be loaded. No payment state was changed." onRetry={() => payments.refetch()} />
      ) : payments.data?.length ? (
        <section aria-label="Subscription payment history" className="overflow-hidden rounded-lg border bg-card">
          <ul className="divide-y">
            {payments.data.map((payment) => {
              const society = Array.isArray(payment.societies)
                ? payment.societies[0]?.name ?? "Society"
                : payment.societies?.name ?? "Society";
              return (
                <li key={payment.id} className="grid gap-4 p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <p className="font-semibold">{society}</p>
                    <p className="text-sm text-muted-foreground capitalize">{payment.plan_id} plan · {formatDate(payment.confirmed_at ?? payment.created_at)}</p>
                    {payment.receipt && <p className="mt-1 text-xs text-muted-foreground">Receipt {payment.receipt.receipt_number}</p>}
                  </div>
                  <div>
                    <p className="font-semibold tabular-nums">₹{(payment.amount_paise / 100).toLocaleString("en-IN")}</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Badge variant="outline" className="capitalize">{payment.lifecycle_status.replaceAll("_", " ")}</Badge>
                      {payment.provider_mode && <Badge variant="secondary">{payment.provider_mode}</Badge>}
                    </div>
                  </div>
                  {payment.lifecycle_status === "captured" && payment.razorpay_payment_id && (
                    <Button variant="outline" className="min-h-11" onClick={() => setTarget({ id: payment.id, society, amount: payment.amount_paise })}>
                      <RotateCcw className="mr-2 h-4 w-4" /> Refund
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : (
        <div className="rounded-lg border bg-card p-8 text-center">
          <CreditCard className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No subscription payment records yet.</p>
        </div>
      )}

      <AlertDialog open={!!target} onOpenChange={(open) => { if (!open && !busy) { setTarget(null); setReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Refund this subscription payment?</AlertDialogTitle>
            <AlertDialogDescription>
              {target ? `Refund ₹${(target.amount / 100).toLocaleString("en-IN")} for ${target.society}.` : ""} The subscription period is adjusted only after Razorpay confirms the refund.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="subscription-refund-reason">Reason saved in audit history</Label>
            <Textarea id="subscription-refund-reason" rows={4} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep payment</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void refund(); }} disabled={busy || reason.trim().length < 3}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Confirm refund
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}