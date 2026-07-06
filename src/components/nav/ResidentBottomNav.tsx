import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Receipt, ShieldCheck, Building2, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";

const TABS = [
  { to: "/app/dashboard", label: "Home", icon: Home, match: ["/app/dashboard"] },
  { to: "/app/bills", label: "Bills", icon: Receipt, match: ["/app/bills", "/app/dues", "/app/ledger"] },
  { to: "/app/visitors", label: "Visitors", icon: ShieldCheck, match: ["/app/visitors"] },
  {
    to: "/app/comm",
    label: "Society",
    icon: Building2,
    match: [
      "/app/comm",
      "/app/notices",
      "/app/helpdesk",
      "/app/contacts",
      "/app/bylaws",
      "/app/feed",
      "/app/polls",
      "/app/notifications",
      "/app/emergency",
    ],
    badge: "notif" as const,
  },
  {
    to: "/app/profile",
    label: "Profile",
    icon: User,
    match: [
      "/app/profile",
      "/app/family",
      "/app/vehicles",
      "/app/services",
      "/app/trust",
      "/app/achievements",
      "/app/activity",
    ],
  },
] as const;

export function ResidentBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const unread = useUnreadNotifications();
  return (
    <nav
      aria-label="Resident navigation"
      className="fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/98 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto grid grid-cols-5 max-w-[480px] px-1">
        {TABS.map((it) => {
          const active = it.match.some((p) => path === p || path.startsWith(p + "/"));
          const Icon = it.icon;
          const showBadge = "badge" in it && it.badge === "notif" && unread > 0;
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
                    "relative grid place-items-center h-9 w-14 rounded-2xl transition-colors",
                    active && "bg-primary/10",
                  )}
                >
                  <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
                  {showBadge && (
                    <span className="absolute -top-0.5 right-2 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[9px] font-bold grid place-items-center leading-none">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  )}
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
