import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Calculator, Vote, Bell, FileText, ChevronRight, Megaphone,
  MessageCircle, ShieldCheck, Trophy, Receipt, LifeBuoy,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { formatDistanceToNow } from "date-fns";

export const Route = createFileRoute("/_resident/app/activity")({
  head: () => ({ meta: [{ title: "Activity — SociyoHub" }] }),
  component: ActivityScreen,
});

const tools = [
  { to: "/app/feed", title: "Community Feed", desc: "Posts, comments & weekly AI digest", icon: MessageCircle, accent: "bg-primary/10 text-primary", badge: "New" },
  { to: "/app/notifications", title: "Notifications", desc: "All your society activity in one feed", icon: Bell, accent: "bg-primary/10 text-primary" },
  { to: "/app/trust", title: "Financial Trust", desc: "Live society income & expenses", icon: ShieldCheck, accent: "bg-success/10 text-success" },
  { to: "/app/achievements", title: "Achievements & Leaderboard", desc: "Earn points for being a great neighbor", icon: Trophy, accent: "bg-amber-500/10 text-amber-600" },
  { to: "/app/ledger", title: "Accounting", desc: "Society ledgers, expenses, audits", icon: Calculator, accent: "bg-primary/10 text-primary" },
  { to: "/app/polls", title: "Elections / Polls", desc: "Vote on community decisions", icon: Vote, accent: "bg-success/10 text-success" },
] as const;

const ACTION_LABELS: Record<string, { label: string; icon: any; to: string }> = {
  payment_captured: { label: "Payment received", icon: Receipt, to: "/app/bills" },
  bill_generated: { label: "New bill generated", icon: Receipt, to: "/app/bills" },
  maintenance_reminder_sent: { label: "Maintenance reminder", icon: Receipt, to: "/app/dues" },
  visitor_entered: { label: "Visitor entered", icon: ShieldCheck, to: "/app/visitors" },
  visitor_exited: { label: "Visitor exited", icon: ShieldCheck, to: "/app/visitors" },
  notice_published: { label: "New notice", icon: Megaphone, to: "/app/comm" },
  complaint_updated: { label: "Complaint updated", icon: LifeBuoy, to: "/app/helpdesk" },
  document_uploaded: { label: "Document uploaded", icon: FileText, to: "/app/bylaws" },
};

function ActivityScreen() {
  const { profile } = useAuth();
  const societyId = profile?.society_id;

  const { data: recent = [] } = useQuery({
    enabled: !!societyId,
    queryKey: ["activity-recent", societyId],
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_log")
        .select("id, action, created_at")
        .eq("society_id", societyId!)
        .in("action", Object.keys(ACTION_LABELS))
        .order("created_at", { ascending: false })
        .limit(6);
      return data ?? [];
    },
  });

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
        <div className="flex items-center justify-between px-1 mb-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Recent</h2>
          <Link to="/app/notifications" className="text-xs text-primary font-medium">View all</Link>
        </div>
        <Card className="rounded-2xl">
          <CardContent className="p-2">
            {recent.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">No recent activity yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((r: any) => {
                  const meta = ACTION_LABELS[r.action] ?? { label: r.action, icon: Bell, to: "/app/notifications" };
                  const Icon = meta.icon;
                  return (
                    <li key={r.id}>
                      <Link to={meta.to} className="flex items-center gap-3 p-3 hover:bg-accent/40 rounded-xl transition-colors">
                        <span className="h-9 w-9 rounded-xl bg-secondary grid place-items-center text-primary shrink-0">
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{meta.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
