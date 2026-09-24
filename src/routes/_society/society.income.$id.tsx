import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { useState, useRef, type ReactNode } from "react";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
  Sparkles,
} from "lucide-react";
import { IncomeAccessBoundary } from "@/components/subscription/IncomeAccessBoundary";
import { incomeKeys, incomeInvalidations } from "@/lib/income-query-keys";

import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { suggestIncomeCategoryFn } from "@/lib/income-category-suggestion.functions";
import type { IncomeSuggestionResult } from "@/lib/income-category-suggestion.server";
import { confirmIncomeCategoryFn } from "@/lib/income-category-review.functions";
import { listIncomeCategoriesFn } from "@/lib/non-member-income.functions";
import {
  getIncomeRecordDetailFn,
  verifyIncomeRecordByIdFn,
  rejectIncomeRecordByIdFn,
  reverseIncomeRecordByIdFn,
  transitionIncomeReconciliationFn,
} from "@/lib/non-member-income.functions";
import type {
  IncomeRecordDetail,
  IncomeTransitionResult,
  IncomeReconciliationResult,
} from "@/lib/non-member-income.server";


export const Route = createFileRoute("/_society/society/income/$id")({
  head: () => ({
    meta: [
      { title: "Income Record — SociyoHub" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <IncomeAccessBoundary>
      {(societyId) => <IncomeDetail societyId={societyId} />}
    </IncomeAccessBoundary>
  ),

});

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

type DialogKind = "category" | "verify" | "reject" | "reverse" | "reconcile" | "unreconcile" | null;

function statusMessage(result: IncomeTransitionResult): string {
  switch (result.status) {
    case "plan_required":
      return "Upgrade to Pro to manage non-member income.";
    case "not_authorized":
      return "You do not have permission to update this record.";
    case "not_found":
      return "This record is unavailable or you do not have access.";
    case "invalid_transition":
      return "This action is no longer valid for the record's current status.";
    case "already_processed":
      return "This record was already updated. The latest status has been loaded.";
    case "error":
      return "The record could not be updated right now. Please try again.";
    default:
      return "";
  }
}

function IncomeDetail({ societyId }: { societyId: string }) {
  const { id } = Route.useParams();
  const getDetail = useServerFn(getIncomeRecordDetailFn);
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogKind>(null);

  const detailKey = incomeKeys.record(societyId, id);

  const q = useQuery({
    enabled: !!id,
    queryKey: detailKey,
    retry: (n, e: unknown) => {
      const msg = e instanceof Error ? e.message : "";
      return n < 1 && !msg.includes("forbidden") && !msg.includes("not_found");
    },
    queryFn: async () => getDetail({ data: { societyId, id } }),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: detailKey });
    for (const key of incomeInvalidations.income(societyId)) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };


  const handleResult = (r: IncomeTransitionResult) => {
    if (r.status === "success") {
      toast.success("Record updated.");
      setDialog(null);
      invalidateAll();
      return;
    }
    if (r.status === "already_processed") {
      toast.message(statusMessage(r));
      setDialog(null);
      invalidateAll();
      return;
    }
    toast.error(statusMessage(r) || "Update failed.");
  };




  const result = q.data;
  const isServerError = q.isError || result?.status === "error";
  const isNotFound = result?.status === "not_found";
  const record = result?.status === "available" ? result.record : null;

  return (
    <div className="px-4 py-6 max-w-3xl mx-auto space-y-4">
      <Link
        to="/society/income"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground min-h-[44px]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Income & Collections
      </Link>

      {q.isLoading ? (
        <Card>
          <CardContent className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading record…
          </CardContent>
        </Card>
      ) : isServerError ? (
        <Card>
          <CardContent className="p-4 flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" /> This record is temporarily unavailable.
          </CardContent>
        </Card>
      ) : isNotFound ? (
        <Card>
          <CardContent className="p-6 text-sm">
            <div className="font-medium">Record not found</div>
            <div className="text-muted-foreground mt-1">
              This income record doesn't exist or you don't have access.
            </div>
          </CardContent>
        </Card>
      ) : record ? (
        <RecordView r={record} societyId={societyId} onAction={setDialog} onRefresh={invalidateAll} />
      ) : null}

      {record && dialog === "verify" && (
        <VerifyDialog
          record={record}
          onClose={() => setDialog(null)}
          onResult={handleResult}
        />
      )}
      {record && dialog === "category" && (
        <CategoryDialog record={record} societyId={societyId} onClose={() => setDialog(null)} onDone={() => { setDialog(null); invalidateAll(); }} />
      )}
      {record && dialog === "reject" && (
        <ReasonDialog
          kind="reject"
          record={record}
          onClose={() => setDialog(null)}
          onResult={handleResult}
        />
      )}
      {record && dialog === "reverse" && (
        <ReasonDialog
          kind="reverse"
          record={record}
          onClose={() => setDialog(null)}
          onResult={handleResult}
        />
      )}
      {record && (dialog === "reconcile" || dialog === "unreconcile") && (
        <ReconcileDialog
          action={dialog}
          record={record}
          onClose={() => setDialog(null)}
          onDone={(r) => {
            if (r.status === "success" || r.status === "already_processed") {
              toast.success("Reconciliation updated.");
              setDialog(null);
              invalidateAll();
              return;
            }
            const msg =
              r.status === "invalid_transition"
                ? "This record can't be reconciled in its current state."
                : r.status === "invalid_input"
                  ? "Please provide a reason (at least 5 characters)."
                  : r.status === "plan_required"
                    ? "Upgrade to Pro to reconcile income."
                     : r.status === "rate_limited"
                       ? "Too many reconciliation requests. Please try again later."
                    : r.status === "not_authorized" || r.status === "not_found"
                      ? "You don't have access to this record."
                      : "The reconciliation could not be updated. Please try again.";
            toast.error(msg);
          }}
        />
      )}

    </div>
  );
}

interface TimelineEvent {
  label: string;
  when: string | null;
  icon: LucideIcon;
}

function buildTimeline(r: IncomeRecordDetail): TimelineEvent[] {
  const events: Array<TimelineEvent | null> = [
    { label: "Recorded", when: r.created_at, icon: Clock },
    r.verification_status === "verified" || r.verified_at
      ? { label: "Verified", when: r.verified_at, icon: CheckCircle2 }
      : null,
    r.verification_status === "rejected"
      ? { label: "Rejected", when: null, icon: XCircle }
      : null,
    r.verification_status === "reversed" || r.reversed_at
      ? { label: "Reversed", when: r.reversed_at, icon: RotateCcw }
      : null,
  ];
  return events.filter((e): e is TimelineEvent => e !== null);
}

function RecordView({
  r,
  societyId,
  onRefresh,
  onAction,
}: {
  r: IncomeRecordDetail;
  societyId: string;
  onRefresh: () => void;
  onAction: (d: DialogKind) => void;
}) {
  const events = buildTimeline(r);
  const canVerify = r.verification_status === "pending";
  const canReject = r.verification_status === "pending";
  const canReverse = r.verification_status === "verified";
  const canReconcile =
    r.verification_status === "verified" &&
    (r.reconciliation_status === "unreconciled" ||
      r.reconciliation_status === "needs_review" ||
      r.reconciliation_status === "partially_matched");
  const canUnreconcile =
    r.verification_status === "verified" && r.reconciliation_status === "matched";


  return (
    <>
      <MobileHero
        title={r.category?.display_name ?? "Income record"}
        subtitle={`${r.payment_date} · ${r.payment_method.replace(/_/g, " ")}`}
      />
      <SectionCard title="Details">
        <div className="grid sm:grid-cols-2 gap-3 text-sm">
          <Field label="Amount">
            <span className="text-lg font-semibold tabular-nums">{inr(r.amount)}</span>
          </Field>
          <Field label="Payment method">
            <span className="capitalize">{r.payment_method.replace(/_/g, " ")}</span>
          </Field>
          <Field label="Payment date">{r.payment_date}</Field>
          <Field label="Payment status">
            <span className="capitalize">{r.payment_status}</span>
          </Field>
          <Field label="Verification">
            <Badge variant="outline" className="capitalize">
              {r.verification_status}
            </Badge>
          </Field>
          <Field label="Reconciliation">
            <Badge variant="outline" className="capitalize">
              {r.reconciliation_status.replace(/_/g, " ")}
            </Badge>
          </Field>
          <Field label="Reference">{r.reference_suffix ?? "—"}</Field>
          <Field label="Payer">
            {r.payer_kind === "anonymous"
              ? "Anonymous"
              : r.payer
                ? `${r.payer.display_name}${r.payer.organization_name ? ` (${r.payer.organization_name})` : ""}`
                : "—"}
          </Field>
          {r.description && (
            <Field label="Description" full>
              <span className="text-muted-foreground">{r.description}</span>
            </Field>
          )}
          {r.reversal_reason && (
            <Field label="Reversal reason" full>
              <span className="text-muted-foreground">{r.reversal_reason}</span>
            </Field>
          )}
        </div>

        {(canVerify || canReverse || canReconcile || canUnreconcile) && (
          <div className="flex flex-wrap gap-2 pt-4">
            {canVerify && (
              <>
                <Button variant="outline" className="min-h-[44px]" onClick={() => onAction("category")}>Review category</Button>
                <Button
                  onClick={() => onAction("verify")}
                  disabled={!r.category_confirmed_at}
                  className="min-h-[44px]"
                  aria-label="Verify income record"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Verify
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onAction("reject")}
                  className="min-h-[44px]"
                  aria-label="Reject income record"
                >
                  <XCircle className="h-4 w-4 mr-1" /> Reject
                </Button>
              </>
            )}
            {canVerify && !r.category_confirmed_at && <p className="w-full text-xs text-muted-foreground">Review and confirm the accounting category before verifying this payment.</p>}
            {canReverse && !canReject && (
              <Button
                variant="destructive"
                onClick={() => onAction("reverse")}
                className="min-h-[44px]"
                aria-label="Reverse verified income record"
              >
                <RotateCcw className="h-4 w-4 mr-1" /> Reverse
              </Button>
            )}
            {canReconcile && (
              <Button
                variant="outline"
                onClick={() => onAction("reconcile")}
                className="min-h-[44px]"
                aria-label="Mark reconciled"
              >
                <CheckCircle2 className="h-4 w-4 mr-1" /> Mark reconciled
              </Button>
            )}
            {canUnreconcile && (
              <Button
                variant="outline"
                onClick={() => onAction("unreconcile")}
                className="min-h-[44px]"
                aria-label="Undo reconciliation"
              >
                <RotateCcw className="h-4 w-4 mr-1" /> Undo reconciliation
              </Button>
            )}
          </div>
        )}
      </SectionCard>

       {r.verification_status === "pending" && (r.category_confirmed_at
         ? <SectionCard title="Category reviewed"><p className="text-sm text-muted-foreground">A human confirmed {r.category?.display_name ?? "the category"}. Payment verification remains separate.</p></SectionCard>
         : <IncomeCategoryAssistant record={r} onRefresh={onRefresh} onReview={() => onAction("category")} />)}



      <SectionCard title="Timeline">
        <ol className="space-y-2 text-sm">
          {events.map((e, i) => {
            const Icon = e.icon;
            return (
              <li key={i} className="flex items-start gap-2">
                <Icon className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <div className="font-medium">{e.label}</div>
                  {e.when && (
                    <div className="text-xs text-muted-foreground">
                      {new Date(e.when).toLocaleString()}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </SectionCard>
    </>
  );
}

function IncomeCategoryAssistant({ record, onRefresh, onReview }: { record: IncomeRecordDetail; onRefresh: () => void; onReview: () => void }) {
  const suggest = useServerFn(suggestIncomeCategoryFn);
  const [result, setResult] = useState<IncomeSuggestionResult | null>(null);
  const m = useMutation({
    mutationFn: () => suggest({ data: { recordId: record.id } }),
    onSuccess: (value) => { setResult(value); if (value.status === "suggested") onRefresh(); },
    onError: () => setResult({ status: "unavailable" }),
  });
  return (
    <SectionCard title="AI category review">
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">AI can suggest a category using this record and your society's active categories. It does not change the recorded category, verify a payment, or reconcile income.</p>
        <div className="rounded-lg border border-teal-600/25 bg-teal-600/5 p-3 space-y-1" aria-live="polite">
          {m.isPending ? <p>Reviewing available categories… This may take up to 20 seconds.</p> : result?.status === "suggested" ? (
            <>
              <p className="font-semibold">Suggested: {result.categoryName} · {result.confidence} confidence</p>
              <p>{result.explanation}</p>
               <p className="text-muted-foreground">Recorded category: {record.category?.display_name ?? "Unavailable"}. Only the human-confirmed category is used for accounting. Review before verification.</p>
            </>
          ) : result?.status === "indeterminate" ? <p>{result.message}</p>
            : result?.status === "plan_required" ? <p>AI suggestions require the Pro or Premium plan.</p>
            : result?.status === "rate_limited" ? <p>Too many suggestions. Please try again later or review manually.</p>
            : result?.status === "invalid_transition" ? <p>This record is no longer pending. Refresh the record.</p>
            : result?.status === "not_found" ? <p>This record is unavailable or you don't have access.</p>
            : result?.status === "unavailable" ? <p>AI is temporarily unavailable. Review the recorded category manually or retry.</p>
            : record.suggested_category_id ? <p>Previous suggestion: {record.suggestion_explanation} ({record.suggestion_confidence ?? "unknown"} confidence). Open manual review to compare categories.</p>
            : <p>Suggestions are optional; you remain responsible for reviewing the recorded category.</p>}
        </div>
        <Button type="button" variant="outline" className="min-h-[44px]" disabled={m.isPending} onClick={() => { if (!m.isPending) m.mutate(); }}>
          {m.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {result ? "Retry suggestion" : "Suggest category"}
        </Button>
        <Button type="button" className="min-h-[44px] ml-2" onClick={onReview}>Review category manually</Button>
      </div>
    </SectionCard>
  );
}

function CategoryDialog({ record, societyId, onClose, onDone }: {
  record: IncomeRecordDetail; societyId: string; onClose: () => void; onDone: () => void;
}) {
  type CategoryOption = { id: string; display_name: string; is_active: boolean };
  const list = useServerFn(listIncomeCategoriesFn);
  const confirm = useServerFn(confirmIncomeCategoryFn);
  const [selected, setSelected] = useState(record.category_id);
  const requestId = useRef(crypto.randomUUID());
  const [notice, setNotice] = useState("");
  const categories = useQuery({
    queryKey: incomeKeys.categories(societyId),
    queryFn: () => list({ data: { societyId } }),
    retry: 1,
  });
  const mutation = useMutation({
    mutationFn: () => confirm({ data: {
      recordId: record.id,
      categoryId: selected,
      expectedRevision: record.suggestion_revision,
      requestId: requestId.current,
    } }),
    onSuccess: (r) => {
      if (r.status === "success" || r.status === "already_processed") {
        toast.success("Category confirmed. Verification remains a separate step.");
        onDone();
      } else {
        setNotice(r.status === "conflict" ? "The suggestion or category changed. Close and reopen this review to see the latest record."
          : r.status === "category_unavailable" ? "That category is no longer active. Choose another category."
          : r.status === "invalid_transition" ? "This record is no longer pending. Refresh the record."
          : r.status === "plan_required" ? "This action requires the Pro or Premium plan."
          : r.status === "rate_limited" ? "Too many category reviews. Please try again later."
          : r.status === "not_found" ? "This record is unavailable or you don't have access."
          : "The category could not be confirmed. Please retry.");
      }
    },
    onError: () => setNotice("The category could not be confirmed. Please retry."),
  });
  const active: CategoryOption[] = (categories.data?.items ?? []).filter((c: CategoryOption) => c.is_active);
  const selectedName = active.find((c) => c.id === selected)?.display_name;
  return <Dialog open onOpenChange={(open) => !open && !mutation.isPending && onClose()}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Review income category</DialogTitle>
        <DialogDescription>Choose the accounting category yourself. AI does not make this decision or verify payment.</DialogDescription>
      </DialogHeader>
      <div className="space-y-3 text-sm">
        <p>Recorded category: <strong>{record.category?.display_name ?? "Unavailable"}</strong></p>
        {record.suggested_category_id && <p className="text-muted-foreground">AI suggested: {active.find((c) => c.id === record.suggested_category_id)?.display_name ?? "Category no longer active"} ({record.suggestion_confidence ?? "unknown"} confidence). {record.suggestion_explanation}</p>}
        <Label htmlFor="income-category-select">Final category</Label>
        {categories.isLoading ? <p role="status">Loading categories…</p>
          : categories.isError ? <Button variant="outline" onClick={() => categories.refetch()}>Retry loading categories</Button>
          : active.length === 0 ? <p>No active categories are available. Add one before confirming.</p>
          : <Select value={selected} onValueChange={(value) => { setSelected(value); requestId.current = crypto.randomUUID(); setNotice(""); }}>
              <SelectTrigger id="income-category-select" className="min-h-[44px]"><SelectValue placeholder="Select a category" /></SelectTrigger>
              <SelectContent>{active.map((c) => <SelectItem key={c.id} value={c.id}>{c.display_name}</SelectItem>)}</SelectContent>
            </Select>}
        {notice && <p role="alert" className="text-destructive">{notice}</p>}
        <p className="text-muted-foreground">Confirming {selectedName ?? "your selection"} does not mark this income as received or reconciled.</p>
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={mutation.isPending} onClick={onClose}>Cancel</Button>
        <Button disabled={mutation.isPending || !selectedName || categories.isLoading || categories.isError || notice.includes("changed") || notice.includes("no longer pending")} onClick={() => { if (!mutation.isPending) mutation.mutate(); }}>
          {mutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Confirm category
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function RecordSummary({ r }: { r: IncomeRecordDetail }) {
  const payerLabel =
    r.payer_kind === "anonymous"
      ? "Anonymous"
      : r.payer
        ? r.payer.display_name
        : "—";
  return (
    <dl className="rounded-md border p-3 text-sm space-y-1">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Payer</dt>
        <dd>{payerLabel}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Category</dt>
        <dd>{r.category?.display_name ?? "—"}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Amount</dt>
        <dd className="font-semibold tabular-nums">{inr(r.amount)}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Method</dt>
        <dd className="capitalize">{r.payment_method.replace(/_/g, " ")}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Payment date</dt>
        <dd>{r.payment_date}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Reference</dt>
        <dd>{r.reference_suffix ?? "—"}</dd>
      </div>
      <div className="flex justify-between">
        <dt className="text-muted-foreground">Status</dt>
        <dd className="capitalize">{r.verification_status}</dd>
      </div>
    </dl>
  );
}

function VerifyDialog({
  record,
  onClose,
  onResult,
}: {
  record: IncomeRecordDetail;
  onClose: () => void;
  onResult: (r: IncomeTransitionResult) => void;
}) {
  const verifyFn = useServerFn(verifyIncomeRecordByIdFn);
  const m = useMutation({
    mutationFn: async () => verifyFn({ data: { recordId: record.id } }),
    onSuccess: onResult,
    onError: () => onResult({ status: "error" }),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && !m.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify income record?</DialogTitle>
          <DialogDescription>
            Confirm that this offline payment has been received and reviewed.
          </DialogDescription>
        </DialogHeader>
        <RecordSummary r={record} />
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={m.isPending}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
          <Button
            onClick={() => m.mutate()}
            disabled={m.isPending}
            className="min-h-[44px]"
          >
            {m.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Verify Income
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReasonDialog({
  kind,
  record,
  onClose,
  onResult,
}: {
  kind: "reject" | "reverse";
  record: IncomeRecordDetail;
  onClose: () => void;
  onResult: (r: IncomeTransitionResult) => void;
}) {
  const [reason, setReason] = useState("");
  const rejectFn = useServerFn(rejectIncomeRecordByIdFn);
  const reverseFn = useServerFn(reverseIncomeRecordByIdFn);

  const trimmed = reason.trim();
  const hasHtml = /<[^>]+>/.test(trimmed);
  const valid = trimmed.length >= 5 && trimmed.length <= 500 && !hasHtml;

  const m = useMutation({
    mutationFn: async () => {
      const fn = kind === "reject" ? rejectFn : reverseFn;
      return fn({ data: { recordId: record.id, reason: trimmed } });
    },
    onSuccess: onResult,
    onError: () => onResult({ status: "error" }),
  });

  const title =
    kind === "reject" ? "Reject income record?" : "Reverse verified income?";
  const supporting =
    kind === "reject"
      ? "Provide a reason so this decision remains clear in the audit history."
      : "This keeps the original record and adds a reversal to the audit history.";
  const cta = kind === "reject" ? "Reject Record" : "Reverse Income";

  return (
    <Dialog open onOpenChange={(o) => !o && !m.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{supporting}</DialogDescription>
        </DialogHeader>
        <RecordSummary r={record} />
        <div className="space-y-1">
          <Label htmlFor="reason" className="text-xs">
            Reason (required, 5–500 characters)
          </Label>
          <Textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={4}
            placeholder="Explain the reason for this decision…"
          />
          {reason.length > 0 && !valid && (
            <p className="text-xs text-destructive">
              {trimmed.length < 5
                ? "Please enter at least 5 characters."
                : hasHtml
                  ? "HTML is not allowed in the reason."
                  : "Reason must be 500 characters or fewer."}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={m.isPending}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
          <Button
            variant={kind === "reject" ? "destructive" : "destructive"}
            onClick={() => m.mutate()}
            disabled={m.isPending || !valid}
            className="min-h-[44px]"
          >
            {m.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReconcileDialog({
  action,
  record,
  onClose,
  onDone,
}: {
  action: "reconcile" | "unreconcile";
  record: IncomeRecordDetail;
  onClose: () => void;
  onDone: (r: IncomeReconciliationResult) => void;
}) {
  const reconcileFn = useServerFn(transitionIncomeReconciliationFn);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const isUnreconcile = action === "unreconcile";
  const trimmedReason = reason.trim();
  const reasonValid = !isUnreconcile || (trimmedReason.length >= 5 && trimmedReason.length <= 500 && !/<[^>]+>/.test(trimmedReason));

  const m = useMutation({
    mutationFn: async () =>
      reconcileFn({
        data: {
          recordId: record.id,
          action,
          reference: !isUnreconcile ? reference.trim() || undefined : undefined,
          reason: isUnreconcile ? trimmedReason : undefined,
        },
      }),
    onSuccess: onDone,
    onError: () => onDone({ status: "error" }),
  });

  const title = isUnreconcile ? "Undo reconciliation?" : "Mark as reconciled?";
  const desc = isUnreconcile
    ? "Return this record to unreconciled. Verification status is not changed."
    : "Confirm this verified income record has been matched to a bank credit. Verification status is not changed.";
  const cta = isUnreconcile ? "Undo reconciliation" : "Mark reconciled";

  return (
    <Dialog open onOpenChange={(o) => !o && !m.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{desc}</DialogDescription>
        </DialogHeader>
        <RecordSummary r={record} />
        <div className="space-y-2 text-sm">
          <div className="flex justify-between rounded-md border p-2">
            <span className="text-muted-foreground">Current reconciliation</span>
            <span className="capitalize">{record.reconciliation_status.replace(/_/g, " ")}</span>
          </div>
          <div className="flex justify-between rounded-md border p-2">
            <span className="text-muted-foreground">Resulting reconciliation</span>
            <span>{isUnreconcile ? "unreconciled" : "matched"}</span>
          </div>
          {!isUnreconcile ? (
            <div>
              <Label htmlFor="rec-ref" className="text-xs">Reference (optional)</Label>
              <Textarea
                id="rec-ref"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={128}
                rows={2}
                placeholder="e.g. bank statement row / UTR"
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="rec-reason" className="text-xs">
                Reason (required, 5–500 characters)
              </Label>
              <Textarea
                id="rec-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                rows={3}
                placeholder="Why is this being unreconciled?"
              />
              {reason.length > 0 && !reasonValid && (
                <p className="text-xs text-destructive">
                  Reason must be 5–500 characters with no HTML.
                </p>
              )}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Verification status will remain <b>{record.verification_status}</b>.
          </p>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={m.isPending}
            className="min-h-[44px]"
          >
            Cancel
          </Button>
          <Button
            onClick={() => m.mutate()}
            disabled={m.isPending || !reasonValid}
            className="min-h-[44px]"
          >
            {m.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {cta}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
