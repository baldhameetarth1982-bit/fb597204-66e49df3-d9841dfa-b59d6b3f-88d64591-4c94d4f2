import { Link, useRouterState } from "@tanstack/react-router";
import { FilePlus2, ListChecks, LayoutTemplate, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Unified Billing Center tab bar for Society Admin.
 * Four surfaces: Generate / History / Templates / Settings.
 * Old `/society/bill-studio` is preserved and now maps into the Templates tab
 * so opening it directly still feels like part of Billing Center.
 */
const TABS: Array<{ to: string; label: string; icon: any; matches?: string[] }> = [
  { to: "/society/billing/generate", label: "Generate", icon: FilePlus2 },
  { to: "/society/billing", label: "History", icon: ListChecks },
  { to: "/society/bill-studio", label: "Templates", icon: LayoutTemplate },
  { to: "/society/billing-settings", label: "Settings", icon: SlidersHorizontal },
];

export function BillingCenterTabs() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="overflow-x-auto border-b border-border">

      <nav className="flex min-w-max gap-1 sm:gap-2" aria-label="Billing sections">
        {TABS.map((t) => {
          // Exact match for /society/billing (History) so /society/billing/generate doesn't also activate it.
          const active =
            t.to === "/society/billing"
              ? path === "/society/billing"
              : path === t.to || path.startsWith(t.to + "/");
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to as any}
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
