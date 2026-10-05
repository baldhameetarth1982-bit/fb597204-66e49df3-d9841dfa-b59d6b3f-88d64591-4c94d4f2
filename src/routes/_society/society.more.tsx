import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Building2, Home, Car, Users, UserCheck, ShieldCheck, MessageSquare,
  Receipt, Wallet, BarChart3, TrendingDown, BookOpen,
  Settings2, UsersRound, Activity, LifeBuoy, Sparkles, KeyRound, Building, Lock,
  LayoutGrid, Compass, FileCheck2, Trophy, Palette, CalendarDays, Gavel,
  Wrench, Siren, Store,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { FEATURE_MIN_PLAN, PLAN_LABELS, type FeatureKey } from "@/lib/plan-features";

export const Route = createFileRoute("/_society/society/more")({
  head: () => ({ meta: [{ title: "More — SociyoHub" }] }),
  component: MoreDirectory,
});

type Tile = { to: string; label: string; icon: any; feature?: FeatureKey };

const DISCOVER: Tile[] = [
  { to: "/society/features", label: "mod.featureDirectory", icon: Compass },
];

const MANAGEMENT: Tile[] = [
  { to: "/society/residents", label: "nav.residents", icon: Users },
  { to: "/society/flats", label: "sd.s.houses", icon: Home },
  { to: "/society/blocks", label: "nav.blocks", icon: Building },
  { to: "/society/helpdesk", label: "sd.s.helpdesk", icon: LifeBuoy },
  { to: "/society/operations", label: "nav.operations", icon: Wrench },
  { to: "/society/approvals", label: "sd.s.approvals", icon: UserCheck },
  { to: "/society/verifications", label: "nav.verifications", icon: ShieldCheck },
  { to: "/society/visitors", label: "nav.visitors", icon: UsersRound, feature: "visitors" },
  { to: "/society/vehicles", label: "nav.vehicles", icon: Car, feature: "vehicles" },
  { to: "/society/parking", label: "notif.tab.parking", icon: Car, feature: "vehicles" },
  { to: "/society/amenities", label: "mod.amenities", icon: CalendarDays, feature: "amenities" },
  { to: "/society/maintenance", label: "mnt.title", icon: BookOpen },
  { to: "/society/communication", label: "mod.communication", icon: MessageSquare },
  { to: "/society/emergency", label: "mod.emergency", icon: Siren },
  { to: "/society/community", label: "mod.marketplace", icon: Store },
  { to: "/society/polls", label: "nav.polls", icon: Sparkles, feature: "polls" },
  { to: "/society/surveys", label: "mod.surveys", icon: Sparkles, feature: "polls" },
  { to: "/society/votes", label: "mod.formalVotes", icon: Gavel, feature: "polls" },
  { to: "/society/meetings", label: "mod.meetings", icon: CalendarDays },
  { to: "/society/agm", label: "mod.agm", icon: CalendarDays },
  { to: "/society/elections", label: "mod.elections", icon: Gavel },
  { to: "/society/data-export", label: "mod.dataExport", icon: FileCheck2 },
  { to: "/society/handover", label: "mod.handover", icon: FileCheck2 },
];

const FINANCE: Tile[] = [
  { to: "/society/billing", label: "nav.billing", icon: Receipt },
  { to: "/society/accounts", label: "mod.accounts", icon: Wallet, feature: "ledger" },
  { to: "/society/expenses", label: "accountsTabs.expenses", icon: TrendingDown, feature: "expenses" },
  { to: "/society/reports", label: "nav.reports", icon: BarChart3, feature: "advanced_reports" },
  { to: "/society/auditor-pack", label: "accountsTabs.auditorPack", icon: FileCheck2, feature: "advanced_reports" },
  { to: "/society/income", label: "mod.otherIncome", icon: Wallet, feature: "non_member_payments" },
  { to: "/society/qr", label: "mod.qr", icon: Wallet, feature: "smart_qr_collections" },
  { to: "/society/reconciliation", label: "inc.reconciliation", icon: Wallet, feature: "reconciliation" },
  { to: "/society/digest", label: "nav.aiDigest", icon: Sparkles, feature: "ai_digest" },
];

