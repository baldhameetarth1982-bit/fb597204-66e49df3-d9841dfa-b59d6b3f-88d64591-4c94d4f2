import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Lock, AlertTriangle, Sparkles, ArrowRight, ShieldCheck, Clock } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_society/society/plan-required")({
  head: () => ({ meta: [{ title: "Renew plan — SocioHub" }] }),
  component: PlanRequired,
});

function PlanRequired() {
  const { signOut } = useAuth();
  const { societyId } = useSocietyId();
  const navigate = useNavigate();

  const { data: society } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-state", societyId],
    queryFn: async () =>
      (await supabase.from("societies").select("id,name,plan_status,trial_ends_at,plan_id").eq("id", societyId!).maybeSingle()).data,
  });

  const { data: plans } = useQuery({
    queryKey: ["plans-required"],
    queryFn: async () => (await supabase.from("plans").select("*").neq("id", "ad_free").neq("id", "trial").order("sort_order")).data ?? [],
  });

  // If access magically came back, leave the page
  useEffect(() => {
    if (!society) return;
    const ok = society.plan_status === "active" ||
      (society.plan_status === "trialing" && society.trial_ends_at && new Date(society.trial_ends_at) > new Date());
    if (ok) navigate({ to: "/society/dashboard" });
  }, [society, navigate]);

  const trialed = society?.plan_status === "trialing";
  const expired = society?.plan_status === "expired" || (trialed && society?.trial_ends_at && new Date(society.trial_ends_at) < new Date());

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0a0a0a] via-[#1a0606] to-[#0a0a0a] text-white">
      <div className="max-w-5xl mx-auto px-5 py-12 space-y-8">
        <div className="text-center space-y-3">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-[#B91C1C]/20 border border-[#B91C1C]/40 grid place-items-center">
            <Lock className="h-8 w-8 text-[#F87171]" />
          </div>
          <Badge className="bg-[#B91C1C]/15 text-[#FCA5A5] border-[#B91C1C]/30 rounded-full">
            <AlertTriangle className="h-3 w-3 mr-1" /> Subscription required
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight">
            {expired ? "Your free trial has ended" : "Choose a plan to continue"}
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            {society?.name ? <><b>{society.name}</b> is locked.</> : "Your society is locked."}{" "}
            Pick a plan to restore access for you and every resident. Your data is safe — nothing has been deleted.
          </p>
        </div>

        <Card className="rounded-3xl bg-[#161616] border border-white/10 p-6">
          <div className="grid sm:grid-cols-3 gap-4 text-sm">
            <Stat icon={<Clock className="h-4 w-4" />} label="Lost since" value={expired ? "Trial ended" : "Now"} />
            <Stat icon={<ShieldCheck className="h-4 w-4" />} label="Data status" value="Safe & backed up" />
            <Stat icon={<Sparkles className="h-4 w-4" />} label="Restore in" value="Under 60 seconds" />
          </div>
        </Card>

        <div className="grid md:grid-cols-3 gap-5">
          {(plans ?? []).map((p: any) => (
            <Card key={p.id}
              className={`rounded-3xl p-6 bg-[#161616] flex flex-col ${
                p.is_recommended ? "border-2 border-[#B91C1C] shadow-[0_0_40px_-10px_#B91C1C]" : "border border-white/10"
              }`}>
              {p.is_recommended && <Badge className="self-start mb-3 bg-[#B91C1C]"><Sparkles className="h-3 w-3 mr-1" /> Best value</Badge>}
              <h3 className="text-xl font-semibold">{p.name}</h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-3xl font-bold">₹{p.price_monthly_inr}</span>
                <span className="text-muted-foreground">/mo</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{p.txn_fee_pct}% txn fee · {p.ads_enabled ? "ads on" : "no ads"}</p>
              <Button asChild className={`mt-auto pt-4 min-h-[52px] rounded-xl ${p.is_recommended ? "bg-[#B91C1C] hover:bg-[#991B1B]" : "bg-white/5 hover:bg-white/10"}`}>
                <Link to="/checkout/$planId" params={{ planId: p.id }}>
                  Renew with {p.name} <ArrowRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            </Card>
          ))}
        </div>

        <div className="text-center text-sm text-muted-foreground space-y-2">
          <p className="flex items-center justify-center gap-2"><ShieldCheck className="h-4 w-4" /> Secured by Razorpay · GST invoice</p>
          <button onClick={() => signOut()} className="underline text-xs">Sign out</button>
        </div>
      </div>
    </main>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-9 w-9 rounded-xl bg-[#B91C1C]/10 grid place-items-center text-[#F87171]">{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
    </div>
  );
}
