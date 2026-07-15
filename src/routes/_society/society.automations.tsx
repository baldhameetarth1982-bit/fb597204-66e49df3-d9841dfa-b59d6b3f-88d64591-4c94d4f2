import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Clock, PlayCircle, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_society/society/automations")({
  head: () => ({ meta: [{ title: "Automations — SociyoHub" }] }),
  component: AutomationsPage,
});

interface AuditRow {
  id: string;
  action: string;
  created_at: string;
  metadata: unknown;
}

const AUTOMATION_ACTIONS = [
  "maintenance_reminder_sent",
  "bill_generated",
  "payment_captured",
  "late_fee_applied",
  "digest_sent",
] as const;

const CRON_JOBS = [
  { id: "daily-bill-run", schedule: "0 3 * * *", description: "Generate monthly maintenance bills" },
  { id: "maintenance-reminders-daily", schedule: "0 9 * * *", description: "Send reminders for unpaid bills" },
  { id: "razorpay-reconciliation", schedule: "*/30 * * * *", description: "Reconcile pending payments" },
];

function AutomationsPage() {
  const { societyId } = useSocietyId();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!societyId) return;
    void (async () => {
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();
      const { data } = await supabase
        .from("audit_log")
        .select("id, action, created_at, metadata")
        .eq("society_id", societyId)
        .in("action", AUTOMATION_ACTIONS as unknown as string[])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(200);
      const list = (data as AuditRow[]) ?? [];
      setRows(list);
      const c: Record<string, number> = {};
      list.forEach((r) => (c[r.action] = (c[r.action] ?? 0) + 1));
      setCounts(c);
      setLoading(false);
    })();
  }, [societyId]);

  return (
    <PageShell>
      <PageHeader title="Automations" description="Scheduled jobs, reminders and audit trail" />

      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        {CRON_JOBS.map((j) => (
          <Card key={j.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Clock className="h-4 w-4" /> {j.id}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground space-y-1">
              <div className="font-mono">{j.schedule}</div>
              <div>{j.description}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent automation activity (7 days)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-4">
                {AUTOMATION_ACTIONS.map((a) => (
                  <Badge key={a} variant="secondary" className="text-xs">
                    {a}: {counts[a] ?? 0}
                  </Badge>
                ))}
              </div>
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-6">No automation events yet.</p>
              ) : (
                <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
                  {rows.map((r) => {
                    const ok = r.action !== "payment_failed";
                    return (
                      <div key={r.id} className="flex items-center gap-3 text-xs py-2 border-b last:border-0">
                        {ok ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                        <PlayCircle className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-mono flex-1">{r.action}</span>
                        <span className="text-muted-foreground">{new Date(r.created_at).toLocaleString()}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
