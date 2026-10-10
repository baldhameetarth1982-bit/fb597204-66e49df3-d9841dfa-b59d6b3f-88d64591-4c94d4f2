import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeftRight, BookOpen, Receipt, PartyPopper, Wallet, Coins, TrendingDown, FileText, QrCode, PiggyBank,
  Scale, BarChart3, FileCheck2, FilePlus2, ListChecks, AlertTriangle, LayoutTemplate, SlidersHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tu } from "@/lib/i18n";

type Page = { to: string; label: string; icon: typeof Wallet; exact?: boolean; also?: string[] };
type Section = { key: string; label: string; icon: typeof Wallet; pages: Page[] };

/**
 * Accounting Center: four section buttons at the top, then that section's pages.
 * Every page here already exists; this only groups them so nothing is two clicks deep.
 */
export const ACCOUNTING_SECTIONS: Section[] = [
  {
    key: "income-expense", label: "ln.acc.incomeExpense", icon: ArrowLeftRight,
    pages: [
      { to: "/society/accounts", label: "ln.acc.overview", icon: Wallet, exact: true },
      { to: "/society/income", label: "ln.acc.income", icon: Coins },
      { to: "/society/expenses", label: "ln.acc.expenses", icon: TrendingDown },
      { to: "/society/vouchers", label: "ln.acc.vouchers", icon: FileText },
      { to: "/society/qr", label: "ln.acc.smartQr", icon: QrCode },
      { to: "/society/budgets", label: "ln.acc.budgets", icon: PiggyBank },
    ],
  },
  {
    key: "ledger", label: "ln.acc.ledger", icon: BookOpen,
    pages: [
      { to: "/society/ledger", label: "ln.acc.transactions", icon: BookOpen },
      { to: "/society/books", label: "ln.acc.books", icon: Scale },
      { to: "/society/reports", label: "ln.acc.reports", icon: BarChart3 },
      { to: "/society/auditor-pack", label: "ln.acc.auditorPack", icon: FileCheck2 },
    ],
  },
  {
    key: "billing", label: "ln.acc.billing", icon: Receipt,
    pages: [
      { to: "/society/billing/generate", label: "ln.acc.generateBill", icon: FilePlus2, also: ["/society/billing/single", "/society/bill-studio/generate"] },
      { to: "/society/billing", label: "ln.acc.billHistory", icon: ListChecks, exact: true, also: ["/society/bills"] },
      { to: "/society/payments", label: "ln.acc.payments", icon: Wallet },
      { to: "/society/defaulters", label: "ln.acc.dues", icon: AlertTriangle },
      { to: "/society/receipts", label: "ln.acc.receipts", icon: Receipt },
      { to: "/society/bill-studio", label: "ln.acc.templates", icon: LayoutTemplate },
      { to: "/society/billing-settings", label: "ln.acc.settings", icon: SlidersHorizontal },
    ],
  },
  {
    key: "events", label: "ln.acc.events", icon: PartyPopper,
    pages: [{ to: "/society/event-money", label: "ln.acc.eventMoney", icon: PartyPopper }],
  },
];

const under = (path: string, to: string) => path === to || path.startsWith(to + "/");
const isOn = (path: string, p: Page) =>
  (p.exact ? path === p.to : under(path, p.to)) || (p.also ?? []).some((a) => under(path, a));

export function AccountingCenterNav({ className }: { className?: string }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const current = ACCOUNTING_SECTIONS.find((s) => s.pages.some((p) => isOn(path, p))) ?? ACCOUNTING_SECTIONS[0];

  return (
    <div className={cn("mb-4 space-y-2", className)}>
      <nav aria-label={tu("ln.acc.center")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
              <span className="truncate">{tu(s.label)}</span>
            </Link>
          );
        })}
      </nav>
      {current.pages.length > 1 && (
        <nav aria-label={tu(current.label)} className="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5">
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
                {tu(p.label)}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
