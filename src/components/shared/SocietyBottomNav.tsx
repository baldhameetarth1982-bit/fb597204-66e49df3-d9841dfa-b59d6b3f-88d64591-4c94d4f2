import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bot,
  Building2,
  Car,
  DoorOpen,
  Home,
  Megaphone,
  Receipt,
  ShieldCheck,
  Trophy,
  UserCheck,
  Users,
  Vote,
  WalletCards,
} from "lucide-react";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const categories = [
  {
    label: "Setup",
    icon: Building2,
    items: [
      { title: "Blocks", to: "/society/blocks", icon: Building2 },
      { title: "Flats", to: "/society/flats", icon: DoorOpen },
      { title: "Residents", to: "/society/residents", icon: Users },
      { title: "Team", to: "/society/team", icon: ShieldCheck },
    ],
  },
  {
    label: "Money",
    icon: WalletCards,
    items: [
      { title: "Billing", to: "/society/billing", icon: Receipt },
      { title: "Ledger", to: "/society/ledger", icon: WalletCards },
    ],
  },
  {
    label: "Ops",
    icon: UserCheck,
    items: [
      { title: "Vehicles", to: "/society/vehicles", icon: Car },
      { title: "Visitors", to: "/society/visitors", icon: UserCheck },
    ],
  },
  {
    label: "Social",
    icon: Megaphone,
    items: [
      { title: "Announcements", to: "/society/announcements", icon: Megaphone },
      { title: "Polls", to: "/society/polls", icon: Vote },
      { title: "Leaderboard", to: "/society/leaderboard", icon: Trophy },
      { title: "AI Digest", to: "/society/digest", icon: Bot },
    ],
  },
] as const;

export function SocietyBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const homeActive = pathname === "/society/dashboard" || pathname === "/society";

  return (
    <nav
      aria-label="Society admin modules"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 mx-auto w-full max-w-[420px] h-[72px] border-t border-border bg-background/95 backdrop-blur"
    >
      <ul className="grid h-full grid-cols-5 px-1">
        <li>
          <Link
            to="/society/dashboard"
            className="flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium"
          >
            <span
              className={cn(
                "grid h-9 w-12 place-items-center rounded-2xl transition-colors",
                homeActive ? "bg-primary/10 text-primary" : "text-muted-foreground",
              )}
            >
              <Home className="h-5 w-5" />
            </span>
            <span className={homeActive ? "text-primary" : "text-muted-foreground"}>Home</span>
          </Link>
        </li>

        {categories.map((category) => {
          const active = category.items.some(
            (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
          );
          const Icon = category.icon;

          return (
            <li key={category.label}>
              <Sheet>
                <SheetTrigger asChild>
                  <button
                    type="button"
                    className="flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-medium"
                    aria-label={`${category.label} modules`}
                  >
                    <span
                      className={cn(
                        "grid h-9 w-12 place-items-center rounded-2xl transition-colors",
                        active ? "bg-primary/10 text-primary" : "text-muted-foreground",
                      )}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <span className={active ? "text-primary" : "text-muted-foreground"}>
                      {category.label}
                    </span>
                  </button>
                </SheetTrigger>
                <SheetContent
                  side="bottom"
                  className="mx-auto max-w-[420px] rounded-t-3xl border-border px-4 pb-7 pt-5"
                >
                  <SheetHeader className="text-left">
                    <SheetTitle>{category.label}</SheetTitle>
                    <SheetDescription>Choose a module</SheetDescription>
                  </SheetHeader>
                  <div className="mt-5 grid grid-cols-2 gap-3">
                    {category.items.map((item) => {
                      const ItemIcon = item.icon;
                      const itemActive = pathname === item.to || pathname.startsWith(`${item.to}/`);
                      return (
                        <SheetClose asChild key={item.to}>
                          <Link
                            to={item.to as any}
                            className={cn(
                              "min-h-24 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-secondary",
                              itemActive && "border-primary bg-primary/5 text-primary",
                            )}
                          >
                            <span className="grid h-10 w-10 place-items-center rounded-xl bg-secondary text-foreground">
                              <ItemIcon className="h-5 w-5" />
                            </span>
                            <span className="mt-3 block text-sm font-semibold leading-tight">
                              {item.title}
                            </span>
                          </Link>
                        </SheetClose>
                      );
                    })}
                  </div>
                </SheetContent>
              </Sheet>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}