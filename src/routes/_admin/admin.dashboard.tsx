import { SchedulerRunsCard } from "@/components/admin/SchedulerRunsCard";
import { Skeleton } from "@/components/ui/skeleton";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { StatusChip } from "@/components/system/StatusChip";
import { platformOverviewQuery, grossProfit, inr, AI_FEATURE_LABEL, type PlatformOverview } from "@/lib/platform-overview";

export const Route = createFileRoute("/_admin/admin/dashboard")({
  head: () => ({ meta: [
    { title: "Platform Overview — SociyoHub" },
    { name: "description", content: "How SociyoHub itself is doing: societies, people, subscriptions, revenue, costs, AI usage and platform health." },
    { property: "og:title", content: "Platform Overview — SociyoHub" },
    { property: "og:description", content: "How SociyoHub itself is doing: societies, people, subscriptions, revenue, costs, AI usage and platform health." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: AdminDashboard,
});

type Alert = { tone: "danger" | "warning"; text: string; to: string };

function alertsFor(o: PlatformOverview): Alert[] {
  const a: Alert[] = [];
  const h = o.health;
  if (h.webhooks_failed_7d) a.push({ tone: "danger", text: `${h.webhooks_failed_7d} payment webhook(s) failed in 7 days`, to: "/admin/subscription-payments" });
  if (h.webhooks_unverified_7d) a.push({ tone: "danger", text: `${h.webhooks_unverified_7d} webhook(s) with an invalid signature`, to: "/admin/security" });
  if (o.subscriptions.stuck_payments) a.push({ tone: "danger", text: `${o.subscriptions.stuck_payments} plan payment(s) stuck in processing`, to: "/admin/subscription-payments" });
  if (o.subscriptions.failed_payments_30d) a.push({ tone: "warning", text: `${o.subscriptions.failed_payments_30d} plan payment(s) failed in 30 days`, to: "/admin/subscription-payments" });
  if (h.jobs_failed_24h || h.jobs_stuck) a.push({ tone: "danger", text: `${h.jobs_failed_24h} failed and ${h.jobs_stuck} stuck scheduled job(s)`, to: "/admin/health" });
  if (o.ai.last_24h > 50 && o.ai.last_24h > o.ai.avg_daily_prev_7d * 3) a.push({ tone: "warning", text: `AI usage is ${o.ai.last_24h} requests in 24h — over 3× the usual daily average`, to: "/admin/ai-usage" });
  if (o.ai.month_total > 20 && o.ai.month_failed / o.ai.month_total > 0.2) a.push({ tone: "warning", text: `${Math.round((o.ai.month_failed / o.ai.month_total) * 100)}% of AI requests failed this month`, to: "/admin/ai-usage" });
  if (h.security_events_7d > 20) a.push({ tone: "warning", text: `${h.security_events_7d} security events in 7 days`, to: "/admin/security" });
  if (o.societies.lapsed) a.push({ tone: "warning", text: `${o.societies.lapsed} societ${o.societies.lapsed === 1 ? "y has" : "ies have"} an ended trial or expired plan`, to: "/admin/societies" });
  if (!h.razorpay_configured) a.push({ tone: "warning", text: "Razorpay isn't configured — societies can't buy plans online", to: "/admin/razorpay" });
  return a;
}

function AdminDashboard() {
  const q = useQuery(platformOverviewQuery);
  const o = q.data;
  const gp = o ? grossProfit(o) : null;
  const loading = q.isLoading;
  const healthBad = o ? o.health.jobs_failed_24h + o.health.jobs_stuck + o.health.webhooks_failed_7d + o.health.webhooks_unverified_7d : 0;
  const alerts = o ? alertsFor(o) : [];

  const metrics: { k: string; v: string; hint?: string }[] = o && gp ? [
    { k: "Active societies", v: String(o.societies.active), hint: `${o.societies.total} total` },
    { k: "Active people", v: o.people.users.toLocaleString("en-IN"), hint: `${o.people.active_30d} active in 30 days` },
    { k: "Paid subscriptions", v: String(o.societies.paid) },
    { k: "Trials", v: String(o.societies.trial) },
    { k: "MRR (estimate)", v: inr(o.subscriptions.mrr_estimate_inr), hint: "Paid plans × active homes" },
    { k: "Net revenue (month)", v: inr(o.revenue.net_inr) },
    { k: "Direct costs (month)", v: inr(gp.direct), hint: gp.missing.length ? `${gp.missing.length} source(s) not configured` : "All sources recorded" },
    { k: "Gross profit (month)", v: inr(gp.profit), hint: gp.missing.length ? "Incomplete — see costs" : undefined },
    { k: "Gross margin", v: gp.margin === null ? "—" : `${gp.margin.toFixed(0)}%`, hint: gp.margin === null ? "No revenue yet this month" : undefined },
    { k: "AI requests (month)", v: o.ai.month_total.toLocaleString("en-IN"), hint: `${o.ai.month_failed} failed` },
    { k: "AI cost (month)", v: gp.aiCost === null ? "Not configured" : inr(gp.aiCost) },
    { k: "Failed payments (30d)", v: String(o.subscriptions.failed_payments_30d) },
    { k: "Subscription problems", v: String(o.subscriptions.stuck_payments + o.societies.lapsed), hint: "Stuck payments + lapsed plans" },
    { k: "Platform health", v: healthBad ? "Needs attention" : "Healthy" },
    { k: "Security events (7d)", v: String(o.health.security_events_7d) },
    { k: "Open platform issues", v: String(alerts.length) },
  ] : [];

  return (
    <PageShell>
      <PageHeader title="Platform overview" description="How SociyoHub itself is doing. Society-level details live in Societies." actions={
        <Link to="/admin/assistant" className="inline-flex min-h-11 items-center rounded-lg border border-border bg-card px-4 text-sm font-medium hover:bg-muted">Ask the assistant</Link>
      } />

      {q.isError && (
        <div role="alert" className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-sm">Platform figures couldn't load. Nothing is shown as zero until they do.</p>
          <button type="button" onClick={() => q.refetch()} className="min-h-11 rounded-lg border border-border bg-card px-4 text-sm font-medium">Try again</button>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
        {(loading ? Array.from({ length: 16 }, (_, i) => ({ k: String(i), v: "" })) : metrics).map((m) => (
          <div key={m.k} className="min-w-0 bg-card px-4 py-3.5">
            <dt className="truncate text-xs text-muted-foreground">{loading ? <Skeleton className="h-3 w-20" /> : m.k}</dt>
            <dd className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight md:text-xl">{loading ? <Skeleton className="h-6 w-16" /> : m.v}</dd>
            {(() => { const h = (m as { hint?: string }).hint; return h ? <p className="truncate text-[11px] text-muted-foreground">{h}</p> : null; })()}
          </div>
        ))}
      </dl>

      {o && gp && (
        <div className="mt-6 grid gap-6 lg:grid-cols-12">
          <div className="min-w-0 space-y-6 lg:col-span-7">
            <Section title="Needs your attention">
              {alerts.length === 0 ? (
                <p className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> No platform problems right now.</p>
              ) : alerts.map((a) => (
                <Link key={a.text} to={a.to as any} className="grid min-h-[56px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 hover:bg-muted/50">
                  <AlertTriangle className={a.tone === "danger" ? "h-4 w-4 text-destructive" : "h-4 w-4 text-warning"} aria-hidden />
                  <span className="text-sm">{a.text}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                </Link>
              ))}
            </Section>

            <Section title="Revenue, costs and gross profit — this month" link={{ to: "/admin/costs", label: "Revenue & costs" }}>
              <Rows rows={[
                ["Gross subscription revenue", inr(o.revenue.gross_inr)],
                ["Refunds", `− ${inr(o.revenue.refunds_inr)}`],
                ["Net subscription revenue", inr(o.revenue.net_inr)],
                ["Direct platform costs", `− ${inr(gp.direct)}`],
                ["Gross profit", inr(gp.profit)],
                ["Gross margin", gp.margin === null ? "Not meaningful (no revenue)" : `${gp.margin.toFixed(1)}%`],
              ]} />
              <p className="px-4 pb-3 text-xs text-muted-foreground">
                Gross profit = net SociyoHub subscription revenue − recorded direct platform costs. Society maintenance money is never included.
                {o.revenue.test_mode_excluded > 0 && ` ${o.revenue.test_mode_excluded} test-mode payment(s) excluded.`}
                {gp.missing.length > 0 && ` Not configured: ${gp.missing.join(", ")} — profit is overstated until these are recorded.`}
              </p>
            </Section>

            <Section title="AI usage — this month" link={{ to: "/admin/ai-usage", label: "AI usage" }}>
              <Rows rows={[
                ["Requests", `${o.ai.month_total} (${o.ai.month_ok} succeeded, ${o.ai.month_failed} failed)`],
                ["Refused or blocked for safety", String(o.ai.month_refused)],
                ["Rate-limited", String(o.ai.month_rate_limited)],
                ["Tokens", o.ai.tokens_in === null && o.ai.tokens_out === null ? "Not reported by every feature" : `${(o.ai.tokens_in ?? 0).toLocaleString("en-IN")} in · ${(o.ai.tokens_out ?? 0).toLocaleString("en-IN")} out`],
                ["Top feature", o.ai.by_feature[0] ? `${AI_FEATURE_LABEL[o.ai.by_feature[0].feature] ?? o.ai.by_feature[0].feature} (${o.ai.by_feature[0].n})` : "No usage yet"],
              ]} />
            </Section>

            <SchedulerRunsCard />
          </div>

          <aside className="min-w-0 space-y-6 lg:col-span-5">
            <Section title="Societies" link={{ to: "/admin/societies", label: "Society health" }}>
              <Rows rows={[
                ["Total", String(o.societies.total)],
                ["Paid", String(o.societies.paid)],
                ["On trial", String(o.societies.trial)],
                ["Trial ended / plan expired", String(o.societies.lapsed)],
                ["Suspended", String(o.societies.suspended)],
                ["New in 30 days", `${o.societies.new_30d} (previous 30 days: ${o.societies.new_prev_30d})`],
              ]} />
            </Section>
            <Section title="Plans">
              <Rows rows={[
                ["Starter · ₹8/flat", String(o.subscriptions.starter)],
                ["Growth · ₹10/flat", String(o.subscriptions.growth)],
                ["Pro · ₹12/flat", String(o.subscriptions.pro)],
                ["Custom (over 300 flats)", String(o.subscriptions.custom)],
                ["Ending within 14 days", String(o.subscriptions.expiring_14d)],
              ]} />
              <p className="px-4 pb-3 text-xs text-muted-foreground">MRR estimate excludes custom plans. Upgrade/downgrade history isn't recorded yet.</p>
            </Section>
            <Section title="People">
              <Rows rows={[
                ["Residents", String(o.people.residents)],
                ["Society admins", String(o.people.admins)],
                ["Guards", String(o.people.guards)],
                ["Staff", String(o.people.staff)],
                ["Auditors", String(o.people.auditors)],
                ["Active in 7 / 30 days", `${o.people.active_7d} / ${o.people.active_30d}`],
              ]} />
            </Section>
            <Section title="Platform health" link={{ to: "/admin/health", label: "Details" }}>
              <ul className="divide-y">
                <HealthRow label="Scheduled jobs (24h)" ok={!o.health.jobs_failed_24h && !o.health.jobs_stuck} text={`${o.health.jobs_24h} runs · ${o.health.jobs_failed_24h} failed · ${o.health.jobs_recovered_7d} recovered (7d)`} />
                <HealthRow label="Payment webhooks (7d)" ok={!o.health.webhooks_failed_7d && !o.health.webhooks_unverified_7d} text={o.health.webhooks_last_at ? `${o.health.webhooks_failed_7d} failed · ${o.health.webhooks_unverified_7d} unverified` : "No webhooks received yet"} />
                <HealthRow label="Razorpay" ok={o.health.razorpay_configured} text={o.health.razorpay_configured ? "Configured" : "Not configured"} />
                <HealthRow label="AI provider (month)" ok={!(o.ai.month_total > 20 && o.ai.month_failed / o.ai.month_total > 0.2)} text={o.ai.month_total ? `${Math.round((o.ai.month_ok / o.ai.month_total) * 100)}% succeeded` : "No requests yet"} />
                <HealthRow label="App errors (24h)" ok={o.health.app_errors_24h <= Math.max(10, o.health.app_errors_prev_24h * 2)} text={`${o.health.app_errors_24h} (previous day ${o.health.app_errors_prev_24h})`} />
                <HealthRow label="Messaging providers" ok={null} text="Not connected" />
                <HealthRow label="Backups" ok={null} text="Managed by the cloud host — not reported here" />
              </ul>
            </Section>
          </aside>
        </div>
      )}
    </PageShell>
  );
}

function Section({ title, link, children }: { title: string; link?: { to: string; label: string }; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {link && <Link to={link.to as any} className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary">{link.label} <ArrowRight className="h-4 w-4" aria-hidden /></Link>}
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">{children}</div>
    </section>
  );
}

function Rows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="divide-y">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-2.5 text-sm">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="text-right font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function HealthRow({ label, ok, text }: { label: string; ok: boolean | null; text: string }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="truncate text-xs text-muted-foreground">{text}</p>
      </div>
      <StatusChip tone={ok === null ? "neutral" : ok ? "success" : "warning"}>{ok === null ? "n/a" : ok ? "OK" : "Check"}</StatusChip>
    </li>
  );
}
