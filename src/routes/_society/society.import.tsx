import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Upload, Loader2, FileDown, CheckCircle2, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_society/society/import")({
  head: () => ({ meta: [{ title: "Bulk Import — SocioHub" }] }),
  component: ImportPage,
});

type Row = { block: string; flat_number: string; resident_name?: string; phone?: string; email?: string; offline?: string | boolean };

function ImportPage() {
  const { societyId } = useSocietyId();
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ flats: number; residents: number; errors: string[] } | null>(null);

  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet([
      { block: "A", flat_number: "101", resident_name: "Ravi Patel", phone: "9000000001", email: "ravi@example.com", offline: "no" },
      { block: "A", flat_number: "102", resident_name: "Offline Owner", phone: "9000000002", email: "", offline: "yes" },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Residents");
    XLSX.writeFile(wb, "sociohub-residents-template.xlsx");
  }

  async function onFile(file: File) {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf);
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<Row>(sheet, { defval: "" });
    const norm = data
      .map((r) => ({
        block: String((r as any).block ?? (r as any).Block ?? "").trim(),
        flat_number: String((r as any).flat_number ?? (r as any).Flat ?? (r as any).Unit ?? "").trim(),
        resident_name: String((r as any).resident_name ?? (r as any).Name ?? "").trim(),
        phone: String((r as any).phone ?? (r as any).Phone ?? "").trim(),
        email: String((r as any).email ?? (r as any).Email ?? "").trim(),
        offline: r.offline,
      }))
      .filter((r) => r.block && r.flat_number);
    setRows(norm);
    setResult(null);
  }

  async function commit() {
    if (!societyId || !rows.length) return;
    setBusy(true);
    const errors: string[] = [];
    let flatCount = 0;
    let resCount = 0;

    // 1. Build unique blocks
    const blockNames = Array.from(new Set(rows.map((r) => r.block)));
    const existingBlocks = await supabase.from("blocks").select("id,name").eq("society_id", societyId);
    if (existingBlocks.error) { toast.error(existingBlocks.error.message); setBusy(false); return; }
    const blockMap = new Map<string, string>();
    for (const b of existingBlocks.data ?? []) blockMap.set(b.name, b.id);
    for (const name of blockNames) {
      if (!blockMap.has(name)) {
        const { data, error } = await supabase.from("blocks").insert({ society_id: societyId, name }).select("id").single();
        if (error) errors.push(`Block ${name}: ${error.message}`);
        else blockMap.set(name, data!.id);
      }
    }

    // 2. Upsert flats
    const flatKey = (block: string, n: string) => `${block}/${n}`;
    const existingFlats = await supabase.from("flats").select("id,flat_number,blocks!flats_block_id_fkey(name)").eq("society_id", societyId);
    const flatMap = new Map<string, string>();
    for (const f of (existingFlats.data ?? []) as any[]) flatMap.set(flatKey(f.blocks?.name ?? "", f.flat_number), f.id);

    for (const r of rows) {
      const bid = blockMap.get(r.block);
      if (!bid) continue;
      const key = flatKey(r.block, r.flat_number);
      if (!flatMap.has(key)) {
        const { data, error } = await supabase.from("flats").insert({ society_id: societyId, block_id: bid, flat_number: r.flat_number }).select("id").single();
        if (error) { errors.push(`Flat ${key}: ${error.message}`); continue; }
        flatMap.set(key, data!.id);
        flatCount++;
      }
    }

    // 3. Insert offline-only resident profiles (no auth user). Online residents must sign up + be approved via join-request flow.
    for (const r of rows) {
      const offline = String(r.offline ?? "").toLowerCase();
      if (!r.resident_name || !(offline === "yes" || offline === "true" || offline === "1")) continue;
      const flatId = flatMap.get(flatKey(r.block, r.flat_number));
      if (!flatId) continue;
      const { error } = await supabase.from("offline_residents").insert({
        society_id: societyId,
        flat_id: flatId,
        full_name: r.resident_name,
        phone: r.phone || null,
        email: r.email || null,
      });
      if (error) errors.push(`Offline ${r.resident_name}: ${error.message}`);
      else resCount++;
    }

    setResult({ flats: flatCount, residents: resCount, errors });
    setBusy(false);
    toast.success(`Imported ${flatCount} flats and ${resCount} offline residents`);
  }

  return (
    <PageShell>
      <PageHeader title="Bulk Import Residents" description="Upload an Excel sheet to add blocks, units, and offline residents in one shot" />
      <Card className="rounded-2xl">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <Button variant="outline" onClick={downloadTemplate}><FileDown className="h-4 w-4 mr-1" /> Download template</Button>
            <label className="inline-flex">
              <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
              <Button asChild><span><Upload className="h-4 w-4 mr-1" /> Choose file</span></Button>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Columns: <code>block, flat_number, resident_name, phone, email, offline</code>. Set <code>offline=yes</code> for residents who don't use the app (admin keeps their accounts). Online residents should sign up & request to join.
          </p>
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-medium">Preview · {rows.length} rows</p>
              <Button onClick={commit} disabled={busy}>{busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} Import</Button>
            </div>
            <div className="overflow-auto max-h-80 rounded-xl border">
              <table className="w-full text-xs">
                <thead className="bg-secondary sticky top-0"><tr>{["Block","Unit","Name","Phone","Email","Offline"].map((h) => <th key={h} className="p-2 text-left">{h}</th>)}</tr></thead>
                <tbody>
                  {rows.slice(0, 200).map((r, i) => (
                    <tr key={i} className="border-t"><td className="p-2">{r.block}</td><td className="p-2">{r.flat_number}</td><td className="p-2">{r.resident_name}</td><td className="p-2">{r.phone}</td><td className="p-2">{r.email}</td><td className="p-2">{String(r.offline)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-2">
            <div className="flex items-center gap-2 text-emerald-600"><CheckCircle2 className="h-5 w-5" /> Created {result.flats} flats · {result.residents} offline residents</div>
            {result.errors.length > 0 && (
              <div className="space-y-1 text-sm">
                <div className="flex items-center gap-2 text-amber-600"><AlertTriangle className="h-4 w-4" /> {result.errors.length} issues</div>
                <ul className="list-disc pl-5 text-xs text-muted-foreground">{result.errors.slice(0, 20).map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
