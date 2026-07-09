import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Building2, Home, Car, Users, UserCheck, ShieldCheck, MessageSquare,
  Receipt, Wallet, BarChart3, TrendingDown, BookOpen,
  Settings2, UsersRound, Activity, LifeBuoy, Sparkles, KeyRound, Building, Lock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { FEATURE_MIN_PLAN, PLAN_LABELS, type FeatureKey } from "@/lib/plan-features";

export const Route = createFileRoute("/_society/society/more")({
  head: () => ({ meta: [{ title: "More — SocioHub" }] }),
  component: MoreDirectory,
});

type Tile = { to: string; label: string; icon: any; feature?: FeatureKey };

const MANAGEMENT: Tile[] = [
  { to: "/society/residents", label: "Residents", icon: Users },
  { to: "/society/flats", label: "Houses", icon: Home },
  { to: "/society/blocks", label: "Blocks", icon: Building },
  { to: "/society/approvals", label: "Approvals", icon: UserCheck },
  { to: "/society/verifications", label: "Verifications", icon: ShieldCheck },
  { to: "/society/visitors", label: "Visitors", icon: UsersRound, feature: "visitors" },
  { to: "/society/vehicles", label: "Vehicles", icon: Car, feature: "vehicles" },
  { to: "/society/maintenance", label: "Maintenance", icon: BookOpen },
  { to: "/society/communication", label: "Communication", icon: MessageSquare },
  { to: "/society/polls", label: "Polls", icon: Sparkles, feature: "polls" },
];

const FINANCE: Tile[] = [
  { to: "/society/billing", label: "Billing", icon: Receipt },
  { to: "/society/accounts", label: "Accounts", icon: Wallet, feature: "ledger" },
  { to: "/society/expenses", label: "Expenses", icon: TrendingDown, feature: "expenses" },
  { to: "/society/reports", label: "Reports", icon: BarChart3, feature: "advanced_reports" },
  { to: "/society/digest", label: "AI Digest", icon: Sparkles, feature: "ai_digest" },
];

const OTHER: Tile[] = [
  { to: "/society/business-profile", label: "Society profile", icon: Building2 },
  { to: "/society/team", label: "Team & roles", icon: Users, feature: "team_roles" },
  { to: "/society/import", label: "Resident import", icon: Users, feature: "resident_import" },
  { to: "/society/bill-studio", label: "Bill templates", icon: Receipt, feature: "bill_templates" },
  { to: "/society/custom-fields", label: "Custom fields", icon: Settings2 },
  { to: "/society/setup", label: "Setup wizard", icon: Activity },
  { to: "/society/leaderboard", label: "Leaderboard", icon: Sparkles },
  { to: "/society/explorer", label: "Explorer", icon: KeyRound },
  { to: "/support", label: "Help & support", icon: LifeBuoy },
];

function TileGrid({ tiles }: { tiles: Tile[] }) {
  const { hasFeature } = useFeatureAccess();
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-3">
      {tiles.map((t) => {
        const locked = t.feature ? !hasFeature(t.feature) : false;
        const required = t.feature ? FEATURE_MIN_PLAN[t.feature] : null;
        return (
          <Link
            key={t.to}
            to={locked ? "/society/plan-required" : (t.to as any)}
            className="group relative rounded-2xl border bg-card hover:bg-primary/5 hover:border-primary/40 transition p-3 flex flex-col items-center justify-center gap-1.5 text-center min-h-[92px]"
          >
            <div className={`h-9 w-9 rounded-xl grid place-items-center ${locked ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
              <t.icon className="h-4 w-4" />
            </div>
            <span className="text-[11px] sm:text-xs font-medium leading-tight">{t.label}</span>
            {locked && required && (
              <Badge variant="secondary" className="absolute top-1.5 right-1.5 rounded-full px-1.5 h-4 text-[9px] gap-0.5">
                <Lock className="h-2.5 w-2.5" />
                {PLAN_LABELS[required]}
              </Badge>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function Section({ title, tiles }: { title: string; tiles: Tile[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <Card className="rounded-2xl">
        <CardContent className="p-3 sm:p-4">
          <TileGrid tiles={tiles} />
        </CardContent>
      </Card>
    </section>
  );
}

function MoreDirectory() {
  return (
    <PageShell>
      <PageHeader
        title="More"
        description="All society management modules organised by area. Locked modules show the plan required to unlock."
      />
      <div className="space-y-6">
        <Section title="Management" tiles={MANAGEMENT} />
        <Section title="Finance" tiles={FINANCE} />
        <Section title="Other" tiles={OTHER} />
      </div>
    </PageShell>
  );
}
