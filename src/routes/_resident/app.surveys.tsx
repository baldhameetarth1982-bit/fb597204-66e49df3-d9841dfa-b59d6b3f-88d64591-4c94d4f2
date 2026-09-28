import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ClipboardList, Loader2, Lock, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { StatusChip, ListSkeleton, LoadError, ListEmpty } from "@/components/people/PeopleUI";
import { CommPage, CommHeader, SectionLabel } from "@/components/comm/CommUI";
import { isSurveyOpen, surveyError, type Survey, type SurveyQuestion } from "@/lib/surveys";

export const Route = createFileRoute("/_resident/app/surveys")({
  head: () => ({
    meta: [
      { title: "Surveys — SociyoHub" },
      { name: "description", content: "Share your views in your society's surveys." },
      { property: "og:title", content: "Surveys — SociyoHub" },
      { property: "og:description", content: "Share your views in your society's surveys." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SurveysPage,
});

type Answer = number | number[] | string;

function SurveysPage() {
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Record<string, Answer>>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true); setFailed(false);
    const { data, error } = await supabase.from("polls").select("id,title,description,status,closes_at,created_at")
      .eq("kind", "survey").neq("status", "draft").order("created_at", { ascending: false });
    if (error) { setFailed(true); setLoading(false); return; }
    const list = (data as Survey[]) ?? [];
    setSurveys(list);
    if (list.length) {
      const ids = list.map((s) => s.id);
      const [qs, rs] = await Promise.all([
        supabase.from("survey_questions").select("id,poll_id,position,prompt,qtype,options,required").in("poll_id", ids).order("position"),
        supabase.from("survey_responses").select("poll_id").in("poll_id", ids),
      ]);
      if (qs.error || rs.error) { setFailed(true); setLoading(false); return; }
      setQuestions((qs.data ?? []) as unknown as SurveyQuestion[]);
      setDone(new Set((rs.data ?? []).map((r) => r.poll_id)));
    }
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);

  const setAns = (sid: string, qid: string, v: Answer) => setAnswers((a) => ({ ...a, [sid]: { ...a[sid], [qid]: v } }));

  async function submit(s: Survey) {
    const qs = questions.filter((q) => q.poll_id === s.id);
    const mine = answers[s.id] ?? {};
    const missing = qs.find((q) => q.required && (mine[q.id] === undefined || mine[q.id] === "" || (Array.isArray(mine[q.id]) && (mine[q.id] as number[]).length === 0)));
    if (missing) { setErrors((e) => ({ ...e, [s.id]: `Please answer: "${missing.prompt}"` })); return; }
    setErrors((e) => ({ ...e, [s.id]: "" }));
    setSending(s.id);
    const { error } = await supabase.rpc("submit_survey_response", { _poll_id: s.id, _answers: mine });
    setSending(null);
    if (error) { setErrors((e) => ({ ...e, [s.id]: surveyError(error) })); return; }
    toast.success("Thanks — your response was recorded");
    setDone((d) => new Set(d).add(s.id));
  }

  const open = surveys.filter(isSurveyOpen);
  const closed = surveys.filter((s) => !isSurveyOpen(s));

  return (
    <CommPage>
      <CommHeader title="Surveys" subtitle="Your answers are anonymous in results" />
      {loading ? <ListSkeleton /> : failed ? <LoadError onRetry={() => void load()} /> : surveys.length === 0 ? (
        <ListEmpty icon={ClipboardList} title="No surveys yet" hint="When your committee asks for feedback, it will appear here." />
      ) : (
        <div className="space-y-6">
          {open.length > 0 && <section><SectionLabel>Open</SectionLabel><div className="space-y-3">{open.map((s) => {
            const qs = questions.filter((q) => q.poll_id === s.id);
            const answered = done.has(s.id);
            return (
              <article key={s.id} className="rounded-2xl border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><h2 className="font-semibold">{s.title}</h2>{s.description && <p className="mt-1 text-sm text-muted-foreground">{s.description}</p>}
                    {s.closes_at && <p className="mt-1 text-xs text-muted-foreground">Closes {new Date(s.closes_at).toLocaleString("en-IN")}</p>}</div>
                  {answered ? <StatusChip tone="success">Answered</StatusChip> : <StatusChip tone="info">{qs.length} questions</StatusChip>}
                </div>
                {answered ? <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />You've answered this survey.</p> : (
                  <form className="mt-4 space-y-5" onSubmit={(e) => { e.preventDefault(); void submit(s); }}>
                    {qs.map((q, i) => <QuestionField key={q.id} q={q} index={i} value={answers[s.id]?.[q.id]} onChange={(v) => setAns(s.id, q.id, v)} />)}
                    {errors[s.id] && <p role="alert" className="text-sm text-destructive">{errors[s.id]}</p>}
                    <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={sending === s.id}>
                      {sending === s.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Submit answers
                    </Button>
                  </form>
                )}
              </article>
            );
          })}</div></section>}
          {closed.length > 0 && <section><SectionLabel>Closed</SectionLabel><ul className="divide-y rounded-2xl border bg-card">{closed.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-3"><span className="min-w-0 truncate">{s.title}</span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" aria-hidden />{done.has(s.id) ? "Answered" : "Closed"}</span></li>
          ))}</ul></section>}
        </div>
      )}
    </CommPage>
  );
}

function QuestionField({ q, index, value, onChange }: { q: SurveyQuestion; index: number; value: Answer | undefined; onChange: (v: Answer) => void }) {
  const id = `q-${q.id}`;
  return (
    <fieldset aria-describedby={`${id}-type`}>
      <legend className="text-sm font-medium">{index + 1}. {q.prompt}{q.required && <span className="text-destructive" aria-label="required"> *</span>}</legend>
      <span id={`${id}-type`} className="sr-only">{q.qtype}</span>
      <div className="mt-2">
        {q.qtype === "single" && <div role="radiogroup" className="grid gap-2">{q.options.map((o, i) => (
          <button key={i} type="button" role="radio" aria-checked={value === i} onClick={() => onChange(i)}
            className={cn("min-h-11 rounded-xl border px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", value === i && "border-primary bg-primary/10 font-medium")}>{o}</button>
        ))}</div>}
        {q.qtype === "multi" && <div className="grid gap-2">{q.options.map((o, i) => {
          const arr = Array.isArray(value) ? value : [];
          return <label key={i} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border px-3 text-sm">
            <Checkbox checked={arr.includes(i)} onCheckedChange={(c) => onChange(c ? [...arr, i] : arr.filter((x) => x !== i))} />{o}</label>;
        })}</div>}
        {q.qtype === "rating" && <div role="radiogroup" className="flex gap-2">{[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} of 5`} onClick={() => onChange(n)}
            className={cn("grid h-11 w-11 place-items-center rounded-xl border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", typeof value === "number" && value >= n && "border-primary bg-primary/10 text-primary")}>
            <Star className="h-5 w-5" aria-hidden fill={typeof value === "number" && value >= n ? "currentColor" : "none"} /></button>
        ))}</div>}
        {q.qtype === "text" && <Textarea aria-label={q.prompt} maxLength={1000} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />}
      </div>
    </fieldset>
  );
}
