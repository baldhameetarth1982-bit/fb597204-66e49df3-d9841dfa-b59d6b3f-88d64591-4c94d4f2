import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, BookOpen, Loader2, RotateCcw, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { askSecretary, type AskSecretaryResult } from "@/lib/ai-secretary.functions";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";

export const Route = createFileRoute("/_resident/app/secretary")({
  head: () => ({
    meta: [
      { title: "AI Secretary — SociyoHub" },
      { name: "description", content: "Ask questions about your society's by-laws and contacts, with cited answers." },
      { property: "og:title", content: "AI Secretary — SociyoHub" },
      { property: "og:description", content: "Cited answers from your society's own rules." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SecretaryPage,
});

type Turn = { q: string; r?: AskSecretaryResult };

function SecretaryPage() {
  const ask = useServerFn(askSecretary);
  const { hasFeature, getLockedReason, isLoading } = useFeatureAccess();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  async function submit(q: string, replaceIndex?: number) {
    const text = q.trim();
    if (text.length < 3 || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const idx = replaceIndex ?? turns.length;
    setTurns((t) => { const n = [...t]; n[idx] = { q: text }; return n; });
    let r: AskSecretaryResult;
    try {
      r = await ask({ data: { question: text } });
    } catch {
      r = { ok: false, code: "ai_unavailable", message: "AI Secretary is unavailable right now. Please try again." };
    }
    setTurns((t) => { const n = [...t]; n[idx] = { q: text, r }; return n; });
    if (r.ok) setQuestion("");
    inFlight.current = false;
    setBusy(false);
  }

  const locked = !isLoading && !hasFeature("ai_secretary");

  return (
    <div className="max-w-2xl mx-auto px-4 py-5 pb-[calc(120px+env(safe-area-inset-bottom))] space-y-4">
      <header className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-2xl bg-primary/10 text-primary grid place-items-center"><Sparkles className="h-5 w-5" /></div>
        <div>
          <h1 className="text-xl font-semibold">AI Secretary</h1>
          <p className="text-sm text-muted-foreground">Answers only from your society's by-laws and contacts.</p>
        </div>
      </header>

      {locked ? (
        <Card className="rounded-2xl"><CardContent className="p-5 space-y-3">
          <p className="text-sm">{getLockedReason("ai_secretary")}</p>
          <Button asChild variant="outline"><Link to="/app/plan-required">See plans</Link></Button>
        </CardContent></Card>
      ) : (
        <>
          <div className="space-y-4" aria-live="polite">
            {turns.map((t, i) => (
              <div key={i} className="space-y-2">
                <div className="ml-auto max-w-[85%] rounded-2xl bg-primary text-primary-foreground px-4 py-2 text-sm w-fit">{t.q}</div>
                {!t.r ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking society sources…</div>
                ) : t.r.ok ? (
                  <Card className="rounded-2xl"><CardContent className="p-4 space-y-3">
                    {t.r.data.conflict && (
                      <p className="flex items-center gap-2 text-xs font-medium text-destructive"><AlertTriangle className="h-4 w-4" /> Sources differ — check each one below.</p>
                    )}
                    <p className="text-sm whitespace-pre-wrap">{t.r.data.answer}</p>
                    {t.r.data.citations.length > 0 && (
                      <div className="space-y-2 border-t pt-3">
                        <p className="text-xs font-medium text-muted-foreground">Sources</p>
                        {t.r.data.citations.map((c) => (
                          <div key={c.label} className="rounded-xl bg-muted/50 p-3 text-xs space-y-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium flex items-center gap-1"><BookOpen className="h-3.5 w-3.5" />{c.title}</span>
                              {c.date && <span className="text-muted-foreground">{c.date}</span>}
                            </div>
                            <p className="text-muted-foreground line-clamp-3">{c.excerpt}</p>
                            {c.href && <Link to={c.href as "/app/bylaws"} className="text-primary underline underline-offset-2">Open source</Link>}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent></Card>
                ) : (
                  <Card className="rounded-2xl border-destructive/40"><CardContent className="p-4 space-y-2">
                    <p className="text-sm text-destructive">{t.r.message}</p>
                    {(t.r.code === "ai_unavailable" || t.r.code === "retrieval_failed" || t.r.code === "rate_limited") && (
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => submit(t.q, i)}><RotateCcw className="h-4 w-4 mr-1" />Retry</Button>
                    )}
                  </CardContent></Card>
                )}
              </div>
            ))}
            {turns.length === 0 && (
              <p className="text-sm text-muted-foreground">Try: "What are the quiet hours?" or "Who do I call for plumbing?"</p>
            )}
          </div>

          <form
            className="fixed left-0 right-0 bottom-[calc(64px+env(safe-area-inset-bottom))] bg-background border-t p-3"
            onSubmit={(e) => { e.preventDefault(); void submit(question); }}
          >
            <div className="max-w-2xl mx-auto flex gap-2 items-end">
              <Textarea
                aria-label="Your question"
                value={question}
                maxLength={1000}
                rows={2}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(question); } }}
                placeholder="Ask about society rules…"
                className="min-h-11"
              />
              <Button type="submit" size="icon" className="h-11 w-11 shrink-0" disabled={busy || question.trim().length < 3} aria-label="Ask">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