const COMMUNITY: Tile[] = [
  { to: "/society/leaderboard", label: "nav.leaderboard", icon: Trophy, feature: "leaderboard" },
];

const CERTIFICATES: Tile[] = [
  { to: "/society/no-dues", label: "mod.noDues", icon: FileCheck2, feature: "no_dues" },
];

const OTHER: Tile[] = [
  { to: "/society/business-profile", label: "setup.profile.label", icon: Building2 },
  { to: "/society/subscription", label: "st.sub", icon: Wallet },
  { to: "/society/team", label: "st.team", icon: Users, feature: "team_roles" },
  { to: "/society/privacy-settings", label: "st.tab.privacy", icon: ShieldCheck, feature: "privacy_controls" },
  { to: "/society/privacy-requests", label: "mod.privacyRequests", icon: ShieldCheck },
  { to: "/society/branding", label: "nav.branding", icon: Palette, feature: "custom_branding" },
  { to: "/society/import", label: "mod.residentImport", icon: Users, feature: "resident_import" },
  { to: "/society/bill-studio", label: "mod.billTemplates", icon: Receipt, feature: "bill_templates" },
  { to: "/society/automations", label: "nav.automations", icon: Activity, feature: "advanced_automation" },
  { to: "/society/knowledge", label: "mod.aiSecretary", icon: Sparkles, feature: "ai_secretary" },
  { to: "/society/custom-fields", label: "mod.customFields", icon: Settings2 },
  { to: "/society/setup", label: "mod.setupWizard", icon: Activity },
  { to: "/society/explorer", label: "mod.explorer", icon: KeyRound },
  { to: "/support", label: "settings.help", icon: LifeBuoy },
];

function TileGrid({ tiles }: { tiles: Tile[] }) {
  const { hasFeature } = useFeatureAccess();
  const { t: tr } = useTranslation();
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
      {tiles.map((t) => {
        const locked = t.feature ? !hasFeature(t.feature) : false;
        const required = t.feature ? FEATURE_MIN_PLAN[t.feature] : null;
        return (
          <Link
            key={t.to}
            to={locked ? "/society/subscription" : (t.to as any)}
            className="group relative rounded-2xl border bg-card hover:bg-primary/5 hover:border-primary/40 active:scale-[0.98] transition p-3 flex flex-col items-center justify-center gap-1.5 text-center min-h-[96px]"
          >
            <div className={`h-10 w-10 rounded-2xl grid place-items-center ${locked ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>
              <t.icon className="h-4.5 w-4.5" />
            </div>
            <span className="text-[11px] sm:text-xs font-medium leading-tight">{tr(t.label)}</span>
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
  const { t } = useTranslation();
  return (
    <div className="pb-24">
      <MobileHero
        eyebrow={t("more.eyebrow")}
        title={t("nav.more")}
        subtitle={t("more.subtitle")}
        icon={LayoutGrid}
        variant="teal"
      />
      <div className="px-4 pt-4 space-y-4">
        <SectionCard title={t("more.discover")} description={t("more.discoverDesc")}>
          <TileGrid tiles={DISCOVER} />
        </SectionCard>
        <SectionCard title={t("more.management")} description={t("more.modules", { count: MANAGEMENT.length })}>
          <TileGrid tiles={MANAGEMENT} />
        </SectionCard>
        <SectionCard title={t("more.finance")} description={t("more.modules", { count: FINANCE.length })}>
          <TileGrid tiles={FINANCE} />
        </SectionCard>
        <SectionCard title={t("nav.group.community")} description={t("more.modules", { count: COMMUNITY.length })}>
          <TileGrid tiles={COMMUNITY} />
        </SectionCard>
        <SectionCard title={t("more.certificates")} description={t("more.modules", { count: CERTIFICATES.length })}>
          <TileGrid tiles={CERTIFICATES} />
        </SectionCard>
        <SectionCard title={t("vch.kind.other")} description={t("more.modules", { count: OTHER.length })}>
          <TileGrid tiles={OTHER} />
        </SectionCard>
      </div>
    </div>
  );
}
