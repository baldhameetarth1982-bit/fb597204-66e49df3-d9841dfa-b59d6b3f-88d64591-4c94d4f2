import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { draftHelpdeskReply } from "@/lib/helpdesk-ai.functions";
import { tu } from "@/lib/i18n";

/** Fills the caller's reply box with an AI draft. Never sends or changes the request. */
export function AiDraftButton({ ticketId, onDraft }: { ticketId: string; onDraft: (text: string) => void }) {
  const fn = useServerFn(draftHelpdeskReply);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ warnings: string[]; uncertain: string[]; incomplete: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setBusy(true); setError(null); setInfo(null);
    try {
      const r = await fn({ data: { ticketId } });
      if (!r.ok) return setError(r.message);
      onDraft(r.draft);
      setInfo({ warnings: r.warnings, uncertain: r.uncertain, incomplete: r.incomplete });
    } catch { setError("AI drafting is unavailable right now. You can still reply normally."); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={busy} onClick={run}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
        {busy ? tu("op.drafting") : info ? tu("op.draft_again") : tu("op.draft_reply_with_ai")}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {info && (
        <div role="status" className="space-y-1 rounded-lg border bg-muted/40 p-2 text-xs">
          <p className="font-medium">{tu("op.ai_draft_review_and_edit")}</p>
          {info.incomplete && <p>{tu("op.some_history_couldn_t_be")}</p>}
          {[...info.warnings, ...info.uncertain.map((u) => `Check: ${u}`)].map((w, i) => (
            <p key={i} className="flex gap-1"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</p>
          ))}
        </div>
      )}
    </div>
  );
}
