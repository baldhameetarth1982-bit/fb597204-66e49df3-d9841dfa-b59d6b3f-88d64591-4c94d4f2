import { useTranslation } from "react-i18next";
import { Link, useRouterState } from "@tanstack/react-router";
import { Wallet, BookOpen, BarChart3, TrendingDown, Coins, QrCode, FileCheck2, PiggyBank, Scale, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Accounts Center tabs — replaces the legacy 7-tab FinanceTabs on
 * accounts / ledger / expenses / reports. Billing surfaces use
 * BillingCenterTabs instead.
 */
const TABS = [
  { to: "/society/accounts", labelKey: "accountsTabs.dashboard", icon: Wallet, match: ["/society/accounts"] },
  { to: "/society/ledger", labelKey: "accountsTabs.transactions", icon: BookOpen, match: ["/society/ledger"] },
  { to: "/society/income", labelKey: "accountsTabs.income", icon: Coins, match: ["/society/income"] },
  { to: "/society/qr", labelKey: "accountsTabs.smartQr", icon: QrCode, match: ["/society/qr"] },
  { to: "/society/reports", labelKey: "accountsTabs.reports", icon: BarChart3, match: ["/society/reports"] },
  { to: "/society/books", labelKey: "accountsTabs.books", icon: Scale, match: ["/society/books"] },
  { to: "/society/auditor-pack", labelKey: "accountsTabs.auditorPack", icon: FileCheck2, match: ["/society/auditor-pack"] },
  { to: "/society/budgets", labelKey: "accountsTabs.budgets", icon: PiggyBank, match: ["/society/budgets"] },
  { to: "/society/expenses", labelKey: "accountsTabs.expenses", icon: TrendingDown, match: ["/society/expenses"] },
  { to: "/society/vouchers", labelKey: "accountsTabs.vouchers", icon: Receipt, match: ["/society/vouchers"] },
] as const;

export function AccountsCenterTabs() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useTranslation();
  return (
    <div className="-mx-4 mb-4 overflow-x-auto border-b bg-background/50 px-4 sm:mx-0 sm:px-0">
      <nav className="flex min-w-max gap-1 sm:gap-2" aria-label={t("accountsTabs.label")}>
        {TABS.map((tab) => {
          const active = tab.match.some((m) => path === m || path.startsWith(m + "/"));
          const Icon = tab.icon;
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t(tab.labelKey)}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
