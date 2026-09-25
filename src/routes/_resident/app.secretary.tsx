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

type Turn = { q: string; r?: AskSecretaryResult; at: number };

const SUGGESTIONS = [
  "What are the quiet hours?",
  "Are pets allowed?",
  "Any recent notices about water supply?",
  "Who do I call for plumbing?",
  "What are the rules for guest parking?",
  "How do I book the clubhouse?",
];

const KIND_ICON = { bylaws: BookOpen, notice: Megaphone, contacts: Phone, document: FileText, faq: HelpCircle } as const;
const KIND_LABEL = { bylaws: "By-laws", notice: "Notice", contacts: "Contacts", document: "Document", faq: "FAQ" } as const;
const RETRYABLE = new Set(["ai_unavailable", "retrieval_failed", "rate_limited"]);

function storageKey(uid?: string) {
  return uid ? `sh.secretary.v1.${uid}` : null;
}

function SecretaryPage() {
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
    if (!key) return;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) setTurns((JSON.parse(raw) as Turn[]).filter((t) => t.r));
    } catch { /* ignore */ }
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

  async function submit(q: string, replaceIndex?: number) {
    const text = q.trim();
    if (text.length < 3 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const idx = replaceIndex ?? turns.length;
    const history = turns.slice(0, idx).filter((t) => t.r?.ok).map((t) => t.q).slice(-3);
    setTurns((t) => { const n = [...t]; n[idx] = { q: text, at: Date.now() }; return n; });
    if (replaceIndex === undefined) setQuestion("");
    let r: AskSecretaryResult;
    try {
      r = await ask({ data: { question: text, history } });
    } catch {
      r = { ok: false, code: "ai_unavailable", message: "AI Secretary couldn't be reached. Check your connection and try again." };
    }
    setTurns((t) => { const n = [...t]; n[idx] = { q: text, r, at: Date.now() }; return n; });
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
        <Button asChild variant="ghost" size="icon" className="h-11 w-11 shrink-0" aria-label="Back to society">
          <Link to="/app/comm"><ChevronLeft className="h-5 w-5" /></Link>
        </Button>
        <div className="h-9 w-9 rounded-xl bg-primary text-primary-foreground grid place-items-center shrink-0" aria-hidden>
          <Landmark className="h-4.5 w-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold leading-tight">AI Secretary</h1>
          <p className="text-xs text-muted-foreground truncate">From your society's by-laws, notices and contacts</p>
        </div>
        {turns.length > 0 && !locked && (
          <Button variant="ghost" size="sm" className="h-11 gap-1.5" onClick={newChat} disabled={busy}>
            <SquarePen className="h-4 w-4" /> <span className="hidden sm:inline">New chat</span>
            <span className="sr-only sm:hidden">New chat</span>
          </Button>
        )}
      </header>

      {isLoading ? (
        <div className="p-4 space-y-3" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-11 w-2/3 rounded-xl" />
          <Skeleton className="h-11 w-1/2 rounded-xl" />
        </div>
      ) : locked ? (
        <div className="flex-1 grid place-items-center p-6">
          <div className="max-w-sm text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-muted grid place-items-center"><Lock className="h-6 w-6 text-muted-foreground" /></div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">AI Secretary is a Pro feature</h2>
              <p className="text-sm text-muted-foreground">{getLockedReason("ai_secretary")}</p>
            </div>
            <Button asChild variant="outline" className="h-11"><Link to="/app/plan-required">See plans</Link></Button>
          </div>
        </div>
      ) : (
        <>
          <main className="flex-1 px-4 pt-4 pb-4 space-y-6" aria-live="polite" aria-relevant="additions">
            {turns.length === 0 && <EmptyState onPick={(s) => void submit(s)} disabled={busy} />}

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
                    <p className="text-sm text-foreground flex gap-2"><AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />{t.r.message}</p>
                    {RETRYABLE.has(t.r.code) && (
                      <Button size="sm" variant="outline" className="h-11" disabled={busy} onClick={() => submit(t.q, i)}>
                        <RotateCcw className="h-4 w-4 mr-1.5" /> Try again
                      </Button>
                    )}
                    {t.r.code === "plan_locked" && (
                      <Button asChild size="sm" variant="outline" className="h-11"><Link to="/app/plan-required">See plans</Link></Button>
                    )}
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
                aria-label="Ask AI Secretary a question"
                value={question}
                maxLength={1000}
                rows={1}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(question); } }}
                placeholder="Ask about rules, notices or contacts…"
                className="min-h-11 max-h-36 resize-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 text-[15px]"
              />
              <Button type="submit" size="icon" className="h-10 w-10 shrink-0 rounded-xl mb-0.5" disabled={!canSend} aria-label="Send question">
                <ArrowUp className="h-5 w-5" />
              </Button>
            </div>
            <p className="mt-1.5 px-1 text-[11px] text-muted-foreground flex justify-between gap-2">
              <span>Answers come only from your society's published information.</span>
              {question.length > 800 && <span aria-live="polite">{1000 - question.length} left</span>}
            </p>
          </form>
        </>
      )}
    </div>
  );
}

