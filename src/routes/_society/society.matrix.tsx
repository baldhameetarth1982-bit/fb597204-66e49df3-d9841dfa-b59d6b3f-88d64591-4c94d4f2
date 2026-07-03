import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Download, Upload, TrendingUp, Home, IndianRupee, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { societyMaintenanceSummary } from "@/lib/residents.functions";

export const Route = createFileRoute("/_society/society/matrix")({
  head: () => ({ meta: [{ title: "Maintenance Matrix — SocioHub" }] }),
  component: MatrixPage,
});

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type FlatRow = { id: string; flat_number: string; block_name: string };
type Period = { flat_id: string; period_start: string; status: string; amount_due: number; due_date: string | null };

function MatrixPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [year, setYear] = useState(new Date().getFullYear());
  const [flats, setFlats] = useState<FlatRow[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

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

  const filtered = flats.filter(
    (f) => !q || (f.flat_number + " " + f.block_name).toLowerCase().includes(q.toLowerCase()),
  );

  function exportExcel() {
    const rows = filtered.map((f) => {
      const row: Record<string, string> = { Block: f.block_name, Unit: f.flat_number };
      for (let m = 0; m < 12; m++) row[MONTH_NAMES[m]] = cell(f.id, m).label;
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Matrix ${year}`);
    XLSX.writeFile(wb, `maintenance-matrix-${year}.xlsx`);
  }

  function exportPDF() {
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
    toast.success("PDF exported");
  }

  return (
    <PageShell>
      <PageHeader
        title="Maintenance Matrix"
        description="Every unit, every month — at one glance"
        actions={
          <div className="flex items-center gap-2">
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value) || year)}
              className="w-20 h-9"
            />
            <Button asChild variant="outline" size="sm" className="rounded-xl">
              <Link to="/society/matrix-import"><Upload className="h-4 w-4 mr-1" /> Import</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={exportExcel} className="rounded-xl">
              <Download className="h-4 w-4 mr-1" /> Excel
            </Button>
            <Button variant="outline" size="sm" onClick={exportPDF} className="rounded-xl">
              <Download className="h-4 w-4 mr-1" /> PDF
            </Button>
          </div>
        }
      />

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
          <Kpi icon={Home} label="Houses" value={summary.total_houses} tone="neutral" />
          <Kpi icon={CheckCircle2} label="Paid" value={summary.paid_periods} tone="ok" />
          <Kpi
            icon={IndianRupee}
            label="Outstanding"
            value={`₹${Number(summary.outstanding_amount).toLocaleString("en-IN")}`}
            tone="danger"
          />
          <Kpi
            icon={TrendingUp}
            label="Collection"
            value={`${Number(summary.collection_percent).toFixed(1)}%`}
            tone="ok"
          />
          <Kpi icon={AlertTriangle} label="Overdue" value={summary.overdue_periods} tone="warn" />
          <Kpi icon={Home} label="Pending" value={summary.pending_periods} tone="warn" />
          <Kpi icon={TrendingUp} label="Advance" value={summary.advance_periods} tone="info" />
          <Kpi
            icon={IndianRupee}
            label="Advance ₹"
            value={`₹${Number(summary.advance_amount).toLocaleString("en-IN")}`}
            tone="info"
          />
        </div>
      )}

      <Input
        placeholder="Search unit or block…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-sm mb-3 rounded-xl"
      />

      {sidLoading || loading ? (
        <div className="grid place-items-center h-60">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="grid place-items-center h-60 text-sm text-muted-foreground">
          No houses match your search.
        </div>
      ) : (
        <div className="overflow-auto rounded-2xl border bg-card max-h-[70vh]">
          <table className="w-full text-xs">
            <thead className="bg-secondary sticky top-0 z-10">
              <tr>
                <th className="text-left p-2 sticky left-0 bg-secondary z-20 min-w-[100px]">Unit</th>
                {MONTH_NAMES.map((m) => (
                  <th key={m} className="p-2 text-center font-medium min-w-[72px]">{m}</th>
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
      )}
    </PageShell>
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
