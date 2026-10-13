import { tu } from "@/lib/i18n";
import { createFileRoute, Link } from "@tanstack/react-router";
import { userMessage } from "@/lib/user-error";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Loader2, ShieldAlert, CreditCard, ArrowLeft, QrCode, Lock } from "lucide-react";
import { getSaasPaymentMethods } from "@/lib/saas-upi-payment.functions";
import { SaasUpiCheckout } from "@/components/payments/SaasUpiCheckout";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { openRazorpayForOrder } from "@/lib/razorpay";
import {
  confirmSaasSubscriptionPayment,
  createSaasSubscriptionOrder,
  getSaasSubscriptionQuotes,
} from "@/lib/saas-subscription-payment.functions";
import { TransactionSummaryModal } from "@/components/payments/TransactionSummaryModal";
import { PaymentSecurityBadge } from "@/components/payments/PaymentSecurityBadge";
import { LegalFooter } from "@/components/shared/LegalFooter";

export const Route = createFileRoute("/checkout/$planId")({
  head: () => ({
    meta: [
      { title: "Checkout — SociyoHub" },
      { name: "description", content: "Secure checkout for SociyoHub subscription plans." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  validateSearch: (s: Record<string, unknown>): { term?: 1 | 3 | 12 } => {
    const n = Number(s.term);
    return n === 3 || n === 12 || n === 1 ? { term: n } : {};
  },
  component: CheckoutPage,
});

function CheckoutPage() {
  const { planId } = Route.useParams();
  const { term } = Route.useSearch();
  const { profile, user, hasRole } = useAuth();
  const canManagePlan = hasRole("society_admin") || hasRole("super_admin");
  const [live, setLive] = useState<boolean | null>(null);
  const fetchMethods = useServerFn(getSaasPaymentMethods);
  const methods = useQuery({ queryKey: ["saas-payment-methods"], queryFn: () => fetchMethods(), staleTime: 60_000 });
  const razorpayLocked = methods.data?.razorpayLocked ?? true;
  const upiOn = Boolean(methods.data?.upiEnabled && methods.data.upiVpa);
  const [method, setMethod] = useState<"upi" | "razorpay">("upi");
  const [busy, setBusy] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const requestId = useRef(crypto.randomUUID());
  // P10: chosen flat quantity (standard plans only). Empty = current active flats.
  const [qtyInput, setQtyInput] = useState("");
  const qtyNum = Number(qtyInput);
  const flatQuantity = qtyInput && Number.isInteger(qtyNum) && qtyNum >= 1 && qtyNum <= 300 ? qtyNum : undefined;

  useEffect(() => {
    supabase.rpc("is_razorpay_live").then(({ data }) => setLive(Boolean(data)), () => setLive(false));
  }, []);

  const fetchQuotes = useServerFn(getSaasSubscriptionQuotes);
  const {
    data: quote,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    enabled: !!profile?.society_id,
    queryKey: ["subscription-quotes", profile?.society_id, flatQuantity ?? null],
    queryFn: () => fetchQuotes({ data: { societyId: profile!.society_id!, flatQuantity } }),
    placeholderData: (prev) => prev,
    select: (quotes) => quotes.find((q) => q.plan_id === planId) ?? null,
  });
  const plan = quote
    ? { id: quote.plan_id, name: quote.plan_name, total: (quote.amount_paise ?? 0) / 100 }
    : null;
  const payable = !!quote && !quote.custom_pricing && (quote.amount_paise ?? 0) > 0;

  async function startPayment() {
    if (!plan || !profile?.society_id) return;
    setBusy(true);
    try {
      const order = await createSaasSubscriptionOrder({
        data: {
          societyId: profile.society_id,
          planId: plan.id as "basic" | "pro" | "premium",
          requestId: requestId.current,
          ...(flatQuantity ? { flatQuantity } : {}),
        },
      });
      await openRazorpayForOrder({
        orderId: order.orderId,
        keyId: order.keyId,
        amount: order.amount,
        description: quote?.pricing_type === "custom"
          ? `${order.planName} custom plan — ${quote.flat_count} flats, ${quote.term_months} month(s)`
          : `${order.planName} plan — monthly`,
        prefill: {
          email: profile?.email ?? user?.email ?? "",
          contact: profile?.phone ?? "",
          name: profile?.full_name ?? "",
        },
        onSuccess: async (resp) => {
          await confirmSaasSubscriptionPayment({
            data: {
              societyId: profile.society_id!,
              planId: plan.id as "basic" | "pro" | "premium",
              razorpayOrderId: resp.razorpay_order_id,
              razorpayPaymentId: resp.razorpay_payment_id,
              razorpaySignature: resp.razorpay_signature,
            },
          });
          toast.success("Subscription activated successfully.");
          requestId.current = crypto.randomUUID();
          setSummaryOpen(false);
          setBusy(false);
        },
        onDismiss: () => setBusy(false),
      });
    } catch (e: any) {
      toast.error(userMessage(e, "Could not start payment"));
      setBusy(false);
    }
  }

  // P02: subscriptions are managed only by Society Admins / Super Admins. The
  // server (requirePlanManager) is the real boundary; this just avoids showing it.
  if (!canManagePlan) {
    return (
      <div className="min-h-dvh bg-background text-foreground flex items-center justify-center p-6">
        <Card className="max-w-md w-full rounded-2xl">
          <CardContent className="p-6 text-center space-y-3 sm:p-6">
            <ShieldAlert className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="font-semibold">Only your society's admins manage the subscription.</p>
            <Button asChild variant="secondary" className="h-11 rounded-xl"><Link to="/">Go back</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      <main className="flex-1 py-12 px-4">
        <div className="max-w-xl mx-auto">
          <Link
            to="/pricing"
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6"
          >
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to plans
          </Link>

          <Card className="rounded-2xl border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" /> Secure Checkout
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {isLoading ? (
                <div className="py-6 grid place-items-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : isError || !plan ? (
                <div
                  role="alert"
                  className="rounded-xl border border-destructive/30 p-4 text-center"
                >
                  <p className="font-medium">This plan couldn't be loaded.</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Check the plan link or try again.
                  </p>
                  <Button
                    variant="outline"
                    className="mt-3 min-h-11"
                    onClick={() => void refetch()}
                  >
                    Try again
                  </Button>
                </div>
              ) : quote!.custom_pricing ? (
                <div className="rounded-xl bg-secondary p-4">
                  <p className="text-2xl font-semibold text-foreground">Custom pricing</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Your society has {quote!.flat_count} flats. Societies with more than{" "}
                    {quote!.threshold} flats get a custom price.
                  </p>
                  <Button asChild variant="outline" className="mt-3 min-h-11">
                    <a href="mailto:sociohub710@gmail.com?subject=Custom pricing enquiry">Talk to us</a>
                  </Button>
                </div>
              ) : !payable ? (
                <div role="alert" className="rounded-xl border p-4 text-sm">
                  Add your society's flats first. The price is ₹{quote!.price_per_flat_inr} per flat
                  per month.
                </div>
              ) : (
                <div className="rounded-xl bg-secondary p-4">
                  <p className="text-sm text-muted-foreground">You are subscribing to</p>
                  <p className="text-2xl font-semibold mt-0.5 text-foreground">{plan.name}</p>
                  <p className="text-lg mt-1 tabular-nums">
                    ₹{plan.total.toLocaleString("en-IN")}/month
                  </p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    {quote!.flat_count} flats × ₹{quote!.price_per_flat_inr} per flat
                  </p>
                  {quote!.pricing_type !== "custom" && (
                    <div className="mt-3 space-y-1">
                      <label htmlFor="flat-qty" className="text-sm font-medium">Flats to buy</label>
                      <input
                        id="flat-qty" type="number" inputMode="numeric" min={1} max={quote!.threshold}
                        value={qtyInput} placeholder={String(quote!.flat_count)}
                        onChange={(e) => { setQtyInput(e.target.value); requestId.current = crypto.randomUUID(); }}
                        className="h-11 w-full rounded-xl border border-input bg-background px-3 tabular-nums"
                      />
                      <p className="text-xs text-muted-foreground">
                        At least your current active flats, up to {quote!.threshold}. The price is worked out by SociyoHub.
                      </p>
                    </div>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    This SociyoHub subscription is billed separately from society maintenance.
                    Maintenance payments go to the society, with no SociyoHub platform fee.
                  </p>
                </div>
              )}

              {live === null || methods.isLoading ? (
                <div className="py-6 grid place-items-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : plan && payable ? (
                <div className="space-y-4">
                  <p className="text-sm font-semibold">{tu("ln.upi.choose")}</p>
                  <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-2 gap-3">
                    <button
                      type="button" role="radio" aria-checked={method === "upi"}
                      disabled={!upiOn}
                      onClick={() => setMethod("upi")}
                      className={`min-h-[72px] rounded-xl border-2 p-3 text-left transition-colors disabled:opacity-50 ${method === "upi" ? "border-primary bg-primary/5" : "border-border"}`}
                    >
                      <QrCode className="h-5 w-5 text-primary" />
                      <p className="mt-1 text-sm font-semibold">{tu("ln.upi.mUpi")}</p>
                      <p className="text-xs text-muted-foreground">{upiOn ? tu("ln.upi.anyApp") : tu("ln.upi.unavailable")}</p>
                    </button>
                    <button
                      type="button" role="radio" aria-checked={method === "razorpay"}
                      disabled={razorpayLocked || !live}
                      aria-disabled={razorpayLocked || !live}
                      onClick={() => setMethod("razorpay")}
                      className={`relative min-h-[72px] rounded-xl border-2 p-3 text-left disabled:cursor-not-allowed disabled:opacity-60 ${method === "razorpay" ? "border-primary bg-primary/5" : "border-border"}`}
                    >
                      <Lock className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                      <CreditCard className="h-5 w-5 text-muted-foreground" />
                      <p className="mt-1 text-sm font-semibold">{tu("ln.upi.mCard")}</p>
                      <p className="text-xs text-muted-foreground">{razorpayLocked || !live ? tu("ln.upi.out") : tu("ln.upi.viaRzp")}</p>
                    </button>
                  </div>
                  {method === "upi" && upiOn && profile?.society_id ? (
                    <SaasUpiCheckout
                      societyId={profile.society_id}
                      planId={plan.id as "basic" | "pro" | "premium"}
                      planName={plan.name}
                      flatQuantity={flatQuantity}
                      initialTerm={term}
                      upiVpa={methods.data!.upiVpa}
                      payeeName={methods.data!.payeeName}
                    />
                  ) : method === "razorpay" && !razorpayLocked && live ? (
                    <>
                      <Button onClick={() => setSummaryOpen(true)} disabled={busy} className="w-full min-h-[56px] rounded-xl">
                        Review & Pay securely
                      </Button>
                      <PaymentSecurityBadge />
                    </>
                  ) : (
                    <div className="rounded-xl border border-warning/30 bg-warning/5 p-4 text-sm">
                      <p className="font-semibold">{tu("ln.upi.outTitle")}</p>
                      <p className="mt-1 text-muted-foreground">
                        {tu("ln.upi.help")} <a href="mailto:sociohub710@gmail.com" className="underline">sociohub710@gmail.com</a>.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}

              <p className="text-xs text-muted-foreground text-center">
                By continuing you agree to our{" "}
                <Link to="/terms" className="underline">
                  Terms
                </Link>
                ,{" "}
                <Link to="/refund" className="underline">
                  Refund Policy
                </Link>
                , and{" "}
                <Link to="/privacy" className="underline">
                  Privacy Policy
                </Link>
                .
              </p>
            </CardContent>
          </Card>
        </div>

        {plan && payable && (
          <TransactionSummaryModal
            open={summaryOpen}
            onOpenChange={(v) => (busy ? null : setSummaryOpen(v))}
            title="Transaction Summary"
            description={`${plan.name} plan — monthly subscription`}
            lines={[
              {
                label: `${plan.name} — ${quote!.flat_count} flats × ₹${quote!.price_per_flat_inr}`,
                amount: (quote!.base_amount_paise ?? quote!.amount_paise ?? 0) / 100,
              },
              (quote!.tax_amount_paise ?? 0) > 0
                ? { label: `${tu("ln.co.gst")}${quote!.tax_percent ? ` (${quote!.tax_percent}%)` : ""}`, amount: (quote!.tax_amount_paise ?? 0) / 100 }
                : { label: tu("ln.co.noTax"), amount: 0, muted: true },
            ]}
            total={plan.total}
            busy={busy}
            onConfirm={startPayment}
            confirmLabel="Pay Now"
          />
        )}
      </main>
      <LegalFooter />
    </div>
  );
}
