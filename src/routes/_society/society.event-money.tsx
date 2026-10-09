import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { tu } from "@/lib/i18n";
import { CalendarDays, Loader2, PartyPopper, RotateCw, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { AccountingCenterNav } from "@/components/nav/AccountingCenterNav";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { EmptyState } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSocietyId } from "@/hooks/useSocietyId";
import { getEventMoney, listEventMoneyRecords, setEventMoneyLink, type EventMoneyRecord } from "@/lib/event-finance.functions";

export const Route = createFileRoute("/_society/society/event-money")({
  head: () => ({ meta: [
    { title: "Event money — SociyoHub" },
    { name: "description", content: "Collections and spending for each society event, from your society's own accounts." },
    { property: "og:title", content: "Event money — SociyoHub" },
    { property: "og:description", content: "See what every society event collected and spent." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: () => <FeatureGate feature="accounts_center"><EventMoneyPage /></FeatureGate>,
});

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const ERR: Record<string, string> = {
  not_authorized: "ln.ev.noPermission",
  plan_required: "ln.ev.planRequired",
  event_not_found: "ln.ev.eventGone",
  record_not_found: "ln.ev.entryGone",
};
const msg = (e: unknown) => tu(ERR[(e as Error)?.message] ?? "ln.ev.loadError");
const NONE = "__none__";

function EventMoneyPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
  const { t } = useTranslation();
  const sumFn = useServerFn(getEventMoney);
  const recFn = useServerFn(listEventMoneyRecords);
  const linkFn = useServerFn(setEventMoneyLink);
  const [filter, setFilter] = useState<"unlinked" | "all">("unlinked");

  const summary = useQuery({ enabled: !!societyId, queryKey: ["event-money", societyId], queryFn: () => sumFn({ data: { societyId: societyId! } }), retry: false });
  const records = useQuery({ enabled: !!societyId, queryKey: ["event-money-records", societyId], queryFn: () => recFn({ data: { societyId: societyId! } }), retry: false });

  const link = useMutation({
    networkMode: "always", retry: false,
    mutationFn: (v: { r: EventMoneyRecord; eventId: string | null }) =>
      linkFn({ data: { societyId: societyId!, kind: v.r.kind, recordId: v.r.id, eventId: v.eventId } }),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ["event-money", societyId] }), qc.invalidateQueries({ queryKey: ["event-money-records", societyId] })]);
      toast.success(tu("ln.ev.saved"));
    },
    onError: (e) => toast.error(msg(e)),
  });

  const events = summary.data ?? [];
  const totals = useMemo(() => events.reduce((a, e) => ({ inc: a.inc + e.income, exp: a.exp + e.expense }), { inc: 0, exp: 0 }), [events]);
  const shown = (records.data ?? []).filter((r) => filter === "all" || !r.event_id);
  const fmt = (n: number) => (summary.isSuccess ? INR.format(n) : "—");

  return (
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <MobileHero eyebrow={tu("ln.acc.center")} title={tu("ln.acc.eventMoney")} subtitle={tu("ln.ev.subtitle")} icon={PartyPopper} variant="teal" />
      <div className="mx-auto max-w-5xl space-y-4 px-4 pt-4 md:px-8">
        <AccountingCenterNav />

        {summary.isError ? (
          <SectionCard title={tu("ln.ev.loadErrorTitle")}>
            <p role="alert" className="text-sm text-muted-foreground">{msg(summary.error)}</p>
            <Button variant="outline" className="mt-3 min-h-11" onClick={() => summary.refetch()}><RotateCw className="mr-2 h-4 w-4" />{tu("ln.ev.tryAgain")}</Button>
          </SectionCard>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <SectionCard icon={TrendingUp} title={tu("ln.ev.collected")}><p className="text-xl font-bold tabular-nums">{fmt(totals.inc)}</p></SectionCard>
              <SectionCard icon={TrendingDown} title={tu("ln.ev.spent")}><p className="text-xl font-bold tabular-nums">{fmt(totals.exp)}</p></SectionCard>
              <SectionCard title={tu("ln.ev.balance")}><p className="text-xl font-bold tabular-nums">{fmt(totals.inc - totals.exp)}</p></SectionCard>
            </div>

            <SectionCard title={tu("ln.acc.events")} description={tu("ln.ev.eventsHint")} bodyClassName="p-0">
              {summary.isLoading ? <div className="grid place-items-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
                : events.length === 0 ? <div className="p-6"><EmptyState icon={CalendarDays} title={tu("ln.ev.noEvents")} description={tu("ln.ev.noEventsHint")} action={<Button asChild className="min-h-11 rounded-full"><Link to="/society/events">{tu("ln.ev.create")}</Link></Button>} /></div>
                : <ul className="divide-y">
                  {events.map((e) => (
                    <li key={e.event_id} className="grid gap-1 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{e.title}</p>
                        <p className="text-xs text-muted-foreground">{new Date(e.starts_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {t("ln.ev.counts", { inc: e.income_count, exp: e.expense_count })}</p>
                      </div>
                      <div className="flex gap-4 text-sm tabular-nums">
                        <span className="text-success">+{INR.format(e.income)}</span>
                        <span className="text-destructive">−{INR.format(e.expense)}</span>
                        <span className="font-semibold">{INR.format(e.income - e.expense)}</span>
                      </div>
                    </li>
                  ))}
                </ul>}
            </SectionCard>

            <SectionCard
              title={tu("ln.ev.linkTitle")}
              description={tu("ln.ev.linkHint")}
              action={<div className="flex gap-1.5">
                <button type="button" className="pill-tab" aria-pressed={filter === "unlinked"} aria-current={filter === "unlinked" ? "page" : undefined} onClick={() => setFilter("unlinked")}>{tu("ln.ev.notLinked")}</button>
                <button type="button" className="pill-tab" aria-pressed={filter === "all"} aria-current={filter === "all" ? "page" : undefined} onClick={() => setFilter("all")}>{tu("ln.ev.all")}</button>
              </div>}
              bodyClassName="p-0"
            >
              {records.isLoading ? <div className="grid place-items-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
                : records.isError ? <p role="alert" className="p-4 text-sm text-muted-foreground">{msg(records.error)}</p>
                : shown.length === 0 ? <p className="p-6 text-sm text-muted-foreground">{tu("ln.ev.nothing")}</p>
                : <ul className="divide-y">
                  {shown.map((r) => (
                    <li key={`${r.kind}-${r.id}`} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto_220px] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.label}</p>
                        <p className="text-xs text-muted-foreground">{r.kind === "income" ? tu("ln.acc.income") : tu("ln.ev.expense")}{r.date ? ` · ${r.date}` : ""}</p>
                      </div>
                      <span className={`text-sm font-semibold tabular-nums ${r.kind === "income" ? "text-success" : "text-destructive"}`}>{r.kind === "income" ? "+" : "−"}{INR.format(r.amount)}</span>
                      <Select
                        value={r.event_id ?? NONE}
                        disabled={link.isPending || events.length === 0}
                        onValueChange={(v) => link.mutate({ r, eventId: v === NONE ? null : v })}
                      >
                        <SelectTrigger aria-label={`${tu("ln.ev.chooseEvent")}: ${r.label}`} className="min-h-11 rounded-xl"><SelectValue placeholder={tu("ln.ev.chooseEvent")} /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>{tu("ln.ev.notEvent")}</SelectItem>
                          {events.map((e) => <SelectItem key={e.event_id} value={e.event_id}>{e.title}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </li>
                  ))}
                </ul>}
            </SectionCard>
          </>
        )}
      </div>
    </div>
  );
}
