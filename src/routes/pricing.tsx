import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, X, Sparkles, Loader2, ShieldCheck, Eye, Palette } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NeonThemePreview } from "@/components/shared/NeonThemePreview";
import { useAuth } from "@/context/AuthContext";
import { ROLES } from "@/config/roles";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — SocioHub" },
      { name: "description", content: "Simple plans for every society. Start with a 14-day free trial. No credit card required." },
    ],
  }),
  component: PricingPage,
});

type Plan = {
  id: string; name: string; price_monthly_inr: number; txn_fee_pct: number;
  ads_enabled: boolean; trial_days: number; is_recommended: boolean;
  features: string[]; sort_order: number;
};

function PricingPage() {
  const [yearly, setYearly] = useState(false);
  const { primaryRole, isAuthenticated } = useAuth();
  const isResident = isAuthenticated && primaryRole === ROLES.RESIDENT;

  const { data: plans, isLoading } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => {
      const { data, error } = await supabase.from("plans").select("*").order("sort_order");
      if (error) throw error;
      return (data ?? []) as Plan[];
    },
  });

  // Strict role-based catalogue: residents get the personal ₹50 plan only,
  // society admins (and guests) see the 3 society plans.
  const residentPlans = (plans ?? []).filter((p) => p.id === "resident" || p.id === "ad_free");
  const adminPaid = (plans ?? []).filter((p) => !["trial", "resident", "ad_free"].includes(p.id));
  const paid = isResident ? residentPlans : adminPaid;
  const trial = !isResident ? (plans ?? []).find((p) => p.id === "trial") : undefined;

  return (
    <main className="min-h-dvh bg-[#121212] text-foreground py-16 px-4">
      <div className="max-w-6xl mx-auto">
        <header className="text-center mb-10">
          <Badge className="bg-[#B91C1C]/15 text-[#F87171] border-[#B91C1C]/30 mb-4">14-day free trial</Badge>
          <h1 className="text-4xl md:text-5xl font-semibold tracking-tight">Plans that scale with your society</h1>
          <p className="text-muted-foreground mt-3 max-w-2xl mx-auto">
            Start free for 14 days — no credit card required. Switch or cancel anytime.
          </p>

          <div className="inline-flex items-center mt-8 p-1 rounded-2xl bg-[#1E1E1E] border border-white/5">
            <button
              onClick={() => setYearly(false)}
              className={`min-h-[44px] px-5 rounded-xl text-sm font-medium transition ${!yearly ? "bg-[#B91C1C] text-white" : "text-muted-foreground"}`}
            >Monthly</button>
            <button
              onClick={() => setYearly(true)}
              className={`min-h-[44px] px-5 rounded-xl text-sm font-medium transition ${yearly ? "bg-[#B91C1C] text-white" : "text-muted-foreground"}`}
            >Yearly <span className="ml-1 text-xs opacity-80">save 16%</span></button>
          </div>
        </header>

        {isLoading ? (
          <div className="py-16 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <>
            {/* Trial banner */}
            {trial && (
              <Card className="rounded-2xl bg-[#1E1E1E] border-white/5 p-6 mb-8 flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm uppercase tracking-wider text-[#F87171]">Try free for {trial.trial_days} days</p>
                  <h3 className="text-xl font-semibold mt-1">All features unlocked. No credit card required.</h3>
                  <p className="text-sm text-muted-foreground mt-1">Auto-converts to Basic when the trial ends — cancel anytime.</p>
                </div>
                <Button asChild className="min-h-[56px] rounded-xl px-6 bg-[#B91C1C] hover:bg-[#991B1B]">
                  <a href="/onboarding/create">Start free trial</a>
                </Button>
              </Card>
            )}

            {/* Plan cards */}
            <div className="grid md:grid-cols-3 gap-5">
              {paid.map((p) => {
                const recommended = p.is_recommended;
                const price = yearly ? Math.round(p.price_monthly_inr * 10) : p.price_monthly_inr;
                return (
                  <Card
                    key={p.id}
                    className={`rounded-2xl bg-[#1E1E1E] p-6 flex flex-col transition ${
                      recommended
                        ? "border-2 border-[#B91C1C] shadow-[0_0_40px_-10px_#B91C1C]"
                        : "border border-white/5"
                    }`}
                  >
                    {recommended && (
                      <Badge className="self-start mb-3 bg-[#B91C1C] text-white border-0">
                        <Sparkles className="h-3 w-3 mr-1" /> Recommended
                      </Badge>
                    )}
                    <h3 className="text-2xl font-semibold">{p.name}</h3>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-4xl font-bold">₹{price.toLocaleString("en-IN")}</span>
                      <span className="text-muted-foreground">/{yearly ? "year" : "month"}</span>
                    </div>
                    <div className="mt-4 space-y-2 text-sm">
                      <Row label={`Transaction fee: ${p.txn_fee_pct}%`} ok={p.txn_fee_pct === 0} />
                      <Row label={p.ads_enabled ? "Ad-supported" : "Ad-free"} ok={!p.ads_enabled} />
                      {(p.features ?? []).map((f, i) => <Row key={i} label={f} ok />)}
                      {p.id === "premium" ? (
                        <div className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
                          <span className="flex-1">Premium <b>Neon</b> theme (advanced look)</span>
                          <ThemePreviewButton />
                        </div>
                      ) : (
                        <Row label="Standard theme only" ok={false} />
                      )}
                    </div>
                    <Button
                      asChild
                      className={`mt-6 min-h-[56px] rounded-xl ${
                        recommended ? "bg-[#B91C1C] hover:bg-[#991B1B]" : "bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      <a href={`/checkout/${p.id}`}>Choose {p.name}</a>
                    </Button>
                  </Card>
                );
              })}
            </div>

            {/* Comparison */}
            <section className="mt-14">
              <h2 className="text-2xl font-semibold mb-4">Compare plans</h2>
              <div className="overflow-x-auto rounded-2xl border border-white/5 bg-[#1E1E1E]">
                <table className="w-full text-sm">
                  <thead className="bg-white/5 text-left">
                    <tr>
                      <th className="p-4">Feature</th>
                      {paid.map((p) => <th key={p.id} className="p-4">{p.name}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <CompareRow label="Monthly price" values={paid.map((p) => `₹${p.price_monthly_inr}`)} />
                    <CompareRow label="Transaction fee" values={paid.map((p) => `${p.txn_fee_pct}%`)} />
                    <CompareRow label="Ads" values={paid.map((p) => p.ads_enabled ? "Shown" : "None")} />
                    <CompareRow label="Priority support" values={paid.map((p) => p.id === "basic" ? "—" : "Yes")} />
                    <CompareRow label="Custom branding" values={paid.map((p) => p.id === "premium" ? "Yes" : "—")} />
                  </tbody>
                </table>
              </div>
            </section>

            <p className="mt-10 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Payments secured by Razorpay. GST invoice provided.
            </p>
          </>
        )}
      </div>
    </main>
  );
}

function Row({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? <Check className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" /> : <X className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />}
      <span className={ok ? "" : "text-muted-foreground"}>{label}</span>
    </div>
  );
}

function CompareRow({ label, values }: { label: string; values: string[] }) {
  return (
    <tr className="border-t border-white/5">
      <td className="p-4 font-medium">{label}</td>
      {values.map((v, i) => <td key={i} className="p-4 text-muted-foreground">{v}</td>)}
    </tr>
  );
}

function ThemePreviewButton() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="text-xs inline-flex items-center gap-1 rounded-full px-2 py-0.5 bg-[#B91C1C]/15 text-[#F87171] border border-[#B91C1C]/30 hover:bg-[#B91C1C]/25">
          <Eye className="h-3 w-3" /> Preview
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-sm bg-[#0d0d0d] border-white/10">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Palette className="h-4 w-4" /> Neon theme preview</DialogTitle>
        </DialogHeader>
        <NeonThemePreview />
        <p className="text-xs text-muted-foreground mt-2">
          Premium-only. Switch back to the standard theme anytime in <b>Settings → Appearance</b>.
        </p>
      </DialogContent>
    </Dialog>
  );
}
