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
    label: "Bill",
    tabs: [
      { to: "/society/billing/generate", label: "Generate", icon: FilePlus2 },
      { to: "/society/billing", label: "History", icon: ListChecks },
    ],
  },
  {
    label: "Collect",
    tabs: [
      { to: "/society/payments", label: "Payments", icon: Wallet },
      { to: "/society/defaulters", label: "Dues", icon: AlertTriangle },
      { to: "/society/receipts", label: "Receipts", icon: Receipt },
    ],
  },
  {
    label: "Set up",
    tabs: [
      { to: "/society/bill-studio", label: "Templates", icon: LayoutTemplate },
      { to: "/society/billing-settings", label: "Settings", icon: SlidersHorizontal },
    ],
  },
];

export function BillingCenterTabs() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="overflow-x-auto">
      <nav className="flex min-w-max items-stretch gap-1 p-1.5" aria-label="Billing sections">
        {GROUPS.map((g, gi) => (
          <div key={g.label} className={cn("flex items-center gap-1", gi > 0 && "ml-1 border-l border-border pl-2")} role="group" aria-label={g.label}>
            <span className="hidden px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:inline">{g.label}</span>
            {g.tabs.map((t) => {
              // Exact match for History so Generate doesn't also activate it.
              const active = t.to === "/society/billing" ? path === "/society/billing" : path === t.to || path.startsWith(t.to + "/");
              const Icon = t.icon;
              return (
                <Link
                  key={t.to}
                  to={t.to as any}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "bg-primary-container text-primary-container-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {t.label}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );
}
