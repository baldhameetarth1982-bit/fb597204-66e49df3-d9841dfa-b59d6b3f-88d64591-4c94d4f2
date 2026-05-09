import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Wallet, Bell, LifeBuoy, User } from "lucide-react";

const tabs = [
  { to: "/app/dashboard", label: "Home", icon: Home },
  { to: "/app/dues", label: "Dues", icon: Wallet },
  { to: "/app/notices", label: "Notices", icon: Bell },
  { to: "/app/helpdesk", label: "Help", icon: LifeBuoy },
  { to: "/app/profile", label: "Me", icon: User },
] as const;

export function ResidentBottomNav() {
  const pathname = useRouterState({
    select: (s) => s.location.pathname,
  });

  return (
    <nav
      aria-label="Resident navigation"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 h-16 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
    >
      <ul className="grid grid-cols-5 h-full">
        {tabs.map(({ to, label, icon: Icon }) => {
          const active = pathname === to || pathname.startsWith(to + "/");
          return (
            <li key={to}>
              <Link
                to={to}
                className={`h-full flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors ${
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
