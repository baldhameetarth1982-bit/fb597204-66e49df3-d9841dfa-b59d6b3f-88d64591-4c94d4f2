import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Building2, Home, Car, Users, UserCheck, ShieldCheck, MessageSquare,
  Megaphone, Vote, FileText, Phone as PhoneIcon, BookOpen,
  Receipt, Wallet, BarChart3, TrendingDown, ClipboardList,
  Settings2, UsersRound, Activity, LifeBuoy, Sparkles, KeyRound, Building,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";

export const Route = createFileRoute("/_society/society/more")({
  head: () => ({ meta: [{ title: "More — SocioHub" }] }),
  component: MoreDirectory,
});

type Tile = { to: string; label: string; icon: any };

const MANAGEMENT: Tile[] = [
  { to: "/society/blocks", label: "Blocks", icon: Building },
  { to: "/society/flats", label: "Houses", icon: Home },
  { to: "/society/vehicles", label: "Vehicles", icon: Car },
  { to: "/society/visitors", label: "Visitors", icon: UsersRound },
  { to: "/society/approvals", label: "Approvals", icon: UserCheck },
  { to: "/society/verifications", label: "Verifications", icon: ShieldCheck },
  { to: "/society/announcements", label: "Announcements", icon: Megaphone },
  { to: "/society/polls", label: "Polls", icon: Vote },
  { to: "/society/bylaws", label: "Documents", icon: FileText },
  { to: "/society/contacts", label: "Contacts", icon: PhoneIcon },
  { to: "/society/digest", label: "AI Digest", icon: Sparkles },
];

const FINANCE: Tile[] = [
  { to: "/society/billing", label: "Billing", icon: Receipt },
  { to: "/society/maintenance", label: "Maintenance", icon: BookOpen },
  { to: "/society/accounts", label: "Accounts", icon: Wallet },
  { to: "/society/reports", label: "Reports", icon: BarChart3 },
  { to: "/society/expenses", label: "Expenses", icon: TrendingDown },
  { to: "/society/ledger", label: "Ledger", icon: ClipboardList },
  { to: "/society/payouts", label: "Payouts", icon: Building2 },
];

const OTHER: Tile[] = [
  { to: "/society/business-profile", label: "Business profile", icon: Building2 },
  { to: "/society/team", label: "Team & roles", icon: Users },
  { to: "/society/custom-fields", label: "Custom fields", icon: Settings2 },
  { to: "/society/setup", label: "Setup wizard", icon: Activity },
  { to: "/society/leaderboard", label: "Leaderboard", icon: MessageSquare },
  { to: "/society/explorer", label: "Explorer", icon: KeyRound },
  { to: "/support", label: "Help & support", icon: LifeBuoy },
];

function TileGrid({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 sm:gap-3">
      {tiles.map((t) => (
        <Link
          key={t.to}
          to={t.to as any}
          className="group rounded-2xl border bg-card hover:bg-primary/5 hover:border-primary/40 transition p-3 flex flex-col items-center justify-center gap-1.5 text-center min-h-[92px]"
        >
          <div className="h-9 w-9 rounded-xl bg-primary/10 grid place-items-center">
            <t.icon className="h-4 w-4 text-primary" />
          </div>
          <span className="text-[11px] sm:text-xs font-medium leading-tight">{t.label}</span>
        </Link>
      ))}
    </div>
  );
}

function Section({ title, tiles }: { title: string; tiles: Tile[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <Card className="rounded-2xl">
        <CardContent className="p-3 sm:p-4">
          <TileGrid tiles={tiles} />
        </CardContent>
      </Card>
    </section>
  );
}

function MoreDirectory() {
  return (
    <PageShell>
      <PageHeader
        title="More"
        description="All society management modules organised by area."
      />
      <div className="space-y-6">
        <Section title="Management" tiles={MANAGEMENT} />
        <Section title="Finance" tiles={FINANCE} />
        <Section title="Other" tiles={OTHER} />
      </div>
    </PageShell>
  );
}
