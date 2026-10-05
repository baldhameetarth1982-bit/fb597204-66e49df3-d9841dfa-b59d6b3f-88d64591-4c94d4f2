import { useTranslation } from "react-i18next";
import { useLocaleFormat } from "@/lib/i18n-format";
import { PendingRoleInvites } from "@/components/roles/PendingRoleInvites";
import { NeedsAttention } from "@/components/shared/NeedsAttention";
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
import { fetchCurrentHomeId } from "@/components/resident/HomeSwitcher";
import { useResidentNotices } from "@/hooks/useResidentNotices";
import { ResidentBrandBand } from "@/components/branding/ResidentBrandBand";

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
const ACTIVE_TICKETS = ["open", "in_progress", "awaiting_approval", "resolved"];

function ResidentDashboard() {
  const { profile, user } = useAuth();
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const DATE = (v: string) => fmt.date(v, { day: "numeric", month: "short" });
  const firstName = profile?.full_name?.split(" ")[0] ?? t("home.there");
  const societyId = profile?.society_id;
  const userId = profile?.id;

  // Everything below is RLS-scoped to this resident's own homes/tickets/visitors.
  const home = useQuery({
    queryKey: ["resident-home", userId, societyId],
    enabled: !!societyId && !!userId,
    staleTime: 30_000,
    queryFn: async () => {
      const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
      // Selected current home only; former homes and other homes never count here.
      const homeId = await fetchCurrentHomeId();
      const flatIds = homeId ? [homeId] : [];
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
      <PendingRoleInvites />
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-border pb-5">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{t("home.welcome")}</p>
          <h1 className="mt-0.5 text-2xl md:text-[28px] md:leading-[34px] font-semibold tracking-tight truncate">{t("home.hi", { name: firstName })}</h1>
        </div>
        <Link
          to="/app/notifications"
          className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border bg-background hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={unread.length ? t("home.notifUnread", { count: unread.length }) : t("common.notifications")}
        >
          <Bell className="h-5 w-5" />
          {unread.length > 0 && <span className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-destructive ring-2 ring-background" aria-hidden />}
        </Link>
      </header>

      <ResidentBrandBand societyId={societyId} />

      {/* Dues — the most important thing for a resident. Never shows a fake ₹0. */}
      <Card className="rounded-xl bg-primary text-primary-foreground border-0 overflow-hidden">
        <CardContent className="p-5 md:p-7" aria-busy={home.isLoading}>
          {home.isError && !d ? (
            <div role="alert" className="space-y-3">
              <p className="font-semibold">{t("home.duesFailed")}</p>
              <p className="text-sm opacity-80">{t("home.duesSafe")}</p>
              <Button onClick={() => home.refetch()} className="h-11 rounded-xl bg-background text-primary hover:bg-background/90">
                <RotateCcw className="h-4 w-4 mr-2" /> {t("common.tryAgain")}
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
              <p className="font-semibold">{t("home.noHome")}</p>
              <p className="text-sm opacity-80">{t("home.noHomeHint")}</p>
            </div>
          ) : d.dueCount === 0 ? (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-9 w-9 shrink-0 opacity-90" />
              <div className="min-w-0">
                <p className="text-lg font-semibold">{t("home.noDues")}</p>
                <p className="text-sm opacity-80">{t("home.caughtUp")}</p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm opacity-80">{t("home.amountDue")}</p>
                {d.overdue && <span className="rounded-full bg-destructive text-destructive-foreground px-2.5 py-0.5 text-xs font-semibold">{t("bills.overdue")}</span>}
              </div>
              <p className="mt-1 text-4xl md:text-5xl font-semibold tabular-nums break-all">{INR.format(d.dueTotal)}</p>
              <p className="mt-1 text-sm opacity-80">
                {d.dueCount > 1 ? t("home.billsCount", { count: d.dueCount }) : ""}
                {d.nextBill?.label}{d.nextBill?.due_date ? t("home.dueOn", { date: DATE(d.nextBill.due_date) }) : ""}
              </p>
              <Button asChild size="lg" className="mt-5 w-full md:w-auto h-12 rounded-xl bg-background text-primary hover:bg-background/90 font-semibold">
                {d.dueCount === 1 && d.nextBill
                  ? <Link to="/app/bills/$id" params={{ id: d.nextBill.id }}><Receipt className="h-4 w-4 mr-2" /> {t("home.viewBill")} <ArrowRight className="h-4 w-4 ml-1" /></Link>
                  : <Link to="/app/bills"><Receipt className="h-4 w-4 mr-2" /> {t("home.viewBills")} <ArrowRight className="h-4 w-4 ml-1" /></Link>}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Your activity */}
      <section aria-labelledby="activity-h">
        <h2 id="activity-h" className="mb-2 text-sm font-semibold">{t("home.attention")}</h2>
        <div className="rounded-xl border bg-card divide-y overflow-hidden">
        <HomeRow to="/app/helpdesk" icon={LifeBuoy} label={t("home.myRequests")}
          value={d?.openTickets == null ? "—" : d.openTickets === 0 ? t("home.noneOpen") : t("home.open", { count: d.openTickets })}
          hint={d?.resolvedToConfirm ? t("home.resolvedConfirm", { count: d.resolvedToConfirm }) : t("home.complaints")} />
        <HomeRow to="/app/visitors" icon={ShieldCheck} label={t("home.visitorsToday")}
          value={d?.visitorsToday == null ? "—" : String(d.visitorsToday)} hint={t("home.passes")} />
        <HomeRow to="/app/comm" icon={Megaphone} label={t("home.notices")}
          value={notices.isError ? "—" : unread.length ? t("home.new", { count: unread.length }) : t("home.upToDate")} hint={t("home.fromCommittee")} />
        </div>
        <div className="mt-3"><NeedsAttention emptyText={t("home.noAttention")} /></div>
      </section>

      {/* AI Secretary */}
      <Link to="/app/secretary" className="group flex items-center gap-4 rounded-xl border border-primary/25 bg-primary/5 p-4 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="h-11 w-11 shrink-0 rounded-xl bg-primary text-primary-foreground grid place-items-center"><Bot className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{t("home.askAi")}</span>
          <span className="block text-sm text-muted-foreground truncate">{t("home.askAiHint")}</span>
        </span>
        <ChevronRight className="h-5 w-5 text-primary shrink-0 transition-transform group-hover:translate-x-0.5" />
      </Link>

      <QuickActions />

      <Card className="rounded-xl">
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">{t("home.recentNotices")}</h2>
            <Link to="/app/comm" className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline">{t("home.viewAll")} <ArrowRight className="h-4 w-4 ml-1" /></Link>
          </div>
          {notices.isLoading ? (
            <div className="space-y-2">{[0, 1].map((i) => <Skeleton key={i} className="h-12 rounded-lg" />)}</div>
          ) : notices.isError ? (
            <p className="py-4 text-sm text-muted-foreground">{t("home.noticesFailed")} <button className="text-primary underline min-h-0" onClick={() => notices.refetch()}>{t("common.tryAgain")}</button></p>
          ) : latest.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              <Inbox className="h-5 w-5 mx-auto mb-1.5 opacity-60" /> {t("home.noNotices")}
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {latest.map((n) => (
                <li key={n.id}>
                  <Link to="/app/comm" className="flex items-start gap-3 py-3">
                    {!notices.data?.read.has(n.id) && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label={t("common.unread")} />}
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium line-clamp-1">{n.title || t("home.notice")}</span>
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
        <Link to="/app/emergency"><ShieldAlert className="h-4 w-4 mr-2" /> {t("home.emergency")}</Link>
      </Button>

      <AdBanner />
    </div>
  );
}

function HomeRow({ to, icon: Icon, label, value, hint }: { to: "/app/helpdesk" | "/app/visitors" | "/app/comm"; icon: any; label: string; value: string; hint: string }) {
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
  { to: "/app/bills", label: "home.qa.bills", icon: Receipt, tone: "bg-primary/10 text-primary" },
  { to: "/app/visitors", label: "home.qa.visitors", icon: ShieldCheck, tone: "bg-primary/10 text-primary" },
  { to: "/app/helpdesk", label: "home.qa.complaints", icon: LifeBuoy, tone: "bg-primary/10 text-primary" },
  { to: "/app/notices", label: "home.qa.notices", icon: Megaphone, tone: "bg-primary/10 text-primary" },
  { to: "/app/documents", label: "home.qa.documents", icon: FileText, tone: "bg-primary/10 text-primary" },
];

function QuickActions() {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="shortcuts-h">
      <h2 id="shortcuts-h" className="mb-2 text-sm font-semibold">{t("home.shortcuts")}</h2>
      <nav className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card">
        {QUICK_ACTIONS.map((a, i) => {
          const Icon = a.icon;
          const lastRow = i >= QUICK_ACTIONS.length - (QUICK_ACTIONS.length % 2 || 2);
          return (
            <Link
              key={a.label}
              to={a.to}
              className={`flex min-h-[52px] items-center gap-2.5 border-border px-3.5 text-sm font-medium hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/60 ${i % 2 === 0 ? "border-r" : ""} ${lastRow ? "" : "border-b"}`}
            >
              <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
              <span className="truncate">{t(a.label)}</span>
            </Link>
          );
        })}
      </nav>
    </section>
  );
}

