import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRight, BookOpen, Receipt, PartyPopper, Wallet, Coins, TrendingDown, FileText, QrCode, PiggyBank,
  Scale, BarChart3, FileCheck2, FilePlus2, ListChecks, AlertTriangle, LayoutTemplate, SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Page = { to: string; label: string; icon: typeof Wallet; exact?: boolean };
type Section = { key: string; label: string; icon: typeof Wallet; pages: Page[] };

/**
 * Accounting Center: four section buttons at the top, then that section's pages.
 * Every page here already exists; this only groups them so nothing is two clicks deep.
 */
export const ACCOUNTING_SECTIONS: Section[] = [
  {
    key: "income-expense", label: "Income & Expense", icon: ArrowLeftRight,
    pages: [
      { to: "/society/accounts", label: "Overview", icon: Wallet, exact: true },
      { to: "/society/income", label: "Income", icon: Coins },
      { to: "/society/expenses", label: "Expenses", icon: TrendingDown },
      { to: "/society/vouchers", label: "Vouchers", icon: FileText },
      { to: "/society/qr", label: "Smart QR", icon: QrCode },
      { to: "/society/budgets", label: "Budgets", icon: PiggyBank },
    ],
  },
  {
    key: "ledger", label: "Ledger", icon: BookOpen,
    pages: [
      { to: "/society/ledger", label: "Transactions", icon: BookOpen },
      { to: "/society/books", label: "Books", icon: Scale },
      { to: "/society/reports", label: "Reports", icon: BarChart3 },
      { to: "/society/auditor-pack", label: "Auditor pack", icon: FileCheck2 },
    ],
  },
  {
    key: "billing", label: "Maintenance & Billing", icon: Receipt,
    pages: [
      { to: "/society/billing/generate", label: "Generate bill", icon: FilePlus2 },
      { to: "/society/billing", label: "Bill history", icon: ListChecks, exact: true },
      { to: "/society/payments", label: "Payments", icon: Wallet },
      { to: "/society/defaulters", label: "Dues", icon: AlertTriangle },
      { to: "/society/receipts", label: "Receipts", icon: Receipt },
      { to: "/society/bill-studio", label: "Templates", icon: LayoutTemplate },
      { to: "/society/billing-settings", label: "Settings", icon: SlidersHorizontal },
    ],
  },
  {
    key: "events", label: "Events", icon: PartyPopper,
    pages: [{ to: "/society/event-money", label: "Event money", icon: PartyPopper }],
  },
];

const isOn = (path: string, p: Page) => (p.exact ? path === p.to : path === p.to || path.startsWith(p.to + "/"));

export function AccountingCenterNav({ className }: { className?: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = ACCOUNTING_SECTIONS.find((s) => s.pages.some((p) => isOn(path, p))) ?? ACCOUNTING_SECTIONS[0];

  return (
    <div className={cn("mb-4 space-y-2", className)}>
      <nav aria-label="Accounting Center" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {ACCOUNTING_SECTIONS.map((s) => {
          const active = s.key === current.key;
          const Icon = s.icon;
          return (
            <Link
              key={s.key}
              to={s.pages[0].to as "/society/accounts"}
              aria-current={active ? "page" : undefined}
              className="pill-tab inline-flex min-h-11 items-center justify-center gap-2 text-center"
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden />
              <span className="truncate">{s.label}</span>
            </Link>
          );
        })}
      </nav>
      {current.pages.length > 1 && (
        <nav aria-label={current.label} className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5">
          {current.pages.map((p) => {
            const active = isOn(path, p);
            const Icon = p.icon;
            return (
              <Link
                key={p.to}
                to={p.to as "/society/accounts"}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-primary-container text-primary-container-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {p.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
