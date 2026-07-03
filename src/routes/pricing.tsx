import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Sparkles, Loader2, ShieldCheck, Zap, Crown, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getApplicablePlans, getPricingSettings } from "@/lib/pricing-engine";
import { LegalFooter } from "@/components/shared/LegalFooter";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — SocioHub" },
      {
        name: "description",
        content:
          "Simple pricing for every society. Start with a free trial. Custom modules, transparent per-unit rates.",
      },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  const [units, setUnits] = useState<number | null>(null);
  const [showEnterprise, setShowEnterprise] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["pricing-settings"],
    queryFn: getPricingSettings,
  });

  const { data: plans, isLoading } = useQuery({
    enabled: units !== null || !showEnterprise,
    queryKey: ["applicable-plans-public", units],
    queryFn: () => getApplicablePlans(units),
  });

  const trialDays = settings?.trial_days ?? 14;
  const threshold = settings?.enterprise_threshold_units ?? 500;
  const enterprise = plans?.find((p) => p.enterprise);
  const standard = (plans ?? []).filter((p) => !p.enterprise && p.plan_id !== "trial");

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <section className="max-w-6xl mx-auto px-5 py-14">
        <header className="text-center mb-10 space-y-3">
          <Badge className="rounded-full bg-primary/10 text-primary border-primary/20">
            <Sparkles className="h-3 w-3 mr-1" /> {trialDays}-day free trial
          </Badge>
          <h1 className="type-display">Plans that scale with your society</h1>
          <p className="text-muted-foreground max-w-2xl mx-auto text-base">
            Start free — no credit card required. Modules pay for themselves in your first month.
          </p>
        </header>

        {/* Total-units estimator */}
        <Card className="rounded-3xl border border-border p-5 mb-8 max-w-lg mx-auto">
          <label className="block text-xs uppercase tracking-wider text-muted-foreground mb-2">
            How many units does your society have?
          </label>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <input
              type="number"
              min={1}
              placeholder="e.g. 120"
              value={units ?? ""}
              onChange={(e) => {
                const n = Number(e.target.value);
                setUnits(Number.isFinite(n) && n > 0 ? n : null);
              }}
              className="flex-1 min-w-0 h-11 rounded-2xl border border-border bg-background px-3 text-base outline-none focus:border-primary"
            />
            <Button
              variant="outline"
              className="rounded-2xl h-11 w-full sm:w-auto shrink-0"
              onClick={() => {
                setUnits(threshold + 1);
                setShowEnterprise(true);
              }}
            >
              I need enterprise
            </Button>
          </div>

          <p className="mt-2 text-[11px] text-muted-foreground">
            Societies with more than {threshold} units automatically qualify for enterprise pricing.
          </p>
        </Card>

        {isLoading ? (
          <div className="py-16 grid place-items-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : enterprise ? (
          <Card className="rounded-3xl border-2 border-primary/30 p-8 bg-gradient-to-br from-primary/10 via-background to-background">
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="h-14 w-14 rounded-2xl bg-primary/15 grid place-items-center">
                <Building2 className="h-7 w-7 text-primary" />
              </div>
              <div className="flex-1 space-y-2">
                <Badge>Enterprise</Badge>
                <h2 className="text-xl font-semibold tracking-tight">Tailored for large societies</h2>
                <p className="text-sm text-muted-foreground">
                  Dedicated onboarding, an SLA, priority support and volume-based pricing. Perfect for townships,
                  villa communities and multi-tower complexes.
                </p>
              </div>
              <Button asChild className="rounded-2xl h-12 min-w-[200px]">
                <a href={`mailto:${settings?.enterprise_contact_email ?? "sales@sociohub.live"}`}>
                  Talk to sales
                </a>
              </Button>
            </div>
          </Card>
        ) : (
          <>
            {/* Trial highlight */}
            <Card className="rounded-3xl border-0 p-6 mb-8 bg-gradient-to-br from-primary to-primary/85 text-primary-foreground">
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                <div className="h-14 w-14 rounded-2xl bg-primary-foreground/15 grid place-items-center shrink-0">
                  <Zap className="h-7 w-7" />
                </div>
                <div className="flex-1">
                  <h2 className="text-xl font-semibold tracking-tight">Free for {trialDays} days</h2>
                  <p className="opacity-90 text-sm mt-1">
                    All Premium features unlocked. Auto-converts to any paid plan you pick — cancel anytime.
                  </p>
                </div>
                <Button
                  asChild
                  className="min-h-[48px] rounded-2xl px-6 bg-background text-foreground hover:bg-background/90 font-semibold"
                >
                  <Link to="/onboarding" search={{} as any}>
                    Start free trial
                  </Link>
                </Button>
              </div>
            </Card>

            {/* Standard plans */}
            <div className="grid md:grid-cols-3 gap-4">
              {standard.map((p) => {
                const Icon = p.plan_id === "premium" ? Crown : p.plan_id === "pro" ? Sparkles : ShieldCheck;
                return (
                  <Card
                    key={p.plan_id}
                    className={`rounded-3xl p-6 flex flex-col ${
                      p.is_recommended ? "border-2 border-primary shadow-lg" : "border border-border"
                    }`}
                  >
                    {p.is_recommended && (
                      <Badge className="self-start mb-3 rounded-full">
                        <Sparkles className="h-3 w-3 mr-1" /> Most popular
                      </Badge>
                    )}
                    <div className="flex items-center gap-2">
                      <Icon className="h-5 w-5 text-primary" />
                      <h3 className="text-xl font-semibold tracking-tight">{p.plan_name}</h3>
                    </div>
                    <div className="mt-3 flex items-baseline gap-1">
                      <span className="text-4xl font-bold">₹{p.price_monthly_inr ?? 0}</span>
                      <span className="text-muted-foreground text-sm">/mo</span>
                    </div>
                    <ul className="mt-4 space-y-2 text-sm flex-1">
                      {p.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <Check className="h-4 w-4 text-primary mt-0.5" /> {f}
                        </li>
                      ))}
                    </ul>
                    <Button asChild className="mt-6 min-h-[48px] rounded-2xl">
                      <Link to="/checkout/$planId" params={{ planId: p.plan_id }}>
                        Choose {p.plan_name}
                      </Link>
                    </Button>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        <p className="text-center text-xs text-muted-foreground mt-10">
          Prices in INR, exclusive of applicable taxes. Payments are processed through secure Indian gateways
          (PayU / Cashfree) with UPI, cards, net banking and wallet support.
        </p>
      </section>
      <LegalFooter />
    </main>
  );
}