function EmptyState({ onPick, disabled }: { onPick: (s: string) => void; disabled: boolean }) {
  return (
    <section className="pt-2 space-y-6" aria-labelledby="sec-hello">
      <div className="space-y-2">
        <h2 id="sec-hello" className="text-2xl font-semibold tracking-tight">Ask your society</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          I answer only from information your committee has published for your society. Every answer shows its sources, and I'll say plainly when something isn't covered.
        </p>
      </div>

      <div>
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">What I use</p>
        <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-4">
          {([
            ["/app/bylaws", BookOpen, "By-laws"],
            ["/app/notices", Megaphone, "Notices"],
            ["/app/contacts", Phone, "Contacts"],
            ["/app/documents", FileText, "Documents & FAQs"],
          ] as const).map(([to, Icon, label]) => (
            <li key={to} className="bg-card">
              <Link to={to} className="flex min-h-12 items-center gap-2 px-3 py-2.5 text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden /><span className="min-w-0 break-words">{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Try asking</p>
        <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
          {SUGGESTIONS.slice(0, 4).map((s) => (
            <li key={s}>
              <button type="button" disabled={disabled} onClick={() => onPick(s)}
                className="flex w-full min-h-12 items-center gap-3 px-4 text-left text-sm hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50">
                <span className="flex-1">{s}</span><ArrowUp className="h-4 w-4 rotate-45 text-muted-foreground" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="flex gap-2 px-1 text-xs text-muted-foreground">
        <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
        Not legal or accounting advice. For decisions, confirm with your committee.
      </p>
    </section>
  );
}

function Thinking({ slow }: { slow: boolean }) {
  return (
    <div className="flex items-start gap-3" role="status">
      <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary grid place-items-center shrink-0"><FileSearch className="h-4 w-4" /></div>
      <div className="space-y-1 pt-1">
        <p className="text-sm text-muted-foreground motion-safe:animate-pulse">Checking your society's sources…</p>
        {slow && (
          <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> This is taking longer than usual. Hang on — your question is saved.</p>
        )}
      </div>
    </div>
  );
}

function AnswerBlock({ r }: { r: Extract<AskSecretaryResult, { ok: true }>["data"] }) {
  const answered = r.status === "answered";
  return (
    <div className="flex items-start gap-3">
      <div className={cn("h-7 w-7 rounded-lg grid place-items-center shrink-0", answered ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")} aria-hidden>
        <Landmark className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        {r.conflict && (
          <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-medium flex gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            These sources say different things. Check each one below or ask your committee.
          </p>
        )}
        <p className={cn("text-[15px] leading-relaxed whitespace-pre-wrap break-words", !answered && "text-muted-foreground")}>{r.answer}</p>
        {r.actions?.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Helpful actions">
            {r.actions.map((a) => (
              <Link key={a.href} to={a.href as "/app/helpdesk"} className="inline-flex min-h-11 items-center rounded-full border bg-card px-3.5 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {a.label} →
              </Link>
            ))}
          </div>
        )}
        {!answered && !(r.actions?.length > 0) && (
          <Link to="/app/helpdesk" className="inline-flex min-h-11 items-center rounded-full border bg-card px-3.5 text-sm font-medium text-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Ask the committee on Helpdesk →
          </Link>
        )}
        {r.citations.length > 0 && (
          <div className="space-y-2 border-l-2 border-primary/30 pl-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Based on {r.citations.length} source{r.citations.length === 1 ? "" : "s"}</p>
            <ul className="space-y-2">
              {r.citations.map((c) => {
                const Icon = KIND_ICON[c.kind] ?? BookOpen;
                return (
                  <li key={c.label} className="rounded-xl border bg-card p-3 space-y-1.5">
                    <span className="sr-only">Source: </span>
                    <div className="flex items-start gap-2">
                      <Icon className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-snug break-words">{c.title}</p>
                        <p className="text-[11px] text-muted-foreground">{KIND_LABEL[c.kind]}{c.date ? ` · ${c.date}` : ""}</p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-3 break-words">{c.excerpt}</p>
                    {c.href && (
                      <Link to={c.href as "/app/bylaws"} className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline underline-offset-2">
                        Open {c.kind === "faq" ? "FAQs" : KIND_LABEL[c.kind].toLowerCase()} →
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
