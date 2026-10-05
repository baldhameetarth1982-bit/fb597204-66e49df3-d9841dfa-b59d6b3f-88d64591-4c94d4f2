import { useTranslation } from "react-i18next";
import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Receipt, Users, Wrench, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/society/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, match: ["/society/dashboard"] },
  {
    to: "/society/billing",
    labelKey: "nav.billing",
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
    labelKey: "nav.residents",
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
    labelKey: "nav.operations",
    icon: Wrench,
    match: [
      "/society/matrix",
      // "/society/matrix-import" retired in Stage 2E — canonical route is /society/import.
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
    to: "/society/more",
    labelKey: "nav.more",
    icon: MoreHorizontal,
    match: [
      "/society/more",
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
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("nav.adminNav")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto grid grid-cols-5 max-w-[480px] px-1">
        {TABS.map((it) => {
          const active = it.match.some((p) => path === p || path.startsWith(p + "/"));
          const Icon = it.icon;
          return (
            <li key={it.to}>
              <Link
                to={it.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 py-2 min-h-[60px] text-[11px] font-medium transition-colors",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-12 place-items-center rounded-md transition-colors",
                    active && "bg-primary/10",
                  )}
                >
                  <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
                </span>
                <span className="leading-none">{t(it.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
