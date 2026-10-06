import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { summarizeRecord, type AISummary } from "@/lib/ai-summaries.functions";
import { tu } from "@/lib/i18n";

type Target = { kind: "ticket"; id: string } | { kind: "meeting"; id: string } | { kind: "attention" };

/**
 * On-demand, read-only AI summary. Clearly labelled; failures never affect the surrounding page.
 */
export function AISummaryCard({ target, label = "Summarise with AI" }: { target: Target; label?: string }) {
  const run = useServerFn(summarizeRecord);
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; data?: AISummary; message?: string }>({ status: "idle" });

  const go = async () => {
    setState({ status: "loading" });
    try {
      const r = await run({ data: target });
      if (r.ok) setState({ status: "done", data: r.data });
      else setState({ status: "error", message: r.message });
    } catch {
      setState({ status: "error", message: navigator.onLine ? "AI summary is unavailable right now." : "You're offline. Connect to get an AI summary." });
    }
  };

  if (state.status === "idle") {
    return (
      <Button type="button" variant="outline" className="h-auto min-h-11 w-full whitespace-normal rounded-xl py-2 text-center" onClick={go}>
        <Sparkles className="me-2 h-4 w-4 text-primary" aria-hidden /> {label}
      </Button>
    );
  }

  return (
    <section aria-live="polite" className="rounded-xl border border-primary/25 bg-primary/5 p-3 text-sm">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-primary">
        <Sparkles className="h-3.5 w-3.5" aria-hidden /> {tu("op.ai_generated_summary_check_the")}
      </p>
      {state.status === "loading" && (
        <p className="mt-2 flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> {tu("op.summarising")}</p>
      )}
      {state.status === "error" && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-muted-foreground">{state.message}</p>
          <Button type="button" size="sm" variant="ghost" className="min-h-11" onClick={go}>{tu("common.tryAgain")}</Button>
        </div>
      )}
      {state.status === "done" && state.data && (
        <div className="mt-2 space-y-2">
          <p className="break-words">{state.data.summary}</p>
          {state.data.points.length > 0 && (
            <ul className="list-disc space-y-1 ps-5 text-muted-foreground">{state.data.points.map((p, i) => <li key={i} className="break-words">{p}</li>)}</ul>
          )}
          {state.data.incomplete && <p className="text-xs text-muted-foreground">{tu("op.based_on_incomplete_information_some")}</p>}
          {state.data.refs.length > 0 && (
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
              <span className="text-muted-foreground">{tu("op.sources")}</span>
              {state.data.refs.map((r, i) => <Link key={i} to={r.href} className="text-primary underline-offset-2 hover:underline">{r.label}</Link>)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
