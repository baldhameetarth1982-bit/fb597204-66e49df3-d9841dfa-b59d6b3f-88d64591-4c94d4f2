import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bell, ArrowRight, Receipt, ShieldCheck, ShieldAlert, Fingerprint } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { AdBanner } from "@/components/shared/AdBanner";
import { requireBiometric } from "@/lib/biometric";

export const Route = createFileRoute("/_resident/app/dashboard")({
  head: () => ({
    meta: [
      { title: "Home — SocioHub" },
      { name: "description", content: "Your maintenance dues and society updates." },
    ],
  }),
  component: ResidentDashboard,
});

function ResidentDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const firstName = profile?.full_name?.split(" ")[0] ?? "there";

  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-3xl mx-auto space-y-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
          Hi {firstName} 👋
        </h1>
        <p className="mt-1 text-muted-foreground">Here's what needs your attention.</p>
      </header>

      {/* Hero: Amount Due */}
      <Card className="rounded-2xl bg-primary text-primary-foreground border-0 shadow-lg">
        <CardContent className="p-6 md:p-8">
          <p className="text-sm opacity-80">Amount Due</p>
          <p className="mt-1 text-4xl md:text-5xl font-semibold tabular-nums">₹4,500</p>
          <p className="mt-1 text-sm opacity-80">Due by 10 May 2026 · May maintenance</p>
          <Button
            size="lg"
            className="mt-6 w-full md:w-auto h-12 rounded-xl bg-background text-primary hover:bg-background/90 font-semibold"
            onClick={async () => {
              const ok = await requireBiometric("authorize this payment");
              if (ok) navigate({ to: "/app/dues" });
            }}
          >
            <Fingerprint className="h-4 w-4 mr-2" /> Pay now <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </CardContent>
      </Card>

      {/* Quick stats */}
      <section className="grid grid-cols-2 gap-4">
        <Card className="rounded-2xl">
          <CardContent className="p-5">
            <div className="h-10 w-10 rounded-xl bg-success/10 grid place-items-center">
              <Receipt className="h-5 w-5 text-success" />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Paid this year</p>
            <p className="text-xl font-semibold tabular-nums">₹40,500</p>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardContent className="p-5">
            <div className="h-10 w-10 rounded-xl bg-primary/10 grid place-items-center">
              <ShieldCheck className="h-5 w-5 text-primary" />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">Visitors today</p>
            <p className="text-xl font-semibold tabular-nums">2</p>
          </CardContent>
        </Card>
      </section>

      <Button
        asChild
        variant="outline"
        className="w-full h-12 rounded-xl border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
      >
        <Link to="/app/emergency">
          <ShieldAlert className="h-4 w-4 mr-2" /> Emergency contacts (works offline)
        </Link>
      </Button>

      {/* Notices */}
      <Card className="rounded-2xl">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="h-4 w-4 text-primary" />
            <h2 className="font-semibold">Recent notices</h2>
          </div>
          <ul className="divide-y divide-border">
            <li className="py-3 first:pt-0">
              <p className="font-medium">Lift maintenance — Block B</p>
              <p className="text-xs text-muted-foreground mt-0.5">06 May 2026 · Maintenance</p>
            </li>
            <li className="py-3 last:pb-0">
              <p className="font-medium">Society AGM rescheduled</p>
              <p className="text-xs text-muted-foreground mt-0.5">04 May 2026 · Notices</p>
            </li>
          </ul>
          <Button variant="ghost" size="sm" asChild className="mt-2 rounded-lg">
            <Link to="/app/notices">View all <ArrowRight className="h-4 w-4 ml-1" /></Link>
          </Button>
        </CardContent>
      </Card>

      <AdBanner />
    </div>
  );
}
