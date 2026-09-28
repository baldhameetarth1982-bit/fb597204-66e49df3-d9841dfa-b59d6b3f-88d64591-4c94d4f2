import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BarChart3, ClipboardList, Loader2, Plus, Trash2 } from "lucide-react";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PageShell, PageHeader } from "@/components/shared/PageHeader";
import { StatusChip, ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { SectionLabel } from "@/components/comm/CommUI";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { QTYPE_LABEL, isSurveyOpen, surveyError, type QType, type Survey } from "@/lib/surveys";

export const Route = createFileRoute("/_society/society/surveys")({
  head: () => ({
    meta: [
      { title: "Manage surveys — SociyoHub" },
      { name: "description", content: "Create multi-question resident surveys and review anonymous results." },
      { property: "og:title", content: "Manage surveys — SociyoHub" },
      { property: "og:description", content: "Create multi-question resident surveys and review anonymous results." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => <FeatureGate feature="polls"><AdminSurveys /></FeatureGate>,
});

interface DraftQ { prompt: string; qtype: QType; options: string[]; required: boolean }
interface Result { responses: number; questions: { id: string; prompt: string; qtype: QType; options: string[]; answered: number; counts: Record<string, number> | null; texts: string[] | null }[] }

const blankQ = (): DraftQ => ({ prompt: "", qtype: "single", options: ["", ""], required: true });

function AdminSurveys() {
  const { societyId } = useSocietyId();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [qs, setQs] = useState<DraftQ[]>([blankQ()]);
  const [results, setResults] = useState<Record<string, Result | "loading" | "error">>({});
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    if (!societyId) return;
    setLoading(true); setFailed(false);
    const { data, error } = await supabase.from("polls").select("id,title,description,status,closes_at,created_at")
      .eq("society_id", societyId).eq("kind", "survey").order("created_at", { ascending: false });
    if (error) setFailed(true); else setSurveys((data as Survey[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [societyId]);

  const updQ = (i: number, patch: Partial<DraftQ>) => setQs((q) => q.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function create(publish: boolean) {
    if (!societyId || saving) return;
    if (title.trim().length < 3) return setFormError("Add a title of at least 3 characters.");
    for (const [i, q] of qs.entries()) {
      if (q.prompt.trim().length < 3) return setFormError(`Question ${i + 1} needs text.`);
      if ((q.qtype === "single" || q.qtype === "multi") && q.options.filter((o) => o.trim()).length < 2) return setFormError(`Question ${i + 1} needs at least 2 options.`);
    }
    if (closesAt && new Date(closesAt) <= new Date()) return setFormError("The closing date must be in the future.");
    setFormError(""); setSaving(true);
    const { error } = await supabase.rpc("admin_create_survey", {
      _society_id: societyId, _title: title.trim(), _description: desc.trim(),
      _closes_at: closesAt ? new Date(closesAt).toISOString() : (null as unknown as string),
      _questions: qs.map((q) => ({ prompt: q.prompt.trim(), qtype: q.qtype, required: q.required, options: q.options.map((o) => o.trim()).filter(Boolean) })),
      _publish: publish,
    });
    setSaving(false);
    if (error) return setFormError(surveyError(error));
    toast.success(publish ? "Survey opened and residents notified" : "Survey saved as draft");
    setOpen(false); setTitle(""); setDesc(""); setClosesAt(""); setQs([blankQ()]);
    void load();
  }

  async function setStatus(s: Survey, status: "open" | "closed") {
    setBusy(s.id);
    const { error } = await supabase.rpc("admin_set_survey_status", { _poll_id: s.id, _status: status });
    setBusy(null);
    if (error) return toast.error(surveyError(error));
    toast.success(status === "open" ? "Survey opened and residents notified" : "Survey closed");
    void load();
  }

  async function loadResults(id: string) {
    if (results[id] && results[id] !== "error") { setResults((r) => { const n = { ...r }; delete n[id]; return n; }); return; }
    setResults((r) => ({ ...r, [id]: "loading" }));
    const { data, error } = await supabase.rpc("get_survey_results", { _poll_id: id });
    setResults((r) => ({ ...r, [id]: error ? "error" : (data as unknown as Result) }));
  }

  const drafts = surveys.filter((s) => s.status === "draft");
  const live = surveys.filter(isSurveyOpen);
  const closed = surveys.filter((s) => s.status !== "draft" && !isSurveyOpen(s));

  const row = (s: Survey) => {
    const r = results[s.id];
    return (
      <li key={s.id} className="px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0"><p className="font-medium">{s.title}</p>
            <p className="text-xs text-muted-foreground">{s.closes_at ? `Closes ${new Date(s.closes_at).toLocaleString("en-IN")}` : "No closing date"}</p></div>
          <div className="flex flex-wrap gap-2">
            {s.status === "draft" && <Button className="min-h-11" disabled={busy === s.id} onClick={() => void setStatus(s, "open")}>Open survey</Button>}
            {isSurveyOpen(s) && <Button variant="outline" className="min-h-11" disabled={busy === s.id} onClick={() => void setStatus(s, "closed")}>Close</Button>}
            {s.status !== "draft" && <Button variant="outline" className="min-h-11" aria-expanded={!!r && r !== "error"} onClick={() => void loadResults(s.id)}><BarChart3 className="mr-1 h-4 w-4" />Results</Button>}
          </div>
        </div>
        {r === "loading" && <div className="py-4 grid place-items-center" aria-label="Loading results"><Loader2 className="h-4 w-4 animate-spin" /></div>}
        {r === "error" && <p role="alert" className="mt-2 text-sm text-destructive">Results couldn't load. Tap Results to retry.</p>}
        {r && typeof r === "object" && <ResultView r={r} />}
      </li>
    );
  };

  return (
    <PageShell>
      <PageHeader title="Surveys" description="Ask residents several questions at once. Results are anonymous."
        actions={
          <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
            <DialogTrigger asChild><Button className="h-11 rounded-xl"><Plus className="mr-1 h-4 w-4" />New survey</Button></DialogTrigger>
            <DialogContent className="max-h-[90dvh] overflow-y-auto">
              <DialogHeader><DialogTitle>New survey</DialogTitle></DialogHeader>
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void create(true); }}>
                <div className="space-y-1.5"><Label htmlFor="st">Title</Label><Input id="st" className="h-11" maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="sd">Details <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="sd" maxLength={1000} value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="sc">Closes <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="sc" type="datetime-local" className="h-11" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} /></div>
                {qs.map((q, i) => (
                  <fieldset key={i} className="space-y-2 rounded-xl border p-3">
                    <legend className="px-1 text-sm font-medium">Question {i + 1}</legend>
                    <Input aria-label={`Question ${i + 1} text`} className="h-11" maxLength={300} value={q.prompt} onChange={(e) => updQ(i, { prompt: e.target.value })} placeholder="What would you like to ask?" />
                    <div className="flex flex-wrap items-center gap-3">
                      <Select value={q.qtype} onValueChange={(v) => updQ(i, { qtype: v as QType })}>
                        <SelectTrigger className="h-11 w-44" aria-label={`Question ${i + 1} type`}><SelectValue /></SelectTrigger>
                        <SelectContent>{(Object.keys(QTYPE_LABEL) as QType[]).map((t) => <SelectItem key={t} value={t}>{QTYPE_LABEL[t]}</SelectItem>)}</SelectContent>
                      </Select>
                      <label className="flex min-h-11 items-center gap-2 text-sm"><Switch checked={q.required} onCheckedChange={(c) => updQ(i, { required: c })} />Required</label>
                      {qs.length > 1 && <Button type="button" variant="ghost" size="icon" className="h-11 w-11" aria-label={`Remove question ${i + 1}`} onClick={() => setQs((x) => x.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                    {(q.qtype === "single" || q.qtype === "multi") && <div className="space-y-2">
                      {q.options.map((o, k) => <Input key={k} className="h-11" maxLength={120} aria-label={`Question ${i + 1} option ${k + 1}`} placeholder={`Option ${k + 1}`} value={o}
                        onChange={(e) => updQ(i, { options: q.options.map((x, j) => (j === k ? e.target.value : x)) })} />)}
                      {q.options.length < 10 && <Button type="button" variant="outline" className="h-11" onClick={() => updQ(i, { options: [...q.options, ""] })}><Plus className="mr-1 h-4 w-4" />Add option</Button>}
                    </div>}
                  </fieldset>
                ))}
                {qs.length < 20 && <Button type="button" variant="outline" className="h-11 w-full" onClick={() => setQs((x) => [...x, blankQ()])}><Plus className="mr-1 h-4 w-4" />Add question</Button>}
                {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="button" variant="outline" className="h-12" disabled={saving} onClick={() => void create(false)}>Save draft</Button>
                  <Button type="submit" className="h-12" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Open & notify residents"}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        } />
      {loading ? <ListSkeleton rows={3} /> : failed ? <LoadError title="We couldn't load surveys." onRetry={load} />
        : surveys.length === 0 ? <ListEmpty icon={ClipboardList} title="No surveys yet">Create a survey to collect detailed feedback from residents.</ListEmpty>
        : <>
          {drafts.length > 0 && <><SectionLabel count={drafts.length}>Drafts</SectionLabel><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{drafts.map(row)}</ul></>}
          {live.length > 0 && <><SectionLabel count={live.length}>Open</SectionLabel><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{live.map(row)}</ul></>}
          {closed.length > 0 && <><SectionLabel count={closed.length}>Closed</SectionLabel><ul className="divide-y overflow-hidden rounded-2xl border bg-card">{closed.map(row)}</ul></>}
        </>}
    </PageShell>
  );
}

function ResultView({ r }: { r: Result }) {
  return (
    <div className="mt-3 space-y-4 rounded-xl bg-muted/40 p-3">
      <StatusChip tone="info">{r.responses} responses</StatusChip>
      {r.questions.map((q, i) => (
        <div key={q.id}>
          <p className="text-sm font-medium">{i + 1}. {q.prompt} <span className="font-normal text-muted-foreground">· {q.answered} answered</span></p>
          {q.qtype === "text" ? (
            q.texts && q.texts.length ? <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{q.texts.map((t, k) => <li key={k} className="break-words">{t}</li>)}</ul> : <p className="text-sm text-muted-foreground">No answers yet.</p>
          ) : (
            <ul className="mt-1 space-y-1">{(q.qtype === "rating" ? ["1", "2", "3", "4", "5"].map((n) => [n, `${n} ★`]) : q.options.map((o, k) => [String(k), o])).map(([key, label]) => {
              const c = q.counts?.[key] ?? 0; const pct = q.answered ? Math.round((c / q.answered) * 100) : 0;
              return <li key={key} className="text-sm"><div className="flex justify-between gap-2"><span className="min-w-0 break-words">{label}</span><span className="tabular-nums">{c} · {pct}%</span></div>
                <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-muted"><div className="h-full origin-left bg-primary" style={{ transform: `scaleX(${pct / 100})` }} /></div></li>;
            })}</ul>
          )}
        </div>
      ))}
    </div>
  );
}
