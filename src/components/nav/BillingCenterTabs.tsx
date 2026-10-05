import { useTranslation } from "react-i18next";
import { Link, useRouterState } from "@tanstack/react-router";
import { FilePlus2, ListChecks, LayoutTemplate, SlidersHorizontal, AlertTriangle, Receipt, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Billing Centre navigation, grouped by the committee workflow:
 * Bill → Collect → Set up. Only existing routes.
 * `/society/bill-studio` stays reachable as Templates.
 */
const GROUPS: Array<{ label: string; tabs: Array<{ to: string; label: string; icon: any }> }> = [
  {
    label: "billingTabs.bill",
    tabs: [
      { to: "/society/billing/generate", label: "billingTabs.generate", icon: FilePlus2 },
      { to: "/society/billing", label: "billingTabs.history", icon: ListChecks },
    ],
  },
  {
    label: "billingTabs.collect",
    tabs: [
      { to: "/society/payments", label: "billingTabs.payments", icon: Wallet },
      { to: "/society/defaulters", label: "billingTabs.dues", icon: AlertTriangle },
      { to: "/society/receipts", label: "billingTabs.receipts", icon: Receipt },
    ],
  },
  {
    label: "billingTabs.setup",
    tabs: [
      { to: "/society/bill-studio", label: "billingTabs.templates", icon: LayoutTemplate },
      { to: "/society/billing-settings", label: "billingTabs.settings", icon: SlidersHorizontal },
    ],
  },
];

export function BillingCenterTabs() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <nav className="flex min-w-max items-stretch gap-1 p-1.5" aria-label={t("billingTabs.label")}>
        {GROUPS.map((g, gi) => (
          <div key={g.label} className={cn("flex items-center gap-1", gi > 0 && "ms-1 border-l border-border ps-2")} role="group" aria-label={t(g.label)}>
            <span className="hidden px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:inline">{t(g.label)}</span>
            {g.tabs.map((tab) => {
              // Exact match for History so Generate doesn't also activate it.
              const active = tab.to === "/society/billing" ? path === "/society/billing" : path === tab.to || path.startsWith(tab.to + "/");
              const Icon = tab.icon;
              return (
                <Link
                  key={tab.to}
                  to={tab.to as any}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "bg-primary-container text-primary-container-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {t(tab.label)}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
