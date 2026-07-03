import { createFileRoute, Navigate, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Loader2, Sparkles, Check, ShieldCheck, Zap, Crown, ArrowRight, Clock, Lock,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export const Route = createFileRoute("/onboarding/plan")({
  head: () => ({ meta: [{ title: "Choose your plan — SocioHub" }] }),
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
          .select("id,name,plan_id,plan_status,plan_expires_at,trial_ends_at")
          .eq("id", societyId!)
          .maybeSingle(),
        supabase.rpc("society_has_access", { _society_id: societyId! }),
      ]);
      return { ...(row ?? {}), has_access: Boolean(access) } as any;
    },
  });

  const { data: plans } = useQuery({
    queryKey: ["plans-onboarding"],
    queryFn: async () => (await supabase.from("plans").select("*").neq("id", "ad_free").order("sort_order")).data ?? [],
  });

  // If access is already granted, kick into the app.
  useEffect(() => {
    if (!society) return;
    if (society.has_access) navigate({ to: "/society/dashboard", replace: true });
  }, [society, navigate]);

  if (isLoading || sLoading) {
    return (
      <div className="min-h-dvh grid place-items-center bg-[#0a0a0a]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!societyId) return <Navigate to="/onboarding/create" replace />;

  async function startTrial() {
    setBusy(true);
    const { error } = await supabase.rpc("start_trial_for_society", { _society_id: societyId! });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success("14-day free trial started 🎉");
    navigate({ to: "/society/dashboard", replace: true });
  }

  const paid = (plans ?? []).filter((p: any) => p.id !== "trial");

  return (
    <main className="min-h-dvh bg-gradient-to-br from-[#0a0a0a] via-[#150505] to-[#0a0a0a] text-white">
      <div className="max-w-6xl mx-auto px-5 py-12">
        {/* Hero */}
        <header className="text-center mb-10 space-y-3">
          <Badge className="bg-[#B91C1C]/15 text-[#FCA5A5] border-[#B91C1C]/30 rounded-full">
            <Lock className="h-3 w-3 mr-1" /> Required to continue
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
            Pick a plan to launch <span className="text-[#F87171]">{society?.name ?? "your society"}</span>
          </h1>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Start free for 14 days — no credit card required. Every resident in your society gets full access while your plan is active.
          </p>
        </header>

        {/* Free trial spotlight */}
        <Card className="rounded-3xl border-0 bg-gradient-to-br from-[#B91C1C] to-[#7f1d1d] p-7 mb-8 shadow-[0_20px_60px_-20px_#B91C1C]">
          <div className="flex flex-col md:flex-row md:items-center gap-5">
            <div className="h-16 w-16 rounded-2xl bg-white/15 grid place-items-center shrink-0">
              <Sparkles className="h-8 w-8" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 text-sm opacity-90">
                <Clock className="h-4 w-4" /> 14 days · No card needed
              </div>
              <h2 className="text-2xl font-bold mt-1">Try every Premium feature free</h2>
              <p className="opacity-90 mt-1 text-sm">After 14 days, your society will be locked until you choose a paid plan. Cancel anytime.</p>
            </div>
            <Button
              disabled={busy}
              onClick={startTrial}
              className="min-h-[56px] rounded-xl px-6 bg-white text-[#7f1d1d] hover:bg-white/90 font-semibold"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
              Start free trial
            </Button>
          </div>
        </Card>

        {/* Paid plans */}
        <div className="grid md:grid-cols-3 gap-5 mb-10">
          {paid.map((p: any) => {
            const recommended = p.is_recommended;
            const Icon = p.id === "premium" ? Crown : p.id === "pro" ? Sparkles : ShieldCheck;
            return (
              <Card
                key={p.id}
                className={`rounded-3xl p-6 flex flex-col transition bg-[#161616] ${
                  recommended ? "border-2 border-[#B91C1C] shadow-[0_0_40px_-10px_#B91C1C]" : "border border-white/10"
                }`}
              >
                {recommended && (
                  <Badge className="self-start mb-3 bg-[#B91C1C] text-white border-0">
                    <Sparkles className="h-3 w-3 mr-1" /> Most popular
                  </Badge>
                )}
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-[#F87171]" />
                  <h3 className="text-2xl font-semibold">{p.name}</h3>
                </div>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-4xl font-bold">₹{p.price_monthly_inr}</span>
                  <span className="text-muted-foreground">/mo</span>
                </div>
                <ul className="mt-4 space-y-2 text-sm flex-1">
                  <li className="flex items-start gap-2"><Check className="h-4 w-4 text-emerald-400 mt-0.5" /> {p.txn_fee_pct}% transaction fee</li>
                  <li className="flex items-start gap-2"><Check className="h-4 w-4 text-emerald-400 mt-0.5" /> {p.ads_enabled ? "Ad-supported" : "Ad-free experience"}</li>
                  {(p.features ?? []).map((f: string, i: number) => (
                    <li key={i} className="flex items-start gap-2"><Check className="h-4 w-4 text-emerald-400 mt-0.5" /> {f}</li>
                  ))}
                </ul>
                <Button asChild className={`mt-6 min-h-[52px] rounded-xl ${recommended ? "bg-[#B91C1C] hover:bg-[#991B1B]" : "bg-white/5 hover:bg-white/10"}`}>
                  <Link to="/checkout/$planId" params={{ planId: p.id }}>
                    Choose {p.name} <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </Card>
            );
          })}
        </div>

        <p className="text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Secured by Razorpay · GST invoice · Cancel anytime
        </p>
      </div>
    </main>
  );
}
