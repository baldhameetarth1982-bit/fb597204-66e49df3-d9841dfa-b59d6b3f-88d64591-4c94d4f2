import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Sparkles, ArrowRight, ShieldCheck, Rocket, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { openRazorpayCheckout } from "@/lib/razorpay";

export const Route = createFileRoute("/_society/society/plan-required")({
  head: () => ({ meta: [{ title: "Unlock SociyoHub — Renew plan" }] }),
  component: PlanRequired,
});

function PlanRequired() {
  const { signOut, profile, user } = useAuth();
  const { societyId } = useSocietyId();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data: society } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-state", societyId],
    refetchInterval: 2000,
    refetchOnWindowFocus: true,
    refetchOnMount: "always",
    staleTime: 0,
    queryFn: async () => {
      const [{ data: row }, { data: access }] = await Promise.all([
        supabase.from("societies").select("id,name,plan_status,trial_ends_at,plan_id").eq("id", societyId!).maybeSingle(),
        supabase.rpc("society_has_access", { _society_id: societyId! }),
      ]);
      return { ...(row ?? {}), has_access: Boolean(access) } as any;
    },
  });

  const { data: plans } = useQuery({
    queryKey: ["plans-required"],
    queryFn: async () =>
      (await supabase.from("plans").select("*").neq("id", "ad_free").neq("id", "trial").neq("id", "resident").order("sort_order")).data ?? [],
  });

  useEffect(() => {
    if (society?.has_access) {
      try { localStorage.removeItem("user_subscription"); } catch {}
      qc.invalidateQueries();
      navigate({ to: "/society/dashboard", replace: true });
    }
  }, [society, navigate, qc]);

  // Refetch instantly when tab/window regains focus or visibility flips.
  useEffect(() => {
    const refetch = () => qc.invalidateQueries({ queryKey: ["society-state", societyId] });
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", refetch);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", refetch);
    };
  }, [qc, societyId]);

  async function handleBuy(plan: any) {
    setBusyId(plan.id);
    const opened = await openRazorpayCheckout({
      plan: { id: plan.id, name: plan.name, price_monthly_inr: plan.price_monthly_inr },
      prefill: {
        email: profile?.email ?? user?.email ?? "",
        contact: profile?.phone ?? "",
        name: profile?.full_name ?? "",
      },
      onSuccess: async () => {
        toast.message("Payment received. Confirming your plan — this can take a minute.");
        try { localStorage.removeItem("user_subscription"); } catch {}
        // Force every dependent query to re-fetch; trigger registered on backend will flip plan_status.
        await qc.invalidateQueries();
        setBusyId(null);
      },
      onDismiss: () => setBusyId(null),
    });
    if (!opened) setBusyId(null);
  }

  return (
    <main className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-5xl space-y-8 px-4 py-10 md:px-6 md:py-14">
        <header className="grid gap-4 border-b border-border pb-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-warning/15 text-warning">
            <Rocket className="h-6 w-6" />
          </div>
          <div className="min-w-0 space-y-1.5">
            <Badge variant="outline" className="rounded-full">Plan renewal needed</Badge>
            <h1 className="text-2xl font-semibold tracking-tight md:text-[28px] md:leading-[34px]">
              Renew {society?.name ?? "your society"}'s plan to continue
            </h1>
            <p className="max-w-2xl text-sm text-muted-foreground">
              Features are paused for committee and residents until a plan is active. All your data is kept. Access returns automatically once payment is confirmed.
            </p>
          </div>
        </header>

        <section aria-label="Choose a plan" className="space-y-3">
          <h2 className="text-sm font-semibold">Choose a plan</h2>
          {!plans ? (
            <div className="grid gap-4 md:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-2xl bg-muted" />)}</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              {plans.map((p: any) => (
                <Card key={p.id} className={`flex flex-col rounded-2xl p-5 ${p.is_recommended ? "border-2 border-primary" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-lg font-semibold">{p.name}</h3>
                    {p.is_recommended && <Badge className="shrink-0"><Sparkles className="mr-1 h-3 w-3" />Best value</Badge>}
                  </div>
                  <p className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-bold tabular-nums">₹{p.price_monthly_inr}</span>
                    <span className="text-sm text-muted-foreground">/month</span>
                  </p>
                  <Button
                    onClick={() => handleBuy(p)}
                    disabled={busyId !== null}
                    variant={p.is_recommended ? "default" : "outline"}
                    className="mt-5 min-h-12 rounded-xl"
                  >
                    {busyId === p.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Renew with {p.name} <ArrowRight className="ml-1 h-4 w-4" />
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </section>

        <footer className="flex flex-col gap-3 border-t border-border pt-5 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 shrink-0" /> Paid securely via Razorpay · checking status automatically</p>
          <Button variant="ghost" onClick={() => signOut()} className="min-h-11 self-start sm:self-auto">Sign out</Button>
        </footer>
      </div>
    </main>
  );
}
