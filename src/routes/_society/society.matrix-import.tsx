import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Upload, Loader2, FileDown, ArrowLeft, CheckCircle2, AlertTriangle,
} from "lucide-react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSocietyId } from "@/hooks/useSocietyId";
import { PageHeader, PageShell } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ensureMaintenancePeriod } from "@/lib/maintenance.functions";

export const Route = createFileRoute("/_society/society/matrix-import")({
  head: () => ({ meta: [{ title: "Bulk Maintenance Import — SociyoHub" }] }),
  component: MatrixImportPage,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type Cell = { flatId: string; block: string; unit: string; month: number; amount: number; row: number };
type Issue = { row: number; msg: string };
type Failure = { row: number; unit: string; month: string; reason: string; cell: Cell };

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** Map any thrown error to a safe, admin-readable category. Never surfaces raw DB text. */
function safeReason(e: unknown): string {
  const msg = String((e as { message?: string } | null)?.message ?? "").toLowerCase();
  if (msg.includes("not authenticated") || msg.includes("401") || msg.includes("unauthorized")) return "Session expired — sign in again";
  if (msg.includes("not authorized") || msg.includes("permission") || msg.includes("denied")) return "Not allowed for this house";
  if (msg.includes("flat not found")) return "House no longer exists";
  if (msg.includes("network") || msg.includes("fetch")) return "Network problem";
  return "Could not be saved";
}

function pick(o: Record<string, unknown>, keys: string[]) {
  for (const k of keys) {
    const v = o[k] ?? o[k.toLowerCase()] ?? o[k.toUpperCase()];
    if (v !== undefined && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function MatrixImportPage() {
  const { societyId } = useSocietyId();
  const [year, setYear] = useState(new Date().getFullYear());
  const [cells, setCells] = useState<Cell[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [busy, setBusy] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [result, setResult] = useState<{ ok: number; failures: Failure[] } | null>(null);
  const ensure = useServerFn(ensureMaintenancePeriod);

  const summary = useMemo(() => {
    const total = cells.reduce((s, c) => s + c.amount, 0);
    return { rows: cells.length, total };
  }, [cells]);

  function downloadTemplate() {
    const ws = XLSX.utils.json_to_sheet([
      { Block: "A", Unit: "101", Jan: 2500, Feb: 2500, Mar: 2500, Apr: "", May: "", Jun: "", Jul: "", Aug: "", Sep: "", Oct: "", Nov: "", Dec: "" },
      { Block: "A", Unit: "102", Jan: 2500, Feb: 2500, Mar: "", Apr: "", May: "", Jun: "", Jul: "", Aug: "", Sep: "", Oct: "", Nov: "", Dec: "" },
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Matrix ${year}`);
    XLSX.writeFile(wb, `maintenance-matrix-template-${year}.xlsx`);
  }

  async function onFile(file: File) {
    if (!societyId || busy) return;
    setResult(null);
    setCells([]);
    setIssues([]);

    if (file.size === 0) { toast.error("That file is empty"); return; }
    if (file.size > MAX_FILE_BYTES) { toast.error("File is too large (max 5 MB)"); return; }

    setParsing(true);
    try {
    let rows: Record<string, unknown>[];
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const sheetName = wb.SheetNames[0];
      const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
      if (!sheet) { toast.error("No readable sheet found in this file"); return; }
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    } catch {
      toast.error("That file could not be read as a spreadsheet");
      return;
    }


    const { data: flats, error } = await supabase
      .from("flats")
      .select("id, flat_number, blocks!flats_block_id_fkey(name)")
      .eq("society_id", societyId);
    if (error) { toast.error("Could not load your houses. Please try again."); return; }

    const flatKey = (b: string, u: string) => `${b.toLowerCase().trim()}/${u.toLowerCase().trim()}`;
    const flatMap = new Map<string, string>();
    for (const f of (flats ?? []) as any[]) {
      flatMap.set(flatKey(f.blocks?.name ?? "", f.flat_number), f.id);
    }

    const newIssues: Issue[] = [];
    const newCells: Cell[] = [];
    const seen = new Set<string>();

    rows.forEach((raw, i) => {
      const block = pick(raw, ["Block", "block", "Tower", "tower"]);
      const unit = pick(raw, ["Unit", "unit", "Flat", "flat", "House", "house"]);
      const rowNum = i + 2;
      if (!block || !unit) {
        newIssues.push({ row: rowNum, msg: "Missing block or unit" });
        return;
      }
      const fid = flatMap.get(flatKey(block, unit));
      if (!fid) {
        newIssues.push({ row: rowNum, msg: `Unknown house ${block}-${unit}` });
        return;
      }
      for (let m = 0; m < 12; m++) {
        const v = raw[MONTHS[m]] ?? raw[MONTHS[m].toLowerCase()] ?? raw[MONTHS[m].toUpperCase()];
        const s = String(v ?? "").replace(/[,₹\s]/g, "").trim();
        if (!s) continue;
        const n = Number(s);
        if (!Number.isFinite(n) || n < 0 || n > 1_000_000 || Math.round(n * 100) !== n * 100) {
          newIssues.push({ row: rowNum, msg: `${MONTHS[m]}: invalid amount "${String(v)}"` });
          continue;
        }
        const key = `${fid}/${m}`;
        if (seen.has(key)) {
          newIssues.push({ row: rowNum, msg: `${MONTHS[m]}: duplicate entry for ${block}-${unit} (ignored)` });
          continue;
        }
        seen.add(key);
        newCells.push({ flatId: fid, block, unit, month: m, amount: n, row: rowNum });
      }
    });

    setCells(newCells);
    setIssues(newIssues);
    if (newCells.length === 0 && newIssues.length === 0) {
      toast.warning("No amounts found in file");
    }
    } finally {
      setParsing(false);
    }
  }

  async function commit(subset?: Cell[]) {
    const batch = subset ?? cells;
    if (!batch.length || busy) return;
    setBusy(true);
    const carriedOk = subset ? (result?.ok ?? 0) : 0;
    setResult(null);
    let ok = carriedOk;
    const failures: Failure[] = [];
    // Serialize: each period write is independently idempotent server-side.
    for (const c of batch) {
      try {
        const periodStart = `${year}-${String(c.month + 1).padStart(2, "0")}-01`;
        await ensure({
          data: { flatId: c.flatId, periodStart, amount: c.amount },
        });
        ok++;
      } catch (e) {
        failures.push({
          row: c.row,
          unit: `${c.block}-${c.unit}`,
          month: `${MONTHS[c.month]} ${year}`,
          reason: safeReason(e),
          cell: c,
        });
      }
    }
    setResult({ ok, failures });
    setBusy(false);
    if (failures.length === 0) toast.success(`Imported ${ok} period${ok === 1 ? "" : "s"}`);
    else toast.warning(`Imported ${ok}, ${failures.length} failed — see details below`);
  }

  return (
    <PageShell>
      <div className="flex items-center gap-2 mb-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/society/matrix"><ArrowLeft className="h-4 w-4 mr-1" /> Matrix</Link>
        </Button>
      </div>
      <PageHeader
        title="Bulk Maintenance Import"
        description="Upload a matrix Excel (Block, Unit, Jan..Dec) to seed a whole year in one shot."
      />

      <Card className="rounded-2xl">
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted-foreground">Year</label>
            <Input
              type="number" value={year}
              onChange={(e) => setYear(Number(e.target.value) || year)}
              className="w-24 h-9"
            />
            <Button variant="outline" onClick={downloadTemplate} className="rounded-xl">
              <FileDown className="h-4 w-4 mr-1.5" /> Template
            </Button>
            <label className="inline-flex">
              <input
                type="file" accept=".xlsx,.xls,.csv" className="hidden"
                disabled={busy || parsing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onFile(f);
                }}
              />
              <span className={`inline-flex items-center px-3 h-9 rounded-xl border bg-primary text-primary-foreground text-sm hover:opacity-90 ${busy || parsing ? "opacity-60 pointer-events-none" : "cursor-pointer"}`}>
                {parsing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Upload className="h-4 w-4 mr-1.5" />}
                {parsing ? "Reading file…" : "Choose Excel"}
              </span>
            </label>
          </div>

          {(cells.length > 0 || issues.length > 0) && (
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Cells" value={cells.length} tone="ok" />
              <Stat label="Total ₹" value={`₹${summary.total.toLocaleString("en-IN")}`} tone="info" />
              <Stat label="Issues" value={issues.length} tone={issues.length ? "warn" : "neutral"} />
            </div>
          )}

          {issues.length > 0 && (
            <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 p-3 max-h-48 overflow-auto text-xs space-y-1">
              {issues.slice(0, 30).map((iss, i) => (
                <div key={i} className="flex items-start gap-2">
                  <AlertTriangle className="h-3 w-3 text-amber-600 mt-0.5 shrink-0" />
                  <span>Row {iss.row}: {iss.msg}</span>
                </div>
              ))}
              {issues.length > 30 && (
                <div className="text-muted-foreground pt-1">…and {issues.length - 30} more</div>
              )}
            </div>
          )}

          {cells.length > 0 && (
            <div className="max-h-64 overflow-auto rounded-xl border">
              <table className="w-full text-xs">
                <thead className="bg-secondary">
                  <tr>
                    <th className="p-2 text-left">Unit</th>
                    <th className="p-2 text-left">Month</th>
                    <th className="p-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {cells.slice(0, 200).map((c, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{c.block}-{c.unit}</td>
                      <td className="p-2">{MONTHS[c.month]} {year}</td>
                      <td className="p-2 text-right">₹{c.amount.toLocaleString("en-IN")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {cells.length > 200 && (
                <div className="p-2 text-xs text-muted-foreground text-center">…and {cells.length - 200} more</div>
              )}
            </div>
          )}

          {cells.length > 0 && (
            <div className="flex justify-end">
              <Button onClick={() => void commit()} disabled={busy} className="rounded-xl">
                {busy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1.5" />}
                Commit {cells.length} period{cells.length === 1 ? "" : "s"}
              </Button>
            </div>
          )}

          {result && (
            <div className={`rounded-xl p-3 text-sm space-y-2 ${result.failures.length === 0 ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}>
              <div className="font-medium">
                {result.failures.length === 0
                  ? `All ${result.ok} amounts saved`
                  : `Partly imported — ${result.ok} saved, ${result.failures.length} not saved`}
              </div>
              {result.failures.length > 0 && (
                <>
                  <div className="max-h-40 overflow-auto space-y-1 text-xs">
                    {result.failures.slice(0, 30).map((f, i) => (
                      <div key={i}>Row {f.row} · {f.unit} · {f.month} — {f.reason}</div>
                    ))}
                    {result.failures.length > 30 && (
                      <div>…and {result.failures.length - 30} more</div>
                    )}
                  </div>
                  <Button
                    size="sm" variant="outline" className="rounded-xl" disabled={busy}
                    onClick={() => void commit(result.failures.map((f) => f.cell))}
                  >
                    Retry failed
                  </Button>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone: "ok" | "warn" | "info" | "neutral" }) {
  const cls = tone === "ok" ? "text-emerald-600" : tone === "warn" ? "text-amber-600" : tone === "info" ? "text-violet-600" : "text-muted-foreground";
  return (
    <div className="rounded-xl border p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
