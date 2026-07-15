import { Link, useRouterState } from "@tanstack/react-router";
import { Wallet, BookOpen, BarChart3, TrendingDown, Coins } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Accounts Center tabs — replaces the legacy 7-tab FinanceTabs on
 * accounts / ledger / expenses / reports. Billing surfaces use
 * BillingCenterTabs instead.
 */
const TABS = [
  { to: "/society/accounts", label: "Dashboard", icon: Wallet, match: ["/society/accounts"] },
  { to: "/society/ledger", label: "Transactions", icon: BookOpen, match: ["/society/ledger"] },
  { to: "/society/income", label: "Income & Collections", icon: Coins, match: ["/society/income"] },
  { to: "/society/reports", label: "Reports", icon: BarChart3, match: ["/society/reports"] },
  { to: "/society/expenses", label: "Expenses", icon: TrendingDown, match: ["/society/expenses"] },
] as const;

export function AccountsCenterTabs() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="-mx-4 mb-4 overflow-x-auto border-b bg-background/50 px-4 sm:mx-0 sm:px-0">
      <nav className="flex min-w-max gap-1 sm:gap-2" aria-label="Accounts Center">
        {TABS.map((t) => {
          const active = t.match.some((m) => path === m || path.startsWith(m + "/"));
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
