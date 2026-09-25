import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowLeft, Check, CreditCard, Loader2, Lock, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { supabase } from "@/integrations/supabase/client";
import { getSocietyAccessStatus, type SocietyAccessStatus } from "@/lib/pricing-engine";
import { getFeatureCatalog, PLAN_LABELS, type PlanKey } from "@/lib/plan-features";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { Card } from "@/components/ui/card";
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
    const opened = await openRazorpayCheckout({
      plan: { id: p.id, name: p.name, price_monthly_inr: p.price_monthly_inr },
      prefill: {
        email: profile?.email ?? user?.email ?? "",
        contact: profile?.phone ?? "",
        name: profile?.full_name ?? "",
      },
      onSuccess: async () => {
        // Never claim activation here — the server webhook confirms the payment.
        toast.message("Payment received. Confirming your plan — this can take a minute.");
        setConfirming(true);
        setTimeout(() => setConfirming(false), 120_000);
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

  return (
    <main className="max-w-3xl mx-auto px-4 py-5 pb-28 space-y-5">
      <Link to="/society/more" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground min-h-[44px]">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Subscription & plan</h1>

      {loading ? (
        <Card className="rounded-2xl p-5 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-full" />
        </Card>
      ) : access.isError || !copy ? (
        <ErrorState
          title="Couldn't confirm your plan"
          description="We can't show your plan status right now. Your features aren't changed."
          onRetry={() => access.refetch()}
        />
      ) : (
        <Card className="rounded-2xl p-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-medium rounded-full px-2.5 py-1 ${copy.tone}`}>{copy.label}</span>
            {confirming && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Confirming payment…
              </span>
            )}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Current plan</p>
            <p className="text-2xl font-semibold">
              {status === "trial" ? "Free trial" : status === "active" && planName ? planName : "—"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Features available now: <b className="text-foreground">{planLoading ? "—" : PLAN_LABELS[effectivePlan]}</b>
            </p>
          </div>
          <p className="text-sm text-muted-foreground">{copy.note}</p>
          {status === "trial" && fmtDate(access.data!.trial_ends_at) && (
            <p className="text-sm">Trial ends on <b>{fmtDate(access.data!.trial_ends_at)}</b></p>
          )}
          {status === "active" && fmtDate(access.data!.plan_expires_at) && (
            <p className="text-sm">Renews / ends on <b>{fmtDate(access.data!.plan_expires_at)}</b></p>
          )}
        </Card>
      )}

      {!loading && !access.isError && status !== "forbidden" && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{status === "active" ? "Change or renew plan" : "Choose a plan"}</h2>
          {plans.isLoading ? (
            <Skeleton className="h-28 w-full rounded-2xl" />
          ) : plans.isError ? (
            <ErrorState title="Couldn't load plans" description="Please try again." onRetry={() => plans.refetch()} />
          ) : (
            <div className="grid sm:grid-cols-3 gap-3">
              {(plans.data ?? []).map((p) => {
                const current = status === "active" && p.id === access.data?.plan_id;
                return (
                  <Card key={p.id} className={`rounded-2xl p-4 flex flex-col gap-3 ${p.is_recommended ? "border-primary border-2" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold">{p.name}</p>
                      {current ? <Badge variant="secondary">Current</Badge> : p.is_recommended ? <Badge><Sparkles className="h-3 w-3 mr-1" />Popular</Badge> : null}
                    </div>
                    <p>
                      <span className="text-2xl font-bold tabular-nums">₹{Number(p.price_monthly_inr).toLocaleString("en-IN")}</span>
                      <span className="text-sm text-muted-foreground">/month</span>
                    </p>
                    <Button
                      className="mt-auto min-h-[44px] rounded-xl"
                      variant={current ? "outline" : "default"}
                      disabled={busyId !== null || confirming}
                      onClick={() => handleBuy(p as any)}
                    >
                      {busyId === p.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      {current ? "Renew" : "Choose"} {p.name}
                    </Button>
                  </Card>
                );
              })}
            </div>
          )}
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" /> Paid securely via Razorpay. Your plan activates only after we confirm the payment.
            <Link to="/pricing" className="underline ml-1">Compare plans</Link>
          </p>
        </section>
      )}

      {!loading && !access.isError && status !== "forbidden" && (
        <section className="grid sm:grid-cols-2 gap-3">
          <Card className="rounded-2xl p-4">
            <h3 className="font-semibold flex items-center gap-2 mb-2"><Check className="h-4 w-4 text-success" /> Included ({included.length})</h3>
            <ul className="space-y-1 text-sm">
              {included.map((f) => <li key={f.key}>{f.label}</li>)}
            </ul>
          </Card>
          <Card className="rounded-2xl p-4">
            <h3 className="font-semibold flex items-center gap-2 mb-2"><Lock className="h-4 w-4 text-muted-foreground" /> Needs a higher plan ({locked.length})</h3>
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
          </Card>
        </section>
      )}
      <p className="text-xs text-muted-foreground flex items-center gap-1.5"><CreditCard className="h-3.5 w-3.5" /> This is SociyoHub's subscription only. Maintenance payments are unaffected.</p>
    </main>
  );
}
