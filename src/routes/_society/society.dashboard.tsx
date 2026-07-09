import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, Wallet, AlertTriangle, Megaphone, Receipt, UserCheck, Users,
  UsersRound, KeyRound, Copy, TrendingUp, Sparkles, ArrowUpRight, Home,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { useSocietyId } from "@/hooks/useSocietyId";
import { SocietyFinanceChart } from "@/components/shared/SocietyFinanceChart";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { ListCard, ListCardGroup } from "@/components/shared/ListCard";

export const Route = createFileRoute("/_society/society/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — SocioHub" },
      { name: "description", content: "Society admin overview." },
    ],
  }),
  component: SocietyDashboard,
});

const INR = new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 0,
});

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const cls =
    s === "paid" || s === "success"
      ? "bg-success/10 text-success"
      : s === "failed"
      ? "bg-destructive/10 text-destructive"
      : "bg-warning/10 text-warning";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${cls}`}>
      {status}
    </span>
  );
}

function SocietyDashboard() {
  const { profile } = useAuth();
  const { societyId } = useSocietyId();

  const { data } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-dashboard-v2", societyId],
    queryFn: async () => {
      const sid = societyId!;
      const monthStart = new Date();
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const [
        { data: soc },
        inviteRes,
        summaryRes,
        { count: flatCount },
        { count: pendingApprovals },
        { count: visitorsToday },
        { count: unpaidBills },
        recentPayments,
        recentPosts,
        recentApprovals,
      ] = await Promise.all([
        supabase.from("societies").select("name").eq("id", sid).maybeSingle(),
        (supabase as any).rpc("get_society_invite_code", { _society_id: sid }),
        supabase.rpc("society_maintenance_summary", { _society_id: sid }),
        supabase.from("flats").select("id", { count: "exact", head: true }).eq("society_id", sid),
        supabase.from("join_requests").select("id", { count: "exact", head: true })
          .eq("society_id", sid).eq("status", "pending"),
        supabase.from("visitors").select("id", { count: "exact", head: true })
          .eq("society_id", sid).gte("created_at", today.toISOString()),
        supabase.from("bills").select("id", { count: "exact", head: true })
          .eq("society_id", sid).in("status", ["unpaid", "overdue"]),
        supabase.from("payments").select("id, amount, status, paid_at, created_at")
          .eq("society_id", sid).order("created_at", { ascending: false }).limit(5),
        supabase.from("posts").select("id, body, created_at")
          .eq("society_id", sid).order("created_at", { ascending: false }).limit(3),
        supabase.from("join_requests").select("id, full_name, created_at")
          .eq("society_id", sid).eq("status", "approved")
          .order("created_at", { ascending: false }).limit(3),
      ]);

      const summary = Array.isArray(summaryRes.data) ? summaryRes.data[0] : null;
      const collectedThisMonth = (recentPayments.data ?? [])
        .filter((p: any) => p.status === "success" && p.paid_at && new Date(p.paid_at) >= monthStart)
        .reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);

      return {
        societyName: (soc as any)?.name ?? "",
        inviteCode: (inviteRes.data as string) ?? null,
        totalFlats: flatCount ?? 0,
        pendingApprovals: pendingApprovals ?? 0,
        visitorsToday: visitorsToday ?? 0,
        unpaidBills: unpaidBills ?? 0,
        collectedThisMonth,
        outstandingAmount: Number(summary?.outstanding_amount ?? 0),
        collectionPercent: Number(summary?.collection_percent ?? 0),
        paidHouses: Number(summary?.paid_periods ?? 0),
        pendingHouses: Number(summary?.pending_periods ?? 0),
        recentPayments: recentPayments.data ?? [],
        recentPosts: recentPosts.data ?? [],
        recentApprovals: recentApprovals.data ?? [],
      };
    },
  });

  const activity = useMemo(() => {
    if (!data) return [];
    const items: Array<{ id: string; icon: any; text: string; when: string }> = [];
    for (const p of data.recentPayments.slice(0, 3)) {
      const when = (p as any).paid_at ?? (p as any).created_at;
      items.push({
        id: `pay-${p.id}`,
        icon: Wallet,
        text: `Payment ${p.status} · ${INR.format(Number(p.amount ?? 0))}`,
        when,
      });
    }
    for (const a of data.recentApprovals) {
      items.push({
        id: `apr-${a.id}`,
        icon: UserCheck,
        text: `Resident approved · ${a.full_name ?? "Unnamed"}`,
        when: a.created_at,
      });
    }
    for (const post of data.recentPosts) {
      const body = String((post as any).body ?? "").replace(/\s+/g, " ").trim();
      items.push({
        id: `post-${post.id}`,
        icon: Megaphone,
        text: `Notice · ${body.slice(0, 60)}${body.length > 60 ? "…" : ""}`,
        when: post.created_at,
      });
    }
    return items
      .filter((i) => !!i.when)
      .sort((a, b) => new Date(b.when).getTime() - new Date(a.when).getTime())
      .slice(0, 6);
  }, [data]);

  function copyInvite() {
    if (!data?.inviteCode) return;
    navigator.clipboard.writeText(data.inviteCode);
    toast.success("Invite code copied");
  }

  const displayName = profile?.full_name?.split(" ")[0] ?? "there";

  const outstandingLabel = data && data.outstandingAmount > 0 ? INR.format(data.outstandingAmount) : "₹0";
  const collectedLabel = data ? INR.format(data.collectedThisMonth) : "₹0";

  return (
    <div className="pb-24">
      <MobileHero
        eyebrow={`${greeting()}, ${displayName}`}
        title={data?.societyName || "Your society"}
        subtitle="Your society at a glance — collections, approvals, and today's visitor flow."
        icon={Home}
        variant="teal"
        action={
          <Button asChild size="sm" className="rounded-xl h-9 bg-white/15 hover:bg-white/25 text-white border-0">
            <Link to="/society/residents"><Users className="h-4 w-4 mr-1.5" /> Add</Link>
          </Button>
        }
        stats={
          <StatPillRow>
            <StatPill label="Collected (mo)" value={collectedLabel} icon={Wallet} />
            <StatPill label="Outstanding" value={outstandingLabel} icon={TrendingUp} />
            <StatPill label="Houses" value={data?.totalFlats ?? "—"} icon={Building2} />
            <StatPill label="Collection" value={data?.collectionPercent ? `${Math.round(data.collectionPercent)}%` : "—"} icon={Sparkles} />
          </StatPillRow>
        }
      />

      <div className="px-4 pt-4 space-y-4 max-w-7xl mx-auto md:px-8">

      {/* Invite code (only if present) */}
      {data?.inviteCode && (
        <Card className="rounded-2xl border-primary/20 bg-primary/5">
          <CardContent className="p-4 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-primary/10 grid place-items-center">
              <KeyRound className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Invite code</p>
              <p className="text-lg font-bold tracking-[0.25em] font-mono truncate">{data.inviteCode}</p>
            </div>
            <Button onClick={copyInvite} variant="outline" size="sm" className="rounded-xl shrink-0">
              <Copy className="h-3.5 w-3.5 mr-1" /> Copy
            </Button>
          </CardContent>
        </Card>
      )}



      {/* Primary action tiles — highest urgency */}
      <section className="grid grid-cols-3 gap-2 sm:gap-3 mb-5">
        <PrimaryTile
          to="/society/billing"
          icon={AlertTriangle}
          tone="warning"
          label="Pending payments"
          value={data ? String(data.unpaidBills) : "—"}
        />
        <PrimaryTile
          to="/society/approvals"
          icon={UserCheck}
          tone="primary"
          label="Approvals"
          value={data ? String(data.pendingApprovals) : "—"}
        />
        <PrimaryTile
          to="/society/visitors"
          icon={UsersRound}
          tone="info"
          label="Visitors today"
          value={data ? String(data.visitorsToday) : "—"}
        />
      </section>

      {/* Overview cards — hide any without data */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {data && data.totalFlats > 0 && (
          <OverviewCard icon={Building2} label="Total houses" value={String(data.totalFlats)} />
        )}
        {data && data.collectedThisMonth > 0 && (
          <OverviewCard
            icon={Wallet}
            tone="success"
            label="Collected this month"
            value={INR.format(data.collectedThisMonth)}
          />
        )}
        {data && data.outstandingAmount > 0 && (
          <OverviewCard
            icon={TrendingUp}
            tone="destructive"
            label="Outstanding"
            value={INR.format(data.outstandingAmount)}
          />
        )}
        {data && data.collectionPercent > 0 && (
          <OverviewCard
            icon={Sparkles}
            tone="primary"
            label="Collection"
            value={`${Math.round(data.collectionPercent)}%`}
          />
        )}
      </section>

      {/* Finance chart */}
      {societyId && (
        <section className="mb-6">
          <SocietyFinanceChart societyId={societyId} />
        </section>
      )}

      {/* Quick actions */}
      <section className="mb-6">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
          Quick actions
        </h2>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {[
            { to: "/society/billing" as const, label: "New bill", icon: Receipt },
            { to: "/society/residents" as const, label: "Residents", icon: Users },
            { to: "/society/approvals" as const, label: "Approvals", icon: UserCheck },
            { to: "/society/visitors" as const, label: "Visitors", icon: UsersRound },
            { to: "/society/announcements" as const, label: "Notice", icon: Megaphone },
            { to: "/society/expenses" as const, label: "Expenses", icon: Wallet },
          ].map((a) => (
            <Link
              key={a.to}
              to={a.to}
              className="rounded-2xl border bg-card hover:bg-primary/5 hover:border-primary/40 transition p-3 flex flex-col items-center gap-1.5 text-center min-h-[76px] justify-center"
            >
              <a.icon className="h-5 w-5 text-primary" />
              <span className="text-[11px] font-medium leading-tight">{a.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Recent activity */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Recent activity
          </h2>
          <Link
            to="/society/ledger"
            className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
          >
            View all <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        <Card className="rounded-2xl">
          <CardContent className="p-0">
            {activity.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No recent activity yet
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {activity.map((it) => (
                  <li key={it.id} className="p-4 flex items-start gap-3">
                    <div className="h-9 w-9 shrink-0 rounded-xl bg-primary/10 grid place-items-center">
                      <it.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{it.text}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(it.when).toLocaleString()}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Empty-state onboarding nudge only when society is truly empty */}
      {data && data.totalFlats === 0 && (
        <Card className="rounded-2xl mt-6 border-dashed">
          <CardContent className="p-6 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="font-medium">Your society is ready to be set up</p>
            <p className="text-sm text-muted-foreground mt-1">
              Start by adding blocks, floors, and flats.
            </p>
            <Button asChild className="mt-4 rounded-xl">
              <Link to="/society/blocks">Add your first block</Link>
            </Button>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}

function PrimaryTile({
  to, icon: Icon, tone, label, value,
}: {
  to: string; icon: any; tone: "primary" | "warning" | "info"; label: string; value: string;
}) {
  const toneClass =
    tone === "warning" ? "bg-warning/10 text-warning"
    : tone === "info" ? "bg-info/10 text-info"
    : "bg-primary/10 text-primary";
  return (
    <Link
      to={to as any}
      className="rounded-2xl border bg-card p-3 sm:p-4 flex flex-col gap-2 hover:border-primary/40 hover:shadow-sm transition"
    >
      <div className={`h-9 w-9 rounded-xl grid place-items-center ${toneClass}`}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground leading-tight">{label}</p>
        <p className="text-xl sm:text-2xl font-semibold tabular-nums truncate">{value}</p>
      </div>
    </Link>
  );
}

function OverviewCard({
  icon: Icon, tone = "muted", label, value,
}: {
  icon: any; tone?: "muted" | "success" | "primary" | "destructive"; label: string; value: string;
}) {
  const toneClass =
    tone === "success" ? "bg-success/10 text-success"
    : tone === "destructive" ? "bg-destructive/10 text-destructive"
    : tone === "primary" ? "bg-primary/10 text-primary"
    : "bg-muted text-muted-foreground";
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-3 sm:p-4 flex items-center gap-3">
        <div className={`h-9 w-9 shrink-0 rounded-xl grid place-items-center ${toneClass}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">
            {label}
          </p>
          <p className="text-base sm:text-lg font-semibold tabular-nums truncate">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// StatusPill exported for reuse; keep to avoid unused-import warnings if referenced elsewhere.
export { StatusPill };
