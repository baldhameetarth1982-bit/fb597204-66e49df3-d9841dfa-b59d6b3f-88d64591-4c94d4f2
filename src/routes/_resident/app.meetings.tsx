import { MinutesCorrections } from "@/components/meetings/MinutesCorrections";
import { AISummaryCard } from "@/components/shared/AISummaryCard";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { CalendarDays, MapPin, Link2, FileText, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { CommPage, CommHeader, SectionLabel } from "@/components/comm/CommUI";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { isOverdue } from "@/lib/overdue";
import { govRpc, govError, MEETING_STATUS, fmtDateTime } from "@/lib/governance";
import { openKnowledgeDocument } from "@/lib/society-knowledge.functions";

export const Route = createFileRoute("/_resident/app/meetings")({
  head: () => ({
    meta: [
      { title: "Society Meetings — SociyoHub" },
      { name: "description", content: "See upcoming society meetings, RSVP, and read published minutes and resolutions." },
      { property: "og:title", content: "Society Meetings — SociyoHub" },
      { property: "og:description", content: "Upcoming meetings, RSVPs, minutes and resolutions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResidentMeetings,
});

type Meeting = { id: string; title: string; agenda: string; starts_at: string; location: string | null; meeting_link: string | null; status: string; minutes: string | null; cancel_reason: string | null };

function ResidentMeetings() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const openDoc = useServerFn(openKnowledgeDocument);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // RLS returns only non-draft, all-resident meetings of the caller's current society.
  const q = useQuery({
    queryKey: ["resident-meetings", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [m, r] = await Promise.all([
        supabase.from("meetings").select("id,title,agenda,starts_at,location,meeting_link,status,minutes,cancel_reason").order("starts_at", { ascending: false }).limit(100),
        supabase.from("meeting_rsvps").select("meeting_id,response"),
      ]);
      if (m.error) throw m.error;
      return { meetings: (m.data ?? []) as Meeting[], rsvp: new Map(((r.data ?? []) as any[]).map((x) => [x.meeting_id as string, x.response as string])) };
    },
  });
  const open = q.data?.meetings.find((m) => m.id === openId) ?? null;
  const detail = useQuery({
    queryKey: ["resident-meeting", openId],
    enabled: !!openId,
    queryFn: async () => {
      const [a, r, d] = await Promise.all([
        supabase.from("meeting_action_items").select("id,title,owner_name,due_on,status").eq("meeting_id", openId!).order("created_at"),
        supabase.from("meeting_resolutions").select("id,seq,text,outcome").eq("meeting_id", openId!).order("seq"),
        supabase.from("meeting_documents").select("source_id, society_knowledge_sources(title)").eq("meeting_id", openId!),
      ]);
      return { actions: (a.data ?? []) as any[], resolutions: (r.data ?? []) as any[], docs: (d.data ?? []) as any[] };
    },
  });

  async function rsvp(id: string, response: string) {
    setBusy(true);
    try { await govRpc("meeting_rsvp", { _id: id, _response: response }); toast.success(t("mt.rsvpSaved")); qc.invalidateQueries({ queryKey: ["resident-meetings"] }); }
    catch (e) { toast.error(govError(e)); } finally { setBusy(false); }
  }
  async function doc(id: string) {
    const r = await openDoc({ data: { id } }).catch(() => null);
    if (!r?.ok) return toast.error(t("mt.docUnavailable"));
    window.open(r.url, "_blank", "noopener,noreferrer");
  }

  const rows = q.data?.meetings ?? [];
  const upcoming = rows.filter((m) => m.status === "scheduled");
  const past = rows.filter((m) => m.status !== "scheduled");
  const item = (m: Meeting) => (
    <li key={m.id}>
      <button onClick={() => setOpenId(m.id)} className="flex w-full min-h-14 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <CalendarDays className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{m.title}</span><span className="block text-xs text-muted-foreground">{fmtDateTime(m.starts_at)}{q.data?.rsvp.get(m.id) ? ` · ${t(`mt.said.${q.data.rsvp.get(m.id)}`)}` : ""}</span></span>
        <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-xs font-medium", MEETING_STATUS[m.status]?.className)}>{MEETING_STATUS[m.status]?.label}</span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
      </button>
    </li>
  );

  return (
    <CommPage>
      <CommHeader title={t("mt.title")} subtitle={t("mt.subtitle")} />
      {q.isLoading ? <ListSkeleton rows={3} />
        : q.isError ? <LoadError title={t("mt.loadError")} onRetry={() => q.refetch()} />
        : rows.length === 0 ? <ListEmpty icon={CalendarDays} title={t("mt.emptyTitle")}>{t("mt.emptyBody")}</ListEmpty>
        : (
          <>
            {upcoming.length > 0 && <><SectionLabel count={upcoming.length}>{t("mt.upcoming")}</SectionLabel><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{upcoming.map(item)}</ul></>}
            {past.length > 0 && <><SectionLabel>{t("hd.tab.past")}</SectionLabel><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{past.map(item)}</ul></>}
          </>
        )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[88vh] max-w-2xl overflow-y-auto rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {open && (
            <div className="space-y-4">
              <SheetHeader>
                <span className={cn("w-fit rounded px-1.5 py-0.5 text-xs font-medium", MEETING_STATUS[open.status]?.className)}>{MEETING_STATUS[open.status]?.label}</span>
                <SheetTitle className="text-start text-xl">{open.title}</SheetTitle>
              </SheetHeader>
              <div className="space-y-1 text-sm">
                <p className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden />{fmtDateTime(open.starts_at)}</p>
                {open.location && <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" aria-hidden />{open.location}</p>}
                {open.meeting_link && <a href={open.meeting_link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 break-all text-primary underline"><Link2 className="h-4 w-4 shrink-0" aria-hidden />{t("mt.joinLink")}</a>}
                {open.cancel_reason && <p className="text-destructive">{t("mt.cancelledReason", { reason: open.cancel_reason })}</p>}
              </div>
              <AISummaryCard key={open.id} target={{ kind: "meeting", id: open.id }} />
              {open.agenda && <div><h3 className="text-sm font-semibold">{t("mt.agenda")}</h3><p className="whitespace-pre-wrap text-sm text-muted-foreground">{open.agenda}</p></div>}
              {open.status === "scheduled" && new Date(open.starts_at) > new Date() && (
                <div role="radiogroup" aria-label={t("mt.attendAria")} className="grid grid-cols-3 gap-2">
                  {[["yes", t("mt.attending")], ["maybe", t("mt.maybe")], ["no", t("mt.cantCome")]].map(([v, l]) => (
                    <Button key={v} role="radio" aria-checked={q.data?.rsvp.get(open.id) === v} variant={q.data?.rsvp.get(open.id) === v ? "default" : "outline"} className="min-h-11 rounded-xl" disabled={busy} onClick={() => rsvp(open.id, v)}>{l}</Button>
                  ))}
                </div>
              )}
              {open.status === "minutes_published" && open.minutes && <div className="space-y-2"><h3 className="text-sm font-semibold">{t("mt.minutes")}</h3><p className="whitespace-pre-wrap text-sm text-muted-foreground">{open.minutes}</p><MinutesCorrections meetingId={open.id} /></div>}
              {(detail.data?.resolutions.length ?? 0) > 0 && (
                <div><h3 className="text-sm font-semibold">{t("mt.resolutions")}</h3>
                  <ol className="space-y-1 text-sm">{detail.data!.resolutions.map((r) => <li key={r.id}><span className="font-medium">R{r.seq}.</span> {r.text} <span className="text-xs text-muted-foreground">— {["passed", "rejected", "deferred"].includes(r.outcome) ? t(`mt.out.${r.outcome}`) : r.outcome}</span></li>)}</ol>
                </div>
              )}
              {(detail.data?.actions.length ?? 0) > 0 && (
                <div><h3 className="text-sm font-semibold">{t("mt.actionItems")}</h3>
                  <ul className="space-y-1 text-sm">{detail.data!.actions.map((a) => <li key={a.id} className={cn(a.status !== "open" && "line-through text-muted-foreground")}>{a.title}{a.owner_name ? ` — ${a.owner_name}` : ""}{a.due_on ? ` · ${t("mt.due", { date: a.due_on })}` : ""}{isOverdue(a.due_on, a.status === "open") && <span className="ms-2 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">{t("bills.overdue")}</span>}</li>)}</ul>
                </div>
              )}
              {(detail.data?.docs.length ?? 0) > 0 && (
                <div><h3 className="text-sm font-semibold">{t("home.qa.documents")}</h3>
                  <ul className="space-y-1">{detail.data!.docs.map((d) => (
                    <li key={d.source_id}><Button variant="outline" className="min-h-11 w-full justify-start rounded-xl" onClick={() => doc(d.source_id)}><FileText className="h-4 w-4 me-2" aria-hidden />{d.society_knowledge_sources?.title ?? t("sec.kind.document")}</Button></li>
                  ))}</ul>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </CommPage>
  );
}
