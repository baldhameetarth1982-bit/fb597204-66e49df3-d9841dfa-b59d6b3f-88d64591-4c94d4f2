import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, IndianRupee, CheckCircle2, Clock, XCircle } from "lucide-react";
import {
  submitResidentBankTransfer,
  getPaymentReceipt,
  getResidentPayments,
} from "@/lib/offline-payments.functions";
import { tu } from "@/lib/i18n";

/**
 * Stage 3C — Offline payment submission for a resident.
 *
 * Cash and Bank Transfer only. Every submission stays pending until an
 * admin verifies it; only then does the receipt number appear here.
 */

type Props = {
  billId: string;
  billAmount: number;
  billStatus: string;
  cancelled: boolean;
};

type Method = "cash" | "bank_transfer";

function randomKey(billId: string) {
  return `pay_${billId.slice(0, 8)}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function OfflinePaymentSubmitCard({ billId, billAmount, billStatus, cancelled }: Props) {
  const submit = useServerFn(submitResidentBankTransfer);
  const fetchReceipt = useServerFn(getPaymentReceipt);
  const listPayments = useServerFn(getResidentPayments);
  // Residents can only submit Bank Transfer. Cash entry is admin-only.
  const method: Method = "bank_transfer";
  const setMethod = (_: Method) => {};
  void setMethod;
  const [amount, setAmount] = useState<string>(billAmount ? String(billAmount) : "");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentDate, setPaymentDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [idKey] = useState<string>(() => randomKey(billId));
  const [submitting, setSubmitting] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [receiptNumber, setReceiptNumber] = useState<string | null>(null);
  const [receiptStatus, setReceiptStatus] = useState<"valid" | "void" | null>(null);
  const [loadingExisting, setLoadingExisting] = useState(true);
  const [rejected, setRejected] = useState<{ rejection_reason: string | null } | null>(null);

  const disabled = useMemo(
    () => cancelled || billStatus === "paid",
    [cancelled, billStatus],
  );

  // A submission lives on the server, not in this component's state. Without
  // this, a refresh (or a later rejection) made the resident's submission
  // look as if it had never happened.
  useEffect(() => {
    let stopped = false;
    (async () => {
      try {
        const res = await listPayments({ data: { limit: 200, offset: 0 } });
        const mine = (res?.payments ?? [])
          .filter((p) => p.bill_id === billId)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        const latest = mine[0];
        if (stopped || !latest) return;
        if (latest.status === "rejected") {
          setRejected({ rejection_reason: latest.rejection_reason });
        } else {
          setPaymentId(latest.id);
        }
      } catch {
        // Non-fatal: the resident can still submit; the server rejects duplicates.
      } finally {
        if (!stopped) setLoadingExisting(false);
      }
    })();
    return () => {
      stopped = true;
    };
  }, [billId, listPayments]);

  useEffect(() => {
    if (!paymentId) return;
    let stopped = false;
    (async () => {
      try {
        const r = await fetchReceipt({ data: { paymentId } });
        if (!stopped && r?.receipt?.receipt_number) {
          setReceiptNumber(r.receipt.receipt_number);
          setReceiptStatus(r.receipt.status);
        }
      } catch {
        // silent; receipt may not be issued yet
      }
    })();
    return () => {
      stopped = true;
    };
  }, [paymentId, fetchReceipt]);

  if (disabled) return null;

  async function onSubmit() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error(tu("acc.enterAmount"));
      return;
    }
    if (method === "bank_transfer" && !reference.trim()) {
      toast.error(tu("op.reference_number_is_required_for"));
      return;
    }
    setSubmitting(true);
    try {
      const res = await submit({
        data: {
          billId,
          amount: amt,
          paymentDate,
          referenceNo: reference.trim(),
          notes: notes.trim() || null,
          idempotencyKey: idKey,
        },
      });
      setPaymentId(res.paymentId);
      toast.success(tu("op.payment_recorded_waiting_for_admin"));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingExisting) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{tu("op.checking_your_payment_status")}</span>
        </CardContent>
      </Card>
    );
  }

  if (rejected) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <XCircle className="h-4 w-4 text-destructive" />
            <span>{tu("op.payment_not_accepted")}</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {rejected.rejection_reason
              ? `Your society office did not accept this submission: ${rejected.rejection_reason}`
              : tu("op.your_society_office_did_not")}
          </p>
          <Button size="sm" variant="outline" onClick={() => setRejected(null)}>
            {tu("op.submit_again")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (paymentId) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            {receiptNumber && receiptStatus === "void" ? (
              <>
                <XCircle className="h-4 w-4 text-red-600" />
                <span>{tu("op.receipt_void_payment_reversed")}</span>
              </>
            ) : receiptNumber ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>{tu("docState.paymentVerified")}</span>
              </>
            ) : (
              <>
                <Clock className="h-4 w-4 text-amber-600" />
                <span>{tu("op.pending_admin_verification")}</span>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {receiptNumber && receiptStatus === "void"
              ? `Receipt ${receiptNumber} was voided by the admin. This payment no longer counts toward your bill.`
              : receiptNumber
                ? `Receipt ${receiptNumber} issued.`
                : tu("op.your_submission_has_been_recorded")}
          </p>
        </CardContent>
      </Card>
    );
  }


  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5 space-y-4">
        <div>
          <p className="text-sm font-semibold">{tu("op.record_payment")}</p>
          <p className="text-xs text-muted-foreground">
            {tu("op.bank_transfer_only_submitting_this")}
          </p>
        </div>

        <div className="rounded-xl border bg-muted/40 px-3 py-2 text-xs font-medium">
          {tu("op.method_bank_transfer")}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pay-amount">{tu("acc.amountInr")}</Label>
          <div className="relative">
            <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="pay-amount"
              inputMode="decimal"
              className="pl-9"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pay-date">{tu("op.payment_date")}</Label>
          <Input
            id="pay-date"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pay-ref">{tu("op.reference_utr")}</Label>
          <Input
            id="pay-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. UTR12345678"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pay-notes">{tu("op.notes_optional")}</Label>
          <Textarea
            id="pay-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={tu("op.anything_the_admin_should_know")}
            rows={2}
          />
        </div>

        <Button className="w-full rounded-xl" onClick={onSubmit} disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              {tu("nd.submitting")}
            </>
          ) : (
            tu("op.submit_for_verification")
          )}
        </Button>

        <p className="text-[11px] text-muted-foreground flex items-start gap-1">
          <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
          {tu("op.payment_becomes_final_only_after")}
        </p>

      </CardContent>
    </Card>
  );
}
