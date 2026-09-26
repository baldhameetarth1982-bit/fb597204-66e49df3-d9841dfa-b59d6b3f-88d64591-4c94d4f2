import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, CreditCard, Loader2, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { supabase } from "@/integrations/supabase/client";
import { getSocietyAccessStatus, type SocietyAccessStatus } from "@/lib/pricing-engine";
import { getFeatureCatalog, PLAN_LABELS, type PlanKey } from "@/lib/plan-features";
import { openRazorpayForOrder } from "@/lib/razorpay";
import { confirmSaasSubscriptionPayment, createSaasSubscriptionOrder } from "@/lib/saas-subscription-payment.functions";
import { SettingsShell, SettingsSection, SettingsDisclosure } from "@/components/settings/SettingsUI";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/system/ErrorState";

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

  const access = useQuery({
    enabled: !!societyId,
    queryKey: ["society-access-status", societyId],
    staleTime: 30_000,
    refetchInterval: confirming ? 3000 : false,
    queryFn: () => getSocietyAccessStatus(societyId!),
  });

  const plans = useQuery({
    queryKey: ["subscription-plans"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("plans")
        .select("id,name,price_monthly_inr,is_recommended,sort_order")
        .not("id", "in", "(ad_free,trial,resident)")
        .order("sort_order");
      if (error) throw new Error("plans_unavailable");
      return data ?? [];
    },
  });

  async function handleBuy(p: { id: string; name: string; price_monthly_inr: number }) {
    setBusyId(p.id);
    try {
    const order = await createSaasSubscriptionOrder({ data: { societyId: societyId!, planId: p.id as "basic" | "pro" | "premium" } });
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
            <ul className="divide-y">
              {(plans.data ?? []).map((p) => {
                const current = status === "active" && p.id === access.data?.plan_id;
                return (
                  <li key={p.id} className={`flex flex-wrap items-center gap-3 py-3 ${current ? "-mx-2 rounded-xl bg-primary/5 px-2" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        {p.name}
                        {current ? <Badge variant="secondary">Your plan</Badge> : p.is_recommended ? <Badge variant="outline">Popular</Badge> : null}
                      </p>
                      <p className="text-sm">
                        <span className="font-semibold tabular-nums">₹{Number(p.price_monthly_inr).toLocaleString("en-IN")}</span>
                        <span className="text-muted-foreground"> / month</span>
                      </p>
                    </div>
                    <Button
                      className="h-11 rounded-xl"
                      variant={current ? "outline" : "default"}
                      disabled={busyId !== null || confirming}
                      onClick={() => handleBuy(p as any)}
                      aria-label={`${current ? "Renew" : "Choose"} ${p.name}`}
                    >
                      {busyId === p.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {current ? "Renew" : "Choose"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          <Link to="/pricing" className="mt-2 inline-flex min-h-11 items-center text-sm text-primary underline-offset-4 hover:underline">
            Compare plans in detail
          </Link>
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
    </SettingsShell>
  );
}
