import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ShieldCheck, Rocket } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_resident/app/plan-required")({
  head: () => ({ meta: [{ title: "Unlock SociyoHub — Subscription" }] }),
  component: PlanRequiredResident,
});

function PlanRequiredResident() {
  const { signOut } = useAuth();
  const { societyId } = useSocietyId();
  const navigate = useNavigate();
  const qc = useQueryClient();

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

        <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="h-4 w-4" /> Your data is safe.</p>
          <Button variant="ghost" onClick={() => signOut()} className="min-h-11 text-sm">Sign out</Button>
        </div>
      </div>
    </main>
  );
}
