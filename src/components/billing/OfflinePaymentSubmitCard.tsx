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
} from "@/lib/offline-payments.functions";

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

  const disabled = useMemo(
    () => cancelled || billStatus === "paid",
    [cancelled, billStatus],
  );

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
      toast.error("Enter a valid amount");
      return;
    }
    if (method === "bank_transfer" && !reference.trim()) {
      toast.error("Reference number is required for bank transfers");
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
      toast.success("Payment recorded. Waiting for admin verification.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (paymentId) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-5 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium">
            {receiptNumber && receiptStatus === "void" ? (
              <>
                <XCircle className="h-4 w-4 text-red-600" />
                <span>Receipt VOID (payment reversed)</span>
              </>
            ) : receiptNumber ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span>Payment verified</span>
              </>
            ) : (
              <>
                <Clock className="h-4 w-4 text-amber-600" />
                <span>Pending admin verification</span>
              </>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {receiptNumber && receiptStatus === "void"
              ? `Receipt ${receiptNumber} was voided by the admin. This payment no longer counts toward your bill.`
              : receiptNumber
                ? `Receipt ${receiptNumber} issued.`
                : "Your submission has been recorded. You'll see the receipt here once your society office verifies it."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-5 space-y-4">
        <div>
          <p className="text-sm font-semibold">Record payment</p>
          <p className="text-xs text-muted-foreground">
            Bank Transfer only. Submitting this does not confirm payment — your society admin must verify it before a receipt is issued. To pay with cash, contact your society office.
          </p>
        </div>

        <div className="rounded-xl border bg-muted/40 px-3 py-2 text-xs font-medium">
          Method: Bank Transfer
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pay-amount">Amount (₹)</Label>
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
          <Label htmlFor="pay-date">Payment date</Label>
          <Input
            id="pay-date"
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pay-ref">Reference / UTR</Label>
          <Input
            id="pay-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. UTR12345678"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="pay-notes">Notes (optional)</Label>
          <Textarea
            id="pay-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything the admin should know"
            rows={2}
          />
        </div>

        <Button className="w-full rounded-xl" onClick={onSubmit} disabled={submitting}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Submitting…
            </>
          ) : (
            "Submit for verification"
          )}
        </Button>

        <p className="text-[11px] text-muted-foreground flex items-start gap-1">
          <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
          Payment becomes final only after your society admin verifies it.
        </p>

      </CardContent>
    </Card>
  );
}
