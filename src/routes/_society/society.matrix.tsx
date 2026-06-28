import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Grid3x3, Loader2, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_society/society/matrix")({
  head: () => ({ meta: [{ title: "Maintenance Matrix — SocioHub" }] }),
  component: MatrixPage,
});

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type FlatRow = { id: string; flat_number: string; block_name: string };

function MatrixPage() {
  const { societyId, loading: sidLoading } = useSocietyId();
  const [year, setYear] = useState(new Date().getFullYear());
  const [flats, setFlats] = useState<FlatRow[]>([]);
  const [bills, setBills] = useState<{ id: string; flat_id: string; amount: number; status: string; period_start: string; due_date: string }[]>([]);
  const [paid, setPaid] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!societyId) return;
    let cancel = false;
    (async () => {
      setLoading(true);
      const [f, b] = await Promise.all([
        supabase.from("flats").select("id,flat_number,blocks!flats_block_id_fkey(name)").eq("society_id", societyId),
        supabase.from("bills").select("id,flat_id,amount,status,period_start,due_date").eq("society_id", societyId).gte("period_start", `${year}-01-01`).lte("period_start", `${year}-12-31`),
      ]);
      if (cancel) return;
      if (f.error || b.error) toast.error(f.error?.message || b.error?.message || "Load failed");
      const billIds = (b.data ?? []).map((x: any) => x.id);
      const p = billIds.length ? await supabase.from("payments").select("bill_id,amount").in("bill_id", billIds).eq("status", "success") : { data: [] as any[] };
      const paidMap: Record<string, number> = {};
      for (const x of p.data ?? []) paidMap[x.bill_id] = (paidMap[x.bill_id] ?? 0) + Number(x.amount);
      setFlats(((f.data ?? []) as any[]).map((x) => ({ id: x.id, flat_number: x.flat_number, block_name: x.blocks?.name ?? "—" })).sort((a, b) => (a.block_name + a.flat_number).localeCompare(b.block_name + b.flat_number, undefined, { numeric: true })));
      setBills(((b.data ?? []) as any[]).map((x) => ({ ...x, amount: Number(x.amount) })));
      setPaid(paidMap);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [societyId, year]);

  const today = useMemo(() => new Date(), []);

  const cell = (flatId: string, mi: number) => {
    const b = bills.find((x) => x.flat_id === flatId && new Date(x.period_start).getMonth() === mi);
    if (!b) return { label: today.getFullYear() === year && mi > today.getMonth() ? "Not due" : "—", cls: "bg-muted text-muted-foreground" };
    const p = paid[b.id] ?? 0;
    if (b.status === "cancelled") return { label: "—", cls: "bg-muted text-muted-foreground line-through" };
    if (p >= b.amount) return { label: "Paid", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" };
    if (new Date(b.due_date) < today) return { label: "Overdue", cls: "bg-destructive/15 text-destructive" };
    return { label: "Pending", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" };
  };

  const filtered = flats.filter((f) => !q || (f.flat_number + " " + f.block_name).toLowerCase().includes(q.toLowerCase()));

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

  return (
    <PageShell>
      <PageHeader title="Maintenance Matrix" description="Every unit, every month — at one glance" actions={
        <div className="flex items-center gap-2">
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || year)} className="w-24" />
          <Button variant="outline" onClick={exportExcel}><Download className="h-4 w-4 mr-1" /> Excel</Button>
        </div>
      } />
      <Input placeholder="Search unit or block…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
      {sidLoading || loading ? (
        <div className="grid place-items-center h-60"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="overflow-auto rounded-2xl border bg-card">
          <table className="w-full text-xs">
            <thead className="bg-secondary sticky top-0">
              <tr>
                <th className="text-left p-2 sticky left-0 bg-secondary">Unit</th>
                {MONTH_NAMES.map((m) => <th key={m} className="p-2 text-center font-medium">{m}</th>)}
              </tr>
            </thead>
            <tbody>
              {filtered.map((f) => (
                <tr key={f.id} className="border-t">
                  <td className="p-2 sticky left-0 bg-card font-medium whitespace-nowrap">{f.block_name}-{f.flat_number}</td>
                  {Array.from({ length: 12 }, (_, mi) => {
                    const c = cell(f.id, mi);
                    return <td key={mi} className="p-1"><div className={cn("rounded-md py-1.5 text-center font-medium", c.cls)}>{c.label}</div></td>;
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
