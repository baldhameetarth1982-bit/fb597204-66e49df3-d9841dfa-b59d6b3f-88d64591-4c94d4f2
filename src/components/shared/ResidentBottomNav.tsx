import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Receipt, Users, LayoutGrid, User } from "lucide-react";

const tabs = [
  { to: "/app/dashboard", label: "Home", icon: Home },
  { to: "/app/bills", label: "Bills", icon: Receipt },
  { to: "/app/feed", label: "Community", icon: Users },
  { to: "/app/services", label: "Services", icon: LayoutGrid },
  { to: "/app/profile", label: "Profile", icon: User },
] as const;

export function ResidentBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 mx-auto w-full max-w-[420px] h-16 border-t border-border bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="grid grid-cols-5 h-full px-1">
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = pathname === to || pathname.startsWith(to + "/");
          return (
            <li key={to}>
              <Link
                to={to}
                className="h-full flex flex-col items-center justify-center gap-1 text-[11px] font-medium"
              >
                <span
                  className={`grid place-items-center h-9 w-12 rounded-2xl transition-colors ${
                    active ? "bg-primary/10 text-primary" : "text-muted-foreground"
                  }`}
                >
                  <Icon className="h-[20px] w-[20px]" />
                </span>
                <span className={active ? "text-primary" : "text-muted-foreground"}>
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
