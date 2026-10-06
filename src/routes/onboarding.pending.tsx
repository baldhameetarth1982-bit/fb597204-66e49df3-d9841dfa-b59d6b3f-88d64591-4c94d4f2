import { createFileRoute, Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Clock, CheckCircle2, XCircle, Building2, LogOut } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/onboarding/pending")({
  head: () => ({ meta: [{ title: "Awaiting approval — SociyoHub" }] }),
  component: PendingApproval,
});

type Req = {
  id: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  flat_id: string;
  society_id: string;
  relationship: string;
};

function PendingApproval() {
  const { isLoading, isAuthenticated, profile, signOut, refresh } = useAuth();
  const navigate = useNavigate();

  const { data: req, isLoading: loading, refetch } = useQuery({
    enabled: !!profile?.id && !profile?.society_id,
    queryKey: ["my-join-request", profile?.id],
    refetchInterval: 8000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("join_requests" as any)
        .select("*")
        .eq("user_id", profile!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as Req | null;
    },
  });

  // Once approved, auto-route into the app
  useEffect(() => {
    if (req?.status === "approved") {
      (async () => {
        await refresh();
        navigate({ to: "/app/dashboard", replace: true });
      })();
    }
  }, [req?.status, navigate, refresh]);

  if (isLoading) return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (profile?.society_id) return <Navigate to="/app/dashboard" replace />;

  if (loading) return <div className="min-h-[60vh] grid place-items-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  if (!req) {
    return (
      <div className="px-5 py-10 text-center space-y-5">
        <p className="text-sm text-muted-foreground">{tu("op.you_don_t_have_a")}</p>
        <Button asChild className="h-12 rounded-2xl px-6"><Link to="/onboarding" search={{} as any}>{tu("op.get_started")}</Link></Button>
      </div>
    );
  }

  if (req.status === "rejected") {
    return (
      <div className="px-5 py-8 space-y-6">
        <div className="text-center space-y-3">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-destructive/10">
            <XCircle className="h-8 w-8 text-destructive" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{tu("op.request_not_approved")}</h1>
          {req.reason && <p className="text-sm text-muted-foreground">{tu("op.reason")} {req.reason}</p>}
        </div>
        <Button asChild className="w-full h-12 rounded-2xl"><Link to="/onboarding/join">{tu("op.try_a_different_flat")}</Link></Button>
        <Button variant="ghost" onClick={signOut} className="w-full h-11 rounded-2xl">
          <LogOut className="h-4 w-4 mr-2" /> {tu("common.signOut")}
        </Button>
      </div>
    );
  }

  return (
    <div className="px-5 py-8 space-y-6">
      <div className="text-center space-y-3">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/10">
          <Clock className="h-8 w-8 text-primary animate-pulse" />
        </div>
        <Badge className="bg-amber-100 text-amber-900 border-0">{tu("op.pending_approval")}</Badge>
        <h1 className="text-2xl font-semibold tracking-tight">{tu("op.almost_there")}</h1>
        <p className="text-sm text-muted-foreground">
          {tu("op.your_society_admin_is_reviewing")}
        </p>
      </div>

      <Card className="rounded-2xl">
        <CardContent className="p-5 flex items-start gap-3">
          <Building2 className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div className="text-sm">
            <p className="font-medium">{tu("op.requested_as")} <span className="capitalize">{req.relationship}</span></p>
            <p className="text-xs text-muted-foreground">{tu("nd.st.submitted")} {new Date(req.created_at).toLocaleString()}</p>
          </div>
        </CardContent>
      </Card>

      <Button variant="outline" onClick={() => refetch()} className="w-full h-11 rounded-2xl">{tu("op.refresh_status")}</Button>
      <Button variant="ghost" onClick={signOut} className="w-full h-11 rounded-2xl">
        <LogOut className="h-4 w-4 mr-2" /> {tu("common.signOut")}
      </Button>
    </div>
  );
}
