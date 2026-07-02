import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Loader2, ShieldAlert, CreditCard, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { openRazorpayCheckout } from "@/lib/razorpay";
import { TransactionSummaryModal } from "@/components/payments/TransactionSummaryModal";
import { PaymentSecurityBadge } from "@/components/payments/PaymentSecurityBadge";
import { LegalFooter } from "@/components/shared/LegalFooter";

export const Route = createFileRoute("/checkout/$planId")({
  head: () => ({
    meta: [
      { title: "Checkout — SocioHub" },
      { name: "description", content: "Secure checkout for SocioHub subscription plans, powered by Razorpay." },
    ],
  }),
  component: CheckoutPage,
});

function CheckoutPage() {
  const { planId } = Route.useParams();
  const { profile, user } = useAuth();
  const [live, setLive] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

  useEffect(() => {
    supabase.rpc("is_razorpay_live").then(({ data }) => setLive(Boolean(data)));
  }, []);

  const { data: plan, isLoading } = useQuery({
    queryKey: ["plan", planId],
    queryFn: async () => (await supabase.from("plans").select("*").eq("id", planId).maybeSingle()).data,
  });

  async function startPayment() {
    if (!plan) return;
    setBusy(true);
    try {
      await openRazorpayCheckout({
        plan: { id: plan.id, name: plan.name, price_monthly_inr: plan.price_monthly_inr },
        prefill: {
          email: profile?.email ?? user?.email ?? "",
          contact: profile?.phone ?? "",
          name: profile?.full_name ?? "",
        },
        onSuccess: (resp) => {
          toast.success(`Payment captured: ${resp.razorpay_payment_id}`);
          setSummaryOpen(false);
        },
        onDismiss: () => setBusy(false),
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not start payment");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1 py-12 px-4">
        <div className="max-w-xl mx-auto">
          <Link to="/pricing" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-6">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to plans
          </Link>

          <Card className="rounded-2xl border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-primary" /> Secure Checkout
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {isLoading || !plan ? (
                <div className="py-6 grid place-items-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="rounded-xl bg-secondary p-4">
                  <p className="text-sm text-muted-foreground">You are subscribing to</p>
                  <p className="text-2xl font-semibold mt-0.5 text-slate-900 dark:text-slate-50">{plan.name}</p>
                  <p className="text-lg mt-1">
                    ₹{plan.price_monthly_inr}/month · {plan.txn_fee_pct}% transaction fee on maintenance
                  </p>
                </div>
              )}

              {live === null ? (
                <div className="py-6 grid place-items-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : live && plan ? (
                <>
                  <Button
                    onClick={() => setSummaryOpen(true)}
                    disabled={busy}
                    className="w-full min-h-[56px] rounded-xl"
                  >
                    Review & Pay securely
                  </Button>
                  <PaymentSecurityBadge />
                </>
              ) : (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
                  <div className="flex items-start gap-3">
                    <ShieldAlert className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold">Payments are being finalised</p>
                      <p className="text-sm text-muted-foreground mt-1">
                        We are completing our Razorpay merchant verification. Checkout will go live shortly. For
                        anything urgent, email{" "}
                        <a href="mailto:sociohub710@gmail.com" className="underline">sociohub710@gmail.com</a>.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <p className="text-xs text-muted-foreground text-center">
                By continuing you agree to our{" "}
                <Link to="/terms" className="underline">Terms</Link>,{" "}
                <Link to="/refund" className="underline">Refund Policy</Link>, and{" "}
                <Link to="/privacy" className="underline">Privacy Policy</Link>.
              </p>
            </CardContent>
          </Card>
        </div>

        {plan && (
          <TransactionSummaryModal
            open={summaryOpen}
            onOpenChange={(v) => (busy ? null : setSummaryOpen(v))}
            title="Transaction Summary"
            description={`${plan.name} plan — monthly subscription`}
            lines={[
              { label: `${plan.name} plan (monthly)`, amount: plan.price_monthly_inr },
              { label: "Platform fee", amount: 0, muted: true },
              { label: "Taxes (incl.)", amount: 0, muted: true },
            ]}
            total={plan.price_monthly_inr}
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
