import { createFileRoute } from "@tanstack/react-router";
import { PiggyBank } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { AccountsCenterTabs } from "@/components/nav/AccountsCenterTabs";
import { MobileHero } from "@/components/shared/MobileHero";
import { BudgetsPanel } from "@/features/procurement/procurement";

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
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-2">
      <AccountsCenterTabs />
      <MobileHero eyebrow="Accounts Center" title="Budgets" subtitle="Approved budgets, revisions and actual spending from posted expenses." icon={PiggyBank} variant="teal" />
      <div className="mt-4"><BudgetsPanel /></div>
    </div>
  );
}
