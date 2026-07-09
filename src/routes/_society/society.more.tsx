import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Building2, Home, Car, Users, UserCheck, ShieldCheck, MessageSquare,
  Receipt, Wallet, BarChart3, TrendingDown, BookOpen,
  Settings2, UsersRound, Activity, LifeBuoy, Sparkles, KeyRound, Building, Lock,
  LayoutGrid,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
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
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
      {tiles.map((t) => {
        const locked = t.feature ? !hasFeature(t.feature) : false;
        const required = t.feature ? FEATURE_MIN_PLAN[t.feature] : null;
        return (
          <Link
            key={t.to}
            to={locked ? "/society/plan-required" : (t.to as any)}
            className="group relative rounded-2xl border bg-card hover:bg-primary/5 hover:border-primary/40 active:scale-[0.98] transition p-3 flex flex-col items-center justify-center gap-1.5 text-center min-h-[96px]"
          >
            <div className={`h-10 w-10 rounded-2xl grid place-items-center ${locked ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
              <t.icon className="h-4.5 w-4.5" />
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

function MoreDirectory() {
  return (
    <div className="pb-24">
      <MobileHero
        eyebrow="Operations directory"
        title="More"
        subtitle="Every society module in one place. Locked modules show the plan needed to unlock."
        icon={LayoutGrid}
        variant="teal"
      />
      <div className="px-4 -mt-6 space-y-4">
        <SectionCard title="Management" description={`${MANAGEMENT.length} modules`}>
          <TileGrid tiles={MANAGEMENT} />
        </SectionCard>
        <SectionCard title="Finance" description={`${FINANCE.length} modules`}>
          <TileGrid tiles={FINANCE} />
        </SectionCard>
        <SectionCard title="Other" description={`${OTHER.length} modules`}>
          <TileGrid tiles={OTHER} />
        </SectionCard>
      </div>
    </div>
  );
}
