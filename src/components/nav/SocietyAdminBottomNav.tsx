import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Receipt, Users, Wrench, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/society/dashboard", label: "Dashboard", icon: LayoutDashboard, match: ["/society/dashboard"] },
  {
    to: "/society/billing",
    label: "Billing",
    icon: Receipt,
    match: [
      "/society/billing",
      "/society/billing-settings",
      "/society/bill-studio",
      "/society/accounts",
      "/society/ledger",
      "/society/expenses",
      "/society/payouts",
      "/society/reports",
    ],
  },
  {
    to: "/society/residents",
    label: "Residents",
    icon: Users,
    match: [
      "/society/residents",
      "/society/flats",
      "/society/blocks",
      "/society/approvals",
      "/society/verifications",
      "/society/import",
    ],
  },
  {
    to: "/society/matrix",
    label: "Operations",
    icon: Wrench,
    match: [
      "/society/matrix",
      "/society/matrix-import",
      "/society/maintenance",
      "/society/visitors",
      "/society/vehicles",
      "/society/polls",
      "/society/announcements",
      "/society/digest",
      "/society/contacts",
      "/society/bylaws",
      "/society/automations",
    ],
  },
  {
    to: "/society/business-profile",
    label: "More",
    icon: MoreHorizontal,
    match: [
      "/society/business-profile",
      "/society/team",
      "/society/custom-fields",
      "/society/explorer",
      "/society/setup",
      "/society/leaderboard",
    ],
  },
] as const;

export function SocietyAdminBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      aria-label="Society admin navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/98 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid grid-cols-5 max-w-[480px] px-1">
        {TABS.map((it) => {
          const active = it.match.some((p) => path === p || path.startsWith(p + "/"));
          const Icon = it.icon;
          return (
            <li key={it.to}>
              <Link
                to={it.to}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-2 min-h-[60px] text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid place-items-center h-9 w-14 rounded-2xl transition-colors",
                    active && "bg-primary/10",
                  )}
                >
                  <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
                </span>
                <span className="leading-none">{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
