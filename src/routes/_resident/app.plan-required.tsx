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
  head: () => ({ meta: [{ title: "Unlock SociyoHub — Subscription" }] }),
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
      onSuccess: async () => {
        toast.message("Payment received. Confirming your plan — this can take a minute.");
        try { localStorage.removeItem("user_subscription"); } catch {}
        await qc.invalidateQueries();
        setBusy(false);
      },
      onDismiss: () => setBusy(false),
    });
    if (!opened) setBusy(false);
  }

  const adminMsg = "Our SociyoHub plan has ended. Please renew it from the committee dashboard so we can use visitors, dues, polls and notices again.";
  async function copyMsg() {
    try { await navigator.clipboard.writeText(adminMsg); toast.success("Message copied"); } catch { toast.error("Couldn't copy"); }
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-md space-y-6">
        <header className="space-y-3">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-warning/15 text-warning">
            <Rocket className="h-6 w-6" />
          </div>
          <Badge variant="outline" className="rounded-full">Society plan paused</Badge>
          <h1 className="text-2xl font-semibold tracking-tight">Your society's plan needs renewing</h1>
          <p className="text-sm text-muted-foreground">
            Only your committee can renew it. Until then, most features are paused for everyone. Nothing has been deleted.
          </p>
        </header>

        <Card className="space-y-3 rounded-2xl p-4">
          <p className="text-sm font-semibold">1. Ask your committee to renew</p>
          <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">"{adminMsg}"</p>
          <Button onClick={copyMsg} variant="outline" className="min-h-11 w-full">Copy message</Button>
        </Card>

        {residentPlan && (
          <Card className="space-y-3 rounded-2xl p-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-sm font-semibold">Optional: personal resident plan</p>
              <p className="shrink-0 text-sm"><span className="text-lg font-semibold tabular-nums">₹{residentPlan.price_monthly_inr}</span><span className="text-muted-foreground">/mo</span></p>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Ad-free experience, priority notifications and visitor pre-approval — just for you.
            </p>
            <Button onClick={handleBuy} disabled={busy} className="min-h-11 w-full">
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Upgrade for me <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Card>
        )}

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Your data is safe.</p>
          <Button variant="ghost" onClick={() => signOut()} className="min-h-11 text-sm">Sign out</Button>
        </div>
      </div>
    </main>
  );
}
