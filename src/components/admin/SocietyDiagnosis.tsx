import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, ShieldCheck, Users, LifeBuoy, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusChip } from "@/components/system/StatusChip";

type Issue = {
  code: string; severity: "high" | "medium" | "low"; owner: "platform" | "society_admin" | "escalate";
  title: string; detail: string; steps?: string[]; fix?: "restore" | "trial" | "grant"; link?: string;
};
type Diagnosis = { status: "ok"; issues: Issue[]; ai_30d: { total: number; failed: number }; role_counts: Record<string, number>; last_activity_at: string | null };

const OWNER = {
  platform: { label: "Super Admin can fix", icon: ShieldCheck, tone: "info" as const },
  society_admin: { label: "Society Admin can resolve this", icon: Users, tone: "neutral" as const },
  escalate: { label: "Needs a controlled support workflow", icon: LifeBuoy, tone: "warning" as const },
};
const FIX_LABEL = { restore: "Restore society", trial: "Extend trial", grant: "Grant plan" };
const ROLE_LABEL: Record<string, string> = { resident: "Residents", society_admin: "Society admins", block_admin: "Block admins", security: "Guards", staff: "Staff", auditor: "Auditors" };

export function SocietyDiagnosis({ societyId, onFix }: { societyId: string; onFix: (fix: "restore" | "trial" | "grant") => void }) {
  const q = useQuery({
    queryKey: ["admin-society-diagnose", societyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_society_diagnose" as any, { _society_id: societyId });
      if (error || (data as any)?.status !== "ok") throw new Error("load_failed");
      return data as unknown as Diagnosis;
    },
  });

  if (q.isLoading) return <Skeleton className="h-32 rounded-2xl" />;
  if (q.isError || !q.data) {
    return (
      <div role="alert" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-destructive/30 bg-destructive/5 p-4">
        <p className="text-sm">Couldn't check this society's health.</p>
        <Button variant="outline" className="min-h-11" onClick={() => q.refetch()}>Try again</Button>
      </div>
    );
  }
  const d = q.data;
  const order = { high: 0, medium: 1, low: 2 };
  const issues = [...d.issues].sort((a, b) => order[a.severity] - order[b.severity]);

  return (
    <section className="space-y-3" aria-labelledby="diag-h">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="diag-h" className="px-1 text-sm font-semibold">What's wrong with this society</h2>
        <Link to="/admin/assistant" search={{ society: societyId }} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-sm font-medium hover:bg-muted">
          <Sparkles className="h-4 w-4 text-primary" aria-hidden /> Ask the assistant about this society
        </Link>
      </div>
      {issues.length === 0 ? (
        <p className="flex items-center gap-2 rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-success" aria-hidden /> No problems found.
        </p>
      ) : (
        <ul className="space-y-2">
          {issues.map((i) => {
            const o = OWNER[i.owner];
            return (
              <li key={i.code} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <AlertCircle className={i.severity === "high" ? "h-4 w-4 text-destructive" : "h-4 w-4 text-warning"} aria-hidden />
                  <p className="font-medium">{i.title}</p>
                  <StatusChip tone={o.tone}>{o.label}</StatusChip>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{i.detail}</p>
                {i.steps && i.steps.length > 0 && (
                  <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">
                    {i.steps.map((s) => <li key={s}>{s}</li>)}
                  </ol>
                )}
                {i.owner === "society_admin" && (
                  <p className="mt-2 text-xs text-muted-foreground">This belongs to the Society Admin. Share these steps with them — don't change it from here.</p>
                )}
                {(i.fix || i.link) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {i.fix && <Button variant={i.owner === "platform" ? "default" : "outline"} className="min-h-11" onClick={() => onFix(i.fix!)}>{FIX_LABEL[i.fix]}{i.owner !== "platform" ? " (exception only)" : ""}</Button>}
                    {i.link && <Link to={i.link as any} className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-muted">Open Plan Payments</Link>}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
        {Object.entries(d.role_counts).map(([k, v]) => (
          <div key={k} className="bg-card px-4 py-3"><dt className="text-xs text-muted-foreground">{ROLE_LABEL[k] ?? k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>
        ))}
        <div className="bg-card px-4 py-3"><dt className="text-xs text-muted-foreground">AI requests (30d)</dt><dd className="font-semibold tabular-nums">{d.ai_30d.total}{d.ai_30d.failed ? ` · ${d.ai_30d.failed} failed` : ""}</dd></div>
        <div className="bg-card px-4 py-3"><dt className="text-xs text-muted-foreground">Last activity</dt><dd className="font-semibold">{d.last_activity_at ? new Date(d.last_activity_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "Never"}</dd></div>
      </dl>
    </section>
  );
}
