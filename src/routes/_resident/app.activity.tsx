import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Calculator, Vote, Bell, FileText, ChevronRight, Megaphone,
  MessageCircle, ShieldCheck, Trophy,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_resident/app/activity")({
  head: () => ({ meta: [{ title: "Activity — SocioHub" }] }),
  component: ActivityScreen,
});

const tools = [
  { to: "/app/feed", title: "Community Feed", desc: "Posts, comments & weekly AI digest", icon: MessageCircle, accent: "bg-primary/10 text-primary", badge: "New" },
  { to: "/app/trust", title: "Financial Trust", desc: "Live society income & expenses", icon: ShieldCheck, accent: "bg-success/10 text-success" },
  { to: "/app/achievements", title: "Achievements & Leaderboard", desc: "Earn points for being a great neighbor", icon: Trophy, accent: "bg-amber-500/10 text-amber-600" },
  { to: "/app/ledger", title: "Accounting", desc: "Society ledgers, expenses, audits", icon: Calculator, accent: "bg-primary/10 text-primary" },
  { to: "/app/polls", title: "Elections / Polls", desc: "Vote on community decisions", icon: Vote, accent: "bg-success/10 text-success" },
] as const;

const recent = [
  { title: "AGM minutes published", time: "2h ago", icon: FileText },
  { title: "Lift maintenance completed", time: "Yesterday", icon: Bell },
  { title: "New notice from committee", time: "2 days ago", icon: Megaphone },
];

function ActivityScreen() {
  return (
    <div className="px-5 py-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
        <p className="text-sm text-muted-foreground">Community, trust & governance</p>
      </header>

      <section className="space-y-3">
        {tools.map((t) => {
          const Icon = t.icon;
          const badge = "badge" in t ? (t as { badge?: string }).badge : undefined;
          return (
            <Link key={t.to} to={t.to} className="block active:scale-[0.99] transition-transform">
              <Card className="rounded-2xl">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className={`h-12 w-12 rounded-2xl grid place-items-center ${t.accent}`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold">{t.title}</p>
                      {badge && (
                        <Badge className="rounded-full text-[10px] bg-primary text-primary-foreground">
                          {badge}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{t.desc}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </section>

      <section>
        <h2 className="px-1 mb-3 text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Recent
        </h2>
        <Card className="rounded-2xl">
          <CardContent className="p-2">
            <ul className="divide-y divide-border">
              {recent.map(({ title, time, icon: Icon }) => (
                <li key={title} className="flex items-center gap-3 p-3">
                  <span className="h-9 w-9 rounded-xl bg-secondary grid place-items-center text-primary">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{title}</p>
                    <p className="text-xs text-muted-foreground">{time}</p>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
