import { createFileRoute } from "@tanstack/react-router";
import {
  Building2,
  Wallet,
  AlertTriangle,
  Megaphone,
  ArrowUpRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDate } from "@/utils/format";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

type Stat = {
  label: string;
  value: string;
  hint: string;
  icon: typeof Building2;
  iconBg: string;
  iconFg: string;
};

const stats: Stat[] = [
  {
    label: "Total Registered Flats",
    value: "428",
    hint: "Across 6 blocks",
    icon: Building2,
    iconBg: "bg-primary/10",
    iconFg: "text-primary",
  },
  {
    label: "Collected Maintenance (This Month)",
    value: formatCurrency(1284500),
    hint: "92% of expected",
    icon: Wallet,
    iconBg: "bg-success/10",
    iconFg: "text-success",
  },
  {
    label: "Defaulters Count",
    value: "37",
    hint: "Pending > 30 days",
    icon: AlertTriangle,
    iconBg: "bg-destructive/10",
    iconFg: "text-destructive",
  },
];

const announcements = [
  {
    title: "Diwali decoration committee — volunteers needed",
    date: "2026-05-08",
    tag: "Community",
  },
  {
    title: "Water tank cleaning scheduled for Tower B",
    date: "2026-05-06",
    tag: "Maintenance",
  },
  {
    title: "Visitor parking rules updated, effective immediately",
    date: "2026-05-04",
    tag: "Notice",
  },
  {
    title: "AGM meeting minutes are now available in Documents",
    date: "2026-05-01",
    tag: "Governance",
  },
];

const transactions = [
  { flat: "A-204", resident: "Priya Sharma", amount: 4500, status: "Paid", date: "2026-05-08" },
  { flat: "B-1102", resident: "Rohan Mehta", amount: 5200, status: "Paid", date: "2026-05-07" },
  { flat: "C-301", resident: "Anita Desai", amount: 4500, status: "Pending", date: "2026-05-06" },
  { flat: "A-507", resident: "Vikram Iyer", amount: 4500, status: "Paid", date: "2026-05-05" },
  { flat: "D-805", resident: "Meera Kapoor", amount: 5200, status: "Failed", date: "2026-05-04" },
];

function StatusPill({ status }: { status: string }) {
  const styles =
    status === "Paid"
      ? "bg-success/10 text-success border-success/20"
      : status === "Pending"
        ? "bg-warning/10 text-warning border-warning/20"
        : "bg-destructive/10 text-destructive border-destructive/20";
  return (
    <Badge variant="outline" className={`rounded-full font-medium ${styles}`}>
      {status}
    </Badge>
  );
}

function DashboardPage() {
  return (
    <div className="px-4 md:px-8 py-6 md:py-10 max-w-7xl mx-auto space-y-8">
      {/* Greeting */}
      <header className="space-y-1">
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground">
          Welcome back, Admin
        </h1>
        <p className="text-muted-foreground">
          Here's what's happening in your society today.
        </p>
      </header>

      {/* Key Stats */}
      <section
        aria-label="Key statistics"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6"
      >
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Card
              key={s.label}
              className="rounded-2xl border-border shadow-none hover:shadow-md transition-shadow"
            >
              <CardContent className="p-6 md:p-7 flex items-start gap-5">
                <div
                  className={`h-14 w-14 rounded-2xl grid place-items-center shrink-0 ${s.iconBg} ${s.iconFg}`}
                >
                  <Icon className="h-7 w-7" strokeWidth={2.25} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-muted-foreground leading-snug">
                    {s.label}
                  </p>
                  <p className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight text-foreground tabular-nums">
                    {s.value}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{s.hint}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* Two-up: Announcements + Transactions */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-4 md:gap-6">
        {/* Announcements */}
        <Card className="rounded-2xl border-border shadow-none lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center">
                <Megaphone className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg font-semibold">
                Recent Announcements
              </CardTitle>
            </div>
            <a
              href="/society/announcements"
              className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1"
            >
              View all <ArrowUpRight className="h-4 w-4" />
            </a>
          </CardHeader>
          <CardContent className="pt-2">
            <ul className="divide-y divide-border">
              {announcements.map((a) => (
                <li key={a.title} className="py-4 first:pt-2 last:pb-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm md:text-base font-medium text-foreground leading-snug">
                        {a.title}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(a.date)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className="rounded-full bg-secondary border-transparent text-secondary-foreground shrink-0"
                    >
                      {a.tag}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        {/* Transactions */}
        <Card className="rounded-2xl border-border shadow-none lg:col-span-3">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary grid place-items-center">
                <Wallet className="h-5 w-5" />
              </div>
              <CardTitle className="text-lg font-semibold">
                Recent Transactions
              </CardTitle>
            </div>
            <a
              href="/society/billing"
              className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1"
            >
              View all <ArrowUpRight className="h-4 w-4" />
            </a>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-muted-foreground">Flat</TableHead>
                    <TableHead className="text-muted-foreground">Resident</TableHead>
                    <TableHead className="text-muted-foreground text-right">Amount</TableHead>
                    <TableHead className="text-muted-foreground">Status</TableHead>
                    <TableHead className="text-muted-foreground hidden md:table-cell">Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((t) => (
                    <TableRow key={t.flat} className="border-border">
                      <TableCell className="font-medium">{t.flat}</TableCell>
                      <TableCell className="text-foreground">{t.resident}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCurrency(t.amount)}
                      </TableCell>
                      <TableCell>
                        <StatusPill status={t.status} />
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        {formatDate(t.date)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
