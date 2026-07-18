import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/system/StatusChip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  RotateCcw,
  Loader2,
  Receipt,
  Clock,
  Search,
  Plus,
} from "lucide-react";
import { useSocietyId } from "@/hooks/useSocietyId";
import {
  listSocietyPayments,
  verifyOfflinePayment,
  rejectOfflinePayment,
  reverseOfflinePayment,
  recordAdminOfflinePayment,
  searchOpenBillsForPayment,
  type OfflinePaymentRow,
  type OpenBillForPayment,
} from "@/lib/offline-payments.functions";
import { formatDate } from "@/utils/format";


export const Route = createFileRoute("/_society/society/payments")({
  head: () => ({ meta: [{ title: "Payments — SociyoHub" }] }),
  component: SocietyPaymentsRoute,
});

type Tab = "pending" | "verified" | "rejected" | "reversed";
type Confirm =
  | { kind: "verify"; p: OfflinePaymentRow }
  | { kind: "reject"; p: OfflinePaymentRow; reason: string }
  | { kind: "reverse"; p: OfflinePaymentRow; reason: string };

function SocietyPaymentsRoute() {
  const { societyId, loading: idLoading } = useSocietyId();
  const list = useServerFn(listSocietyPayments);
  const verify = useServerFn(verifyOfflinePayment);
  const reject = useServerFn(rejectOfflinePayment);
  const reverse = useServerFn(reverseOfflinePayment);
  const [tab, setTab] = useState<Tab>("pending");
  const [rows, setRows] = useState<OfflinePaymentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  async function refresh() {
    if (!societyId) return;
    setLoading(true);
    try {
      const { payments } = await list({ data: { societyId, status: tab, limit: 100 } });
      setRows(payments);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [societyId, tab]);

  function onVerify(p: OfflinePaymentRow) {
    setConfirm({ kind: "verify", p });
  }
  function onReject(p: OfflinePaymentRow) {
    const reason = (reasonById[p.id] ?? "").trim();
    if (!reason) {
      toast.error("Enter a reason before rejecting");
      return;
    }
    setConfirm({ kind: "reject", p, reason });
  }
  function onReverse(p: OfflinePaymentRow) {
    const reason = (reasonById[p.id] ?? "").trim();
    if (!reason) {
      toast.error("Enter a reason before reversing");
      return;
    }
    setConfirm({ kind: "reverse", p, reason });
  }

  async function executeConfirm() {
    if (!confirm) return;
    const { kind, p } = confirm;
    setBusyId(p.id);
    try {
      if (kind === "verify") {
        const res = await verify({ data: { paymentId: p.id, notes: null } });
        toast.success(
          res.receiptNumber ? `Verified. Receipt ${res.receiptNumber}` : "Payment verified",
        );
      } else if (kind === "reject") {
        await reject({ data: { paymentId: p.id, reason: confirm.reason } });
        toast.success("Payment rejected");
      } else {
        await reverse({ data: { paymentId: p.id, reason: confirm.reason } });
        toast.success("Payment reversed and receipt voided");
      }
      setConfirm(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  if (idLoading) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!societyId) {
    return <p className="p-6 text-muted-foreground">No society context available.</p>;
  }

  const TABS: { id: Tab; label: string; tone: "warning" | "success" | "danger" | "neutral" }[] = [
    { id: "pending", label: "Pending", tone: "warning" },
    { id: "verified", label: "Verified", tone: "success" },
    { id: "rejected", label: "Rejected", tone: "danger" },
    { id: "reversed", label: "Reversed", tone: "neutral" },
  ];

  return (
    <div className="px-5 py-6 space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-xl font-semibold">Payments</h1>
        <p className="text-sm text-muted-foreground">
          Verify offline maintenance payments (Cash / Bank Transfer). Receipts are issued only after verification.
        </p>
      </div>

      <RecordOfflinePaymentSection societyId={societyId} onRecorded={refresh} />



      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <Button
            key={t.id}
            variant={tab === t.id ? "default" : "outline"}
            size="sm"
            className="rounded-full"
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="grid place-items-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <Card className="rounded-2xl">
          <CardContent className="p-6 text-sm text-muted-foreground text-center">
            No {tab} payments.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {rows.map((p) => (
            <Card key={p.id} className="rounded-2xl">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums">
                      ₹{Number(p.amount).toLocaleString("en-IN")}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        · {p.method === "bank_transfer" ? "Bank Transfer" : p.method === "cash" ? "Cash" : p.method}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {p.reference_no ? `Ref: ${p.reference_no}` : "No reference"} ·{" "}
                      {p.payment_date ? formatDate(p.payment_date) : "date n/a"}
                    </p>
                    {p.notes && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {p.notes}
                      </p>
                    )}
                  </div>
                  <StatusChip
                    tone={
                      p.status === "verified"
                        ? "success"
                        : p.status === "pending"
                          ? "warning"
                          : p.status === "rejected"
                            ? "danger"
                            : "neutral"
                    }
                  >
                    {p.status}
                  </StatusChip>
                </div>

                {p.status === "verified" && p.verified_at && (
                  <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Receipt className="h-3 w-3" />
                    Verified {formatDate(p.verified_at)}
                    {p.verification_notes ? ` · ${p.verification_notes}` : ""}
                  </p>
                )}
                {p.status === "rejected" && p.rejection_reason && (
                  <p className="text-[11px] text-muted-foreground">
                    Rejected: {p.rejection_reason}
                  </p>
                )}
                {p.status === "reversed" && p.reversal_reason && (
                  <p className="text-[11px] text-muted-foreground">
                    Reversed: {p.reversal_reason}
                  </p>
                )}

                {(tab === "pending" || tab === "verified") && (
                  <div className="space-y-2">
                    {tab !== "verified" && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          className="rounded-lg"
                          onClick={() => onVerify(p)}
                          disabled={busyId === p.id}
                        >
                          {busyId === p.id ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 mr-1" />
                          )}
                          Verify
                        </Button>
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label htmlFor={`reason-${p.id}`} className="text-[11px]">
                        {tab === "verified" ? "Reason to reverse" : "Reason to reject"}
                      </Label>
                      <Textarea
                        id={`reason-${p.id}`}
                        rows={2}
                        value={reasonById[p.id] ?? ""}
                        onChange={(e) =>
                          setReasonById((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        placeholder="Required"
                      />
                      <div className="flex gap-2">
                        {tab === "pending" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-lg"
                            onClick={() => onReject(p)}
                            disabled={busyId === p.id}
                          >
                            <XCircle className="h-4 w-4 mr-1" />
                            Reject
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-lg"
                            onClick={() => onReverse(p)}
                            disabled={busyId === p.id}
                          >
                            <RotateCcw className="h-4 w-4 mr-1" />
                            Reverse
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {p.submitted_at && (
                  <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Submitted {formatDate(p.submitted_at)}
                    {p.source ? ` · ${p.source.replace("_", " ")}` : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "verify"
                ? "Verify this payment?"
                : confirm?.kind === "reject"
                  ? "Reject this payment?"
                  : "Reverse this verified payment?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm ? (
                <>
                  <div className="mb-2">
                    <span className="font-semibold tabular-nums">
                      ₹{Number(confirm.p.amount).toLocaleString("en-IN")}
                    </span>{" "}
                    ·{" "}
                    {confirm.p.method === "bank_transfer"
                      ? "Bank Transfer"
                      : confirm.p.method === "cash"
                        ? "Cash"
                        : confirm.p.method}
                    {confirm.p.reference_no ? ` · Ref ${confirm.p.reference_no}` : ""}
                  </div>
                  {confirm.kind === "verify" && (
                    <>Verifying issues a receipt and marks the bill balance paid. This cannot be undone by editing — you would need to reverse it later.</>
                  )}
                  {confirm.kind === "reject" && (
                    <>Rejecting closes this submission with the reason below. No receipt is issued.</>
                  )}
                  {confirm.kind === "reverse" && (
                    <>Reversing voids the receipt and re-opens the bill balance. This is a permanent audit event.</>
                  )}
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!busyId}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeConfirm} disabled={!!busyId}>
              {busyId ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Working…
                </>
              ) : confirm?.kind === "verify" ? (
                "Verify"
              ) : confirm?.kind === "reject" ? (
                "Reject"
              ) : (
                "Reverse"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ---------------- Admin Record Offline Payment section ---------------- */

function randomIdKey(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function RecordOfflinePaymentSection({
  societyId,
  onRecorded,
}: {
  societyId: string;
  onRecorded: () => void;
}) {
  const search = useServerFn(searchOpenBillsForPayment);
  const record = useServerFn(recordAdminOfflinePayment);

  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<OpenBillForPayment[]>([]);
  const [selected, setSelected] = useState<OpenBillForPayment | null>(null);

  const [method, setMethod] = useState<"cash" | "bank_transfer">("cash");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [paymentDate, setPaymentDate] = useState<string>(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [submitting, setSubmitting] = useState(false);
  const [idKey, setIdKey] = useState(() => randomIdKey("adm"));

  const canSubmit = useMemo(
    () =>
      !!selected &&
      Number(amount) > 0 &&
      (method === "cash" || reference.trim().length > 0),
    [selected, amount, method, reference],
  );

  async function runSearch() {
    setSearching(true);
    try {
      const { bills } = await search({
        data: { societyId, query, limit: 20 },
      });
      setResults(bills);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  async function onSubmit() {
    if (!selected) return;
    setSubmitting(true);
    try {
      const res = await record({
        data: {
          billId: selected.bill_id,
          method,
          amount: Number(amount),
          paymentDate,
          referenceNo: reference.trim() || null,
          notes: notes.trim() || null,
          idempotencyKey: idKey,
        },
      });
      toast.success(`Recorded (pending verification). Payment ${res.paymentId.slice(0, 8)}…`);
      // Reset for next entry
      setSelected(null);
      setAmount("");
      setReference("");
      setNotes("");
      setIdKey(randomIdKey("adm"));
      onRecorded();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!expanded) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Record offline payment</p>
            <p className="text-xs text-muted-foreground">
              Enter a Cash or Bank Transfer payment received at the office. Verification happens as a separate step.
            </p>
          </div>
          <Button size="sm" className="rounded-lg" onClick={() => setExpanded(true)}>
            <Plus className="h-4 w-4 mr-1" /> Record
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Record offline payment</p>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-lg"
            onClick={() => {
              setExpanded(false);
              setSelected(null);
            }}
          >
            Cancel
          </Button>
        </div>

        {!selected ? (
          <div className="space-y-2">
            <Label htmlFor="bill-search" className="text-xs">
              Find bill by flat or bill number
            </Label>
            <div className="flex gap-2">
              <Input
                id="bill-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. A-101 or RR/202607/0001"
                onKeyDown={(e) => {
                  if (e.key === "Enter") runSearch();
                }}
              />
              <Button
                size="sm"
                className="rounded-lg"
                onClick={runSearch}
                disabled={searching}
              >
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </div>
            {results.length > 0 && (
              <div className="border rounded-lg divide-y max-h-64 overflow-y-auto">
                {results.map((b) => (
                  <button
                    key={b.bill_id}
                    className="w-full text-left p-2 text-xs hover:bg-muted/50"
                    onClick={() => {
                      setSelected(b);
                      setAmount(String(b.total_payable ?? ""));
                    }}
                  >
                    <div className="font-medium">
                      {b.flat_label ?? "Unit ?"}{b.block_name ? ` · ${b.block_name}` : ""} · {b.bill_number ?? "no number"}
                    </div>
                    <div className="text-muted-foreground">
                      ₹{Number(b.total_payable ?? 0).toLocaleString("en-IN")} · {b.status}{b.due_date ? ` · due ${b.due_date}` : ""}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {!searching && results.length === 0 && query.length > 0 && (
              <p className="text-xs text-muted-foreground">No matching open bills.</p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border bg-muted/30 p-2 text-xs">
              <div className="font-medium">
                {selected.flat_label ?? "Unit"} · {selected.bill_number ?? "no number"}
              </div>
              <div className="text-muted-foreground">
                Amount payable ₹{Number(selected.total_payable ?? 0).toLocaleString("en-IN")}
              </div>
              <button
                className="text-primary underline text-xs mt-1"
                onClick={() => setSelected(null)}
              >
                Change bill
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Method</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={method === "cash" ? "default" : "outline"}
                    className="rounded-lg flex-1"
                    onClick={() => setMethod("cash")}
                  >
                    Cash
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={method === "bank_transfer" ? "default" : "outline"}
                    className="rounded-lg flex-1"
                    onClick={() => setMethod("bank_transfer")}
                  >
                    Bank
                  </Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="adm-amount" className="text-xs">Amount (₹)</Label>
                <Input
                  id="adm-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="adm-date" className="text-xs">Date</Label>
                <Input
                  id="adm-date"
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="adm-ref" className="text-xs">
                  Reference {method === "bank_transfer" ? "(required)" : "(optional)"}
                </Label>
                <Input
                  id="adm-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={method === "bank_transfer" ? "UTR" : "Receipt / slip #"}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="adm-notes" className="text-xs">Notes</Label>
              <Textarea
                id="adm-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <Button
              size="sm"
              className="rounded-lg w-full"
              onClick={onSubmit}
              disabled={!canSubmit || submitting}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : null}
              Record payment (pending verification)
            </Button>
            <p className="text-[11px] text-muted-foreground">
              Recording does not verify the payment. Verify it from the Pending tab to issue a receipt.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
