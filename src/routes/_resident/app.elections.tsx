import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Vote, Loader2, CheckCircle2, ChevronRight, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { CommPage, CommHeader, SectionLabel } from "@/components/comm/CommUI";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { govRpc, govError, fmtDateTime, ELECTION_STATUS, NOMINATION_STATUS, ELECTION_ELIGIBILITY } from "@/lib/governance";
import { ElectionResultsView } from "@/components/governance/ElectionResultsView";

export const Route = createFileRoute("/_resident/app/elections")({
  head: () => ({
    meta: [
      { title: "Society Elections — SociyoHub" },
      { name: "description", content: "Stand for a post, see approved candidates and cast your ballot in society elections." },
      { property: "og:title", content: "Society Elections — SociyoHub" },
      { property: "og:description", content: "Nominations, candidates, ballots and published results." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ResidentElections,
});

type Election = { id: string; title: string; instructions: string | null; eligibility: string; secret_ballot: boolean; status: string;
  nomination_closes_at: string; voting_opens_at: string; voting_closes_at: string };
type Post = { id: string; election_id: string; seq: number; name: string; seats: number; description: string | null; candidate_rule: string; requirements: string | null };
type Nom = { id: string; post_id: string; candidate_id: string; candidate_name: string; statement: string | null; status: string; review_reason: string | null };
type Mine = { eligible: boolean; voted: boolean; home_voted: boolean };

/** One request id per election per device, so a retried submission is recognised as the same ballot. */
function requestId(electionId: string) {
  const k = `ballot-req:${electionId}`;
  let v = sessionStorage.getItem(k);
  if (!v) { v = crypto.randomUUID(); sessionStorage.setItem(k, v); }
  return v;
}

function ResidentElections() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string[]>>({});
  const [nominating, setNominating] = useState<Post | null>(null);
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);

  const list = useQuery({
    queryKey: ["resident-elections", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase.from("elections").select("id,title,instructions,eligibility,secret_ballot,status,nomination_closes_at,voting_opens_at,voting_closes_at")
        .neq("status", "draft").order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return (data ?? []) as Election[];
    },
  });
  const open = list.data?.find((e) => e.id === openId) ?? null;
  const detail = useQuery({
    queryKey: ["resident-election", openId],
    enabled: !!openId,
    queryFn: async () => {
      const [p, n, me] = await Promise.all([
        supabase.from("election_posts").select("*").eq("election_id", openId!).order("seq"),
        supabase.from("election_nominations").select("id,post_id,candidate_id,candidate_name,statement,status,review_reason").eq("election_id", openId!).order("candidate_name"),
        govRpc<Mine>("election_my_state", { _election: openId }),
      ]);
      if (p.error) throw p.error;
      if (n.error) throw n.error;
      return { posts: (p.data ?? []) as Post[], noms: (n.data ?? []) as Nom[], me };
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["resident-election"] }); qc.invalidateQueries({ queryKey: ["resident-elections"] }); qc.invalidateQueries({ queryKey: ["election-results"] }); };

  async function nominate() {
    if (!nominating) return;
    setBusy(true);
    try { await govRpc("election_nominate", { _post: nominating.id, _statement: statement }); toast.success(t("el.nomSubmitted")); setNominating(null); setStatement(""); refresh(); }
    catch (e) { toast.error(govError(e)); } finally { setBusy(false); }
  }
  async function withdraw(id: string) {
    if (!confirm(t("el.withdrawConfirm"))) return;
    setBusy(true);
    try { await govRpc("election_withdraw_nomination", { _nomination: id }); toast.success(t("el.nomWithdrawn")); refresh(); }
    catch (e) { toast.error(govError(e)); } finally { setBusy(false); }
  }
  async function cast() {
    if (!open) return;
    const choices = Object.values(picks).flat();
    if (!choices.length) return;
    if (!confirm(t("el.castConfirm"))) return;
    setBusy(true);
    try {
      const r = await govRpc<string>("election_cast_ballot", { _election: open.id, _choices: choices, _request: requestId(open.id) });
      toast.success(r === "already_recorded" ? t("el.alreadyRecorded") : t("el.recorded"));
      setPicks({}); refresh();
    } catch (e) { toast.error(govError(e)); } finally { setBusy(false); }
  }
  const toggle = (post: Post, nomId: string) => setPicks((cur) => {
    const sel = cur[post.id] ?? [];
    if (sel.includes(nomId)) return { ...cur, [post.id]: sel.filter((x) => x !== nomId) };
    if (post.seats === 1) return { ...cur, [post.id]: [nomId] };
    if (sel.length >= post.seats) { toast.info(t("el.limit", { n: post.seats, post: post.name })); return cur; }
    return { ...cur, [post.id]: [...sel, nomId] };
  });

  const rows = list.data ?? [];
  const active = rows.filter((e) => ["nomination_open", "nomination_review", "voting_open", "voting_closed"].includes(e.status));
  const past = rows.filter((e) => !active.includes(e));
  const me = detail.data?.me;
  const votingLive = open?.status === "voting_open" && new Date(open.voting_closes_at) > new Date();

  const item = (e: Election) => (
    <li key={e.id}>
      <button onClick={() => { setOpenId(e.id); setPicks({}); }} className="flex w-full min-h-14 items-center gap-3 px-4 py-3 text-start hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <Vote className="h-5 w-5 shrink-0 text-primary" aria-hidden />
        <span className="min-w-0 flex-1"><span className="block truncate font-medium">{e.title}</span>
          <span className="block text-xs text-muted-foreground">{ELECTION_STATUS[e.status]?.label}{e.status === "voting_open" ? ` · ${t("el.closes", { date: fmtDateTime(e.voting_closes_at) })}` : e.status === "nomination_open" ? ` · ${t("el.until", { date: fmtDateTime(e.nomination_closes_at) })}` : ""}</span></span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
      </button>
    </li>
  );

  return (
    <CommPage>
      <CommHeader title={t("el.title")} subtitle={t("el.subtitle")} />
      {list.isLoading ? <ListSkeleton rows={3} />
        : list.isError ? <LoadError title={t("el.loadFailed")} onRetry={() => list.refetch()} />
        : rows.length === 0 ? <ListEmpty icon={Vote} title={t("el.none")}>{t("el.noneHint")}</ListEmpty>
        : (
          <>
            {active.length > 0 && <><SectionLabel count={active.length}>{t("rep.current")}</SectionLabel><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{active.map(item)}</ul></>}
            {past.length > 0 && <><SectionLabel>{t("hd.tab.past")}</SectionLabel><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{past.map(item)}</ul></>}
          </>
        )}

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <SheetContent side="bottom" className="mx-auto max-h-[90vh] max-w-2xl overflow-y-auto rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {open && (
            <div className="space-y-4">
              <SheetHeader>
                <span className={cn("w-fit rounded px-1.5 py-0.5 text-xs font-medium", ELECTION_STATUS[open.status]?.className)}>{ELECTION_STATUS[open.status]?.label}</span>
                <SheetTitle className="text-start text-xl">{open.title}</SheetTitle>
              </SheetHeader>
              <p className="text-xs text-muted-foreground">{ELECTION_ELIGIBILITY[open.eligibility]}{` · ${open.secret_ballot ? t("el.secretInfo") : t("el.openBallot")}`} · {t("el.votingRange", { from: fmtDateTime(open.voting_opens_at), to: fmtDateTime(open.voting_closes_at) })}</p>
              {open.instructions && <p className="whitespace-pre-wrap rounded-xl bg-muted p-3 text-sm">{open.instructions}</p>}

              {detail.isLoading ? <ListSkeleton rows={2} /> : detail.isError ? <LoadError title={t("el.loadOneFailed")} onRetry={() => detail.refetch()} /> : (
                <>
                  {me && !me.eligible && <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">{t("el.notEligible")}</p>}
                  {open.status === "voting_open" && !votingLive && <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">{t("el.windowEnded")}</p>}
                  {me?.voted && <p className="flex items-center gap-2 rounded-xl bg-success/10 p-3 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />{t("el.recordedFinal")}</p>}
                  {!me?.voted && me?.home_voted && votingLive && <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">{t("gv.e.home_already_voted")}</p>}

                  {detail.data!.posts.map((p) => {
                    const mineNoms = detail.data!.noms.filter((n) => n.post_id === p.id && n.candidate_id === user?.id);
                    const cands = detail.data!.noms.filter((n) => n.post_id === p.id && n.status === "approved");
                    const canNominate = open.status === "nomination_open" && me?.eligible && !mineNoms.some((n) => ["pending", "approved"].includes(n.status));
                    const canVote = votingLive && me?.eligible && !me.voted && !me.home_voted;
                    const sel = picks[p.id] ?? [];
                    return (
                      <section key={p.id} className="rounded-2xl border p-3" aria-label={p.name}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-medium">{p.name}</h3>
                            <p className="text-xs text-muted-foreground">{t("el.seats", { n: p.seats })} · {p.candidate_rule === "owner" ? t("el.ownersOnly") : t("el.anyResident")}</p>
                            {p.description && <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>}
                            {p.requirements && <p className="text-xs text-muted-foreground">{t("el.requirements", { text: p.requirements })}</p>}
                          </div>
                          {canNominate && <Button size="sm" variant="outline" className="min-h-11 shrink-0 rounded-xl" onClick={() => { setNominating(p); setStatement(""); }}><UserPlus className="h-4 w-4 me-1" />{t("el.stand")}</Button>}
                        </div>
                        {mineNoms.map((n) => (
                          <div key={n.id} className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-muted/60 p-2 text-sm">
                            <span>{t("el.yourNom")} <span className={cn("rounded px-1.5 py-0.5 text-[11px] font-medium", NOMINATION_STATUS[n.status]?.className)}>{NOMINATION_STATUS[n.status]?.label}</span>
                              {n.review_reason && <span className="block text-xs text-muted-foreground">{t("cm.reason")}: {n.review_reason}</span>}</span>
                            {["pending", "approved"].includes(n.status) && ["nomination_open", "nomination_review"].includes(open.status) &&
                              <Button size="sm" variant="ghost" className="min-h-11" disabled={busy} onClick={() => withdraw(n.id)}>{t("el.withdraw")}</Button>}
                          </div>
                        ))}
                        {open.status !== "nomination_open" && (
                          cands.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">{t("el.noCands")}</p> : (
                            <div role={canVote ? (p.seats === 1 ? "radiogroup" : "group") : undefined} aria-label={canVote ? t("el.chooseFor", { post: p.name }) : undefined} className="mt-2 space-y-2">
                              {canVote && <p className="text-xs text-muted-foreground">{t("el.chooseUpTo", { n: p.seats, sel: sel.length })}</p>}
                              {cands.map((c) => canVote ? (
                                <button key={c.id} role={p.seats === 1 ? "radio" : "checkbox"} aria-checked={sel.includes(c.id)} onClick={() => toggle(p, c.id)}
                                  className={cn("block w-full min-h-12 rounded-xl border px-4 py-2 text-start text-sm", sel.includes(c.id) ? "border-primary bg-primary/10" : "border-border")}>
                                  <span className="font-medium">{c.candidate_name}</span>
                                  {c.statement && <span className="mt-0.5 block text-xs text-muted-foreground">{c.statement}</span>}
                                </button>
                              ) : (
                                <div key={c.id} className="rounded-xl bg-muted/40 px-3 py-2 text-sm"><span className="font-medium">{c.candidate_name}</span>
                                  {c.statement && <span className="mt-0.5 block text-xs text-muted-foreground">{c.statement}</span>}</div>
                              ))}
                            </div>
                          )
                        )}
                      </section>
                    );
                  })}

                  {votingLive && me?.eligible && !me.voted && !me.home_voted && (
                    <Button className="h-12 w-full rounded-xl" disabled={busy || !Object.values(picks).flat().length} onClick={cast}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("el.submitBallot")}</Button>
                  )}
                  {["voting_closed", "results_published", "archived"].includes(open.status) && <section className="space-y-2"><h3 className="font-semibold">{t("el.results")}</h3><ElectionResultsView electionId={open.id} /></section>}
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={!!nominating} onOpenChange={(o) => !o && setNominating(null)}>
        <SheetContent side="bottom" className="mx-auto max-w-2xl rounded-t-3xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <SheetHeader><SheetTitle>{t("el.standFor", { post: nominating?.name ?? "" })}</SheetTitle></SheetHeader>
          <div className="space-y-3 py-4">
            <Label htmlFor="n-stmt">{t("el.statement")}</Label>
            <Textarea id="n-stmt" rows={4} maxLength={2000} value={statement} onChange={(e) => setStatement(e.target.value)} placeholder={t("el.statementPh")} />
            <p className="text-xs text-muted-foreground">{t("el.nomHint")}</p>
            <Button className="h-12 w-full rounded-xl" disabled={busy} onClick={nominate}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t("el.submitNom")}</Button>
          </div>
        </SheetContent>
      </Sheet>
    </CommPage>
  );
}
