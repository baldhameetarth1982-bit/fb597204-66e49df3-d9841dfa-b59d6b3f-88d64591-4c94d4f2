import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Send, ShieldAlert } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { askPlatformAssistant } from "@/lib/platform-assistant.functions";

export const Route = createFileRoute("/_admin/admin/assistant")({
  validateSearch: z.object({ society: z.string().uuid().optional() }),
  head: () => ({ meta: [
    { title: "Product Assistant — Super Admin · SociyoHub" },
    { name: "description", content: "Ask how SociyoHub works, where a setting is, and who should fix a society's problem." },
    { property: "og:title", content: "Product Assistant — Super Admin · SociyoHub" },
    { property: "og:description", content: "Ask how SociyoHub works, where a setting is, and who should fix a society's problem." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: AssistantPage,
});

type Msg = { role: "user" | "assistant"; text: string; refused?: boolean };
const EXAMPLES = ["How does a Society Admin add a resident?", "Where is the No-Dues button?", "Why can't a society use AI Secretary?", "Is a stuck plan payment something I need to fix?"];

function AssistantPage() {
  const search = Route.useSearch();
  const ask = useServerFn(askPlatformAssistant);
  const [societyId, setSocietyId] = useState<string>(search.society ?? "none");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const societies = useQuery({
    queryKey: ["admin-society-health"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_society_health_list" as any);
      if (error) throw new Error("load_failed");
      return (data ?? []) as unknown as { id: string; name: string }[];
    },
    staleTime: 60_000,
  });

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next = [...msgs, { role: "user" as const, text: t }].slice(-12);
    setMsgs(next); setInput(""); setErr(null); setBusy(true);
    try {
      const r = await ask({ data: { messages: next.map(({ role, text }) => ({ role, text: text.slice(0, 2000) })), societyId: societyId === "none" ? null : societyId } });
      if (r.ok) setMsgs([...next, { role: "assistant", text: r.answer, refused: r.refused }]);
      else setErr(r.message);
    } catch {
      setErr("The assistant couldn't answer right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <PageHeader title="Product assistant" description="Explains how SociyoHub works and who should fix a problem. It can't change anything and never sees secrets." />
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="soc-pick">Ask about a society (optional)</label>
          <Select value={societyId} onValueChange={setSocietyId}>
            <SelectTrigger id="soc-pick" className="min-h-11"><SelectValue placeholder="No society selected" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No society — general product questions</SelectItem>
              {(societies.data ?? []).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Only that society's health summary is shared — no resident details.</p>
        </div>

        <div className="min-h-[240px] space-y-3 rounded-xl border border-border bg-card p-4" aria-live="polite">
          {msgs.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((e) => <button key={e} type="button" onClick={() => send(e)} className="min-h-11 rounded-full border border-border px-3 text-left text-sm hover:bg-muted">{e}</button>)}
            </div>
          )}
          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "ml-auto max-w-[85%] rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground" : "max-w-[90%] whitespace-pre-wrap rounded-xl bg-muted px-3 py-2 text-sm"}>
              {m.refused && <ShieldAlert className="mr-1 inline h-4 w-4 text-warning" aria-label="Refused for safety" />}
              {m.text}
            </div>
          ))}
          {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Thinking" />}
          {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <Textarea aria-label="Your question" value={input} maxLength={2000} rows={2} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} placeholder="Ask how something works…" />
          <Button type="submit" className="min-h-11" disabled={busy || !input.trim()} aria-label="Send"><Send className="h-4 w-4" /></Button>
        </form>
      </div>
    </PageShell>
  );
}
