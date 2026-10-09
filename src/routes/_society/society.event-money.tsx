import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
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
  not_authorized: "You don't have permission to manage society accounts.",
  plan_required: "Event money is part of the Accounting Center on your society's plan.",
  event_not_found: "That event no longer exists.",
  record_not_found: "That entry no longer exists.",
};
const msg = (e: unknown) => ERR[(e as Error)?.message] ?? "Couldn't load event money. Check your connection and try again.";
const NONE = "__none__";

function EventMoneyPage() {
  const { societyId } = useSocietyId();
  const qc = useQueryClient();
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
      toast.success("Saved");
    },
    onError: (e) => toast.error(msg(e)),
  });

  const events = summary.data ?? [];
  const totals = useMemo(() => events.reduce((a, e) => ({ inc: a.inc + e.income, exp: a.exp + e.expense }), { inc: 0, exp: 0 }), [events]);
  const shown = (records.data ?? []).filter((r) => filter === "all" || !r.event_id);
  const fmt = (n: number) => (summary.isSuccess ? INR.format(n) : "—");

  return (
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <MobileHero eyebrow="Accounting Center" title="Event money" subtitle="What each society event collected and spent. Only verified income and posted expenses count." icon={PartyPopper} variant="teal" />
      <div className="mx-auto max-w-5xl space-y-4 px-4 pt-4 md:px-8">
        <AccountingCenterNav />

        {summary.isError ? (
          <SectionCard title="Couldn't load event money">
            <p role="alert" className="text-sm text-muted-foreground">{msg(summary.error)}</p>
            <Button variant="outline" className="mt-3 min-h-11" onClick={() => summary.refetch()}><RotateCw className="mr-2 h-4 w-4" />Try again</Button>
          </SectionCard>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <SectionCard icon={TrendingUp} title="Collected"><p className="text-xl font-bold tabular-nums">{fmt(totals.inc)}</p></SectionCard>
              <SectionCard icon={TrendingDown} title="Spent"><p className="text-xl font-bold tabular-nums">{fmt(totals.exp)}</p></SectionCard>
              <SectionCard title="Balance"><p className="text-xl font-bold tabular-nums">{fmt(totals.inc - totals.exp)}</p></SectionCard>
            </div>

            <SectionCard title="Events" description="Create events in Community → Events. Link income and expenses to them below." bodyClassName="p-0">
              {summary.isLoading ? <div className="grid place-items-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
                : events.length === 0 ? <div className="p-6"><EmptyState icon={CalendarDays} title="No events yet" description="Add a festival or function first, then link its collections and spending here." action={<Button asChild className="min-h-11 rounded-full"><Link to="/society/events">Create an event</Link></Button>} /></div>
                : <ul className="divide-y">
                  {events.map((e) => (
                    <li key={e.event_id} className="grid gap-1 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{e.title}</p>
                        <p className="text-xs text-muted-foreground">{new Date(e.starts_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} · {e.income_count} collection(s) · {e.expense_count} expense(s)</p>
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
              title="Link entries to an event"
              description="Recent verified income and posted expenses. Linking only tags the entry; amounts and accounts never change."
              action={<div className="flex gap-1.5">
                <button type="button" className="pill-tab" aria-pressed={filter === "unlinked"} aria-current={filter === "unlinked" ? "page" : undefined} onClick={() => setFilter("unlinked")}>Not linked</button>
                <button type="button" className="pill-tab" aria-pressed={filter === "all"} aria-current={filter === "all" ? "page" : undefined} onClick={() => setFilter("all")}>All</button>
              </div>}
              bodyClassName="p-0"
            >
              {records.isLoading ? <div className="grid place-items-center p-10"><Loader2 className="h-5 w-5 animate-spin" /></div>
                : records.isError ? <p role="alert" className="p-4 text-sm text-muted-foreground">{msg(records.error)}</p>
                : shown.length === 0 ? <p className="p-6 text-sm text-muted-foreground">Nothing to link right now.</p>
                : <ul className="divide-y">
                  {shown.map((r) => (
                    <li key={`${r.kind}-${r.id}`} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto_220px] sm:items-center">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.label}</p>
                        <p className="text-xs text-muted-foreground">{r.kind === "income" ? "Income" : "Expense"}{r.date ? ` · ${r.date}` : ""}</p>
                      </div>
                      <span className={`text-sm font-semibold tabular-nums ${r.kind === "income" ? "text-success" : "text-destructive"}`}>{r.kind === "income" ? "+" : "−"}{INR.format(r.amount)}</span>
                      <Select
                        value={r.event_id ?? NONE}
                        disabled={link.isPending || events.length === 0}
                        onValueChange={(v) => link.mutate({ r, eventId: v === NONE ? null : v })}
                      >
                        <SelectTrigger aria-label={`Event for ${r.label}`} className="min-h-11 rounded-xl"><SelectValue placeholder="Choose event" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE}>Not an event</SelectItem>
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
