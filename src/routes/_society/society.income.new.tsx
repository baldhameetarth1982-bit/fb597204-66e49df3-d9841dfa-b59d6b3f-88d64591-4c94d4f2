import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2, Coins, CheckCircle2, AlertCircle } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useSocietyId } from "@/hooks/useSocietyId";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  listIncomeCategoriesFn,
  listNonMemberPayersFn,
  createNonMemberIncomeRecordFn,
} from "@/lib/non-member-income.functions";

export const Route = createFileRoute("/_society/society/income/new")({
  head: () => ({
    meta: [
      { title: "Record Income — SociyoHub" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <FeatureGate feature="non_member_payments">
      <NewIncomePage />
    </FeatureGate>
  ),
});

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Stage 1D payment methods — Cash and Bank Transfer only. No online, no
 * "Other offline". Server still accepts other_offline for legacy admin
 * paths, but the UI never surfaces it. */
type PayerKind = "non_member" | "anonymous";
type PaymentMethod = "cash" | "bank_transfer";
type Step = "details" | "review" | "saved";

interface Form {
  categoryId: string;
  payerKind: PayerKind;
  payerId: string;
  amount: string;
  method: PaymentMethod;
  paymentDate: string;
  reference: string;
  description: string;
}

const EMPTY_FORM: Form = {
  categoryId: "",
  payerKind: "non_member",
  payerId: "",
  amount: "",
  method: "cash",
  paymentDate: todayISO(),
  reference: "",
  description: "",
};

const INR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(n);

const METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: "Cash",
  bank_transfer: "Bank Transfer",
};

function maskReference(ref: string): string {
  const t = ref.trim();
  if (!t) return "";
  if (t.length <= 4) return "•".repeat(t.length);
  return `••••${t.slice(-4)}`;
}

function friendlyError(msg: string): string {
  switch (msg) {
    case "category_inactive":
      return "Selected category is inactive";
    case "payer_inactive":
      return "Selected payer is inactive";
    case "category_society_mismatch":
    case "payer_society_mismatch":
      return "Invalid selection for this society";
    case "plan_required":
      return "Upgrade required to record non-member income";
    case "not_authorized":
      return "You don't have permission to record income";
    default:
      return "Could not record income. Please try again.";
  }
}

function NewIncomePage() {
  const { societyId, loading } = useSocietyId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const listCatsFn = useServerFn(listIncomeCategoriesFn);
  const listPayersFn = useServerFn(listNonMemberPayersFn);
  const createFn = useServerFn(createNonMemberIncomeRecordFn);

  const catsQ = useQuery({
    enabled: !!societyId,
    queryKey: ["society-income", "categories", societyId],
    queryFn: async () => listCatsFn({ data: { societyId: societyId! } }),
  });
  const payersQ = useQuery({
    enabled: !!societyId,
    queryKey: ["society-income", "payers", societyId],
    queryFn: async () => listPayersFn({ data: { societyId: societyId! } }),
  });

  const activeCats = useMemo(
    () =>
      ((catsQ.data?.items ?? []) as Array<{
        id: string;
        display_name: string;
        is_active: boolean;
      }>).filter((c) => c.is_active),
    [catsQ.data],
  );
  const activePayers = useMemo(
    () =>
      ((payersQ.data?.items ?? []) as Array<{
        id: string;
        display_name: string;
        is_active: boolean;
      }>).filter((p) => p.is_active),
    [payersQ.data],
  );

  const [step, setStep] = useState<Step>("details");
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [savedRecord, setSavedRecord] = useState<{
    id: string;
    snapshot: Form;
  } | null>(null);
  // Stage 1D — one stable UUID per Review pass. Retries reuse it so the
  // server-side unique index resolves duplicate Saves to the original row.
  // Regenerated on "Record Another" AND whenever the user returns to
  // Details and materially edits the draft (so a changed payload cannot
  // silently collide with the previous key).
  const [requestId, setRequestId] = useState<string | null>(null);
  // Snapshot of the form at the moment the current requestId was minted.
  // If the user edits any material field, we invalidate the key.
  const [requestSnapshot, setRequestSnapshot] = useState<Form | null>(null);

  const materialFingerprint = (f: Form): string =>
    [
      f.categoryId,
      f.payerKind,
      f.payerKind === "non_member" ? f.payerId : "",
      f.amount.trim(),
      f.method,
      f.paymentDate,
      f.reference.trim(),
      f.description.trim(),
    ].join("|");

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => {
      const next = { ...f, [k]: v };
      // If we already minted a request id and the user edits the draft
      // materially, drop the key so re-entering Review generates a fresh one.
      if (requestId && materialFingerprint(next) !== materialFingerprint(f)) {
        setRequestId(null);
        setRequestSnapshot(null);
      }
      return next;
    });

  const enterReview = () => {
    const uuid = secureRequestUuid();
    if (!requestId) {
      if (!uuid) {
        toast.error(
          "Your browser can't securely record this entry. Please update to a modern browser.",
        );
        return;
      }
      setRequestId(uuid);
      setRequestSnapshot(form);
    }
    setStep("review");
  };

  const mut = useMutation({
    mutationFn: async () => {
      const amountNum = Number(form.amount);
      const res = await createFn({
        data: {
          societyId: societyId!,
          category_id: form.categoryId,
          payer_kind: form.payerKind,
          non_member_payer_id:
            form.payerKind === "non_member" ? form.payerId : undefined,
          amount: amountNum,
          payment_method: form.method,
          payment_date: form.paymentDate,
          reference_number: form.reference.trim() || undefined,
          description: form.description.trim() || undefined,
          creation_request_id: requestId ?? undefined,
        },
      });
      return parseCreateIncomeResult(res);
    },
    onSuccess: (res) => {
      switch (res.status) {
        case "created":
        case "existing":
          setSavedRecord({ id: res.id, snapshot: form });
          setStep("saved");
          void qc.invalidateQueries({ queryKey: ["society-income"] });
          return;
        case "idempotency_conflict":
          toast.error(friendlyIncomeError("idempotency_conflict"));
          // Force a fresh key on next Review.
          setRequestId(null);
          setRequestSnapshot(null);
          setStep("details");
          return;
        default:
          toast.error(friendlyIncomeError(res.status));
      }
    },
    onError: (e: unknown) => {
      toast.error(friendlyIncomeError(e));
    },
  });

  if (loading || !societyId) {
    return (
      <div className="min-h-[40vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const amountNum = Number(form.amount);
  const amountValid =
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    amountNum <= 1e11 &&
    !/e/i.test(form.amount) &&
    /^\d+(\.\d{1,2})?$/.test(form.amount.trim());
  const dateValid =
    !!form.paymentDate && form.paymentDate <= todayISO();
  const detailsValid =
    !!form.categoryId &&
    amountValid &&
    dateValid &&
    (form.payerKind === "anonymous" ||
      (form.payerKind === "non_member" && !!form.payerId));

  const resetAndRestart = () => {
    setForm({ ...EMPTY_FORM, paymentDate: todayISO() });
    setSavedRecord(null);
    setRequestId(null); // fresh idempotency key for the next record
    setStep("details");
  };

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto space-y-4">
      <Link
        to="/society/income"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground min-h-[44px]"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Income
      </Link>
      <MobileHero
        icon={Coins}
        title="Record offline income"
        subtitle="Cash or Bank Transfer received from a non-member or anonymous payer."
      />

      <Stepper step={step} />

      {step === "details" && (
        <DetailsStep
          form={form}
          set={set}
          activeCats={activeCats}
          activePayers={activePayers}
          catsError={catsQ.isError}
          catsLoading={catsQ.isLoading}
          payersError={payersQ.isError}
          payersLoading={payersQ.isLoading}
          canProceed={detailsValid}
          onNext={enterReview}
          amountValid={amountValid || !form.amount}
          dateValid={dateValid || !form.paymentDate}
        />
      )}

      {step === "review" && (
        <ReviewStep
          form={form}
          categoryLabel={
            activeCats.find((c) => c.id === form.categoryId)?.display_name ?? "—"
          }
          payerLabel={
            form.payerKind === "anonymous"
              ? "Anonymous"
              : activePayers.find((p) => p.id === form.payerId)?.display_name ?? "—"
          }
          onBack={() => setStep("details")}
          onSubmit={() => mut.mutate()}
          submitting={mut.isPending}
        />
      )}

      {step === "saved" && savedRecord && (
        <SavedStep
          record={savedRecord}
          categoryLabel={
            activeCats.find((c) => c.id === savedRecord.snapshot.categoryId)
              ?.display_name ?? "—"
          }
          payerLabel={
            savedRecord.snapshot.payerKind === "anonymous"
              ? "Anonymous"
              : activePayers.find((p) => p.id === savedRecord.snapshot.payerId)
                  ?.display_name ?? "—"
          }
          onView={() =>
            navigate({ to: "/society/income/$id", params: { id: savedRecord.id } })
          }
          onAnother={resetAndRestart}
        />
      )}
    </div>
  );
}

function Stepper({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "details", label: "Details" },
    { id: "review", label: "Review" },
    { id: "saved", label: "Saved" },
  ];
  const activeIndex = steps.findIndex((s) => s.id === step);
  return (
    <ol
      className="flex items-center gap-2 text-xs"
      aria-label="Progress"
    >
      {steps.map((s, i) => {
        const state =
          i < activeIndex ? "done" : i === activeIndex ? "active" : "todo";
        return (
          <li key={s.id} className="flex items-center gap-2 flex-1 min-w-0">
            <span
              className={
                "inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium " +
                (state === "done"
                  ? "bg-[color:var(--success,#10B981)] text-white"
                  : state === "active"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground")
              }
              aria-current={state === "active" ? "step" : undefined}
            >
              {state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span
              className={
                "truncate " +
                (state === "todo" ? "text-muted-foreground" : "text-foreground font-medium")
              }
            >
              {s.label}
            </span>
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className="h-px flex-1 bg-border"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function DetailsStep(props: {
  form: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  activeCats: Array<{ id: string; display_name: string; is_active: boolean }>;
  activePayers: Array<{ id: string; display_name: string; is_active: boolean }>;
  catsError: boolean;
  catsLoading: boolean;
  payersError: boolean;
  payersLoading: boolean;
  canProceed: boolean;
  onNext: () => void;
  amountValid: boolean;
  dateValid: boolean;
}) {
  const {
    form,
    set,
    activeCats,
    activePayers,
    catsError,
    catsLoading,
    payersError,
    payersLoading,
    canProceed,
    onNext,
    amountValid,
    dateValid,
  } = props;

  return (
    <SectionCard
      title="Details"
      description="Records start as pending and must be verified by an admin."
    >
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Category</Label>
          <Select value={form.categoryId} onValueChange={(v) => set("categoryId", v)}>
            <SelectTrigger className="min-h-[44px]">
              <SelectValue placeholder="Select a category" />
            </SelectTrigger>
            <SelectContent>
              {catsError ? (
                <div className="px-2 py-1.5 text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> Categories unavailable
                </div>
              ) : catsLoading ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Loading…
                </div>
              ) : activeCats.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No active categories. Create one first.
                </div>
              ) : (
                activeCats.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.display_name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          {!catsError && !catsLoading && activeCats.length === 0 && (
            <Link
              to="/society/income/categories"
              className="text-xs text-primary underline mt-1 inline-block min-h-[32px]"
            >
              Manage categories
            </Link>
          )}
        </div>

        <div>
          <Label className="text-xs">Payer</Label>
          <Select
            value={form.payerKind}
            onValueChange={(v) => set("payerKind", v as PayerKind)}
          >
            <SelectTrigger className="min-h-[44px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="non_member">Non-member payer</SelectItem>
              <SelectItem value="anonymous">Anonymous</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {form.payerKind === "non_member" && (
          <div>
            <Label className="text-xs">Select payer</Label>
            <Select value={form.payerId} onValueChange={(v) => set("payerId", v)}>
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder="Select a payer" />
              </SelectTrigger>
              <SelectContent>
                {payersError ? (
                  <div className="px-2 py-1.5 text-xs text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> Payers unavailable
                  </div>
                ) : payersLoading ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Loading…
                  </div>
                ) : activePayers.length === 0 ? (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    No active payers. Add one first.
                  </div>
                ) : (
                  activePayers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.display_name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
            {!payersError && !payersLoading && activePayers.length === 0 && (
              <Link
                to="/society/income/payers"
                className="text-xs text-primary underline mt-1 inline-block min-h-[32px]"
              >
                Manage payers
              </Link>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <Label htmlFor="amount" className="text-xs">
              Amount (₹)
            </Label>
            <Input
              id="amount"
              className="min-h-[44px] tabular-nums"
              type="text"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="0"
              aria-invalid={!amountValid}
              aria-describedby="amount-hint"
            />
            {!amountValid && (
              <p id="amount-hint" className="text-[11px] text-destructive mt-1">
                Enter a positive amount with up to 2 decimal places.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="pdate" className="text-xs">
              Payment date
            </Label>
            <Input
              id="pdate"
              className="min-h-[44px]"
              type="date"
              value={form.paymentDate}
              max={todayISO()}
              onChange={(e) => set("paymentDate", e.target.value)}
              aria-invalid={!dateValid}
              aria-describedby="date-hint"
            />
            {!dateValid && (
              <p id="date-hint" className="text-[11px] text-destructive mt-1">
                Payment date can't be in the future.
              </p>
            )}
          </div>
        </div>

        <div>
          <Label className="text-xs">Payment method</Label>
          <Select
            value={form.method}
            onValueChange={(v) => set("method", v as PaymentMethod)}
          >
            <SelectTrigger className="min-h-[44px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">Cash</SelectItem>
              <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground mt-1">
            Online gateway collection will be introduced in a later release.
          </p>
        </div>

        <div>
          <Label htmlFor="ref" className="text-xs">
            Reference number (optional)
          </Label>
          <Input
            id="ref"
            className="min-h-[44px]"
            value={form.reference}
            onChange={(e) => set("reference", e.target.value)}
            placeholder="Receipt / UTR / cheque no."
            maxLength={80}
          />
        </div>

        <div>
          <Label htmlFor="desc" className="text-xs">
            Description (optional)
          </Label>
          <Textarea
            id="desc"
            rows={3}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            maxLength={500}
            placeholder="What was this payment for?"
          />
        </div>

        <div className="pt-2">
          <Button
            className="w-full min-h-[48px]"
            onClick={onNext}
            disabled={!canProceed}
          >
            Review Income
          </Button>
        </div>
      </div>
    </SectionCard>
  );
}

function ReviewStep(props: {
  form: Form;
  categoryLabel: string;
  payerLabel: string;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  const { form, categoryLabel, payerLabel, onBack, onSubmit, submitting } = props;
  const amountNum = Number(form.amount);
  return (
    <SectionCard
      title="Review"
      description="This record will be saved as pending verification."
    >
      <dl className="grid grid-cols-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground col-span-1">Payer</dt>
        <dd className="col-span-2 font-medium truncate">{payerLabel}</dd>

        <dt className="text-muted-foreground col-span-1">Payer type</dt>
        <dd className="col-span-2 capitalize">
          {form.payerKind === "anonymous" ? "Anonymous" : "Non-member"}
        </dd>

        <dt className="text-muted-foreground col-span-1">Category</dt>
        <dd className="col-span-2 truncate">{categoryLabel}</dd>

        <dt className="text-muted-foreground col-span-1">Amount</dt>
        <dd className="col-span-2 tabular-nums font-semibold">{INR(amountNum)}</dd>

        <dt className="text-muted-foreground col-span-1">Method</dt>
        <dd className="col-span-2">{METHOD_LABEL[form.method]}</dd>

        <dt className="text-muted-foreground col-span-1">Date</dt>
        <dd className="col-span-2 tabular-nums">{form.paymentDate}</dd>

        {form.reference.trim() && (
          <>
            <dt className="text-muted-foreground col-span-1">Reference</dt>
            <dd className="col-span-2 font-mono">{maskReference(form.reference)}</dd>
          </>
        )}

        {form.description.trim() && (
          <>
            <dt className="text-muted-foreground col-span-1">Description</dt>
            <dd className="col-span-2 whitespace-pre-wrap break-words">
              {form.description}
            </dd>
          </>
        )}

        <dt className="text-muted-foreground col-span-1">Verification</dt>
        <dd className="col-span-2">
          <Badge variant="outline">Pending</Badge>
        </dd>

        <dt className="text-muted-foreground col-span-1">Reconciliation</dt>
        <dd className="col-span-2">
          <Badge variant="outline">Unreconciled</Badge>
        </dd>
      </dl>

      <div className="grid grid-cols-2 gap-2 pt-4">
        <Button
          variant="outline"
          className="min-h-[48px]"
          onClick={onBack}
          disabled={submitting}
        >
          Back
        </Button>
        <Button
          className="min-h-[48px]"
          onClick={onSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Save Income Record"
          )}
        </Button>
      </div>
    </SectionCard>
  );
}

function SavedStep(props: {
  record: { id: string; snapshot: Form };
  categoryLabel: string;
  payerLabel: string;
  onView: () => void;
  onAnother: () => void;
}) {
  const { record, categoryLabel, payerLabel, onView, onAnother } = props;
  const f = record.snapshot;
  const amountNum = Number(f.amount);
  return (
    <SectionCard
      title="Income record saved"
      description="The record is ready for an authorized admin to review."
    >
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="h-5 w-5 text-[color:var(--success,#10B981)]" />
        <Badge variant="outline">Pending verification</Badge>
      </div>
      <dl className="grid grid-cols-3 gap-y-2 text-sm">
        <dt className="text-muted-foreground col-span-1">Amount</dt>
        <dd className="col-span-2 tabular-nums font-semibold">{INR(amountNum)}</dd>

        <dt className="text-muted-foreground col-span-1">Payer</dt>
        <dd className="col-span-2 truncate">{payerLabel}</dd>

        <dt className="text-muted-foreground col-span-1">Category</dt>
        <dd className="col-span-2 truncate">{categoryLabel}</dd>

        <dt className="text-muted-foreground col-span-1">Method</dt>
        <dd className="col-span-2">{METHOD_LABEL[f.method]}</dd>

        <dt className="text-muted-foreground col-span-1">Date</dt>
        <dd className="col-span-2 tabular-nums">{f.paymentDate}</dd>

        {f.reference.trim() && (
          <>
            <dt className="text-muted-foreground col-span-1">Reference</dt>
            <dd className="col-span-2 font-mono">{maskReference(f.reference)}</dd>
          </>
        )}

        <dt className="text-muted-foreground col-span-1">Record</dt>
        <dd className="col-span-2 font-mono text-xs truncate">{record.id.slice(0, 8)}…</dd>
      </dl>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-4">
        <Button className="min-h-[48px]" onClick={onView}>
          View Record
        </Button>
        <Button
          variant="outline"
          className="min-h-[48px]"
          onClick={onAnother}
        >
          Record Another
        </Button>
        <Link
          to="/society/income"
          className="inline-flex items-center justify-center min-h-[48px] px-4 rounded-md border text-sm hover:bg-muted"
        >
          Back to Income
        </Link>
      </div>
    </SectionCard>
  );
}
