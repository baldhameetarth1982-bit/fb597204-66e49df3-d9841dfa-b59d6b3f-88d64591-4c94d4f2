import { createFileRoute, Navigate, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Sparkles, Check, ArrowRight, Clock, Lock, Crown, ShieldCheck, Building2, Zap } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { OnboardingStepper } from "@/components/system/OnboardingStepper";
import { getApplicablePlans, startSocietyTrial, getPricingSettings } from "@/lib/pricing-engine";

export const Route = createFileRoute("/onboarding/plan")({
  head: () => ({ meta: [{ title: "Choose your plan — SociyoHub" }] }),
  component: PlanGate,
});

function PlanGate() {
  const { isLoading, isAuthenticated } = useAuth();
  const { societyId, loading: sLoading } = useSocietyId();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const { data: society } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-plan-state", societyId],
    queryFn: async () => {
      const [{ data: row }, { data: access }] = await Promise.all([
        supabase
          .from("societies")
          .select("id,name,plan_id,plan_status,plan_expires_at,trial_ends_at,total_units,trial_consumed_at")
          .eq("id", societyId!)
          .maybeSingle(),
        supabase.rpc("society_has_access", { _society_id: societyId! }),
      ]);
      return { ...(row ?? {}), has_access: Boolean(access) } as any;
    },
  });

  const { data: plans } = useQuery({
    enabled: !!society,
    queryKey: ["applicable-plans", (society as any)?.total_units],
    queryFn: () => getApplicablePlans((society as any)?.total_units ?? null),
  });

  const { data: settings } = useQuery({
    queryKey: ["pricing-settings"],
    queryFn: getPricingSettings,
  });

  useEffect(() => {
    if (society && (society as any).has_access) navigate({ to: "/society/dashboard", replace: true });
  }, [society, navigate]);

  if (isLoading || sLoading) {
    return (
      <div className="min-h-dvh grid place-items-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!societyId) return <Navigate to="/onboarding/create" replace />;

  async function handleStartTrial() {
    if (busy) return;
    setBusy(true);
    try {
      await startSocietyTrial(societyId!);
      toast.success(`Free trial started 🎉`);
      navigate({ to: "/society/dashboard", replace: true });
    } catch (e: any) {
      toast.error(e.message ?? "Could not start trial");
    } finally {
      setBusy(false);
    }
  }

  const enterprise = plans?.find((p) => p.enterprise);
  const standard = (plans ?? []).filter((p) => !p.enterprise && p.plan_id !== "trial");
  const trialAlreadyUsed = Boolean((society as any)?.trial_consumed_at);
  const trialDays = settings?.trial_days ?? 14;

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="max-w-6xl mx-auto px-5 py-10">
        <OnboardingStepper
          step={2}
          total={4}
          labels={["Society details", "Choose plan", "Payment", "Setup"]}
          className="mb-6 max-w-md"
        />

        <header className="text-center mb-8 space-y-3">
          <Badge className="rounded-full bg-primary/10 text-primary border-primary/20">
            <Lock className="h-3 w-3 mr-1" /> Required to continue
          </Badge>
          <h1 className="type-display">
            Pick a plan for{" "}
            <span className="text-primary">{(society as any)?.name ?? "your society"}</span>
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto text-sm">
            Every resident gets full access while your plan is active. Cancel anytime.
          </p>
        </header>

        {/* Enterprise fast-path */}
        {enterprise ? (
          <Card className="rounded-3xl border-2 border-primary/30 p-8 mb-8 bg-gradient-to-br from-primary/10 via-background to-background">
            <div className="flex flex-col md:flex-row gap-6 items-start">
              <div className="h-14 w-14 rounded-2xl bg-primary/15 grid place-items-center">
                <Building2 className="h-7 w-7 text-primary" />
              </div>
              <div className="flex-1 space-y-2">
                <Badge className="rounded-full">Enterprise</Badge>
                <h2 className="text-xl font-semibold tracking-tight">Custom pricing for your society</h2>
                <p className="text-sm text-muted-foreground">
                  With <strong>{(society as any)?.total_units ?? "500+"}</strong> units, you qualify for enterprise
                  pricing with dedicated onboarding, SLA and account management.
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full md:w-auto">
                <Button
                  asChild
                  className="rounded-2xl h-12 min-w-[200px]"
                >
                  <a
                    href={`mailto:${settings?.enterprise_contact_email ?? "sales@sociohub.live"}?subject=Enterprise plan enquiry`}
                  >
                    Talk to sales
                  </a>
                </Button>
                {settings?.enterprise_contact_phone && (
                  <a
                    href={`tel:${settings.enterprise_contact_phone}`}
                    className="text-xs text-center text-muted-foreground hover:text-foreground"
                  >
                    or call {settings.enterprise_contact_phone}
                  </a>
                )}
              </div>
            </div>
          </Card>
        ) : (
          <>
            {/* Trial */}
            {!trialAlreadyUsed && (
              <Card className="rounded-3xl border-0 bg-gradient-to-br from-primary to-primary/85 text-primary-foreground p-6 mb-6">
                <div className="flex flex-col md:flex-row md:items-center gap-4">
                  <div className="h-14 w-14 rounded-2xl bg-primary-foreground/15 grid place-items-center shrink-0">
                    <Sparkles className="h-7 w-7" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-xs opacity-90">
                      <Clock className="h-4 w-4" /> {trialDays} days · No card needed
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight mt-1">Try every Premium feature free</h2>
                    <p className="opacity-90 mt-1 text-sm">
                      Trial can be started once per society. After it ends, you can switch to any paid plan.
                    </p>
                  </div>
                  <Button
                    disabled={busy}
                    onClick={handleStartTrial}
                    className="min-h-[52px] rounded-2xl px-6 bg-background text-foreground hover:bg-background/90 font-semibold"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                    Start free trial
                  </Button>
                </div>
              </Card>
            )}

            {/* Plans */}
            <div className="grid md:grid-cols-3 gap-4 mb-8">
              {standard.map((p) => {
                const Icon = p.plan_id === "premium" ? Crown : p.plan_id === "pro" ? Sparkles : ShieldCheck;
                return (
                  <Card
                    key={p.plan_id}
                    className={`rounded-3xl p-6 flex flex-col ${p.is_recommended ? "border-2 border-primary shadow-lg" : "border border-border"}`}
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
                    <Button
                      asChild
                      className={`mt-6 min-h-[48px] rounded-2xl ${p.is_recommended ? "" : "variant-outline"}`}
                    >
                      <Link to="/checkout/$planId" params={{ planId: p.plan_id }}>
                        Choose {p.plan_name} <ArrowRight className="h-4 w-4 ml-1" />
                      </Link>
                    </Button>
                  </Card>
                );
              })}
            </div>

            <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Secure payments · GST invoice · Cancel anytime
            </p>
          </>
        )}
      </div>
    </main>
  );
}
