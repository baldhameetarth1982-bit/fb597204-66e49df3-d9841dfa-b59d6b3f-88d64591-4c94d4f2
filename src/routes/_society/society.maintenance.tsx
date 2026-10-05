import { useTranslation } from "react-i18next";
import { useLocaleFormat } from "@/lib/i18n-format";
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
import { getMaintenanceBoard, setMaintenanceTiming } from "@/lib/accounts-documents.functions";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { toSafeFinanceMessage } from "@/lib/finance-safe-error";
import { toast } from "sonner";
import type { MaintenanceStatus, MaintenanceTiming } from "@/lib/maintenance-status";

export const Route = createFileRoute("/_society/society/maintenance")({
  head: () => ({ meta: [{ title: "Maintenance — SociyoHub" }] }),
  component: MaintenancePage,
});

const MONTH_IDX = Array.from({ length: 12 }, (_, i) => i);

function MaintenancePage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const summaryFn = useServerFn(societyMaintenanceSummary);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState<number | "all">("all");
  const [blockId, setBlockId] = useState<string>("all");
  const { t } = useTranslation();
  const fmt = useLocaleFormat();

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
        eyebrow={t("mnt.eyebrow")}
        title={t("mnt.title")}
        subtitle={t("mnt.subtitle")}
        icon={BookOpen}
        variant="teal"
        action={
          <Button asChild size="sm" variant="secondary" className="rounded-xl h-9 bg-white/15 hover:bg-white/25 text-white border-0">
            <Link to="/society/matrix">{t("mnt.matrix")} <ArrowRight className="h-3.5 w-3.5 ml-1" /></Link>
          </Button>
        }
        stats={
          hasAnyData && summary ? (
            <StatPillRow>
              <StatPill label={t("mnt.houses")} value={summary.total_houses} icon={Home} />
              <StatPill label={t("mnt.status.paid")} value={scopeTotals.paid} icon={CheckCircle2} />
              <StatPill label={t("mnt.status.pending")} value={scopeTotals.pending + scopeTotals.overdue} icon={AlertTriangle} />
              <StatPill label={t("mnt.outstanding")} value={outstandingAmt > 0 ? `₹${outstandingAmt.toLocaleString("en-IN")}` : "₹0"} icon={IndianRupee} />
            </StatPillRow>
          ) : undefined
        }
      />

      <div className="px-4 pt-4 space-y-4">


      {/* Filters */}
      <Card className="rounded-2xl">
        <CardContent className="p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="rounded-xl"><SelectValue placeholder={t("mnt.year")} /></SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>{t("mnt.fy", { year: y })}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={String(month)} onValueChange={(v) => setMonth(v === "all" ? "all" : Number(v))}>
            <SelectTrigger className="rounded-xl"><SelectValue placeholder={t("mnt.month")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("mnt.allMonths")}</SelectItem>
              {MONTH_IDX.map((i) => (
                <SelectItem key={i} value={String(i)}>{fmt.monthShort(i)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={blockId} onValueChange={setBlockId}>
            <SelectTrigger className="rounded-xl col-span-2 sm:col-span-1">
              <SelectValue placeholder={t("mnt.block")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("mnt.allBlocks")}</SelectItem>
              {(blocks ?? []).map((b: any) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild variant="outline" className="rounded-xl">
            <Link to="/society/matrix"><ArrowRight className="h-4 w-4 mr-1.5" />{t("mnt.openMatrix")}</Link>
          </Button>
        </CardContent>
      </Card>

      {societyId && <MaintenanceBoard societyId={societyId} year={year} month={month === "all" ? now.getMonth() : month} blockId={blockId} />}

      {/* KPIs — only when we have real data */}
      {hasAnyData && summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Kpi icon={Home} label={t("mnt.totalHouses")} value={summary.total_houses} tone="neutral" />
          <Kpi icon={CheckCircle2} label={t("mnt.status.paid")} value={scopeTotals.paid} tone="ok" />
          <Kpi icon={AlertTriangle} label={t("mnt.status.pending")} value={scopeTotals.pending + scopeTotals.overdue} tone="warn" />
          {scopeTotals.pct !== null && (
            <Kpi icon={TrendingUp} label={t("mnt.collection")} value={`${scopeTotals.pct}%`} tone="ok" />
          )}
          {scopeTotals.outstandingAmt > 0 && (
            <Kpi icon={IndianRupee} label={t("mnt.outstanding")}
              value={`₹${scopeTotals.outstandingAmt.toLocaleString("en-IN")}`} tone="danger" />
          )}
          {Number(summary.advance_amount) > 0 && (
            <Kpi icon={TrendingUp} label={t("mnt.advance")}
              value={`₹${Number(summary.advance_amount).toLocaleString("en-IN")}`} tone="info" />
          )}
          {scopeTotals.overdue > 0 && (
            <Kpi icon={AlertTriangle} label={t("mnt.status.overdue")} value={scopeTotals.overdue} tone="danger" />
          )}
        </div>
      )}

      {/* Monthly summary (calendar-style) */}
      {hasAnyData && (
        <Card className="rounded-2xl">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <CalendarRange className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">{t("mnt.collectionStatus", { year })}</h3>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {MONTH_IDX.map((i) => {
                const b = monthlyBreakdown[i];
                const pct = b.total > 0 ? Math.round((b.paid / b.total) * 100) : null;
                const isActive = month === i;
                return (
                  <button
                    key={i}
                    onClick={() => setMonth(month === i ? "all" : i)}
                    className={cn(
                      "rounded-xl border p-2.5 text-left transition-colors",
                      isActive ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                    )}
                  >
                    <div className="text-xs font-medium">{fmt.monthShort(i)}</div>
                    {b.total === 0 ? (
                      <div className="text-[10px] text-muted-foreground mt-1">{t("mnt.noData")}</div>
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
          <h3 className="text-sm font-semibold mb-3">{t("mnt.quick")}</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/matrix-import">
                <Upload className="h-4 w-4" />
                <span className="text-xs">{t("mnt.import")}</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/matrix">
                <Download className="h-4 w-4" />
                <span className="text-xs">{t("mnt.export")}</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/billing/generate">
                <FileText className="h-4 w-4" />
                <span className="text-xs">{t("mnt.generate")}</span>
              </Link>
            </Button>
            <Button asChild variant="outline" className="rounded-xl h-auto py-3 flex-col gap-1.5">
              <Link to="/society/billing">

                <ArrowRight className="h-4 w-4" />
                <span className="text-xs">{t("mnt.billingCenter")}</span>
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
          title={t("mnt.empty")}
          description={t("mnt.emptyHint")}
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

const STATUS_UI: Record<MaintenanceStatus, { cls: string }> = {
  upcoming: { cls: "bg-muted text-muted-foreground" },
  pending: { cls: "bg-secondary text-secondary-foreground" },
  due: { cls: "bg-accent text-accent-foreground" },
  overdue: { cls: "bg-destructive/15 text-destructive" },
  paid: { cls: "bg-primary/15 text-primary" },
  advance: { cls: "bg-primary/10 text-primary" },
};

function MaintenanceBoard({ societyId, year, month, blockId }: { societyId: string; year: number; month: number; blockId: string }) {
  const boardFn = useServerFn(getMaintenanceBoard), saveTiming = useServerFn(setMaintenanceTiming);
  const qc = useQueryClient();
  const [status, setStatus] = useState<"all" | MaintenanceStatus>("all");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const q = useQuery({ queryKey: ["maintenance-board", societyId, year, month], retry: false, placeholderData: (p) => p, queryFn: () => boardFn({ data: { societyId, year, month } }) });
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) =>
    (blockId === "all" || r.block_id === blockId) && (status === "all" || r.status === status) &&
    (!search.trim() || `${r.block ?? ""} ${r.label}`.toLowerCase().includes(search.trim().toLowerCase()))), [q.data, blockId, status, search]);
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const r of q.data?.rows ?? []) c[r.status] = (c[r.status] ?? 0) + 1; return c; }, [q.data]);

  async function changeTiming(next: MaintenanceTiming) {
    if (saving || next === q.data?.timing) return;
    setSaving(true);
    try { await saveTiming({ data: { societyId, timing: next } }); await qc.invalidateQueries({ queryKey: ["maintenance-board", societyId] }); toast.success(t("mnt.timingSaved")); }
    catch (e) { toast.error(toSafeFinanceMessage(e)); } finally { setSaving(false); }
  }

  return (
    <SectionCard title={t("mnt.board.title", { month: fmt.monthShort(month), year })} description={t("mnt.board.desc")}>
      {q.isLoading ? <div className="p-6 grid place-items-center"><Loader2 className="h-5 w-5 animate-spin" aria-label={t("mnt.board.loading")} /></div>
        : q.error ? <div className="space-y-2"><p className="text-sm text-destructive" role="alert">{t("mnt.board.failed")}</p><Button size="sm" variant="outline" className="min-h-11" onClick={() => q.refetch()}>{t("common.retry")}</Button></div>
        : <div className="space-y-3">
          <div>
            <p className="text-xs font-medium mb-1.5">{t("mnt.timing")}</p>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t("mnt.timing")}>
              {(["post", "current", "pre"] as const).map((tm) => (
                <Button key={tm} role="radio" aria-checked={q.data!.timing === tm} variant={q.data!.timing === tm ? "default" : "outline"} className="min-h-11" disabled={saving} onClick={() => changeTiming(tm)}>{t(`mnt.timing.${tm}`)}</Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">{t(`mnt.timingHelp.${q.data!.timing}`)}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
              <SelectTrigger className="rounded-xl min-h-11" aria-label={t("common.status")}><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">{t("mnt.allStatuses")}</SelectItem>{(Object.keys(STATUS_UI) as MaintenanceStatus[]).map((k) => <SelectItem key={k} value={k}>{t(`mnt.status.${k}`)} ({counts[k] ?? 0})</SelectItem>)}</SelectContent>
            </Select>
            <Input aria-label={t("mnt.searchHouse")} placeholder={t("mnt.searchHouse")} className="min-h-11" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {rows.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">{(q.data?.rows.length ?? 0) === 0 ? t("mnt.noHouses") : t("mnt.noHouseMatch")}</p>
            : <ul className="divide-y rounded-xl border max-h-[28rem] overflow-y-auto">{rows.map((r) => (
              <li key={r.flat_id} className="flex items-center justify-between gap-2 px-3 py-2.5 min-h-11">
                <div className="min-w-0"><p className="text-sm font-medium truncate">{r.block ? `${r.block} · ` : ""}{r.label}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{r.amount_due != null ? `₹${r.amount_due.toLocaleString("en-IN")}` : t("mnt.noEntry")}</p></div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", STATUS_UI[r.status].cls)}>{t(`mnt.status.${r.status}`)}</span>
              </li>))}</ul>}
        </div>}
    </SectionCard>
  );
}
