import { Link, useRouterState } from "@tanstack/react-router";
import { Receipt, FileText, Wallet, BookOpen, TrendingDown, BarChart3, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/society/billing", label: "Bills", icon: Receipt },
  { to: "/society/bill-studio", label: "Bill Studio", icon: FileText },
  { to: "/society/accounts", label: "Accounts", icon: Wallet },
  { to: "/society/ledger", label: "Ledger", icon: BookOpen },
  { to: "/society/expenses", label: "Expenses", icon: TrendingDown },
  { to: "/society/reports", label: "Reports", icon: BarChart3 },
  { to: "/society/billing-settings", label: "Settings", icon: Settings2 },
] as const;

export function FinanceTabs() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="-mx-4 mb-4 overflow-x-auto border-b bg-background/50 px-4 sm:mx-0 sm:px-0">
      <nav className="flex min-w-max gap-1 sm:gap-2" aria-label="Finance sections">
        {TABS.map((t) => {
          const active = path === t.to;
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
