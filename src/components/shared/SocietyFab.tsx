import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Plus, Receipt, Wallet, UserCheck, Megaphone } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetClose,
} from "@/components/ui/sheet";

const ACTIONS = [
  { label: "Generate Bill", to: "/society/billing/generate", icon: Receipt, color: "bg-blue-500/10 text-blue-600" },
  { label: "Add Expense", to: "/society/expenses", icon: Wallet, color: "bg-amber-500/10 text-amber-600" },
  { label: "Log Visitor", to: "/society/visitors", icon: UserCheck, color: "bg-emerald-500/10 text-emerald-600" },
  { label: "Announcement", to: "/society/announcements", icon: Megaphone, color: "bg-purple-500/10 text-purple-600" },
];

/**
 * Floating action button for the society admin shell. Tapping opens a bottom
 * sheet with primary quick actions — Material-3 "Extended FAB" pattern.
 */
export function SocietyFab() {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          aria-label="Quick actions"
          className="fixed z-40 right-4 grid h-14 w-14 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-95 md:hidden"
          style={{ bottom: "calc(80px + env(safe-area-inset-bottom))" }}
        >
          <Plus className="h-6 w-6" />
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="mx-auto max-w-[480px] rounded-t-3xl px-4 pb-7 pt-5">
        <SheetHeader className="text-left">
          <SheetTitle>Quick actions</SheetTitle>
        </SheetHeader>
        <div className="mt-4 grid grid-cols-2 gap-3">
          {ACTIONS.map(({ label, to, icon: Icon, color }) => (
            <SheetClose asChild key={to}>
              <Link
                to={to as any}
                className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-4 transition-colors hover:bg-secondary"
              >
                <span className={`grid h-11 w-11 place-items-center rounded-xl ${color}`}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="text-sm font-semibold leading-tight">{label}</span>
              </Link>
            </SheetClose>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
