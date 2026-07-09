import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2, Home, CheckCircle2, AlertTriangle, TrendingUp, IndianRupee,
  Upload, Download, FileText, ArrowRight, CalendarRange, BookOpen,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { EmptyState } from "@/components/shared/PageHeader";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { societyMaintenanceSummary } from "@/lib/residents.functions";

export const Route = createFileRoute("/_society/society/maintenance")({
  head: () => ({ meta: [{ title: "Maintenance — SocioHub" }] }),
  component: MaintenancePage,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function MaintenancePage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const summaryFn = useServerFn(societyMaintenanceSummary);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | "all">("all");
  const [blockId, setBlockId] = useState<string>("all");

  const { data: summary, isLoading: sLoading } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-maintenance-summary", societyId],
    queryFn: async () => summaryFn({ data: { societyId: societyId! } }),
    staleTime: 30_000,
  });

  const { data: blocks } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-blocks", societyId],
    queryFn: async () => {
      const { data } = await supabase.from("blocks").select("id, name").eq("society_id", societyId!).order("name");
      return data ?? [];
    },
    staleTime: 60_000,
  });

  const { data: periods, isLoading: pLoading } = useQuery({
    enabled: !!societyId,
    queryKey: ["maintenance-periods", societyId, year, blockId],
    queryFn: async () => {
      let q = supabase
        .from("maintenance_periods")
        .select("period_start, status, amount_due, due_date, flat_id, flats!inner(block_id)")
        .eq("society_id", societyId!)
        .gte("period_start", `${year}-01-01`)
        .lte("period_start", `${year}-12-31`);
      if (blockId !== "all") q = q.eq("flats.block_id", blockId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
    },
    staleTime: 30_000,
  });

  const filtered = useMemo(() => {
    if (!periods) return [];
    if (month === "all") return periods;
    return periods.filter((p: any) => new Date(p.period_start).getMonth() === month);
  }, [periods, month]);

  const monthlyBreakdown = useMemo(() => {
    const buckets: { paid: number; pending: number; overdue: number; total: number }[] =
      Array.from({ length: 12 }, () => ({ paid: 0, pending: 0, overdue: 0, total: 0 }));
    const today = new Date();
    for (const p of periods ?? []) {
      const mi = new Date(p.period_start).getMonth();
      const b = buckets[mi];
      b.total += 1;
      if (p.status === "paid") b.paid += 1;
      else if (p.due_date && new Date(p.due_date) < today) b.overdue += 1;
      else b.pending += 1;
    }
    return buckets;
  }, [periods]);

  const scopeTotals = useMemo(() => {
    const today = new Date();
    let paid = 0, pending = 0, overdue = 0, outstandingAmt = 0;
    for (const p of filtered) {
      if (p.status === "paid") paid++;
      else {
        if (p.due_date && new Date(p.due_date) < today) overdue++;
        else pending++;
        outstandingAmt += Number(p.amount_due || 0);
      }
    }
    const total = paid + pending + overdue;
    const pct = total > 0 ? Math.round((paid / total) * 100) : null;
    return { paid, pending, overdue, outstandingAmt, total, pct };
  }, [filtered]);

  if (sidLoading || sLoading) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasAnyData = (summary?.total_houses ?? 0) > 0;
  const years = [year - 1, year, year + 1];
  const outstandingAmt = scopeTotals.outstandingAmt;

  return (
    <div className="pb-24">
      <MobileHero
        eyebrow="Operations"
        title="Maintenance"
        subtitle="Monthly maintenance status per house — independent of bills."
        icon={BookOpen}
        variant="teal"
        action={
          <Button asChild size="sm" variant="secondary" className="rounded-xl h-9 bg-white/15 hover:bg-white/25 text-white border-0">
            <Link to="/society/matrix">Matrix <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
          </Button>
        }
        stats={
          hasAnyData && summary ? (
            <StatPillRow>
              <StatPill label="Houses" value={summary.total_houses} icon={Home} />
              <StatPill label="Paid" value={scopeTotals.paid} icon={CheckCircle2} />
              <StatPill label="Pending" value={scopeTotals.pending + scopeTotals.overdue} icon={AlertTriangle} />
              <StatPill label="Outstanding" value={outstandingAmt > 0 ? `₹${outstandingAmt.toLocaleString("en-IN")}` : "₹0"} icon={IndianRupee} />
            </StatPillRow>
          ) : undefined
        }
      />

      <div className="px-4 pt-4 space-y-4">


      {/* Filters */}
      <Card className="rounded-2xl">
        <CardContent className="p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="rounded-xl"><SelectValue placeholder="Year" /></SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>FY {y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={(v) => setMonth(v === "all" ? "all" : Number(v))}>
            <SelectTrigger className="rounded-xl"><SelectValue placeholder="Month" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All months</SelectItem>
              {MONTHS.map((m, i) => (
                <SelectItem key={m} value={String(i)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={blockId} onValueChange={setBlockId}>
            <SelectTrigger className="rounded-xl col-span-2 sm:col-span-1">
              <SelectValue placeholder="Block" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All blocks</SelectItem>
              {(blocks ?? []).map((b: any) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild variant="outline" className="rounded-xl">
            <Link to="/society/matrix"><ArrowRight className="h-4 w-4 mr-1.5" />Open Matrix</Link>
          </Button>
        </CardContent>
      </Card>

      {/* KPIs — only when we have real data */}
      {hasAnyData && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Kpi icon={Home} label="Total Houses" value={summary.total_houses} tone="neutral" />
          <Kpi icon={CheckCircle2} label="Paid" value={scopeTotals.paid} tone="ok" />
          <Kpi icon={AlertTriangle} label="Pending" value={scopeTotals.pending + scopeTotals.overdue} tone="warn" />
          {scopeTotals.pct !== null && (
            <Kpi icon={TrendingUp} label="Collection" value={`${scopeTotals.pct}%`} tone="ok" />
          )}
          {scopeTotals.outstandingAmt > 0 && (
            <Kpi icon={IndianRupee} label="Outstanding"
              value={`₹${scopeTotals.outstandingAmt.toLocaleString("en-IN")}`} tone="danger" />
          )}
          {Number(summary.advance_amount) > 0 && (
            <Kpi icon={TrendingUp} label="Advance"
              value={`₹${Number(summary.advance_amount).toLocaleString("en-IN")}`} tone="info" />
          )}
          {scopeTotals.overdue > 0 && (
            <Kpi icon={AlertTriangle} label="Overdue" value={scopeTotals.overdue} tone="danger" />
          )}
        </div>
      )}

      {/* Monthly summary (calendar-style) */}
      {hasAnyData && (
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarRange className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Collection status · {year}</h3>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {MONTHS.map((m, i) => {
                const b = monthlyBreakdown[i];
                const pct = b.total > 0 ? Math.round((b.paid / b.total) * 100) : null;
                const isActive = month === i;
                return (
                  <button
                    key={m}
                    onClick={() => setMonth(month === i ? "all" : i)}
                    className={cn(
                      "rounded-xl border p-2.5 text-left transition-colors",
                      isActive ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                    )}
                  >
                    <div className="text-xs font-medium">{m}</div>
                    {b.total === 0 ? (
                      <div className="text-[10px] text-muted-foreground mt-1">No data</div>
                    ) : (
                      <>
                        <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-emerald-500"
                            style={{ width: `${pct ?? 0}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {b.paid}/{b.total} · {pct}%
                        </div>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick actions */}
      <Card className="rounded-2xl">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Quick actions</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/matrix-import">
                <Upload className="h-4 w-4" />
                <span className="text-xs">Import Excel</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/matrix">
                <Download className="h-4 w-4" />
                <span className="text-xs">Export Matrix</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/billing/generate">
                <FileText className="h-4 w-4" />
                <span className="text-xs">Generate Bill</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/billing">

                <ArrowRight className="h-4 w-4" />
                <span className="text-xs">Billing Center</span>
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {pLoading && (
        <div className="grid place-items-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}

      {!hasAnyData && !pLoading && (
        <EmptyState
          icon={CalendarRange}
          title="No maintenance data yet"
          description="Import the yearly matrix or open the Matrix to start tracking maintenance."
        />
      )}
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon, label, value, tone,
}: {
  icon: any; label: string; value: string | number;
  tone: "ok" | "warn" | "danger" | "info" | "neutral";
}) {
  const toneCls =
    tone === "ok" ? "text-emerald-600 bg-emerald-500/10"
    : tone === "warn" ? "text-amber-600 bg-amber-500/10"
    : tone === "danger" ? "text-rose-600 bg-rose-500/10"
    : tone === "info" ? "text-violet-600 bg-violet-500/10"
    : "text-muted-foreground bg-muted";
  return (
    <Card className="rounded-2xl p-3 flex items-center gap-2.5">
      <div className={cn("h-9 w-9 rounded-xl grid place-items-center shrink-0", toneCls)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className="text-sm font-semibold truncate">{value}</div>
      </div>
    </Card>
  );
}
