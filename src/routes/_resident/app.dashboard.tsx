import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Bell, ArrowRight, Receipt, ShieldCheck, ShieldAlert, Inbox,
  Megaphone, LifeBuoy, FileText, Bot, ChevronRight, CheckCircle2, RotateCcw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { AdBanner } from "@/components/shared/AdBanner";
import { supabase } from "@/integrations/supabase/client";
import { useResidentNotices } from "@/hooks/useResidentNotices";

export const Route = createFileRoute("/_resident/app/dashboard")({
  head: () => ({
    meta: [
      { title: "Home — SociyoHub" },
      { name: "description", content: "Your maintenance dues, requests, visitors and society notices in one place." },
      { property: "og:title", content: "Home — SociyoHub" },
      { property: "og:description", content: "Your dues, requests and society updates at a glance." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResidentDashboard,
});

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const DATE = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const ACTIVE_TICKETS = ["open", "in_progress", "awaiting_approval", "resolved"];

function ResidentDashboard() {
  const { profile, user } = useAuth();
  const firstName = profile?.full_name?.split(" ")[0] ?? "there";
  const societyId = profile?.society_id;
  const userId = profile?.id;

  // Everything below is RLS-scoped to this resident's own homes/tickets/visitors.
  const home = useQuery({
    queryKey: ["resident-home", userId, societyId],
    enabled: !!societyId && !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      const { data: flatRows, error: fErr } = await supabase.from("flat_residents").select("flat_id").eq("user_id", userId!);
      if (fErr) throw fErr;
      const flatIds = (flatRows ?? []).map((r: any) => r.flat_id).filter(Boolean);
      const [bills, tickets, visitors] = await Promise.all([
        flatIds.length
          ? supabase.from("bills").select("id, amount, total_payable, due_date, period_label, status")
              .eq("society_id", societyId!).in("flat_id", flatIds).in("status", ["unpaid", "overdue"])
              .order("due_date", { ascending: true }).limit(24)
          : Promise.resolve({ data: [] as any[], error: null }),
        supabase.from("support_tickets").select("id, status").eq("user_id", userId!).in("status", ACTIVE_TICKETS).limit(100),
        supabase.from("visitors").select("id, status, expected_at, entry_at, created_at")
          .gte("created_at", dayStart.toISOString()).limit(100),
      ]);
      if (bills.error) throw bills.error;
      const due = (bills.data ?? []) as any[];
      return {
        hasHome: flatIds.length > 0,
        dueTotal: due.reduce((s, b) => s + Number(b.total_payable ?? b.amount ?? 0), 0),
        dueCount: due.length,
        overdue: due.some((b) => b.status === "overdue"),
        nextBill: due[0] ? { id: due[0].id as string, label: (due[0].period_label as string) ?? "Maintenance", due_date: due[0].due_date as string | null } : null,
        openTickets: tickets.error ? null : (tickets.data ?? []).length,
        resolvedToConfirm: tickets.error ? 0 : (tickets.data ?? []).filter((t: any) => t.status === "resolved").length,
        visitorsToday: visitors.error ? null : (visitors.data ?? []).length,
      };
    },
  });
  const notices = useResidentNotices();
  const unread = (notices.data?.notices ?? []).filter((n) => !notices.data?.read.has(n.id));
  const latest = (notices.data?.notices ?? []).slice(0, 3);
  const d = home.data;

  return (
    <div className="px-4 py-5 md:py-8 max-w-3xl mx-auto space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border pb-5">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Welcome back</p>
          <h1 className="mt-0.5 text-2xl md:text-[28px] md:leading-[34px] font-semibold tracking-tight truncate">Hi {firstName}</h1>
        </div>
        <Link
          to="/app/notifications"
          className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border bg-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={unread.length ? `Notifications, ${unread.length} unread notices` : "Notifications"}
        >
          <Bell className="h-5 w-5" />
          {unread.length > 0 && <span className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-background" aria-hidden />}
        </Link>
      </header>

      {/* Dues — the most important thing for a resident. Never shows a fake ₹0. */}
      <Card className="rounded-xl bg-primary text-primary-foreground border-0 overflow-hidden">
        <CardContent className="p-5 md:p-7" aria-busy={home.isLoading}>
          {home.isError && !d ? (
            <div role="alert" className="space-y-3">
              <p className="font-semibold">We couldn't load your dues</p>
              <p className="text-sm opacity-80">Your bills are safe — this is only a loading problem.</p>
              <Button onClick={() => home.refetch()} className="h-11 rounded-xl bg-background text-primary hover:bg-background/90">
                <RotateCcw className="h-4 w-4 mr-2" /> Try again
              </Button>
            </div>
          ) : !d ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-24 bg-primary-foreground/20" />
              <Skeleton className="h-10 w-40 bg-primary-foreground/20" />
              <Skeleton className="h-12 w-full bg-primary-foreground/20 rounded-xl" />
            </div>
          ) : !d.hasHome ? (
            <div className="space-y-2">
              <p className="font-semibold">No home linked yet</p>
              <p className="text-sm opacity-80">Once the committee links your flat, your bills will appear here.</p>
            </div>
          ) : d.dueCount === 0 ? (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-9 w-9 shrink-0 opacity-90" />
              <div className="min-w-0">
                <p className="text-lg font-semibold">No dues right now</p>
                <p className="text-sm opacity-80">You're all caught up.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm opacity-80">Amount due</p>
                {d.overdue && <span className="rounded-full bg-destructive text-destructive-foreground px-2.5 py-0.5 text-xs font-semibold">Overdue</span>}
              </div>
              <p className="mt-1 text-4xl md:text-5xl font-semibold tabular-nums break-all">{INR.format(d.dueTotal)}</p>
              <p className="mt-1 text-sm opacity-80">
                {d.dueCount > 1 ? `${d.dueCount} bills · ` : ""}
                {d.nextBill?.label}{d.nextBill?.due_date ? ` · due ${DATE(d.nextBill.due_date)}` : ""}
              </p>
              <Button asChild size="lg" className="mt-5 w-full md:w-auto h-12 rounded-xl bg-background text-primary hover:bg-background/90 font-semibold">
                {d.dueCount === 1 && d.nextBill
                  ? <Link to="/app/bills/$id" params={{ id: d.nextBill.id }}><Receipt className="h-4 w-4 mr-2" /> View bill <ArrowRight className="h-4 w-4 ml-1" /></Link>
                  : <Link to="/app/bills"><Receipt className="h-4 w-4 mr-2" /> View bills <ArrowRight className="h-4 w-4 ml-1" /></Link>}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Your activity */}
      <section aria-labelledby="activity-h">
        <h2 id="activity-h" className="mb-2 text-sm font-semibold">Needs your attention</h2>
        <div className="rounded-xl border bg-card divide-y overflow-hidden">
        <HomeRow to="/app/helpdesk" icon={LifeBuoy} label="My requests"
          value={d?.openTickets == null ? "—" : d.openTickets === 0 ? "None open" : `${d.openTickets} open`}
          hint={d?.resolvedToConfirm ? `${d.resolvedToConfirm} resolved — please confirm` : "Complaints & repairs"} />
        <HomeRow to="/app/visitors" icon={ShieldCheck} label="My visitors today"
          value={d?.visitorsToday == null ? "—" : String(d.visitorsToday)} hint="Passes & gate entries" />
        <HomeRow to="/app/notices" icon={Megaphone} label="Notices"
          value={notices.isError ? "—" : unread.length ? `${unread.length} new` : "Up to date"} hint="From your committee" />
        </div>
      </section>

      {/* AI Secretary */}
      <Link to="/app/secretary" className="group flex items-center gap-4 rounded-xl border border-primary/25 bg-primary/5 p-4 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="h-11 w-11 shrink-0 rounded-xl bg-primary text-primary-foreground grid place-items-center"><Bot className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">Ask AI Secretary</span>
          <span className="block text-sm text-muted-foreground truncate">Rules, notices, contacts — answered with sources</span>
        </span>
        <ChevronRight className="h-5 w-5 text-primary shrink-0 transition-transform group-hover:translate-x-0.5" />
      </Link>

      <QuickActions />

      <Card className="rounded-xl">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Recent notices</h2>
            <Link to="/app/notices" className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">View all <ArrowRight className="h-4 w-4 ml-1" /></Link>
          </div>
          {notices.isLoading ? (
            <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : notices.isError ? (
            <p className="py-4 text-sm text-muted-foreground">Notices couldn't load. <button className="text-primary underline min-h-0" onClick={() => notices.refetch()}>Try again</button></p>
          ) : latest.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <Inbox className="h-5 w-5 mx-auto mb-1.5 opacity-60" /> No notices yet
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {latest.map((n) => (
                <li key={n.id}>
                  <Link to="/app/notices" className="flex items-start gap-3 py-3">
                    {!notices.data?.read.has(n.id) && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium line-clamp-1">{n.title || "Notice"}</span>
                      <span className="block text-sm text-muted-foreground line-clamp-1">{String(n.body ?? "").replace(/\s+/g, " ")}</span>
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0 pt-0.5">{DATE(n.publish_at ?? n.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Button asChild variant="outline" className="w-full h-12 rounded-xl border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">
        <Link to="/app/emergency"><ShieldAlert className="h-4 w-4 mr-2" /> Emergency contacts (works offline)</Link>
      </Button>

      <AdBanner />
    </div>
  );
}

function HomeRow({ to, icon: Icon, label, value, hint }: { to: "/app/helpdesk" | "/app/visitors" | "/app/notices"; icon: any; label: string; value: string; hint: string }) {
  return (
    <Link to={to} className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 p-3.5 min-h-[64px] hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/60">
      <span className="h-10 w-10 shrink-0 rounded-lg bg-primary/10 text-primary grid place-items-center"><Icon className="h-5 w-5" /></span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold truncate">{label}</span>
        <span className="block text-xs text-muted-foreground truncate">{hint}</span>
      </span>
      <span className="text-sm font-semibold tabular-nums text-right">{value}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
    </Link>
  );
}

const QUICK_ACTIONS: Array<{ to: string; label: string; icon: any; tone: string }> = [
  { to: "/app/bills", label: "Bills", icon: Receipt, tone: "bg-primary/10 text-primary" },
  { to: "/app/visitors", label: "Visitors", icon: ShieldCheck, tone: "bg-primary/10 text-primary" },
  { to: "/app/helpdesk", label: "Complaints", icon: LifeBuoy, tone: "bg-primary/10 text-primary" },
  { to: "/app/notices", label: "Notices", icon: Megaphone, tone: "bg-primary/10 text-primary" },
  { to: "/app/documents", label: "Documents", icon: FileText, tone: "bg-primary/10 text-primary" },
];

function QuickActions() {
  return (
    <section aria-label="Quick actions">
      <div className="grid grid-cols-4 gap-2">
        {QUICK_ACTIONS.map((a) => {
          const Icon = a.icon;
          return (
            <Link
              key={a.label}
              to={a.to}
              className="flex flex-col items-center gap-1.5 rounded-xl border bg-card p-3 min-h-[76px] justify-center hover:bg-accent/40 active:scale-[0.98] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={`h-10 w-10 rounded-xl grid place-items-center ${a.tone}`}>
                <Icon className="h-5 w-5" />
              </span>
              <span className="text-[11px] font-medium text-center leading-tight">{a.label}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

