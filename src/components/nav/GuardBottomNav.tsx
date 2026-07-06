import { Link, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, History, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

// Guard sub-routes for History/Settings do not exist yet; link to closest existing routes.
// See .lovable/ui-audit.md.
const TABS = [
  { to: "/app/guard", label: "Dashboard", icon: LayoutDashboard, match: ["/app/guard"] },
  { to: "/app/guard", label: "History", icon: History, match: [] },
  { to: "/settings", label: "Settings", icon: Settings, match: ["/settings"] },
] as const;

export function GuardBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      aria-label="Guard navigation"
      className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/98 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid grid-cols-3 max-w-[480px] px-1">
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
