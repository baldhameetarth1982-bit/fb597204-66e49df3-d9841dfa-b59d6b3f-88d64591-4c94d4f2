import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Check, CreditCard, Loader2, Lock, RefreshCw, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { getSocietyAccessStatus, type SocietyAccessStatus } from "@/lib/pricing-engine";
import { getFeatureCatalog, PLAN_LABELS, type PlanKey } from "@/lib/plan-features";
import { openRazorpayForOrder } from "@/lib/razorpay";
import { confirmSaasSubscriptionPayment, createSaasSubscriptionOrder, getSaasSubscriptionQuotes } from "@/lib/saas-subscription-payment.functions";
import { SettingsShell, SettingsSection, SettingsDisclosure } from "@/components/settings/SettingsUI";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/system/ErrorState";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  cancelPendingSaasSubscriptionOrder,
  listSaasSubscriptionPayments,
  reconcileSaasSubscriptionOrder,
} from "@/lib/saas-subscription-lifecycle.functions";

export const Route = createFileRoute("/_society/society/subscription")({
  head: () => ({
    meta: [
      { title: "Subscription & plan — SociyoHub" },
      { name: "description", content: "Your society's SociyoHub plan, status and included features." },
      { property: "og:title", content: "Subscription & plan — SociyoHub" },
      { property: "og:description", content: "Your society's SociyoHub plan, status and included features." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SubscriptionPage,
});

const STATUS_COPY: Record<SocietyAccessStatus, { label: string; tone: string; note: string }> = {
  trial: { label: "Free trial", tone: "bg-primary/10 text-primary", note: "Your trial includes every feature until it ends." },
  trial_expired: { label: "Trial ended", tone: "bg-destructive/10 text-destructive", note: "Choose a plan to keep using SociyoHub." },
  active: { label: "Active", tone: "bg-success/15 text-success", note: "Your subscription is active." },
  past_due: { label: "Payment due", tone: "bg-destructive/10 text-destructive", note: "Renew to avoid losing access." },
  canceled: { label: "Cancelled", tone: "bg-muted text-muted-foreground", note: "Choose a plan to restore access." },
  none: { label: "No plan", tone: "bg-muted text-muted-foreground", note: "Choose a plan to get started." },
  forbidden: { label: "Unavailable", tone: "bg-muted text-muted-foreground", note: "Only committee members can see the subscription." },
};

function fmtDate(v: string | null) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime())
    ? d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
    : null;
}

function SubscriptionPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const { plan: effectivePlan, isLoading: planLoading } = useFeatureAccess();
  const { profile, user } = useAuth();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const requestIds = useRef(new Map<string, string>());
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [historyBusy, setHistoryBusy] = useState<string | null>(null);
  const listPayments = useServerFn(listSaasSubscriptionPayments);
  const reconcileOrder = useServerFn(reconcileSaasSubscriptionOrder);
  const cancelOrder = useServerFn(cancelPendingSaasSubscriptionOrder);

  const access = useQuery({
    enabled: !!societyId,
    queryKey: ["society-access-status", societyId],
    staleTime: 30_000,
    refetchInterval: confirming ? 3000 : false,
    queryFn: () => getSocietyAccessStatus(societyId!),
  });

  const fetchQuotes = useServerFn(getSaasSubscriptionQuotes);
  const plans = useQuery({
    enabled: !!societyId,
    queryKey: ["subscription-quotes", societyId],
    staleTime: 60_000,
    queryFn: async () => {
      const quotes = await fetchQuotes({ data: { societyId: societyId as string } });
      return quotes.map((q) => ({ ...q, id: q.plan_id, name: q.plan_name, is_recommended: q.plan_id === "pro" }));
    },
  });
  const customPricing = plans.data?.[0]?.custom_pricing ?? false;

  const paymentHistory = useQuery({
    enabled: !!societyId,
    queryKey: ["saas-subscription-payments", societyId],
    queryFn: () => listPayments({ data: { societyId: societyId as string } }),
  });

  async function reconcile(orderId: string) {
    if (!societyId) return;
    setHistoryBusy(orderId);
    try {
      const result = await reconcileOrder({ data: { societyId, orderId } });
      toast.success(result.status === "captured" ? "Payment confirmed." : "Payment is not captured yet.");
      await paymentHistory.refetch();
      await qc.invalidateQueries({ queryKey: ["society-access-status", societyId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Payment could not be checked.");
    } finally {
      setHistoryBusy(null);
    }
  }

  async function cancelPending() {
    if (!societyId || !cancelOrderId) return;
    setHistoryBusy(cancelOrderId);
    try {
      await cancelOrder({ data: { societyId, orderId: cancelOrderId, reason: cancelReason } });
      toast.success("Pending order cancelled.");
      setCancelOrderId(null);
      setCancelReason("");
      await paymentHistory.refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Order could not be cancelled.");
    } finally {
      setHistoryBusy(null);
    }
  }

  async function handleBuy(p: { id: string; name: string }) {
    setBusyId(p.id);
    try {
    const requestId = requestIds.current.get(p.id) ?? crypto.randomUUID();
    requestIds.current.set(p.id, requestId);
    const order = await createSaasSubscriptionOrder({ data: {
      societyId: societyId!, planId: p.id as "basic" | "pro" | "premium", requestId,
    } });
    const opened = await openRazorpayForOrder({
      orderId: order.orderId,
      keyId: order.keyId,
      amount: order.amount,
      description: `${order.planName} plan — monthly`,
      prefill: {
        email: profile?.email ?? user?.email ?? "",
        contact: profile?.phone ?? "",
        name: profile?.full_name ?? "",
      },
      onSuccess: async (response) => {
        await confirmSaasSubscriptionPayment({ data: {
          societyId: societyId!, planId: p.id as "basic" | "pro" | "premium",
          razorpayOrderId: response.razorpay_order_id, razorpayPaymentId: response.razorpay_payment_id,
          razorpaySignature: response.razorpay_signature,
        } });
        toast.success("Subscription activated successfully.");
        requestIds.current.delete(p.id);
        setConfirming(true);
        setTimeout(() => setConfirming(false), 15_000);
        await qc.invalidateQueries({ queryKey: ["society-access-status", societyId] });
        await qc.invalidateQueries({ queryKey: ["society-plan", societyId] });
        setBusyId(null);
      },
      onDismiss: () => setBusyId(null),
    });
    if (!opened) {
      toast.error("Payments couldn't be opened right now. Please try again.");
      setBusyId(null);
    }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Subscription payment could not be completed.");
      setBusyId(null);
    }
  }

  const loading = sidLoading || (access.isLoading && !!societyId);
  const status = access.data?.status;
  const copy = status ? STATUS_COPY[status] : null;
  const catalog = getFeatureCatalog().filter((f) => !f.planNeutral && f.roles.includes("society_admin"));
  const planRank: Record<PlanKey, number> = { basic: 0, pro: 1, premium: 2 };
  const included = catalog.filter((f) => planRank[f.minPlan] <= planRank[effectivePlan]);
  const locked = catalog.filter((f) => planRank[f.minPlan] > planRank[effectivePlan]);
  const planName =
    (plans.data ?? []).find((p) => p.id === access.data?.plan_id)?.name ?? access.data?.plan_id ?? null;

  const showPlans = !loading && !access.isError && status !== "forbidden";
  return (
    <SettingsShell
      title="Subscription"
      scope="Whole society"
      icon={CreditCard}
      description="Your society's SociyoHub plan. This is separate from maintenance payments, which are unaffected."
    >
      <SettingsSection title="Current plan" icon={ShieldCheck}>
        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-full" />
          </div>
        ) : access.isError || !copy ? (
          <ErrorState
            title="Couldn't confirm your plan"
            description="We can't show your plan status right now. Your features aren't changed."
            onRetry={() => access.refetch()}
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${copy.tone}`}>{copy.label}</span>
              {confirming && (
                <span role="status" className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Confirming payment — not active yet
                </span>
              )}
            </div>
            <p className="text-3xl font-semibold tracking-tight">
              {status === "trial" ? "Free trial" : status === "active" && planName ? planName : "—"}
            </p>
            <dl className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border p-3">
                <dt className="text-xs text-muted-foreground">Features available now</dt>
                <dd className="font-medium">{planLoading ? "—" : PLAN_LABELS[effectivePlan]}</dd>
              </div>
              <div className="rounded-xl border p-3">
                <dt className="text-xs text-muted-foreground">
                  {status === "trial" ? "Trial ends" : status === "active" ? "Renews / ends" : "Next step"}
                </dt>
                <dd className="font-medium">
                  {status === "trial"
                    ? fmtDate(access.data!.trial_ends_at) ?? "—"
                    : status === "active"
                    ? fmtDate(access.data!.plan_expires_at) ?? "—"
                    : "Choose a plan"}
                </dd>
              </div>
            </dl>
            <p className="text-sm text-muted-foreground">{copy.note}</p>
          </div>
        )}
      </SettingsSection>

      {showPlans && (
        <SettingsSection
          title={status === "active" ? "Change or renew" : "Choose a plan"}
          icon={Sparkles}
          description="Paid securely via Razorpay. Your plan changes only after we confirm the payment."
        >
          {plans.isLoading ? (
            <Skeleton className="h-28 w-full rounded-2xl" />
          ) : plans.isError ? (
            <ErrorState title="Couldn't load plans" description="Please try again." onRetry={() => plans.refetch()} />
          ) : (
            <>
            {customPricing ? (
              <div className="rounded-xl border p-4 text-sm">
                <p className="font-semibold">Custom pricing</p>
                <p className="mt-1 text-muted-foreground">
                  Your society has {plans.data?.[0]?.flat_count} flats. Societies with more than{" "}
                  {plans.data?.[0]?.threshold} flats get a custom price, so online checkout isn't available.
                </p>
                <a href="mailto:sociohub710@gmail.com?subject=Custom pricing enquiry" className="mt-2 inline-flex min-h-11 items-center text-primary underline-offset-4 hover:underline">
                  Talk to us
                </a>
              </div>
            ) : plans.data?.[0]?.flat_count === 0 ? (
              <p className="text-sm text-muted-foreground">Add your society's flats first — the price is per flat.</p>
            ) : null}
            <ul className="divide-y">
              {(plans.data ?? []).map((p) => {
                const current = status === "active" && p.id === access.data?.plan_id;
                return (
                  <li key={p.id} className={`flex flex-wrap items-center gap-3 py-3 ${current ? "-mx-2 rounded-xl bg-primary/5 px-2" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 font-semibold">
                        {p.name}
                        {current ? <Badge variant="secondary">Your plan</Badge> : p.is_recommended ? <Badge variant="outline">Popular</Badge> : null}
                      </div>
                      <p className="text-sm">
                        <span className="font-semibold tabular-nums">₹{p.price_per_flat_inr}</span>
                        <span className="text-muted-foreground"> / flat / month</span>
                        {p.amount_paise ? (
                          <span className="text-muted-foreground tabular-nums">
                            {" "}· ₹{(p.amount_paise / 100).toLocaleString("en-IN")}/month for {p.flat_count} {p.flat_count === 1 ? "flat" : "flats"}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <Button
                      className="h-11 rounded-xl"
                      variant={current ? "outline" : "default"}
                      disabled={busyId !== null || confirming || !p.amount_paise}
                      onClick={() => handleBuy(p)}
                      aria-label={`${current ? "Renew" : "Choose"} ${p.name}`}
                    >
                      {busyId === p.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {current ? "Renew" : "Choose"}
                    </Button>
                  </li>
                );
              })}
            </ul>
            </>
          )}
          <Link to="/pricing" className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline">
            Compare plans in detail
          </Link>
        </SettingsSection>
      )}

      {showPlans && (
        <SettingsSection
          title="Payment history"
          icon={CreditCard}
          description="Server-confirmed subscription orders and receipts. Maintenance collections remain separate."
        >
          {paymentHistory.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : paymentHistory.isError ? (
            <ErrorState title="Couldn't load payment history" description="No payment status was changed." onRetry={() => paymentHistory.refetch()} />
          ) : paymentHistory.data?.length ? (
            <ul className="divide-y">
              {paymentHistory.data.map((payment) => {
                const pending = ["created", "pending", "processing", "failed"].includes(payment.lifecycle_status);
                return (
                  <li key={payment.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold">{PLAN_LABELS[payment.plan_id as PlanKey] ?? payment.plan_id} plan</p>
                        <Badge variant="outline" className="capitalize">{payment.lifecycle_status.replaceAll("_", " ")}</Badge>
                        {payment.provider_mode && <Badge variant="secondary">{payment.provider_mode}</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        ₹{(payment.amount_paise / 100).toLocaleString("en-IN")} · {fmtDate(payment.confirmed_at ?? payment.created_at)}
                        {payment.receipt ? ` · Receipt ${payment.receipt.receipt_number}` : ""}
                      </p>
                    </div>
                    {pending && (
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" className="min-h-11" disabled={historyBusy !== null} onClick={() => reconcile(payment.razorpay_order_id)}>
                          {historyBusy === payment.razorpay_order_id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                          Check payment
                        </Button>
                        <Button variant="ghost" className="min-h-11" disabled={historyBusy !== null} onClick={() => setCancelOrderId(payment.razorpay_order_id)}>
                          <XCircle className="mr-2 h-4 w-4" /> Cancel
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No subscription payments yet.</p>
          )}
        </SettingsSection>
      )}

      {showPlans && (
        <SettingsDisclosure
          title="What's included"
          description={`${included.length} included · ${locked.length} need a higher plan`}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Check className="h-4 w-4 text-success" /> Included</h3>
              <ul className="space-y-1 text-sm">{included.map((f) => <li key={f.key}>{f.label}</li>)}</ul>
            </div>
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4 text-muted-foreground" /> Needs a higher plan</h3>
              {locked.length === 0 ? (
                <p className="text-sm text-muted-foreground">Everything is unlocked.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {locked.map((f) => (
                    <li key={f.key} className="flex justify-between gap-2">
                      <span>{f.label}</span>
                      <span className="text-xs text-muted-foreground">{PLAN_LABELS[f.minPlan]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </SettingsDisclosure>
      )}
      <AlertDialog open={!!cancelOrderId} onOpenChange={(open) => { if (!open && !historyBusy) { setCancelOrderId(null); setCancelReason(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this pending order?</AlertDialogTitle>
            <AlertDialogDescription>This does not refund captured money. Check the payment first if the checkout may have completed.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-subscription-reason">Reason saved in audit history</Label>
            <Textarea id="cancel-subscription-reason" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} maxLength={500} rows={3} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!historyBusy}>Keep order</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void cancelPending(); }} disabled={!!historyBusy || cancelReason.trim().length < 3}>
              Cancel order
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsShell>
  );
}
