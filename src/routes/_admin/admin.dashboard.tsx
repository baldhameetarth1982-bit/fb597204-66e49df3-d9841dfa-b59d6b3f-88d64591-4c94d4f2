import { createFileRoute, Link } from "@tanstack/react-router";
import { LayoutDashboard, Banknote, CreditCard, Tags, ArrowRight, BarChart3, Megaphone, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_admin/admin/dashboard")({
  head: () => ({ meta: [{ title: "Super Admin — SocioHub" }] }),
  component: AdminDashboard,
});

const TILES = [
  { to: "/admin/users", icon: Users, title: "Users & Societies", desc: "View every user. Grant or upgrade any society's plan for free." },
  { to: "/admin/income", icon: BarChart3, title: "Income & Analytics", desc: "Platform revenue, subscriptions and transaction fees." },
  { to: "/admin/plans", icon: Tags, title: "Plans & Pricing", desc: "Manage the trial, Basic, Pro and Premium tiers." },
  { to: "/admin/razorpay", icon: CreditCard, title: "Razorpay", desc: "Connect keys to enable plan checkout and payouts." },
  { to: "/admin/ads", icon: Megaphone, title: "Ads", desc: "Banner placements and full-screen ad timing (10–30s)." },
  { to: "/admin/withdrawals", icon: Banknote, title: "Withdrawals", desc: "Approve partner referral payouts." },
  { to: "/pricing", icon: CreditCard, title: "Public pricing page", desc: "Preview what visitors see." },
] as const;

function AdminDashboard() {
  return (
    <div className="px-6 py-8 space-y-6 max-w-5xl">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight flex items-center gap-2">
          <LayoutDashboard className="h-7 w-7 text-primary" /> Super Admin
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Platform-wide tools — analytics, plans, payments and ads only.</p>
      </header>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TILES.map((t) => (
          <Card key={t.to} className="rounded-2xl group hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary grid place-items-center mb-3">
                <t.icon className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold">{t.title}</h2>
              <p className="text-sm text-muted-foreground mt-1">{t.desc}</p>
              <Button asChild className="mt-4 rounded-xl">
                <Link to={t.to}>Open <ArrowRight className="h-4 w-4 ml-1" /></Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
