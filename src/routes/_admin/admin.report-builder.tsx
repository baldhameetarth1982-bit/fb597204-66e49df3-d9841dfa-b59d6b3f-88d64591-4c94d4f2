import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, Download, Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/_admin/admin/report-builder")({
  head: () => ({ meta: [{ title: "Report Builder — Super Admin" }] }),
  component: ReportBuilder,
});

type Dataset = "societies" | "bills" | "payments" | "visitors" | "audit_log";

const DATASETS: Record<Dataset, { label: string; fields: string[]; dateField?: string; select: string }> = {
  societies:   { label: "Societies", fields: ["id","name","plan_id","plan_status","status","created_at"], dateField: "created_at", select: "id,name,plan_id,plan_status,status,created_at" },
  bills:       { label: "Bills", fields: ["id","society_id","amount","status","bill_date","due_date","paid_at"], dateField: "bill_date", select: "id,society_id,amount,status,bill_date,due_date,paid_at" },
  payments:    { label: "Payments", fields: ["id","society_id","amount","status","method","paid_at","created_at"], dateField: "created_at", select: "id,society_id,amount,status,method,paid_at,created_at" },
  visitors:    { label: "Visitors", fields: ["id","society_id","visitor_name","status","entry_at","exit_at","created_at"], dateField: "created_at", select: "id,society_id,visitor_name,status,entry_at,exit_at,created_at" },
  audit_log:   { label: "Audit log", fields: ["id","actor_id","action","target_table","target_id","society_id","created_at"], dateField: "created_at", select: "id,actor_id,action,target_table,target_id,society_id,created_at" },
};

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

  const { data: rows = [], isFetching, refetch } = useQuery({
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
    const csv = toCsv(filtered, cfg.fields);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${dataset}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="px-6 py-8 space-y-6 max-w-7xl">
      <header className="flex items-center gap-3">
        <FileText className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Custom Report Builder</h1>
          <p className="text-sm text-muted-foreground">Pick a dataset, apply filters, export CSV.</p>
        </div>
      </header>

      <Card className="rounded-2xl">
        <CardContent className="p-4 grid md:grid-cols-4 gap-3">
          <div>
            <Label>Dataset</Label>
            <Select value={dataset} onValueChange={(v) => setDataset(v as Dataset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(DATASETS).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={!cfg.dateField} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={!cfg.dateField} />
          </div>
          <div className="flex items-end gap-2">
            <Button variant="outline" onClick={() => refetch()} className="flex-1">Refresh</Button>
            <Button onClick={download} disabled={!filtered.length}><Download className="h-4 w-4 mr-1" />CSV</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardContent className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search any column…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
          </div>
        </CardContent>
        <CardContent className="p-0 overflow-x-auto">
          {isFetching ? (
            <div className="p-8 text-center"><Loader2 className="h-5 w-5 inline animate-spin" /></div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {cfg.fields.map((f) => <TableHead key={f}>{f}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.slice(0, 500).map((r, i) => (
                  <TableRow key={r.id ?? i}>
                    {cfg.fields.map((f) => (
                      <TableCell key={f} className="text-xs font-mono max-w-[220px] truncate">
                        {typeof r[f] === "string" && r[f].length > 30 ? r[f].slice(0, 30) + "…" : String(r[f] ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={cfg.fields.length} className="text-center py-8 text-muted-foreground">No rows</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
        <CardContent className="p-3 border-t text-xs text-muted-foreground">
          Showing {Math.min(filtered.length, 500)} of {filtered.length} rows. Export includes all filtered rows.
        </CardContent>
      </Card>
    </div>
  );
}
