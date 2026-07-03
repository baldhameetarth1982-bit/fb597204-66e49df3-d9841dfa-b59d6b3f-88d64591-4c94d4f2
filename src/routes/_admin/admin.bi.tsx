import { createFileRoute, Link } from "@tanstack/react-router";
import { BarChart3, TrendingUp, Users, Building2, Wallet, Receipt, UserCheck, MessageSquare, Activity, Heart, FileText, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_admin/admin/bi")({
  head: () => ({ meta: [{ title: "Business Intelligence — Super Admin" }] }),
  component: BIHub,
});

const SECTIONS = [
  { to: "/admin/executive", icon: TrendingUp, title: "Executive Dashboard", desc: "Collection, revenue, growth, health at a glance." },
  { to: "/admin/revenue", icon: Wallet, title: "Financial Analytics", desc: "MRR, ARR, subscription and payment income." },
  { to: "/admin/health", icon: Heart, title: "Society Health Score", desc: "Ranked score per society with drill-down." },
  { to: "/admin/report-builder", icon: FileText, title: "Custom Report Builder", desc: "Compose your own reports and export CSV." },
  { to: "/admin/societies", icon: Building2, title: "Subscription Analytics", desc: "Active plans, trials, expiries." },
  { to: "/admin/users", icon: Users, title: "Resident Analytics", desc: "User counts, roles, sign-ups." },
  { to: "/admin/audit", icon: Activity, title: "Platform Activity", desc: "Every platform action, searchable." },
  { to: "/admin/income", icon: Receipt, title: "Payment Ledger", desc: "Full transaction history." },
] as const;

function BIHub() {
  return (
    <div className="px-6 py-8 space-y-6 max-w-6xl">
      <header className="flex items-center gap-3">
        <BarChart3 className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Business Intelligence Center</h1>
          <p className="text-sm text-muted-foreground">Every analytics surface in one place.</p>
        </div>
      </header>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {SECTIONS.map((s) => (
          <Card key={s.to} className="rounded-2xl hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary grid place-items-center mb-3">
                <s.icon className="h-5 w-5" />
              </div>
              <h2 className="text-lg font-semibold">{s.title}</h2>
              <p className="text-sm text-muted-foreground mt-1">{s.desc}</p>
              <Button asChild className="mt-4 rounded-xl">
                <Link to={s.to}>Open <ArrowRight className="h-4 w-4 ml-1" /></Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
