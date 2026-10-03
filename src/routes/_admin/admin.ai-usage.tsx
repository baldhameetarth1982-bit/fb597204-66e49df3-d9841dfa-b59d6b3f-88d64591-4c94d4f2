import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { platformOverviewQuery, grossProfit, inr, AI_FEATURE_LABEL } from "@/lib/platform-overview";

export const Route = createFileRoute("/_admin/admin/ai-usage")({
  head: () => ({ meta: [
    { title: "AI Usage — Super Admin · SociyoHub" },
    { name: "description", content: "AI requests, failures, safety refusals, tokens and estimated cost across SociyoHub." },
    { property: "og:title", content: "AI Usage — Super Admin · SociyoHub" },
    { property: "og:description", content: "AI requests, failures, safety refusals, tokens and estimated cost across SociyoHub." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: AiUsagePage,
});

function AiUsagePage() {
  const q = useQuery(platformOverviewQuery);
  const o = q.data;
  if (!o) {
    return (
      <PageShell>
        <PageHeader title="AI usage" />
        {q.isError ? <p className="text-sm text-destructive">Couldn't load AI usage. <button className="min-h-11 underline" onClick={() => q.refetch()}>Try again</button></p> : <Skeleton className="h-64 rounded-xl" />}
      </PageShell>
    );
  }
  const a = o.ai;
  const gp = grossProfit(o);
  const max = Math.max(1, ...a.daily.map((d) => d.n));

  return (
    <PageShell>
      <PageHeader title="AI usage" description="Counts only — prompts, answers and documents are never stored here." />
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        {[
          ["Requests this month", a.month_total.toLocaleString("en-IN")],
          ["Succeeded", a.month_ok.toLocaleString("en-IN")],
          ["Failed", a.month_failed.toLocaleString("en-IN")],
          ["Refused / blocked for safety", a.month_refused.toLocaleString("en-IN")],
          ["Rate-limited", a.month_rate_limited.toLocaleString("en-IN")],
          ["Last 24 hours", `${a.last_24h} (usual ${a.avg_daily_prev_7d}/day)`],
          ["Tokens in / out", a.tokens_in === null && a.tokens_out === null ? "Not reported" : `${(a.tokens_in ?? 0).toLocaleString("en-IN")} / ${(a.tokens_out ?? 0).toLocaleString("en-IN")}`],
          ["AI cost this month", gp.aiCost === null ? "Not configured" : inr(gp.aiCost)],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0 bg-card px-4 py-3"><dt className="truncate text-xs text-muted-foreground">{k}</dt><dd className="mt-1 truncate font-semibold tabular-nums">{v}</dd></div>
        ))}
      </dl>
      {gp.aiCost === null && <p className="mt-2 text-xs text-muted-foreground">Set a per-request rate or record the AI bill in <Link to="/admin/costs" className="underline">Revenue & costs</Link> to see AI cost.</p>}
      {a.tracking_since && <p className="mt-1 text-xs text-muted-foreground">Tracking since {new Date(a.tracking_since).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}. Earlier usage wasn't recorded.</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <h2 className="border-b px-4 py-3 text-sm font-semibold">By feature — this month</h2>
          {a.by_feature.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No AI requests yet this month.</p> : (
            <ul className="divide-y">
              {a.by_feature.map((f) => (
                <li key={f.feature} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-2.5 text-sm">
                  <span>{AI_FEATURE_LABEL[f.feature] ?? f.feature}</span>
                  <span className="tabular-nums">{f.n}{f.failed ? <span className="text-destructive"> · {f.failed} failed</span> : null}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <h2 className="border-b px-4 py-3 text-sm font-semibold">Last 14 days</h2>
          {a.daily.length === 0 ? <p className="p-4 text-sm text-muted-foreground">No requests in the last 14 days.</p> : (
            <ul className="space-y-1.5 p-4" aria-label="Requests per day">
              {a.daily.map((d) => (
                <li key={d.d} className="grid grid-cols-[4.5rem_minmax(0,1fr)_3rem] items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{new Date(d.d).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full origin-left rounded-full bg-primary" style={{ transform: `scaleX(${d.n / max})` }} /></span>
                  <span className="text-right tabular-nums">{d.n}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PageShell>
  );
}
