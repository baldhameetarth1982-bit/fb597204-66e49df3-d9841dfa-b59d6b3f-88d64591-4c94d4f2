import { useTranslation } from "react-i18next";
import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Building2, Users, BarChart3, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  {
    to: "/admin/dashboard",
    labelKey: "nav.overview",
    icon: LayoutDashboard,
    match: ["/admin/dashboard", "/admin/executive", "/admin/health"],
  },
  {
    to: "/admin/societies",
    labelKey: "nav.societies",
    icon: Building2,
    match: ["/admin/societies", "/admin/withdrawals", "/admin/razorpay"],
  },
  {
    to: "/admin/users",
    labelKey: "nav.users",
    icon: Users,
    match: ["/admin/users", "/admin/plans", "/admin/custom-plans"],
  },
  {
    to: "/admin/bi",
    labelKey: "nav.reports",
    icon: BarChart3,
    match: [
      "/admin/bi",
      "/admin/revenue",
      "/admin/income",
      "/admin/report-builder",
      "/admin/audit",
    ],
  },
  {
    to: "/admin/settings",
    labelKey: "nav.more",
    icon: MoreHorizontal,
    match: ["/admin/settings", "/admin/security", "/admin/ads", "/admin/marketplace", "/admin/branding", "/admin/costs", "/admin/ai-usage", "/admin/assistant"],
  },
] as const;

export function SuperAdminBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("nav.superNav")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
    >
      <ul className="mx-auto grid grid-cols-5 max-w-[480px] px-1">
        {TABS.map((it) => {
          const active = it.match.some((p) => path === p || path.startsWith(p + "/"));
          const Icon = it.icon;
          return (
            <li key={it.to} className="min-w-0">
              <Link
                to={it.to}
                className={cn(
                  "flex min-w-0 flex-col items-center justify-center gap-1 py-2 min-h-[60px] text-[11px] font-medium transition-colors",
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
                <span className="block w-full max-w-full truncate px-0.5 text-center leading-tight">{t(it.labelKey)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
