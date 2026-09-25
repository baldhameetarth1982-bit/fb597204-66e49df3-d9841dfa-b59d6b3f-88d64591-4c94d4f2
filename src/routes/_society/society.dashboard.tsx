import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Building2, Wallet, AlertTriangle, Megaphone, Receipt, UserCheck, Users,
  UsersRound, KeyRound, Copy, TrendingUp, Sparkles, ArrowUpRight, Home,
  LifeBuoy, BadgeCheck, ChevronRight, FileText, CheckCircle2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/system/ErrorState";
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
import { SetupChecklistCard } from "@/components/society/SetupChecklistCard";

export const Route = createFileRoute("/_society/society/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — SociyoHub" },
      { name: "description", content: "Society admin overview: pending actions, collections, requests and visitors." },
      { property: "og:title", content: "Committee dashboard — SociyoHub" },
      { property: "og:description", content: "What needs your attention today in your society." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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

  const { data, isError, isLoading, refetch, isFetching } = useQuery({
    enabled: !!societyId,
    staleTime: 30_000,
    queryKey: ["society-dashboard-v3", societyId],
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
        monthPayments,
        { count: paymentsToVerify },
        helpdeskRes,
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
        // Collected this month = confirmed payments only, from the server.
        supabase.from("payments").select("amount")
          .eq("society_id", sid).eq("status", "success").gte("paid_at", monthStart.toISOString()).limit(5000),
        supabase.from("payments").select("id", { count: "exact", head: true })
          .eq("society_id", sid).eq("status", "pending"),
        supabase.rpc("helpdesk_admin_queue", { _limit: 300 }),
      ]);
      if (summaryRes.error && monthPayments.error) throw new Error("dashboard_unavailable");

      const summary = Array.isArray(summaryRes.data) ? summaryRes.data[0] : null;
      const collectedThisMonth = monthPayments.error ? null : (monthPayments.data ?? [])
        .reduce((s: number, p: any) => s + Number(p.amount ?? 0), 0);
      const tickets = (helpdeskRes.data ?? []) as Array<{ status: string }>;
      const openRequests = helpdeskRes.error ? null : tickets.filter((t) => t.status === "open" || t.status === "in_progress").length;
      const ticketApprovals = helpdeskRes.error ? null : tickets.filter((t) => t.status === "awaiting_approval").length;

      return {
        societyName: (soc as any)?.name ?? "",
        inviteCode: (inviteRes.data as string) ?? null,
        totalFlats: flatCount ?? 0,
        pendingApprovals: pendingApprovals ?? 0,
        visitorsToday: visitorsToday ?? 0,
        unpaidBills: unpaidBills ?? 0,
        collectedThisMonth,
        paymentsToVerify: paymentsToVerify ?? 0,
        openRequests,
        ticketApprovals,
        summaryOk: !summaryRes.error,
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
    const items: Array<{ id: string; icon: any; text: string; when: string; to: string }> = [];
    for (const p of data.recentPayments.slice(0, 3)) {
      const when = (p as any).paid_at ?? (p as any).created_at;
      items.push({
        id: `pay-${p.id}`,
        icon: Wallet,
        to: "/society/payments",
        text: `Payment ${p.status} · ${INR.format(Number(p.amount ?? 0))}`,
        when,
      });
    }
    for (const a of data.recentApprovals) {
      items.push({
        id: `apr-${a.id}`,
        icon: UserCheck,
        to: "/society/residents",
        text: `Resident approved · ${a.full_name ?? "Unnamed"}`,
        when: a.created_at,
      });
    }
    for (const post of data.recentPosts) {
      const body = String((post as any).body ?? "").replace(/\s+/g, " ").trim();
      items.push({
        id: `post-${post.id}`,
        icon: Megaphone,
        to: "/society/communication",
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

  // Never show a fake ₹0 when data is missing or failed.
  const outstandingLabel = data?.summaryOk ? INR.format(data.outstandingAmount) : "—";
  const collectedLabel = data && data.collectedThisMonth !== null ? INR.format(data.collectedThisMonth) : "—";
  const attention = data ? [
    { to: "/society/payments", icon: BadgeCheck, tone: "warning" as const, label: "Payments to verify", hint: "Cash & bank transfers awaiting a check", count: data.paymentsToVerify },
    { to: "/society/approvals", icon: UserCheck, tone: "primary" as const, label: "Residents to approve", hint: "Join requests waiting", count: data.pendingApprovals },
    { to: "/society/helpdesk", icon: LifeBuoy, tone: "info" as const, label: "Open requests", hint: "Complaints & repairs", count: data.openRequests },
    { to: "/society/helpdesk", icon: FileText, tone: "primary" as const, label: "Requests needing approval", hint: "Renovation, events, NOC", count: data.ticketApprovals },
    { to: "/society/billing", icon: AlertTriangle, tone: "warning" as const, label: "Unpaid bills", hint: "Unpaid or overdue", count: data.unpaidBills },
  ].filter((a) => (a.count ?? 0) > 0) : [];

  const collectionLabel = data?.summaryOk ? `${Math.round(data.collectionPercent)}%` : "—";

  return (
    <div className="container-page py-5 md:py-8">
      {/* Page header */}
      <header className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{greeting()}, {displayName}</p>
          <h1 className="mt-0.5 truncate text-2xl font-semibold tracking-tight md:text-[28px] md:leading-[34px]">
            {data?.societyName || (isLoading ? <Skeleton className="h-8 w-56" /> : "Your society")}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" className="h-11">
            <Link to="/society/residents"><Users className="mr-1.5 h-4 w-4" aria-hidden /> Residents</Link>
          </Button>
          <Button asChild className="h-11">
            <Link to="/society/billing"><Receipt className="mr-1.5 h-4 w-4" aria-hidden /> Billing</Link>
          </Button>
        </div>
      </header>

      {/* Key money figures — one strip, not three hero cards */}
      <dl aria-busy={isLoading} className="mt-5 grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-4 [&>div]:border-border [&>div:nth-child(odd)]:border-r lg:[&>div]:border-r lg:[&>div:last-child]:border-r-0 [&>div:nth-child(-n+2)]:border-b lg:[&>div]:border-b-0">
        {[
          { k: "Collected this month", v: collectedLabel, to: "/society/payments" },
          { k: "Outstanding", v: outstandingLabel, to: "/society/billing" },
          { k: "Collection rate", v: collectionLabel, to: "/society/billing" },
          { k: "Visitors today", v: data ? String(data.visitorsToday) : "—", to: "/society/visitors" },
        ].map((m) => (
          <div key={m.k}>
            <Link to={m.to as "/society/billing"} className="block px-4 py-3.5 hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/60 md:px-5 md:py-4">
              <dt className="text-xs text-muted-foreground">{m.k}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight md:text-2xl">
                {isLoading ? <Skeleton className="h-7 w-20" /> : m.v}
              </dd>
            </Link>
          </div>
        ))}
      </dl>

      <div className="mt-6 grid gap-6 lg:grid-cols-12">
        {/* Primary column */}
        <div className="min-w-0 space-y-6 lg:col-span-8">
          {isError && !data ? (
            <Card className="rounded-xl">
              <ErrorState
                title="Dashboard didn't load"
                description="We couldn't load your society's latest numbers. Nothing has changed — try again."
                onRetry={() => refetch()}
                showSupport={false}
              />
            </Card>
          ) : (
            <section aria-labelledby="attention-h" aria-busy={isLoading}>
              <div className="mb-2 flex items-center justify-between">
                <h2 id="attention-h" className="text-sm font-semibold">Needs your attention</h2>
                {isFetching && data && <span className="text-xs text-muted-foreground" role="status">Updating…</span>}
              </div>
              {!data ? (
                <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[64px] rounded-xl" />)}</div>
              ) : attention.length === 0 ? (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-success/10 text-success"><CheckCircle2 className="h-5 w-5" /></div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">You're all caught up</p>
                    <p className="text-xs text-muted-foreground">No payments, approvals or requests are waiting.</p>
                  </div>
                </div>
              ) : (
                <ul className="divide-y overflow-hidden rounded-xl border bg-card">
                  {attention.map((a) => (
                    <li key={a.label}>
                      <AttentionRow {...a} count={a.count ?? 0} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {societyId && (
            <section aria-label="Society setup checklist">
              <SetupChecklistCard societyId={societyId} />
            </section>
          )}

          {societyId && (
            <section>
              <SocietyFinanceChart societyId={societyId} />
            </section>
          )}
        </div>

        {/* Secondary column */}
        <aside className="min-w-0 space-y-6 lg:col-span-4">
          <section aria-labelledby="shortcuts-h">
            <h2 id="shortcuts-h" className="mb-2 text-sm font-semibold">Shortcuts</h2>
            <nav className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card">
              {[
                { to: "/society/payments" as const, label: "Payments", icon: BadgeCheck },
                { to: "/society/approvals" as const, label: "Approvals", icon: UserCheck },
                { to: "/society/helpdesk" as const, label: "Helpdesk", icon: LifeBuoy },
                { to: "/society/announcements" as const, label: "Notice", icon: Megaphone },
                { to: "/society/income" as const, label: "Income", icon: Wallet },
                { to: "/society/expenses" as const, label: "Expenses", icon: TrendingUp },
                { to: "/society/knowledge" as const, label: "Docs & FAQs", icon: FileText },
                { to: "/society/flats" as const, label: `Houses${data ? ` · ${data.totalFlats}` : ""}`, icon: Building2 },
              ].map((a, i) => (
                <Link
                  key={a.to}
                  to={a.to}
                  className={`flex min-h-[52px] items-center gap-2.5 border-border px-3.5 text-sm font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/60 ${i % 2 === 0 ? "border-r" : ""} ${i < 6 ? "border-b" : ""}`}
                >
                  <a.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  <span className="truncate">{a.label}</span>
                </Link>
              ))}
            </nav>
          </section>

          {data?.inviteCode && (
            <section className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Invite code for residents</p>
                <p className="mt-0.5 truncate font-mono text-lg font-semibold tracking-[0.2em]">{data.inviteCode}</p>
              </div>
              <Button onClick={copyInvite} variant="outline" className="h-11 shrink-0">
                <Copy className="mr-1.5 h-4 w-4" aria-hidden /> Copy
              </Button>
            </section>
          )}

      {/* Recent activity */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">
            Recent activity
          </h2>
          <Link
            to="/society/ledger"
            className="inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline"
          >
            View all <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
        <Card className="rounded-xl">
          <CardContent className="p-0">
            {activity.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {data ? "No recent activity yet" : "Loading activity…"}
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {activity.map((it) => (
                  <li key={it.id}>
                   <Link to={it.to as "/society/payments"} className="p-4 flex items-start gap-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/60">
                    <div className="h-9 w-9 shrink-0 rounded-xl bg-primary/10 grid place-items-center">
                      <it.icon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm truncate">{it.text}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {new Date(it.when).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 self-center" aria-hidden />
                   </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Empty-state onboarding nudge only when society is truly empty */}
      {data && data.totalFlats === 0 && (
        <Card className="rounded-xl mt-6 border-dashed">
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
        </aside>
      </div>
    </div>
  );
}

function AttentionRow({ to, icon: Icon, tone, label, hint, count }: {
  to: string; icon: any; tone: "primary" | "warning" | "info"; label: string; hint: string; count: number;
}) {
  const toneClass = tone === "warning" ? "bg-warning/10 text-warning" : tone === "info" ? "bg-info/10 text-info" : "bg-primary/10 text-primary";
  return (
    <Link to={to as "/society/payments"} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 p-3.5 min-h-[68px] hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/60">
      <div className={`h-10 w-10 rounded-xl grid place-items-center ${toneClass}`}><Icon className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="text-sm font-semibold truncate">{label}</p>
        <p className="text-xs text-muted-foreground truncate">{hint}</p>
      </div>
      <span className="min-w-8 h-7 px-2 rounded-full bg-foreground text-background text-sm font-semibold tabular-nums grid place-items-center">{count > 99 ? "99+" : count}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
    </Link>
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
