import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Landmark, ChevronRight, MapPin, Video } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { CommPage, CommHeader } from "@/components/comm/CommUI";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { fmtDateTime, AGM_STATUS } from "@/lib/governance";
import { QuorumPanel, AgendaList, ResolutionList, type AgendaItem, type Resolution, type MinutesVersion } from "@/components/governance/AgmRecord";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_resident/app/agm")({
  head: () => ({
    meta: [
      { title: "Annual General Meeting — SociyoHub" },
      { name: "description", content: "See your society's AGM notice, agenda, quorum, resolutions and published minutes." },
      { property: "og:title", content: "Annual General Meeting — SociyoHub" },
      { property: "og:description", content: "AGM notice, agenda, resolutions and minutes." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResidentAgm,
});

type Agm = { id: string; meeting_id: string; title: string; financial_year: string; notice_date: string | null; status: string };

function ResidentAgm() {
  const { user } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["resident-agms", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("agms").select("id,meeting_id,title,financial_year,notice_date,status").neq("status", "draft").order("created_at", { ascending: false }).limit(30);
      if (error) throw error;
      return (data ?? []) as Agm[];
    },
  });
  const open = list.data?.find((a) => a.id === openId) ?? null;
  const detail = useQuery({
    queryKey: ["resident-agm", openId],
    enabled: !!open,
    queryFn: async () => {
      const [m, ag, rs, mv] = await Promise.all([
        supabase.from("meetings").select("starts_at,location,meeting_link").eq("id", open!.meeting_id).maybeSingle(),
        supabase.from("agm_agenda_items").select("*").eq("agm_id", open!.id).order("seq"),
        supabase.from("agm_resolutions").select("*").eq("agm_id", open!.id).order("seq"),
        supabase.from("agm_minutes_versions").select("*").eq("agm_id", open!.id).eq("status", "published").order("version", { ascending: false }),
      ]);
      if (ag.error) throw ag.error;
      return { meeting: m.data as { starts_at: string; location: string | null; meeting_link: string | null } | null, agenda: (ag.data ?? []) as AgendaItem[],
        resolutions: (rs.data ?? []) as Resolution[], minutes: (mv.data ?? []) as MinutesVersion[] };
    },
  });
  const d = detail.data;

  return (
    <CommPage>
      <CommHeader title="AGM" subtitle={tu("op.annual_general_meeting_notices_and")} />
      {list.isLoading ? <ListSkeleton rows={2} />
        : list.isError ? <LoadError title={tu("op.we_couldn_t_load_agm")} onRetry={() => list.refetch()} />
        : !list.data?.length ? <ListEmpty icon={Landmark} title={tu("op.no_agm_yet")}>{tu("op.when_your_committee_publishes_the")}</ListEmpty>
        : (
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {list.data.map((a) => (
              <li key={a.id}>
                <button onClick={() => setOpenId(a.id)} className="flex w-full min-h-14 items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                  <Landmark className="h-5 w-5 shrink-0 text-primary" aria-hidden />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{a.title}</span><span className="block text-xs text-muted-foreground">FY {a.financial_year} · {AGM_STATUS[a.status]?.label}</span></span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[90vh] max-w-2xl overflow-y-auto rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {open && (
            <div className="space-y-4">
              <SheetHeader>
                <span className={cn("w-fit rounded px-1.5 py-0.5 text-xs font-medium", AGM_STATUS[open.status]?.className)}>{AGM_STATUS[open.status]?.label}</span>
                <SheetTitle className="text-left text-xl">{open.title} · FY {open.financial_year}</SheetTitle>
              </SheetHeader>
              {detail.isLoading ? <ListSkeleton rows={3} /> : detail.isError || !d ? <LoadError title={tu("op.we_couldn_t_load_this")} onRetry={() => detail.refetch()} /> : (
                <>
                  {d.meeting && (
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">{fmtDateTime(d.meeting.starts_at)}</p>
                      {d.meeting.location && <p className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="h-4 w-4" aria-hidden />{d.meeting.location}</p>}
                      {d.meeting.meeting_link && <a href={d.meeting.meeting_link} target="_blank" rel="noopener noreferrer" className="flex min-h-11 items-center gap-1.5 text-primary underline-offset-4 hover:underline"><Video className="h-4 w-4" aria-hidden />{tu("op.join_online")}</a>}
                    </div>
                  )}
                  <section className="space-y-2"><h3 className="font-semibold">{tu("mt.agenda")}</h3><AgendaList items={d.agenda} /></section>
                  {!["notice_published", "scheduled"].includes(open.status) && <section className="space-y-2"><h3 className="font-semibold">{tu("op.quorum")}</h3><QuorumPanel agmId={open.id} /></section>}
                  {d.resolutions.length > 0 && <section className="space-y-2"><h3 className="font-semibold">{tu("mt.resolutions")}</h3><ResolutionList items={d.resolutions} agenda={d.agenda} /></section>}
                  <section className="space-y-2"><h3 className="font-semibold">{tu("mt.minutes")}</h3>
                    {!d.minutes.length ? <p className="text-sm text-muted-foreground">{tu("op.minutes_appear_here_once_published")}</p> : d.minutes.map((m, i) => (
                      <details key={m.id} className="rounded-xl border p-3 text-sm" open={i === 0}>
                        <summary className="cursor-pointer font-medium">{tu("op.version")} {m.version}{m.published_at ? ` · ${fmtDateTime(m.published_at)}` : ""}{i > 0 ? tu("op.superseded") : ""}</summary>
                        {m.correction_reason && <p className="mt-1 text-xs text-muted-foreground">{tu("op.correction")} {m.correction_reason}</p>}
                        <p className="mt-2 whitespace-pre-wrap">{m.body}</p>
                      </details>
                    ))}
                  </section>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </CommPage>
  );
}
