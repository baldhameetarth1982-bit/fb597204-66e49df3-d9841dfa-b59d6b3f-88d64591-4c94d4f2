import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  Building2, Car, DoorOpen, LayoutDashboard, Megaphone, Menu, Receipt,
  ShieldCheck, Trophy, UserCheck, Users, Vote, Wallet, Wand2, Sparkles,
  Calculator, BadgeCheck, LogOut, Settings, ListChecks, Wrench, CalendarRange,
  BarChart3, Compass, Grid3x3, Upload, BookOpen, PhoneCall,
} from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/shared/Logo";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

type NavItem = { label: string; to: string; icon: React.ComponentType<{ className?: string }> };
type Group = { label: string; items: NavItem[] };

const GROUPS: Group[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", to: "/society/dashboard", icon: LayoutDashboard },
      { label: "Society Explorer", to: "/society/explorer", icon: Compass },
      { label: "Maintenance Matrix", to: "/society/matrix", icon: Grid3x3 },
      { label: "Approvals", to: "/society/approvals", icon: BadgeCheck },
    ],
  },
  {
    label: "Setup",
    items: [
      { label: "Setup Wizard", to: "/society/setup", icon: Wrench },
      { label: "Bulk Import", to: "/society/import", icon: Upload },
      { label: "Blocks", to: "/society/blocks", icon: Building2 },
      { label: "Flats", to: "/society/flats", icon: DoorOpen },
      { label: "Residents", to: "/society/residents", icon: Users },
      { label: "Custom Fields", to: "/society/custom-fields", icon: ListChecks },
      { label: "Team & Roles", to: "/society/team", icon: ShieldCheck },
      { label: "Verifications", to: "/society/verifications", icon: BadgeCheck },
    ],
  },
  {
    label: "Money",
    items: [
      { label: "Maintenance", to: "/society/maintenance", icon: CalendarRange },
      { label: "Bill Studio", to: "/society/bill-studio", icon: Wand2 },
      { label: "Billing", to: "/society/billing", icon: Receipt },
      { label: "Expenses", to: "/society/expenses", icon: Wallet },
      { label: "Income & Expense", to: "/society/accounts", icon: Calculator },
      { label: "Ledger", to: "/society/ledger", icon: Calculator },
      { label: "Reports", to: "/society/reports", icon: BarChart3 },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Vehicles", to: "/society/vehicles", icon: Car },
      { label: "Visitors", to: "/society/visitors", icon: UserCheck },
    ],
  },
  {
    label: "Community",
    items: [
      { label: "Announcements", to: "/society/announcements", icon: Megaphone },
      { label: "Notices & By-Laws", to: "/society/bylaws", icon: BookOpen },
      { label: "Contacts", to: "/society/contacts", icon: PhoneCall },
      { label: "Polls", to: "/society/polls", icon: Vote },
      { label: "Leaderboard", to: "/society/leaderboard", icon: Trophy },
      { label: "AI Digest", to: "/society/digest", icon: Sparkles },
    ],
  },
];

export function SocietyDrawer() {
  const [open, setOpen] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { profile, user, signOut } = useAuth();

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open menu"
          className="h-10 w-10 rounded-full"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[320px] max-w-[85vw] p-0 flex flex-col h-[100dvh]">
        <SheetHeader className="px-5 pt-6 pb-4 border-b">
          <div className="flex items-center gap-3">
            <Logo size={40} />
            <div className="min-w-0">
              <SheetTitle className="text-base truncate">{profile?.full_name ?? "Society Admin"}</SheetTitle>
              <p className="text-xs text-muted-foreground truncate">{user?.email}</p>
            </div>
          </div>
        </SheetHeader>

        <nav className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-4 pb-24 space-y-5">
          {GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
              <ul className="space-y-1">
                {group.items.map((item) => {
                  const active = pathname === item.to || pathname.startsWith(item.to + "/");
                  const Icon = item.icon;
                  return (
                    <li key={item.to}>
                      <SheetClose asChild>
                        <Link
                          to={item.to as any}
                          className={cn(
                            "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium transition-colors",
                            active
                              ? "bg-primary/10 text-primary"
                              : "text-foreground hover:bg-secondary",
                          )}
                        >
                          <Icon className="h-5 w-5 shrink-0" />
                          <span className="truncate">{item.label}</span>
                        </Link>
                      </SheetClose>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t p-3 space-y-1">
          <SheetClose asChild>
            <Link
              to="/settings"
              className="flex items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-foreground hover:bg-secondary"
            >
              <Settings className="h-5 w-5" /> Settings
            </Link>
          </SheetClose>
          <button
            onClick={async () => { setOpen(false); await signOut(); }}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-sm font-medium text-destructive hover:bg-destructive/5"
          >
            <LogOut className="h-5 w-5" /> Log out
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
