import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Loader2, TrendingUp, AlertTriangle, Users, Receipt, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { useSocietyId } from "@/hooks/useSocietyId";
import { supabase } from "@/integrations/supabase/client";
import { generateCommunityDigest } from "@/lib/digest.functions";
import { formatCurrency } from "@/utils/format";
import { toast } from "sonner";

export const Route = createFileRoute("/_society/society/digest")({
  head: () => ({ meta: [{ title: "AI Insights — SocioHub" }] }),
  component: () => (<FeatureGate feature="ai_digest"><DigestPage /></FeatureGate>),
});

interface Insights {
  totalBills: number;
  paidBills: number;
  pendingAmount: number;
  overdueCount: number;
  defaulterCount: number;
  recentVisitors: number;
}

function DigestPage() {
  const { societyId } = useSocietyId();
  const generate = useServerFn(generateCommunityDigest);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [insights, setInsights] = useState<Insights | null>(null);
  const [loadingInsights, setLoadingInsights] = useState(true);

  useEffect(() => {
    if (!societyId) return;
    (async () => {
      setLoadingInsights(true);
      const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const [bills, visitors] = await Promise.all([
        supabase.from("bills").select("id, amount, status, due_date, flat_id").eq("society_id", societyId),
        supabase.from("visitors").select("id", { count: "exact", head: true }).eq("society_id", societyId).gte("created_at", monthAgo),
      ]);
      const rows = (bills.data as any[]) ?? [];
      const now = Date.now();
      const paid = rows.filter((r) => r.status === "paid");
      const overdue = rows.filter((r) => r.status !== "paid" && r.status !== "cancelled" && new Date(r.due_date).getTime() < now);
      const pendingAmount = rows
        .filter((r) => r.status !== "paid" && r.status !== "cancelled")
        .reduce((s, r) => s + Number(r.amount ?? 0), 0);
      const defaulterFlats = new Set(overdue.map((r) => r.flat_id));
      setInsights({
        totalBills: rows.length,
        paidBills: paid.length,
        pendingAmount,
        overdueCount: overdue.length,
        defaulterCount: defaulterFlats.size,
        recentVisitors: visitors.count ?? 0,
      });
      setLoadingInsights(false);
    })();
  }, [societyId]);

  async function run() {
    if (!societyId) return;
    setLoading(true); setResult(null);
    try {
      const res = await generate({ data: { societyId } });
      setResult(res.summary);
      toast.success("Digest published to residents");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate");
    } finally {
      setLoading(false);
    }
  }

  const efficiency = insights && insights.totalBills > 0
    ? Math.round((insights.paidBills / insights.totalBills) * 100)
    : null;

  const suggestions: string[] = [];
  if (insights) {
    if (insights.overdueCount > 0) {
      suggestions.push(`Send payment reminders to ${insights.defaulterCount} defaulter${insights.defaulterCount === 1 ? "" : "s"}.`);
    }
    if (efficiency !== null && efficiency < 70 && insights.totalBills > 5) {
      suggestions.push("Collection efficiency is below 70%. Consider enabling auto reminders.");
    }
    if (insights.totalBills === 0) {
      suggestions.push("No bills generated yet. Head to Billing Center → Generate to create your first monthly bill.");
    }
    if (insights.recentVisitors === 0) {
      suggestions.push("No visitors logged this month. Ensure guards are logging entries.");
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="AI Insights"
        description="Rule-based insights from your society's real data, plus optional AI-written community digest."
      />

      {loadingInsights ? (
        <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : insights && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <InsightCard
            icon={TrendingUp}
            label="Collection efficiency"
            value={efficiency !== null ? `${efficiency}%` : "—"}
            subtitle={insights.totalBills ? `${insights.paidBills} of ${insights.totalBills} bills paid` : "No bills yet"}
            tone={efficiency !== null && efficiency >= 80 ? "success" : efficiency !== null && efficiency >= 50 ? "warning" : "danger"}
          />
          <InsightCard
            icon={Receipt}
            label="Pending dues"
            value={formatCurrency(insights.pendingAmount)}
            subtitle={`${insights.overdueCount} overdue`}
            tone={insights.pendingAmount > 0 ? "warning" : "success"}
          />
          <InsightCard
            icon={AlertTriangle}
            label="Defaulters"
            value={String(insights.defaulterCount)}
            subtitle="flats with overdue bills"
            tone={insights.defaulterCount > 0 ? "danger" : "success"}
          />
          <InsightCard
            icon={Users}
            label="Visitors (30d)"
            value={String(insights.recentVisitors)}
            subtitle="entries logged"
            tone="info"
          />
        </div>
      )}

      {suggestions.length > 0 && (
        <Card className="rounded-2xl mb-4">
          <CardContent className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <Lightbulb className="h-4 w-4 text-primary" />
              <p className="font-semibold">Smart suggestions</p>
            </div>
            <ul className="space-y-2">
              {suggestions.map((s, i) => (
                <li key={i} className="text-sm text-muted-foreground flex gap-2">
                  <span className="text-primary">•</span>{s}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl mb-4">
        <CardContent className="p-5 flex items-center gap-4 flex-wrap">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary grid place-items-center shrink-0">
            <Sparkles className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold">AI community digest</p>
            <p className="text-sm text-muted-foreground">
              Summarises past week's posts and comments. Published to every resident's feed.
            </p>
          </div>
          <Button onClick={run} disabled={loading || !societyId} className="rounded-xl">
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Generate
          </Button>
        </CardContent>
      </Card>

      {result && (
        <Card className="rounded-2xl">
          <CardContent className="p-5">
            <p className="text-xs font-semibold text-primary uppercase tracking-wide mb-2">Preview</p>
            <p className="text-sm leading-relaxed whitespace-pre-line">{result}</p>
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

function InsightCard({
  icon: Icon, label, value, subtitle, tone,
}: {
  icon: any; label: string; value: string; subtitle: string;
  tone: "success" | "warning" | "danger" | "info";
}) {
  const bg =
    tone === "success" ? "bg-success-container text-success-container-foreground" :
    tone === "warning" ? "bg-warning-container text-warning-container-foreground" :
    tone === "danger" ? "bg-danger-container text-danger-container-foreground" :
    "bg-info-container text-info-container-foreground";
  return (
    <Card className="rounded-2xl">
      <CardContent className="p-4">
        <div className={`h-9 w-9 rounded-xl grid place-items-center mb-2 ${bg}`}>
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold leading-tight mt-0.5">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
      </CardContent>
    </Card>
  );
}
