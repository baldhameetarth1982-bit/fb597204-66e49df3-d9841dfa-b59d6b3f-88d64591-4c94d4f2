import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Download, Upload, TrendingUp, Home, IndianRupee, AlertTriangle, CheckCircle2, LayoutGrid } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { MobileHero } from "@/components/shared/MobileHero";
import { StatPill, StatPillRow } from "@/components/shared/StatPill";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { societyMaintenanceSummary } from "@/lib/residents.functions";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/matrix")({
  head: () => ({ meta: [{ title: "Maintenance Matrix — SociyoHub" }] }),
  component: MatrixPage,
});

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type FlatRow = { id: string; flat_number: string; block_name: string };
type Period = { flat_id: string; period_start: string; status: string; amount_due: number; due_date: string | null };

const STATUS_KEYS = ["Paid", "Pending", "Overdue", "Advance", "Upcoming"] as const;
type StatusKey = (typeof STATUS_KEYS)[number] | "all";

function MatrixPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [year, setYear] = useState(new Date().getFullYear());
  const [flats, setFlats] = useState<FlatRow[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [blockFilter, setBlockFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusKey>("all");

  const summaryFn = useServerFn(societyMaintenanceSummary);
  const { data: summary } = useQuery({
    enabled: !!societyId,
    queryKey: ["society-maintenance-summary", societyId],
    queryFn: async () => summaryFn({ data: { societyId: societyId! } }),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!societyId) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      const [f, p] = await Promise.all([
        supabase.from("flats").select("id,flat_number,blocks!flats_block_id_fkey(name)").eq("society_id", societyId),
        supabase
          .from("maintenance_periods")
          .select("flat_id,period_start,status,amount_due,due_date")
          .eq("society_id", societyId)
          .gte("period_start", `${year}-01-01`)
          .lte("period_start", `${year}-12-31`),
      ]);
      if (cancel) return;
      if (f.error || p.error) toast.error(f.error?.message || p.error?.message || "Load failed");
      setFlats(
        ((f.data ?? []) as any[])
          .map((x) => ({ id: x.id, flat_number: x.flat_number, block_name: x.blocks?.name ?? "—" }))
          .sort((a, b) =>
            (a.block_name + a.flat_number).localeCompare(b.block_name + b.flat_number, undefined, { numeric: true }),
          ),
      );
      setPeriods(((p.data ?? []) as any[]).map((x) => ({ ...x, amount_due: Number(x.amount_due) })));
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [societyId, year]);

  const today = useMemo(() => new Date(), []);

  const cell = (flatId: string, mi: number) => {
    const period = periods.find(
      (x) => x.flat_id === flatId && new Date(x.period_start).getMonth() === mi,
    );
    if (!period) {
      const isFuture = year > today.getFullYear() || (year === today.getFullYear() && mi > today.getMonth());
      return {
        label: isFuture ? "Upcoming" : "—",
        cls: isFuture ? "bg-blue-500/10 text-blue-600" : "bg-muted text-muted-foreground",
      };
    }
    const isFuture = new Date(period.period_start) > today;
    if (period.status === "paid") {
      return isFuture
        ? { label: "Advance", cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300" }
        : { label: "Paid", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" };
    }
    if (period.due_date && new Date(period.due_date) < today) {
      return { label: "Overdue", cls: "bg-destructive/15 text-destructive" };
    }
    if (isFuture) return { label: "Upcoming", cls: "bg-blue-500/10 text-blue-600" };
    return { label: "Pending", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" };
  };

  const blockOptions = useMemo(() => {
    const s = new Set<string>();
    flats.forEach((f) => f.block_name && s.add(f.block_name));
    return Array.from(s).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [flats]);

  const filtered = useMemo(() => {
    return flats.filter((f) => {
      if (q && !(f.flat_number + " " + f.block_name).toLowerCase().includes(q.toLowerCase())) return false;
      if (blockFilter !== "all" && f.block_name !== blockFilter) return false;
      if (statusFilter !== "all") {
        const has = Array.from({ length: 12 }, (_, m) => cell(f.id, m).label).includes(statusFilter);
        if (!has) return false;
      }
      return true;
    });
  }, [flats, q, blockFilter, statusFilter, periods, year]);

  async function exportExcel() {
    const { writeSafeWorkbook } = await import("@/lib/spreadsheet-safety");
    const rows = filtered.map((f) => {
      const row: Record<string, string> = { Block: f.block_name, Unit: f.flat_number };
      for (let m = 0; m < 12; m++) row[MONTH_NAMES[m]] = cell(f.id, m).label;
      return row;
    });
    writeSafeWorkbook(rows, `Matrix ${year}`, `maintenance-matrix-${year}.xlsx`);
  }

  async function exportPDF() {
    const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(14);
    doc.text(`Maintenance Matrix ${year}`, 40, 40);
    doc.setFontSize(9);
    doc.setTextColor(120);
    doc.text(`Generated ${new Date().toLocaleString("en-IN")} · ${filtered.length} units`, 40, 56);
    doc.setTextColor(0);
    autoTable(doc, {
      startY: 74,
      head: [["Unit", ...MONTH_NAMES]],
      body: filtered.map((f) => [
        `${f.block_name}-${f.flat_number}`,
        ...Array.from({ length: 12 }, (_, m) => cell(f.id, m).label),
      ]),
      styles: { fontSize: 7, cellPadding: 3 },
      headStyles: { fillColor: [30, 41, 59] },
      columnStyles: { 0: { fontStyle: "bold" } },
    });
    doc.save(`maintenance-matrix-${year}.pdf`);
    toast.success(tu("op.pdf_exported"));
  }

  return (
    <div className="pb-24">
      <MobileHero
        eyebrow={tu("nav.operations")}
        title={tu("op.maintenance_matrix")}
        subtitle={tu("op.every_unit_every_month_at")}
        icon={LayoutGrid}
        variant="teal"
        stats={
          summary ? (
            <StatPillRow>
              <StatPill label={tu("sd.s.houses")} value={summary.total_houses} icon={Home} />
              <StatPill label={tu("bills.paid")} value={summary.paid_periods} icon={CheckCircle2} />
              <StatPill label={tu("sd.m.outstanding")} value={`₹${Number(summary.outstanding_amount).toLocaleString("en-IN")}`} icon={IndianRupee} />
              <StatPill label={tu("mnt.collection")} value={`${Number(summary.collection_percent).toFixed(0)}%`} icon={TrendingUp} />
            </StatPillRow>
          ) : undefined
        }
      />

      <div className="px-4 pt-4 space-y-4">
        <SectionCard bodyClassName="p-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground">{tu("mnt.year")}</label>
            <Input
              aria-label={tu("op.search_house_or_block")}
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || year)}
              className="w-20 h-9 rounded-xl"
            />
            <Button asChild variant="outline" size="sm" className="rounded-xl">
              <Link to="/society/matrix-import"><Upload className="h-4 w-4 mr-1" /> {tu("op.import")}</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportExcel().catch(() => toast.error(tu("op.couldn_t_prepare_the_export")))} className="rounded-xl">
              <Download className="h-4 w-4 mr-1" /> {tu("op.excel")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => exportPDF().catch(() => toast.error(tu("op.couldn_t_prepare_the_export")))} className="rounded-xl">
              <Download className="h-4 w-4 mr-1" /> PDF
            </Button>
          </div>
        </SectionCard>


        {summary && (
          <div className="grid grid-cols-2 gap-2.5">
            <Kpi icon={AlertTriangle} label={tu("bills.overdue")} value={summary.overdue_periods} tone="warn" />
            <Kpi icon={Home} label={tu("docState.pending")} value={summary.pending_periods} tone="warn" />
            <Kpi icon={TrendingUp} label={tu("mnt.advance")} value={summary.advance_periods} tone="info" />
            <Kpi
              icon={IndianRupee}
              label={tu("op.advance")}
              value={`₹${Number(summary.advance_amount).toLocaleString("en-IN")}`}
              tone="info"
            />
          </div>
        )}

        <SectionCard bodyClassName="p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-2">
            <Input
              placeholder={tu("op.search_unit_or_block")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="rounded-xl"
            />
            <Select value={blockFilter} onValueChange={setBlockFilter}>
              <SelectTrigger aria-label={tu("op.block_filter")}><SelectValue placeholder={tu("mnt.allBlocks")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tu("mnt.allBlocks")}</SelectItem>
                {blockOptions.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusKey)}>
              <SelectTrigger aria-label={tu("op.status_filter")}><SelectValue placeholder={tu("mnt.allStatuses")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{tu("mnt.allStatuses")}</SelectItem>
                {STATUS_KEYS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <LegendChip label={tu("bills.paid")} cls="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" />
            <LegendChip label={tu("docState.pending")} cls="bg-amber-500/15 text-amber-700 dark:text-amber-300" />
            <LegendChip label={tu("bills.overdue")} cls="bg-destructive/15 text-destructive" />
            <LegendChip label={tu("mnt.advance")} cls="bg-violet-500/15 text-violet-700 dark:text-violet-300" />
            <LegendChip label={tu("mnt.status.upcoming")} cls="bg-blue-500/10 text-blue-600" />
          </div>
        </SectionCard>

        {sidLoading || loading ? (
          <div className="grid place-items-center h-60">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="grid place-items-center h-60 text-sm text-muted-foreground">
            {tu("op.no_houses_match_your_search")}
          </div>
        ) : (
          <div className="-mx-4 sm:mx-0">
            <ul className="divide-y border-y border-border bg-card sm:hidden">
              {filtered.map((f) => (
                <li key={f.id} className="p-4">
                  <p className="font-semibold">{f.block_name}-{f.flat_number}</p>
                  <div className="mt-3 grid grid-cols-4 gap-2">
                    {MONTH_NAMES.map((month, mi) => {
                      const c = cell(f.id, mi);
                      return <div key={month} className="min-w-0 text-center"><p className="text-[10px] text-muted-foreground">{month}</p><p className={cn("mt-1 rounded-sm px-1 py-1 text-[10px] font-medium", c.cls)}>{c.label}</p></div>;
                    })}
                  </div>
                </li>
              ))}
            </ul>
            <div className="hidden max-h-[70vh] overflow-auto rounded-lg border bg-card sm:block">
              <table className="w-full text-xs">
                <thead className="bg-secondary sticky top-0 z-10">
                  <tr>
                    <th className="text-left p-2 sticky left-0 bg-secondary z-20 min-w-[100px]">{tu("nd.unit")}</th>
                    {MONTH_NAMES.map((m) => (
                      <th key={m} className="p-2 text-center font-medium min-w-[64px]">{m}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => (
                    <tr key={f.id} className="border-t">
                      <td className="p-2 sticky left-0 bg-card font-medium whitespace-nowrap z-10">
                        {f.block_name}-{f.flat_number}
                      </td>
                      {Array.from({ length: 12 }, (_, mi) => {
                        const c = cell(f.id, mi);
                        return (
                          <td key={mi} className="p-1">
                            <div className={cn("rounded-md py-1.5 text-center font-medium text-[11px]", c.cls)}>
                              {c.label}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function LegendChip({ label, cls }: { label: string; cls: string }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 font-medium", cls)}>{label}</span>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: any;
  label: string;
  value: string | number;
  tone: "ok" | "warn" | "danger" | "info" | "neutral";
}) {
  const toneCls =
    tone === "ok"
      ? "text-emerald-600 bg-emerald-500/10"
      : tone === "warn"
      ? "text-amber-600 bg-amber-500/10"
      : tone === "danger"
      ? "text-rose-600 bg-rose-500/10"
      : tone === "info"
      ? "text-violet-600 bg-violet-500/10"
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
