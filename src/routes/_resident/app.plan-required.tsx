import { createFileRoute } from "@tanstack/react-router";
import { Lock, AlertTriangle, Mail, ShieldCheck } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_resident/app/plan-required")({
  head: () => ({ meta: [{ title: "Subscription ended — SocioHub" }] }),
  component: PlanRequiredResident,
});

function PlanRequiredResident() {
  const { signOut } = useAuth();
  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0a0a0a] via-[#1a0606] to-[#0a0a0a] text-white px-5 py-12">
      <div className="max-w-md mx-auto space-y-6 text-center">
        <div className="mx-auto h-16 w-16 rounded-2xl bg-[#B91C1C]/20 border border-[#B91C1C]/40 grid place-items-center">
          <Lock className="h-8 w-8 text-[#F87171]" />
        </div>
        <Badge className="bg-[#B91C1C]/15 text-[#FCA5A5] border-[#B91C1C]/30 rounded-full">
          <AlertTriangle className="h-3 w-3 mr-1" /> Society subscription ended
        </Badge>
        <h1 className="text-3xl font-bold">Access paused</h1>
        <p className="text-muted-foreground">
          Your society's plan is no longer active. Please ask your <b>Society Admin</b> to renew so everyone can get back in.
        </p>

        <Card className="rounded-2xl bg-[#161616] border border-white/10 p-5 text-left space-y-3">
          <p className="text-sm font-medium flex items-center gap-2"><Mail className="h-4 w-4 text-[#F87171]" /> What to tell your admin</p>
          <p className="text-xs text-muted-foreground">
            "Our SocioHub plan has ended. Please sign in and choose a plan from the dashboard so we can use visitors, dues, polls and notices again."
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
