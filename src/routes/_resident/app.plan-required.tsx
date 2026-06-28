import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Sparkles, ShieldCheck, Rocket, ArrowRight } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_resident/app/plan-required")({
  head: () => ({ meta: [{ title: "Unlock SocioHub — Subscription" }] }),
  component: PlanRequiredResident,
});

function PlanRequiredResident() {
  const { signOut } = useAuth();
  const { societyId } = useSocietyId();
  const navigate = useNavigate();

  // Poll so a Super Admin or Society Admin upgrade reflects within seconds — no manual refresh required.
  const { data: society } = useQuery({
    enabled: !!societyId,
    queryKey: ["resident-society-access", societyId],
    refetchInterval: 12000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [{ data: row }, { data: access }] = await Promise.all([
        supabase.from("societies").select("id,name").eq("id", societyId!).maybeSingle(),
        supabase.rpc("society_has_access", { _society_id: societyId! }),
      ]);
      return { ...(row ?? {}), has_access: Boolean(access) } as any;
    },
  });

  // Resident-only ad-free / premium personal plan (₹50). Falls back gracefully if not seeded.
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
    if (society?.has_access) navigate({ to: "/app/dashboard", replace: true });
  }, [society, navigate]);

  return (
    <main className="min-h-screen bg-background text-foreground px-5 py-12">
      <div className="max-w-md mx-auto space-y-6 text-center">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/15 border border-primary/30 grid place-items-center">
          <Rocket className="h-8 w-8 text-primary" />
        </div>
        <Badge className="bg-primary/15 text-primary border-primary/30 rounded-full">
          <Sparkles className="h-3 w-3 mr-1" /> Renew to keep your perks
        </Badge>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-50">Unlock SocioHub's Full Power</h1>
        <p className="text-slate-600 dark:text-slate-300">
          Your society's plan is paused. Ask your <b>Society Admin</b> to renew so everyone stays connected — or unlock
          the ad-free personal experience just for you.
        </p>

        {residentPlan && (
          <Card className="rounded-2xl bg-card border p-5 text-left space-y-3">
            <p className="text-xs uppercase tracking-wider text-primary font-semibold">Resident plan</p>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-slate-900 dark:text-slate-50">₹{residentPlan.price_monthly_inr}</span>
              <span className="text-sm text-slate-500 dark:text-slate-400">/month</span>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Ad-free experience, priority notifications, and full visitor pre-approval.
            </p>
            <Button asChild className="w-full min-h-[52px] rounded-xl">
              <Link to="/checkout/$planId" params={{ planId: residentPlan.id }}>
                Upgrade for me <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </Card>
        )}

        <Card className="rounded-2xl bg-card border p-5 text-left space-y-2">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-50">Message your admin</p>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            "Our SocioHub plan has ended. Please pick a plan from the dashboard so we can use visitors, dues, polls and notices again."
          </p>
        </Card>

        <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center justify-center gap-2">
          <ShieldCheck className="h-4 w-4" /> Your data is safe and untouched.
        </p>
        <Button variant="ghost" onClick={() => signOut()} className="text-xs">Sign out</Button>
      </div>
    </main>
  );
}
