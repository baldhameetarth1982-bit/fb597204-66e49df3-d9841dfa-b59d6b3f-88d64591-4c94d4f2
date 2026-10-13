import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OnboardingStepper } from "@/components/system/OnboardingStepper";
import { getApplicablePlans } from "@/lib/pricing-engine";
import { saveIntendedPlan, type IntendedTerm } from "@/lib/intended-plan";
import { tu } from "@/lib/i18n";
import { PlanFeatureList, isPlanKey } from "@/components/subscription/PlanFeatureList";

export const Route = createFileRoute("/onboarding/choose-plan")({
  head: () => ({
    meta: [
      { title: "Choose a plan — SociyoHub" },
      { name: "description", content: "Pick a SociyoHub plan before setting up your society." },
      { property: "og:title", content: "Choose a plan — SociyoHub" },
      { property: "og:description", content: "Pick a SociyoHub plan before setting up your society." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ChoosePlanFirst,
});

function ChoosePlanFirst() {
  const { isLoading, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [plan, setPlan] = useState<string | null>(null);
  const [term, setTerm] = useState<IntendedTerm>(12);
  const plans = useQuery({ queryKey: ["applicable-plans", null], queryFn: () => getApplicablePlans(null), enabled: isAuthenticated });

  if (isLoading) return <div className="min-h-dvh grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;

  const standard = (plans.data ?? []).filter((p) => !p.enterprise && p.plan_id !== "trial");
  const chosen = plan ?? standard.find((p) => p.is_recommended)?.plan_id ?? standard[0]?.plan_id ?? null;
  const chosenName = standard.find((p) => p.plan_id === chosen)?.plan_name ?? "";

  return (
    <main className="min-h-dvh bg-background px-5 py-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <OnboardingStepper step={1} total={4} labels={["Choose plan", "Society details", "Payment", "Setup"]} className="max-w-md" />
        <header className="space-y-2">
          <h1 className="type-display">{tu("ln.ob.title")}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{tu("ln.ob.body")}</p>
        </header>

        <div role="radiogroup" aria-label={tu("ln.sub.term")} className="grid max-w-md grid-cols-3 gap-2">
          {([1, 3, 12] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={term === m} onClick={() => setTerm(m)}
              className={`min-h-[56px] rounded-xl border-2 p-2 text-sm font-semibold ${term === m ? "border-primary bg-primary/5" : "border-border"}`}>
              {tu(`ln.sub.m${m}`)}
              {m > 1 && <span className="mt-0.5 block text-xs font-medium text-success">{tu("ln.sub.save").replace("{{pct}}", m === 3 ? "6" : "8")}</span>}
            </button>
          ))}
        </div>

        {plans.isLoading ? (
          <div className="py-10 grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : plans.isError ? (
          <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm">
            {tu("ln.upi.fail")} <Button variant="outline" className="ml-2 min-h-11" onClick={() => void plans.refetch()}>{tu("ln.sub.retry")}</Button>
          </div>
        ) : (
          <div role="radiogroup" aria-label={tu("ln.ob.title")} className="grid gap-4 md:grid-cols-3">
            {standard.map((p) => (
              <Card key={p.plan_id} className={`h-full rounded-3xl p-6 transition-colors ${chosen === p.plan_id ? "border-2 border-primary" : "border border-border"}`}>
                <button type="button" role="radio" aria-checked={chosen === p.plan_id} onClick={() => setPlan(p.plan_id)} className="block w-full rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  {p.is_recommended && <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"><Sparkles className="h-3 w-3" />{tu("op.most_popular")}</span>}
                  <h2 className="text-xl font-semibold tracking-tight">{p.plan_name}</h2>
                  <p className="mt-2"><span className="text-3xl font-bold tabular-nums">₹{p.price_per_flat_inr ?? 0}</span> <span className="text-sm text-muted-foreground">{tu("ln.ob.perFlat")}</span></p>
                </button>
                {isPlanKey(p.plan_id) ? (
                  <PlanFeatureList plan={p.plan_id} className="mt-4" />
                ) : (
                  <ul className="mt-4 space-y-2 text-sm">
                    {p.features.slice(0, 6).map((f, i) => <li key={i} className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{f}</li>)}
                  </ul>
                )}
              </Card>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <Button className="h-12 w-full rounded-2xl sm:w-auto sm:px-8" disabled={!chosen}
            onClick={() => { if (!chosen) return; saveIntendedPlan({ plan: chosen, term }); navigate({ to: "/onboarding/create" }); }}>
            {tu("ln.ob.continue").replace("{{plan}}", chosenName)} <ArrowRight className="ml-1 h-4 w-4" />
          </Button>
          <p className="text-xs text-muted-foreground">{tu("ln.ob.trialNote")}</p>
        </div>
      </div>
    </main>
  );
}
