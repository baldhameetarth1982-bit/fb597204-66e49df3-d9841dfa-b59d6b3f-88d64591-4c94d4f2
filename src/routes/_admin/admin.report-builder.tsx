import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Search, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState } from "@/components/system/ErrorState";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";

export const Route = createFileRoute("/_admin/admin/report-builder")({
  head: () => ({ meta: [{ title: "Report Builder — Super Admin" }] }),
  component: ReportBuilder,
});

type Dataset = "societies" | "bills" | "payments" | "visitors" | "audit_log";

const DATASETS: Record<Dataset, { label: string; fields: string[]; dateField?: string; select: string }> = {
  societies: { label: "Societies", fields: ["id", "name", "plan_id", "plan_status", "status", "created_at"], dateField: "created_at", select: "id,name,plan_id,plan_status,status,created_at" },
  bills: { label: "Bills", fields: ["id", "society_id", "amount", "status", "bill_date", "due_date", "paid_at"], dateField: "bill_date", select: "id,society_id,amount,status,bill_date,due_date,paid_at" },
  payments: { label: "Payments", fields: ["id", "society_id", "amount", "status", "method", "paid_at", "created_at"], dateField: "created_at", select: "id,society_id,amount,status,method,paid_at,created_at" },
  visitors: { label: "Visitors", fields: ["id", "society_id", "visitor_name", "status", "entry_at", "exit_at", "created_at"], dateField: "created_at", select: "id,society_id,visitor_name,status,entry_at,exit_at,created_at" },
  audit_log: { label: "Audit log", fields: ["id", "actor_id", "action", "target_table", "target_id", "society_id", "created_at"], dateField: "created_at", select: "id,actor_id,action,target_table,target_id,society_id,created_at" },
};

const label = (f: string) => f.replace(/_/g, " ");

function toCsv(rows: any[], fields: string[]) {
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replaceAll('"', '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  return [fields.join(","), ...rows.map((r) => fields.map((f) => esc(r[f])).join(","))].join("\n");
}

function ReportBuilder() {
  const [dataset, setDataset] = useState<Dataset>("bills");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const cfg = DATASETS[dataset];

  const { data: rows = [], isFetching, isError, refetch } = useQuery({
    queryKey: ["report-builder", dataset, from, to],
    queryFn: async () => {
      let query = supabase.from(dataset as any).select(cfg.select).limit(2000);
      if (cfg.dateField && from) query = query.gte(cfg.dateField, from);
      if (cfg.dateField && to) query = query.lte(cfg.dateField, to);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => Object.values(r).some((v) => String(v ?? "").toLowerCase().includes(s)));
  }, [rows, q]);

  const download = () => {
    const blob = new Blob([toCsv(filtered, cfg.fields)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageShell>
      <PageHeader
        title="Report Builder"
        description="Choose a dataset, narrow it down, then export CSV."
        actions={<Button onClick={download} disabled={!filtered.length || isFetching} className="h-11 rounded-xl"><Download className="mr-1 h-4 w-4" /> Export {filtered.length ? filtered.length.toLocaleString("en-IN") : ""} rows</Button>}
      />

      <div className="space-y-4">
        <div role="tablist" aria-label="Dataset" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
          {(Object.keys(DATASETS) as Dataset[]).map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={dataset === k}
              onClick={() => setDataset(k)}
              className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors ${dataset === k ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"}`}
            >
              {DATASETS[k].label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 rounded-2xl border border-border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-end">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search any column" placeholder="Search any column…" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 pl-9" />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:contents">
            <div className="space-y-1"><Label htmlFor="rb-from" className="text-xs">From</Label><Input id="rb-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!cfg.dateField} className="h-11" /></div>
            <div className="space-y-1"><Label htmlFor="rb-to" className="text-xs">To</Label><Input id="rb-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={!cfg.dateField} className="h-11" /></div>
          </div>
          <Button variant="outline" onClick={() => refetch()} className="h-11 rounded-xl" aria-label="Refresh">
            {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}<span className="ml-1 sm:hidden">Refresh</span>
          </Button>
        </div>

        {isError ? (
          <ErrorState onRetry={() => refetch()} showSupport={false} />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="max-h-[65vh] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>{cfg.fields.map((f) => <th key={f} className="whitespace-nowrap px-3 py-2.5 font-medium">{label(f)}</th>)}</tr>
                </thead>
                <tbody className={`divide-y divide-border ${isFetching ? "opacity-50" : ""}`}>
                  {filtered.slice(0, 500).map((r, i) => (
                    <tr key={r.id ?? i} className="hover:bg-muted/40">
                      {cfg.fields.map((f) => (
                        <td key={f} className="max-w-[220px] truncate whitespace-nowrap px-3 py-2 font-mono text-xs" title={String(r[f] ?? "")}>{String(r[f] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                  {!isFetching && filtered.length === 0 && (
                    <tr><td colSpan={cfg.fields.length} className="py-10 text-center text-muted-foreground">No rows match these filters.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
              Showing {Math.min(filtered.length, 500).toLocaleString("en-IN")} of {filtered.length.toLocaleString("en-IN")} rows. Export includes every filtered row.
            </p>
          </div>
        )}
      </div>
    </PageShell>
  );
}
