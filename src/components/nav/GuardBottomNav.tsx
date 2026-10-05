import { useTranslation } from "react-i18next";
import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/app/guard", labelKey: "nav.dashboard", icon: LayoutDashboard, match: ["/app/guard"] },
  { to: "/settings", labelKey: "nav.settings", icon: Settings, match: ["/settings"] },
] as const;

export function GuardBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("nav.guardNav")}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
    >
      <ul className="mx-auto grid grid-cols-2 max-w-[480px] px-1">
        {TABS.map((it, i) => {
          const active = it.match.some((p) => path === p || path.startsWith(p + "/"));
          const Icon = it.icon;
          return (
            <li key={`${it.to}-${i}`}>
              <Link
                to={it.to}
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
