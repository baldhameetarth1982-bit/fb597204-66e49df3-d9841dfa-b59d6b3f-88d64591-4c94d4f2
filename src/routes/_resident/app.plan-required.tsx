import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Sparkles, ShieldCheck, Rocket, ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { openRazorpayCheckout } from "@/lib/razorpay";

export const Route = createFileRoute("/_resident/app/plan-required")({
  head: () => ({ meta: [{ title: "Unlock SocioHub — Subscription" }] }),
  component: PlanRequiredResident,
});

function PlanRequiredResident() {
  const { signOut, profile, user } = useAuth();
  const { societyId } = useSocietyId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

  const { data: society } = useQuery({
    enabled: !!societyId,
    queryKey: ["resident-society-access", societyId],
    refetchInterval: 2000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: async () => {
      const [{ data: row }, { data: access }] = await Promise.all([
        supabase.from("societies").select("id,name").eq("id", societyId!).maybeSingle(),
        supabase.rpc("society_has_access", { _society_id: societyId! }),
      ]);
      return { ...(row ?? {}), has_access: Boolean(access) } as any;
    },
  });

  const { data: residentPlan } = useQuery({
    queryKey: ["resident-plan-card"],
    queryFn: async () => {
      const { data } = await supabase
        .from("plans")
        .select("id,name,price_monthly_inr,features")
        .in("id", ["resident", "ad_free"])
        .order("price_monthly_inr", { ascending: true });
      return data?.[0] ?? null;
    },
  });

  useEffect(() => {
    if (society?.has_access) {
      try { localStorage.removeItem("user_subscription"); } catch {}
      qc.invalidateQueries();
      navigate({ to: "/app/dashboard", replace: true });
    }
  }, [society, navigate, qc]);

  useEffect(() => {
    const refetch = () => qc.invalidateQueries({ queryKey: ["resident-society-access", societyId] });
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", refetch);
    };
  }, [qc, societyId]);

  async function handleBuy() {
    if (!residentPlan) return;
    setBusy(true);
    const opened = await openRazorpayCheckout({
      plan: { id: residentPlan.id, name: residentPlan.name, price_monthly_inr: residentPlan.price_monthly_inr },
      prefill: {
        email: profile?.email ?? user?.email ?? "",
        contact: profile?.phone ?? "",
        name: profile?.full_name ?? "",
      },
      onSuccess: async (resp) => {
        toast.success(`Payment captured: ${resp.razorpay_payment_id}`);
        try { localStorage.removeItem("user_subscription"); } catch {}
        await qc.invalidateQueries();
        setBusy(false);
      },
      onDismiss: () => setBusy(false),
    });
    if (!opened) setBusy(false);
  }

  return (
    <main className="min-h-dvh bg-background text-foreground px-5 py-12">
      <div className="max-w-md mx-auto space-y-6 text-center">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/15 border border-primary/30 grid place-items-center">
          <Rocket className="h-8 w-8 text-primary" />
        </div>
        <Badge className="bg-primary/15 text-primary border-primary/30 rounded-full">
          <Sparkles className="h-3 w-3 mr-1" /> Renew to keep your perks
        </Badge>
        <h1 className="text-3xl font-bold text-foreground">Unlock SocioHub's Full Power</h1>
        <p className="text-muted-foreground">
          Your society's plan is paused. Ask your <b>Society Admin</b> to renew so everyone stays connected — or unlock
          the ad-free personal experience just for you.
        </p>

        {residentPlan && (
          <Card className="rounded-2xl bg-card border p-5 text-left space-y-3">
            <p className="text-xs uppercase tracking-wider text-primary font-semibold">Resident plan</p>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-foreground">₹{residentPlan.price_monthly_inr}</span>
              <span className="text-sm text-muted-foreground">/month</span>
            </div>
            <p className="text-sm text-muted-foreground">
              Ad-free experience, priority notifications, and full visitor pre-approval.
            </p>
            <Button onClick={handleBuy} disabled={busy} className="w-full min-h-[52px] rounded-xl">
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Upgrade for me <ArrowRight className="h-4 w-4 ml-1" />
            </Button>
          </Card>
        )}

        <Card className="rounded-2xl bg-card border p-5 text-left space-y-2">
          <p className="text-sm font-medium text-foreground">Message your admin</p>
          <p className="text-xs text-muted-foreground">
            "Our SocioHub plan has ended. Please pick a plan from the dashboard so we can use visitors, dues, polls and notices again."
          </p>
        </Card>

        <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Your data is safe and untouched.
        </p>
        <Button variant="ghost" onClick={() => signOut()} className="text-xs">Sign out</Button>
      </div>
    </main>
  );
}
