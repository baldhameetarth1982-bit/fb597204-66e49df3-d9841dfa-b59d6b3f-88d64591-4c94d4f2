import { createFileRoute } from "@tanstack/react-router";
import { userMessage } from "@/lib/user-error";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Sparkles, Loader2, TrendingUp, AlertTriangle, Users, Receipt, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { useSocietyId } from "@/hooks/useSocietyId";
import { supabase } from "@/integrations/supabase/client";
import { generateCommunityDigest } from "@/lib/digest.functions";
import { formatCurrency } from "@/utils/format";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/digest")({
  head: () => ({ meta: [{ title: "AI Insights — SociyoHub" }] }),
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
      toast.success(tu("op.digest_published_to_residents"));
    } catch (e: any) {
      toast.error(userMessage(e, "Failed to generate"));
    } finally {
      setLoading(false);
    }
  }

  const efficiency = insights && insights.totalBills > 0
    ? Math.round((insights.paidBills / insights.totalBills) * 100)
    : null;

  const suggestions: string[] = [];
  if (insights) {
    if (insights.overdueCount > 0) suggestions.push(`Send payment reminders to ${insights.defaulterCount} defaulter${insights.defaulterCount === 1 ? "" : "s"}.`);
    if (efficiency !== null && efficiency < 70 && insights.totalBills > 5) suggestions.push("Collection efficiency is below 70%. Consider enabling auto reminders.");
    if (insights.totalBills === 0) suggestions.push("No bills generated yet. Head to Billing Center → Generate to create your first monthly bill.");
    if (insights.recentVisitors === 0) suggestions.push("No visitors logged this month. Ensure guards are logging entries.");
  }

  return (
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <MobileHero
        eyebrow={tu("op.society_admin")}
        title={tu("op.ai_insights")}
        subtitle={tu("op.rule_based_insights_from_your")}
        icon={Sparkles}
        variant="teal"
        stats={
          insights ? (
            <StatPillRow>
              <StatPill label={tu("mnt.collection")} value={efficiency !== null ? `${efficiency}%` : "—"} icon={TrendingUp} />
              <StatPill label={tu("docState.pending")} value={formatCurrency(insights.pendingAmount)} icon={Receipt} />
              <StatPill label={tu("op.defaulters")} value={insights.defaulterCount} icon={AlertTriangle} />
              <StatPill label={tu("op.visitors_30d")} value={insights.recentVisitors} icon={Users} />
            </StatPillRow>
          ) : undefined
        }
      />

      <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
        {loadingInsights && (
          <div className="grid place-items-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        )}

        {insights && (
          <div className="grid grid-cols-2 gap-3">
            <InsightCard
              icon={TrendingUp}
              label={tu("op.collection_efficiency")}
              value={efficiency !== null ? `${efficiency}%` : "—"}
              subtitle={insights.totalBills ? `${insights.paidBills}/${insights.totalBills} paid` : tu("rbills.none")}
              tone={efficiency !== null && efficiency >= 80 ? "success" : efficiency !== null && efficiency >= 50 ? "warning" : "danger"}
            />
            <InsightCard icon={Receipt} label={tu("op.pending_dues")} value={formatCurrency(insights.pendingAmount)} subtitle={`${insights.overdueCount} overdue`} tone={insights.pendingAmount > 0 ? "warning" : "success"} />
            <InsightCard icon={AlertTriangle} label={tu("op.defaulters")} value={String(insights.defaulterCount)} subtitle={tu("op.flats_with_overdue_bills")} tone={insights.defaulterCount > 0 ? "danger" : "success"} />
            <InsightCard icon={Users} label={tu("op.visitors_30d_2")} value={String(insights.recentVisitors)} subtitle={tu("op.entries_logged")} tone="info" />
          </div>
        )}

        {suggestions.length > 0 && (
          <SectionCard icon={Lightbulb} title={tu("op.smart_suggestions")}>
            <ul className="space-y-2">
              {suggestions.map((s, i) => (
                <li key={i} className="text-sm text-muted-foreground flex gap-2"><span className="text-primary">•</span>{s}</li>
              ))}
            </ul>
          </SectionCard>
        )}

        <SectionCard icon={Sparkles} title={tu("op.ai_community_digest")} description={tu("op.summarise_past_week_s_posts")} tone="primary">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-muted-foreground min-w-0 flex-1">
              {tu("op.published_to_every_resident_s")}
            </p>
            <Button onClick={run} disabled={loading || !societyId} className="rounded-xl">
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {tu("billingTabs.generate")}
            </Button>
          </div>
        </SectionCard>

        {result && (
          <SectionCard title={tu("op.preview")}>
            <p className="text-sm leading-relaxed whitespace-pre-line">{result}</p>
          </SectionCard>
        )}
      </div>
    </div>
  );
}

function InsightCard({
  icon: Icon, label, value, subtitle, tone,
}: {
  icon: any; label: string; value: string; subtitle: string;
  tone: "success" | "warning" | "danger" | "info";
}) {
  const bg =
    tone === "success" ? "bg-emerald-500/10 text-emerald-600" :
    tone === "warning" ? "bg-amber-500/10 text-amber-600" :
    tone === "danger" ? "bg-rose-500/10 text-rose-600" :
    "bg-sky-500/10 text-sky-600";
  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className={cn("h-9 w-9 rounded-xl grid place-items-center mb-2", bg)}>
        <Icon className="h-4 w-4" />
      </div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold leading-tight mt-0.5 truncate">{value}</p>
      <p className="text-xs text-muted-foreground mt-0.5 truncate">{subtitle}</p>
    </div>
  );
}
