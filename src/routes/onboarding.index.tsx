import { Link, Navigate, createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Building2, ArrowRight, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/context/AuthContext";
import { ROLE_HOME } from "@/config/roles";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/onboarding/")({
  head: () => ({ meta: [{ title: "Get started — SociyoHub" }] }),
  validateSearch: (s: Record<string, unknown>) => ({ ref: typeof s.ref === "string" ? s.ref : undefined }),
  component: OnboardingChoice,
});

function OnboardingChoice() {
  const { isLoading, profile, primaryRole } = useAuth();
  const { ref } = useSearch({ from: "/onboarding/" });
  const [pendingChecked, setPendingChecked] = useState(false);
  const [hasPending, setHasPending] = useState(false);

  useEffect(() => { if (ref) localStorage.setItem("sociohub:ref", ref); }, [ref]);

  useEffect(() => {
    if (!profile?.id || profile.society_id) { setPendingChecked(true); return; }
    (async () => {
      const { data } = await supabase
        .from("join_requests" as any)
        .select("id")
        .eq("user_id", profile.id)
        .eq("status", "pending")
        .maybeSingle();
      setHasPending(!!data);
      setPendingChecked(true);
    })();
  }, [profile?.id, profile?.society_id]);

  if (isLoading || !pendingChecked) {
    return (
      <div className="min-h-[60vh] grid place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (profile?.society_id && primaryRole) {
    return <Navigate to={ROLE_HOME[primaryRole]} replace />;
  }
  if (hasPending) return <Navigate to="/onboarding/pending" replace />;
  const firstName = profile?.full_name?.split(" ")[0] ?? "there";

  return (
    <div className="px-5 py-8 space-y-6">
      <header className="space-y-1">
        <p className="text-sm text-muted-foreground">Welcome, {firstName} 👋</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          How would you like to get started?
        </h1>
        <p className="text-sm text-muted-foreground">
          Choose one to continue. You can always switch later.
        </p>
      </header>

      <div className="space-y-4">
        <Link to="/onboarding/create" className="block group">
          <Card className="rounded-3xl border-0 shadow-md bg-gradient-to-br from-primary to-primary/85 text-primary-foreground transition-transform group-active:scale-[0.98]">
            <CardContent className="p-6 flex items-start gap-4">
              <div className="h-14 w-14 rounded-2xl bg-primary-foreground/15 grid place-items-center text-3xl">
                🏢
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  Create Society
                </h2>
                <p className="mt-1 text-sm opacity-90">
                  Set up your building, add blocks & flats, and invite residents.
                </p>
                <span className="mt-3 inline-flex items-center text-sm font-medium opacity-95">
                  Get started <ArrowRight className="h-4 w-4 ml-1" />
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link to="/onboarding/join" className="block group">
          <Card className="rounded-3xl border border-border shadow-sm bg-background transition-transform group-active:scale-[0.98]">
            <CardContent className="p-6 flex items-start gap-4">
              <div className="h-14 w-14 rounded-2xl bg-primary/10 grid place-items-center text-3xl">
                🏘️
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-semibold text-foreground">
                  Join Society
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Enter an invite code from your society admin to join your flat.
                </p>
                <span className="mt-3 inline-flex items-center text-sm font-medium text-primary">
                  Enter code <ArrowRight className="h-4 w-4 ml-1" />
                </span>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <Building2 className="h-4 w-4 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          Trusted by modern societies — premium experience, mobile-first.
        </p>
      </div>
    </div>
  );
}
