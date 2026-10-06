import { createFileRoute } from "@tanstack/react-router";
import { PiggyBank } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { BudgetsPanel } from "@/features/procurement/procurement";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/budgets")({
  head: () => ({ meta: [
    { title: "Budgets — SociyoHub" },
    { name: "description", content: "Society budgets by financial year with actual spending from posted expenses." },
    { property: "og:title", content: "Budgets — SociyoHub" },
    { property: "og:description", content: "Budget vs actual for your society, calculated from posted expenses." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex, nofollow" },
  ] }),
  component: () => <FeatureGate feature="accounts_center"><BudgetsPage /></FeatureGate>,
});

function BudgetsPage() {
  return (
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <MobileHero eyebrow={tu("accountsTabs.label")} title={tu("accountsTabs.budgets")} subtitle={tu("op.approved_budgets_revisions_and_actual")} icon={PiggyBank} variant="teal" />
      <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
        <AccountsCenterTabs />
        <BudgetsPanel />
      </div>
    </div>
  );
}
