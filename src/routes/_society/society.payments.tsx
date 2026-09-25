import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { StatusChip } from "@/components/system/StatusChip";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { BillingCenterTabs } from "@/components/nav/BillingCenterTabs";
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
import { toSafeFinanceError } from "@/lib/finance-safe-error";

const STATUS_LABEL: Record<string, string> = {
  pending: "Awaiting verification",
  verified: "Verified",
  rejected: "Rejected",
  reversed: "Reversed",
};



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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<Confirm | null>(null);

  async function refresh() {
    if (!societyId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const { payments } = await list({ data: { societyId, status: tab, limit: 100 } });
      setRows(payments);
    } catch (e) {
      // Never show "no payments" after a failed load.
      setRows([]);
      setLoadError(toSafeFinanceError(e).message);
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
      toast.error(toSafeFinanceError(e).message);
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

  const TAB_META: Record<Tab, { title: string; hint: string; empty: string; bar: string }> = {
    pending: { title: "Awaiting verification", hint: "Check each payment against cash received or your bank statement before verifying.", empty: "No payments waiting for verification. You're all caught up.", bar: "bg-warning" },
    verified: { title: "Verified", hint: "Receipts have been issued. Reverse only if a payment was recorded in error.", empty: "No verified payments yet.", bar: "bg-success" },
    rejected: { title: "Rejected", hint: "Closed without a receipt. Kept for the record.", empty: "No rejected payments.", bar: "bg-destructive" },
    reversed: { title: "Reversed", hint: "Receipts voided and bill balances re-opened. History is kept.", empty: "No reversed payments.", bar: "bg-muted-foreground" },
  };
  const meta = TAB_META[tab];
  const methodLabel = (m: string) => (m === "bank_transfer" ? "Bank Transfer" : m === "cash" ? "Cash" : m);

  return (
    <PageShell>
      <PageHeader title="Payments" description="Cash and Bank Transfer payments. A receipt is issued only after you verify a payment." />
      <div className="mb-5 rounded-2xl border border-border bg-card"><BillingCenterTabs /></div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-4">
          <div role="tablist" aria-label="Payment status" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {TABS.map((t) => {
              const active = tab === t.id;
              return (
                <button key={t.id} type="button" role="tab" aria-selected={active} onClick={() => setTab(t.id)}
                  className={`flex min-h-12 items-center gap-2 rounded-xl border px-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? "border-foreground bg-card shadow-sm" : "border-border bg-card/60 text-muted-foreground hover:text-foreground"}`}>
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${TAB_META[t.id].bar}`} aria-hidden />
                  {t.id === "pending" ? "Awaiting" : t.label}
                </button>
              );
            })}
          </div>

          <div>
            <h2 className="font-semibold">{meta.title}</h2>
            <p className="text-sm text-muted-foreground">{meta.hint}</p>
          </div>

          {loading ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading payments">
              {[0, 1, 2].map((i) => <div key={i} className="h-24 rounded-2xl bg-muted animate-pulse" />)}
            </div>
          ) : loadError ? (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-2xl border border-destructive/30 bg-card p-4">
              <p className="text-sm text-muted-foreground">{loadError}</p>
              <Button variant="outline" className="min-h-11 shrink-0 rounded-xl" onClick={refresh}>Try again</Button>
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">{meta.empty}</div>
          ) : (
            <ul className="space-y-2" aria-label={meta.title}>
              {rows.map((p) => (
                <li key={p.id} className="relative overflow-hidden rounded-2xl border border-border bg-card">
                  <span className={`absolute inset-y-0 left-0 w-1 ${TAB_META[(p.status as Tab)]?.bar ?? "bg-muted"}`} aria-hidden />
                  <div className="space-y-3 p-4 pl-5">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
                      <div className="min-w-0">
                        <p className="text-lg font-semibold tabular-nums">₹{Number(p.amount).toLocaleString("en-IN")}</p>
                        <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <dt>Method</dt><dd className="text-foreground">{methodLabel(p.method)}</dd>
                          <dt>Paid on</dt><dd className="text-foreground">{p.payment_date ? formatDate(p.payment_date) : "Not given"}</dd>
                          <dt>Reference</dt><dd className="truncate text-foreground">{p.reference_no ?? "None"}</dd>
                          {p.submitted_at && (<><dt>Submitted</dt><dd>{formatDate(p.submitted_at)}{p.source ? ` · ${p.source.replace("_", " ")}` : ""}</dd></>)}
                        </dl>
                        {p.notes && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">“{p.notes}”</p>}
                      </div>
                      <StatusChip tone={p.status === "verified" ? "success" : p.status === "pending" ? "warning" : p.status === "rejected" ? "danger" : "neutral"}
                        icon={p.status === "verified" ? <CheckCircle2 className="h-3 w-3" /> : p.status === "pending" ? <Clock className="h-3 w-3" /> : p.status === "rejected" ? <XCircle className="h-3 w-3" /> : <RotateCcw className="h-3 w-3" />}>
                        {STATUS_LABEL[p.status] ?? p.status}
                      </StatusChip>
                    </div>

                    {p.status === "pending" && (
                      <p className="rounded-lg bg-warning-container px-3 py-2 text-xs text-warning-container-foreground">Not confirmed yet — no receipt has been issued and the bill is still unpaid.</p>
                    )}
                    {p.status === "verified" && p.verified_at && (
                      <p className="flex items-center gap-1 text-xs text-muted-foreground"><Receipt className="h-3.5 w-3.5" />Verified {formatDate(p.verified_at)}{p.verification_notes ? ` · ${p.verification_notes}` : ""}</p>
                    )}
                    {p.status === "rejected" && p.rejection_reason && <p className="text-xs text-muted-foreground">Reason: {p.rejection_reason}</p>}
                    {p.status === "reversed" && p.reversal_reason && <p className="text-xs text-muted-foreground">Reason: {p.reversal_reason}</p>}

                    {(tab === "pending" || tab === "verified") && (
                      <details className="group rounded-xl border border-border" open={tab === "pending" ? undefined : false}>
                        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm font-medium">
                          {tab === "pending" ? "Verify or reject" : "Reverse this payment"}
                          <span className="text-xs text-muted-foreground group-open:hidden">Open</span>
                        </summary>
                        <div className="space-y-3 border-t border-border p-3">
                          {tab === "pending" && (
                            <Button className="min-h-11 w-full rounded-xl sm:w-auto" onClick={() => onVerify(p)} disabled={busyId === p.id}>
                              {busyId === p.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}Verify payment
                            </Button>
                          )}
                          <div className="space-y-1">
                            <Label htmlFor={`reason-${p.id}`} className="text-xs">{tab === "verified" ? "Reason to reverse (required)" : "Reason to reject (required)"}</Label>
                            <Textarea id={`reason-${p.id}`} rows={2} value={reasonById[p.id] ?? ""} onChange={(e) => setReasonById((prev) => ({ ...prev, [p.id]: e.target.value }))} />
                          </div>
                          {tab === "pending" ? (
                            <Button variant="outline" className="min-h-11 rounded-xl text-destructive" onClick={() => onReject(p)} disabled={busyId === p.id}><XCircle className="mr-1 h-4 w-4" />Reject</Button>
                          ) : (
                            <Button variant="outline" className="min-h-11 rounded-xl text-destructive" onClick={() => onReverse(p)} disabled={busyId === p.id}><RotateCcw className="mr-1 h-4 w-4" />Reverse</Button>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <aside aria-label="Record a payment" className="lg:sticky lg:top-20">
          <RecordOfflinePaymentSection societyId={societyId} onRecorded={refresh} />
        </aside>
      </div>

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
                  <span className="mb-2 block">
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
                  </span>
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
    </PageShell>
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

  const availableToSubmit = selected?.available_to_submit ?? 0;
  const amountNum = Number(amount);
  const amountExceeds = selected != null && amountNum > availableToSubmit + 0.001;
  const canSubmit = useMemo(
    () =>
      !!selected &&
      amountNum > 0 &&
      !amountExceeds &&
      (method === "cash" || reference.trim().length > 0),
    [selected, amountNum, amountExceeds, method, reference],
  );

  async function runSearch() {
    setSearching(true);
    try {
      const { bills } = await search({
        data: { societyId, query, limit: 20, offset: 0 },
      });
      // The search core returns a deeply frozen, readonly result; copy
      // into a mutable array for local component state.
      setResults([...bills]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSearching(false);
    }
  }

  async function onSubmit() {
    if (!selected) return;
    if (amountExceeds) {
      toast.error("Amount exceeds the available balance for this bill.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await record({
        data: {
          billId: selected.bill_id,
          method,
          amount: amountNum,
          paymentDate,
          referenceNo: reference.trim() || null,
          notes: notes.trim() || null,
          idempotencyKey: idKey,
        },
      });
      toast.success(
        `Payment recorded and awaiting verification. Another authorized committee member must verify this payment. (${res.paymentId.slice(0, 8)}…)`,
      );
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
                      setAmount(String(b.available_to_submit ?? 0));
                    }}
                  >
                    <div className="font-medium">
                      {b.flat_label ?? "Unit ?"}{b.block_name ? ` · ${b.block_name}` : ""} · {b.bill_number ?? "no number"}
                    </div>
                    <div className="text-muted-foreground">
                      Avail ₹{Number(b.available_to_submit ?? 0).toLocaleString("en-IN")} of ₹{Number(b.total_payable ?? 0).toLocaleString("en-IN")} · {b.status}{b.due_date ? ` · due ${b.due_date}` : ""}
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
            <div className="rounded-lg border bg-muted/30 p-2 text-xs space-y-0.5">
              <div className="font-medium">
                {selected.flat_label ?? "Unit"}
                {selected.block_name ? ` · ${selected.block_name}` : ""} · {selected.bill_number ?? "no number"}
              </div>
              <div className="text-muted-foreground">
                Total payable ₹{Number(selected.total_payable ?? 0).toLocaleString("en-IN")} · Verified ₹{Number(selected.verified_amount ?? 0).toLocaleString("en-IN")} · Pending ₹{Number(selected.pending_amount ?? 0).toLocaleString("en-IN")}
              </div>
              <div className="text-muted-foreground">
                Available to submit <span className="font-semibold text-foreground">₹{Number(selected.available_to_submit ?? 0).toLocaleString("en-IN")}</span>
                {selected.due_date ? ` · due ${selected.due_date}` : ""} · {selected.status}
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
                  aria-invalid={amountExceeds || undefined}
                />
                {amountExceeds && (
                  <p className="text-[11px] text-destructive">
                    Amount exceeds available balance (₹{Number(availableToSubmit).toLocaleString("en-IN")}).
                  </p>
                )}
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
              Recording does not verify the payment. Another authorized committee member must verify it from the Pending tab before a receipt is issued.
            </p>

          </div>
        )}
      </CardContent>
    </Card>
  );
}
