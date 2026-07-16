import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
} from "lucide-react";
import { IncomeAccessBoundary } from "@/components/subscription/IncomeAccessBoundary";
import { incomeKeys, incomeInvalidations } from "@/lib/income-query-keys";

import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import {
  getIncomeRecordDetailFn,
  verifyIncomeRecordByIdFn,
  rejectIncomeRecordByIdFn,
  reverseIncomeRecordByIdFn,
} from "@/lib/non-member-income.functions";
import type {
  IncomeRecordDetail,
  IncomeTransitionResult,
} from "@/lib/non-member-income.server";

export const Route = createFileRoute("/_society/society/income/$id")({
  head: () => ({
    meta: [
      { title: "Income Record — SociyoHub" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <FeatureGate feature="non_member_payments">
      <IncomeDetail />
    </FeatureGate>
  ),
});

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

type DialogKind = "verify" | "reject" | "reverse" | null;

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

function IncomeDetail() {
  const { id } = Route.useParams();
  const { societyId, loading } = useSocietyId();
  const getDetail = useServerFn(getIncomeRecordDetailFn);
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<DialogKind>(null);

  const detailKey = incomeKeys.record(societyId ?? "", id);

  const q = useQuery({
    enabled: !!societyId && !!id,
    queryKey: detailKey,
    retry: (n, e: unknown) => {
      const msg = e instanceof Error ? e.message : "";
      return n < 1 && !msg.includes("forbidden") && !msg.includes("not_found");
    },
    queryFn: async () => getDetail({ data: { societyId: societyId!, id } }),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: detailKey });
    for (const key of incomeInvalidations.income(societyId ?? "")) {
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

  if (loading || !societyId) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

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
        <RecordView r={record} onAction={setDialog} />
      ) : null}

      {record && dialog === "verify" && (
        <VerifyDialog
          record={record}
          onClose={() => setDialog(null)}
          onResult={handleResult}
        />
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
  onAction,
}: {
  r: IncomeRecordDetail;
  onAction: (d: DialogKind) => void;
}) {
  const events = buildTimeline(r);
  const canVerify = r.verification_status === "pending";
  const canReject = r.verification_status === "pending";
  const canReverse = r.verification_status === "verified";

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

        {(canVerify || canReverse) && (
          <div className="flex flex-wrap gap-2 pt-4">
            {canVerify && (
              <>
                <Button
                  onClick={() => onAction("verify")}
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
          </div>
        )}
      </SectionCard>

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
