import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle, ArrowUp, BookOpen, FileText, HelpCircle, ChevronLeft, Clock, FileSearch, Landmark, Lock, Megaphone, Phone, RotateCcw, ShieldCheck, SquarePen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { askSecretary, type AskSecretaryResult } from "@/lib/ai-secretary.functions";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";
import i18n from "@/lib/i18n";

export const Route = createFileRoute("/_resident/app/secretary")({
  head: () => ({
    meta: [
      { title: "AI Secretary — SociyoHub" },
      { name: "description", content: "Ask about your society's by-laws, notices and contacts and get answers with sources." },
      { property: "og:title", content: "AI Secretary — SociyoHub" },
      { property: "og:description", content: "Answers taken only from your society's own rules, notices and contacts." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SecretaryPage,
});

// `sid` marks a built-in suggested question so its actions work in every language.
type SuggestionId = "q1" | "q2" | "q3" | "q4";
type Turn = { q: string; sid?: SuggestionId; r?: AskSecretaryResult; at: number };

const SUGGESTIONS: readonly SuggestionId[] = ["q1", "q2", "q3", "q4"];

const KIND_ICON = { bylaws: BookOpen, notice: Megaphone, contacts: Phone, document: FileText, faq: HelpCircle } as const;
const KIND_LABEL = { bylaws: "sec.bylaws", notice: "home.notice", contacts: "comm.contacts", document: "sec.kind.document", faq: "sec.kind.faq" } as const;
// Server sends fixed English for these; the client shows them in the chosen language.
// AI-written answers, questions, titles and excerpts are never translated here.
const ERR_KEY: Record<string, string> = {
  not_member: "sec.err.not_member", plan_locked: "sec.err.plan_locked", rate_limited: "sec.err.rate_limited",
  ai_unavailable: "sec.err.ai_unavailable", retrieval_failed: "sec.err.retrieval_failed", refused: "sec.err.refused",
};
// Actions are localised by their stable id. The label map below only covers
// answers saved in this tab before ids existed.
const ACTION_ID_KEY: Record<string, string> = {
  bills: "sec.act.bills", visitors: "sec.act.visitors", vehicles: "sec.act.vehicles", raise: "sec.act.raise",
  notices: "sec.act.notices", polls: "sec.act.polls", emergency: "sec.act.emergency", contacts: "sec.act.contacts",
  documents: "sec.docsFaqs", nodues: "sec.act.nodues", family: "sec.act.family", askHelpdesk: "sec.act.askHelpdesk",
};
const ACTION_KEY: Record<string, string> = {
  "View my bills": "sec.act.bills", "Manage visitors": "sec.act.visitors", "My vehicles & parking": "sec.act.vehicles",
  "Raise a Helpdesk request": "sec.act.raise", "Open notices": "sec.act.notices", "Open polls": "sec.act.polls",
  "Emergency contacts": "sec.act.emergency", "Society contacts": "sec.act.contacts", "Documents & FAQs": "sec.docsFaqs",
  "No-dues certificate": "sec.act.nodues", "My family": "sec.act.family", "Ask the committee via Helpdesk": "sec.act.askHelpdesk",
};
const SOURCE_TITLE_KEY: Record<string, string> = { "Society contacts": "sec.act.contacts" };
const tx = (map: Record<string, string>, k: string, fallback: string) => (map[k] && i18n.exists(map[k]) ? i18n.t(map[k]) : fallback);
const RETRYABLE = new Set(["ai_unavailable", "retrieval_failed", "rate_limited"]);

function storageKey(uid?: string) {
  return uid ? `sh.secretary.v1.${uid}` : null;
}

function SecretaryPage() {
  const { t: tr } = useTranslation();
  const ask = useServerFn(askSecretary);
  const { user } = useAuth();
  const { hasFeature, getLockedReason, isLoading } = useFeatureAccess();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [slow, setSlow] = useState(false);
  const inFlight = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const key = storageKey(user?.id);

  // Conversation continuity for this tab session (per user, never shared).
  useEffect(() => {
    if (!key) {
      setTurns([]);
      return;
    }
    try {
      const raw = sessionStorage.getItem(key);
      setTurns(raw ? (JSON.parse(raw) as Turn[]).filter((t) => t.r) : []);
    } catch {
      setTurns([]);
    }
  }, [key]);
  useEffect(() => {
    if (!key) return;
    try { sessionStorage.setItem(key, JSON.stringify(turns.filter((t) => t.r).slice(-20))); } catch { /* ignore */ }
  }, [turns, key]);

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    endRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "end" });
  }, [turns, busy]);

  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 12_000);
    return () => clearTimeout(t);
  }, [busy]);

  async function submit(q: string, replaceIndex?: number, sid?: SuggestionId) {
    const text = q.trim();
    if (text.length < 3 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const idx = replaceIndex ?? turns.length;
    const earlier = turns.slice(0, idx).filter((t) => t.r?.ok);
    const history = earlier.map((t) => t.q).slice(-3);
    const priorSuggestion = earlier[earlier.length - 1]?.sid;
    setTurns((t) => { const n = [...t]; n[idx] = { q: text, sid, at: Date.now() }; return n; });
    if (replaceIndex === undefined) setQuestion("");
    let r: AskSecretaryResult;
    try {
      r = await ask({ data: { question: text, history, suggestion: sid, priorSuggestion } });
    } catch {
      r = { ok: false, code: "ai_unavailable", message: "network" };
    }
    setTurns((t) => { const n = [...t]; n[idx] = { q: text, sid, r, at: Date.now() }; return n; });
    // Keep the question in the composer if it failed and the user hasn't typed anything new.
    if (!r.ok && replaceIndex === undefined) setQuestion((cur) => cur || text);
    inFlight.current = false;
    setBusy(false);
    inputRef.current?.focus();
  }

  function newChat() {
    if (busy) return;
    setTurns([]);
    setQuestion("");
    inputRef.current?.focus();
  }

  const locked = !isLoading && !hasFeature("ai_secretary");
  const canSend = !busy && question.trim().length >= 3;

  return (
    <div className="flex flex-col min-h-[calc(100dvh-64px)] max-w-2xl mx-auto w-full">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b px-3 py-2 flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label={tr("sec.backAria")}>
          <Link to="/app/comm"><ChevronLeft className="h-5 w-5 rtl:rotate-180" /></Link>
        </Button>
        <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground grid place-items-center shrink-0" aria-hidden>
          <Landmark className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold leading-tight">{tr("sec.title")}</h1>
          <p className="text-xs text-muted-foreground truncate">{tr("sec.subtitle")}</p>
        </div>
        {turns.length > 0 && !locked && (
          <Button variant="ghost" size="sm" className="h-11 gap-1.5" onClick={newChat} disabled={busy}>
            <SquarePen className="h-4 w-4" /> <span className="hidden sm:inline">{tr("sec.newChat")}</span>
            <span className="sr-only sm:hidden">{tr("sec.newChat")}</span>
          </Button>
        )}
      </header>

      {isLoading ? (
        <div className="p-4 space-y-3" aria-busy="true" aria-label={tr("common.loading")}>
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-11 w-2/3 rounded-xl" />
          <Skeleton className="h-11 w-1/2 rounded-xl" />
        </div>
      ) : locked ? (
        <div className="flex-1 grid place-items-center p-6">
          <div className="max-w-sm text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-muted grid place-items-center"><Lock className="h-6 w-6 text-muted-foreground" /></div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{tr("sec.lockedTitle")}</h2>
              <p className="text-sm text-muted-foreground">{getLockedReason("ai_secretary")}</p>
            </div>
            <Button asChild variant="outline" className="h-11"><Link to="/app/plan-required">{tr("sec.seePlans")}</Link></Button>
          </div>
        </div>
      ) : (
        <>
          <main className="flex-1 px-4 pt-4 pb-4 space-y-6" aria-live="polite" aria-relevant="additions">
            {turns.length === 0 && <EmptyState onPick={(s, sid) => void submit(s, undefined, sid)} disabled={busy} />}

            {turns.map((t, i) => (
              <div key={i} className="space-y-3">
                <div className="flex justify-end">
                  <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {t.q}
                  </p>
                </div>
                {!t.r ? (
                  <Thinking slow={slow} />
                ) : t.r.ok ? (
                  <AnswerBlock r={t.r.data} />
                ) : (
                  <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 space-y-3">
                    <p className="text-sm text-foreground flex gap-2"><AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />{t.r.message === "network" ? tr("sec.err.network") : tx(ERR_KEY, t.r.code, t.r.message)}</p>
                    <div className="flex flex-wrap gap-2">
                      {RETRYABLE.has(t.r.code) && (
                        <Button size="sm" variant="outline" className="h-11" disabled={busy} onClick={() => submit(t.q, i, t.sid)}>
                          <RotateCcw className="h-4 w-4 me-1.5" /> {tr("common.tryAgain")}
                        </Button>
                      )}
                      {t.r.code === "plan_locked" ? (
                        <Button asChild size="sm" variant="outline" className="h-11"><Link to="/app/plan-required">{tr("sec.seePlans")}</Link></Button>
                      ) : (
                        <Button asChild size="sm" variant="ghost" className="h-11 text-primary"><Link to="/app/helpdesk">{tr("sec.askHelpdesk")} <span className="rtl:rotate-180 inline-block">→</span></Link></Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
            <div ref={endRef} />
          </main>

          <form
            className="sticky bottom-[calc(68px+env(safe-area-inset-bottom))] z-10 bg-background/95 backdrop-blur border-t px-3 pt-2 pb-3"
            onSubmit={(e) => { e.preventDefault(); void submit(question); }}
          >
            <div className="flex items-end gap-2 rounded-2xl border bg-card px-3 py-1.5 focus-within:ring-2 focus-within:ring-ring">
              <Textarea
                ref={inputRef}
                aria-label={tr("sec.inputAria")}
                value={question}
                maxLength={1000}
                rows={1}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(question); } }}
                placeholder={tr("sec.placeholder")}
                className="min-h-11 max-h-36 resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 text-[15px]"
              />
              <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-xl mb-0.5" disabled={!canSend} aria-label={tr("cm.send")}>
                <ArrowUp className="h-5 w-5" />
              </Button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-muted-foreground flex justify-between gap-2">
              <span>{tr("sec.footer")}</span>
              {question.length > 800 && <span aria-live="polite">{tr("sec.left", { n: 1000 - question.length })}</span>}
            </p>
          </form>
        </>
      )}
    </div>
  );
}

function EmptyState({ onPick, disabled }: { onPick: (s: string, sid: SuggestionId) => void; disabled: boolean }) {
  const { t } = useTranslation();
  return (
    <section className="pt-2 space-y-6" aria-labelledby="sec-hello">
      <div className="space-y-2">
        <h2 id="sec-hello" className="text-2xl font-semibold tracking-tight">{t("sec.hello")}</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          {t("sec.intro")}
        </p>
      </div>

      <div>
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("sec.whatIUse")}</p>
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-4">
          {([
            ["/app/bylaws", BookOpen, "sec.bylaws"],
            ["/app/notices", Megaphone, "home.notices"],
            ["/app/contacts", Phone, "comm.contacts"],
            ["/app/documents", FileText, "sec.docsFaqs"],
          ] as const).map(([to, Icon, label]) => (
            <li key={to} className="bg-card">
              <Link to={to} className="flex min-h-12 items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden /><span className="min-w-0 break-words">{t(label)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("sec.tryAsking")}</p>
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {SUGGESTIONS.map((sid) => [sid, t(`sec.${sid}`)] as const).map(([sid, s]) => (
            <li key={sid}>
              <button type="button" disabled={disabled} onClick={() => onPick(s, sid)}
                className="flex w-full min-h-12 items-center gap-3 px-4 text-start text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50">
                <span className="flex-1">{s}</span><ArrowUp className="h-4 w-4 rotate-45 rtl:-rotate-45 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="flex gap-2 px-1 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
        {t("sec.disclaimer")}
      </p>
    </section>
  );
}

function Thinking({ slow }: { slow: boolean }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3" role="status">
      <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><FileSearch className="h-4 w-4" /></div>
      <div className="space-y-1 pt-1">
        <p className="text-sm text-muted-foreground motion-safe:animate-pulse">{t("sec.checking")}</p>
        {slow && (
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {t("sec.slow")}</p>
        )}
      </div>
    </div>
  );
}

function AnswerBlock({ r }: { r: Extract<AskSecretaryResult, { ok: true }>["data"] }) {
  const { t } = useTranslation();
  const answered = r.status === "answered";
  const answer = r.status === "not_found" ? t("sec.notFound") : r.status === "no_sources" ? t("sec.noSources") : r.answer;
  return (
    <div className="flex items-start gap-3">
      <div className={cn("h-7 w-7 rounded-lg grid place-items-center shrink-0", answered ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")} aria-hidden>
        <Landmark className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {r.conflict && (
          <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            {t("sec.conflict")}
          </p>
        )}
        <p className={cn("text-[15px] leading-relaxed whitespace-pre-wrap break-words", !answered && "text-muted-foreground")}>{answer}</p>
        {r.actions?.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label={t("sec.actionsAria")}>
            {r.actions.map((a) => (
              <Link key={a.href} to={a.href as "/app/helpdesk"} className="inline-flex min-h-11 items-center rounded-full border bg-card px-3.5 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {a.id ? tx(ACTION_ID_KEY, a.id, a.label) : tx(ACTION_KEY, a.label, a.label)} <span className="ms-1 rtl:rotate-180 inline-block">→</span>
              </Link>
            ))}
          </div>
        )}
        {!answered && !(r.actions?.length > 0) && (
          <Link to="/app/helpdesk" className="inline-flex min-h-11 items-center rounded-full border bg-card px-3.5 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("sec.askHelpdesk")} <span className="ms-1 rtl:rotate-180 inline-block">→</span>
          </Link>
        )}
        {r.citations.length > 0 && (
          <div className="space-y-2 border-s-2 border-primary/30 ps-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{r.citations.length === 1 ? t("sec.basedOne") : t("sec.basedMany", { n: r.citations.length })}</p>
            <ul className="space-y-2">
              {r.citations.map((c) => {
                const Icon = KIND_ICON[c.kind] ?? BookOpen;
                return (
                  <li key={c.label} className="rounded-xl border bg-card p-3 space-y-1.5">
                    <span className="sr-only">{t("sec.sourceSr")} </span>
                    <div className="flex items-start gap-2">
                      <Icon className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug break-words">{tx(SOURCE_TITLE_KEY, c.title, c.title)}</p>
                        <p className="text-[11px] text-muted-foreground">{t(KIND_LABEL[c.kind])}{c.date ? ` · ${c.date}` : ""}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3 break-words">{c.excerpt}</p>
                    {c.href && (
                      <Link to={c.href as "/app/bylaws"} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline underline-offset-2">
                        {t(`sec.open.${c.kind}`)} <span className="ms-1 rtl:rotate-180 inline-block">→</span>
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
