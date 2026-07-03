import { Link, useRouterState } from "@tanstack/react-router";
import { Home, Receipt, ShieldCheck, Building2, User } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { to: "/app/dashboard", label: "Home", icon: Home, match: ["/app/dashboard"] },
  { to: "/app/bills", label: "Bills", icon: Receipt, match: ["/app/bills", "/app/dues", "/app/ledger"] },
  { to: "/app/visitors", label: "Visitors", icon: ShieldCheck, match: ["/app/visitors", "/app/guard"] },
  { to: "/app/comm", label: "Society", icon: Building2, match: ["/app/comm", "/app/notices", "/app/helpdesk", "/app/contacts", "/app/bylaws", "/app/feed", "/app/polls"] },
  { to: "/app/profile", label: "Profile", icon: User, match: ["/app/profile", "/app/family", "/app/vehicles"] },
] as const;

export function ResidentBottomNav() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <nav
      aria-label="Resident navigation"
      className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="mx-auto flex max-w-3xl items-stretch justify-around px-1">
        {ITEMS.map((it) => {
          const active = it.match.some((p) => path === p || path.startsWith(p + "/"));
          const Icon = it.icon;
          return (
            <li key={it.to} className="flex-1">
              <Link
                to={it.to}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors min-h-[56px]",
                  active ? "text-primary" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className={cn("h-5 w-5", active && "stroke-[2.5]")} />
                <span>{it.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
