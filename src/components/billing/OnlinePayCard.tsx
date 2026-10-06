import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CreditCard, Loader2, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openRazorpayForOrder } from "@/lib/razorpay";
import {
  confirmMaintenancePayment,
  getOnlinePaymentAvailability,
  startMaintenancePayment,
} from "@/lib/maintenance-online-payment.functions";
import { tu } from "@/lib/i18n";

const MESSAGES: Record<string, string> = {
  plan_required: "Online payment isn't part of your society's plan.",
  not_authorized: "Only current residents of this home can pay online.",
  bill_cancelled: "This bill was cancelled.",
  nothing_due: "Nothing is due on this bill.",
  payment_in_progress: "Someone in your home is already paying this bill. Try again in 30 minutes.",
  offline_payment_pending: "Another payment for this bill is waiting for the committee to check it.",
  rate_limited: "Too many tries. Please wait a while and try again.",
  provider_unavailable: "Online payment is unavailable right now. Please try later.",
};

export function OnlinePayCard({ billId, societyId, onPaid }: { billId: string; societyId: string; onPaid: () => void }) {
  const availability = useServerFn(getOnlinePaymentAvailability);
  const start = useServerFn(startMaintenancePayment);
  const confirm = useServerFn(confirmMaintenancePayment);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["online-pay-availability", societyId],
    queryFn: () => availability({ data: { societyId } }),
    staleTime: 60_000,
  });

  if (q.isLoading) return <div className="h-24 rounded-2xl bg-muted animate-pulse" aria-busy="true" />;
  if (q.isError || !q.data?.configured) return null;
  if (!q.data.enabled) {
    return (
      <div className="rounded-2xl border border-border p-4 flex gap-3">
        <Lock className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <p className="text-sm text-muted-foreground">{tu("op.online_payment_is_available_when")}</p>
      </div>
    );
  }

  async function pay() {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await start({ data: { billId, requestId: crypto.randomUUID() } });
      if (!res.ok) { toast.error(MESSAGES[res.code] ?? "Online payment is unavailable right now."); setBusy(false); return; }
      const opened = await openRazorpayForOrder({
        orderId: res.razorpayOrderId,
        keyId: res.keyId,
        amount: res.amountPaise,
        description: "Society maintenance",
        onSuccess: async (r) => {
          setStatus("checking");
          const out = await confirm({ data: { razorpayOrderId: r.razorpay_order_id, razorpayPaymentId: r.razorpay_payment_id, razorpaySignature: r.razorpay_signature } });
          setBusy(false);
          if (out.status === "paid") { setStatus("paid"); toast.success(tu("op.payment_received_your_receipt_is")); onPaid(); }
          else if (out.status === "needs_refund") { setStatus("refund"); }
          else if (out.status === "pending") { setStatus("pending"); }
          else { setStatus(null); toast.error(tu("op.we_couldn_t_confirm_this")); }
        },
        onDismiss: () => setBusy(false),
      });
      if (!opened) setBusy(false);
    } catch {
      setBusy(false);
      toast.error(tu("op.online_payment_is_unavailable_right"));
    }
  }

  return (
    <div className="rounded-2xl border border-border p-4 space-y-3">
      <div>
        <p className="font-medium">{tu("op.pay_online")}</p>
        <p className="text-sm text-muted-foreground">{tu("op.upi_card_or_netbanking_through")}</p>
      </div>
      <Button className="h-11 w-full rounded-xl" disabled={busy} onClick={() => void pay()}>
        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CreditCard className="h-4 w-4 mr-2" />}
        {status === "checking" ? tu("op.confirming_payment") : tu("op.pay_now")}
      </Button>
      {status === "pending" && <p role="status" className="text-sm text-muted-foreground">{tu("op.payment_is_still_being_confirmed")}</p>}
      {status === "refund" && <p role="status" className="text-sm text-muted-foreground">{tu("op.this_bill_was_already_settled")}</p>}
    </div>
  );
}
