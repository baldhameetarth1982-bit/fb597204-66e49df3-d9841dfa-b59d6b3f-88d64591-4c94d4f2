import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { GitCompare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { compareMigrationUnits, type CompareResult } from "@/lib/workstream7.functions";
import { pick, readSheetRows } from "@/lib/sheet-rows";

const LABEL: Record<string, string> = { changed: "Changed", missing: "Not in SociyoHub", conflicting: "Conflicting", unresolved: "Unresolved" };

/** Compare-only: shows how a source unit list differs from SociyoHub. Never writes anything. */
export function MigrationCompare({ societyId }: { societyId: string }) {
  const compare = useServerFn(compareMigrationUnits);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<CompareResult | null>(null);

  async function onFile(f: File | undefined) {
    if (!f) return;
    setErr(null); setRes(null); setBusy(true);
    try {
      const r = await readSheetRows(f);
      if (!r.ok) { setErr(r.error); return; }
      const rows = r.rows.map((x) => ({
        structure: pick(x, "structure", "block", "wing", "tower").slice(0, 80),
        unit: pick(x, "unit", "flat", "flat_number", "unit_number", "flat_no").slice(0, 40),
        area_sqft: pick(x, "area_sqft", "area", "sqft").slice(0, 20),
        unit_type: pick(x, "unit_type", "type", "bhk").slice(0, 40),
      }));
      setRes(await compare({ data: { societyId, rows } }));
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
      <div>
        <p className="flex items-center gap-1.5 font-semibold"><GitCompare className="h-4 w-4" />Compare with your old data</p>
        <p className="text-xs text-muted-foreground">Upload a unit list (CSV or Excel with columns like Block, Flat, Area, Type). Nothing is changed — fix differences through the normal screens.</p>
      </div>
      <label className="inline-flex">
        <input type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        <Button asChild variant="outline" className="min-h-11 rounded-xl" disabled={busy}>
          <span>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <GitCompare className="mr-1.5 h-4 w-4" />}Choose file to compare</span>
        </Button>
      </label>
      {err && <p role="alert" className="text-sm text-destructive">{err}</p>}
      {res && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 text-xs">
            <StatusChip tone="success">{res.matched} matched</StatusChip>
            <StatusChip tone="warning">{res.changed} changed</StatusChip>
            <StatusChip tone="danger">{res.missing} not in SociyoHub</StatusChip>
            <StatusChip tone="neutral">{res.conflicting_or_unresolved} conflicting / unresolved</StatusChip>
            <StatusChip tone="neutral">{res.only_in_sociyohub} only in SociyoHub</StatusChip>
          </div>
          {res.rows.length > 0 && (
            <div className="max-h-72 overflow-auto rounded-xl border border-border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted"><tr>{["Row", "Unit", "Result", "Differs in"].map((h) => <th key={h} className="p-2 text-left font-medium text-muted-foreground">{h}</th>)}</tr></thead>
                <tbody>{res.rows.map((r) => (
                  <tr key={r.row} className="border-t border-border">
                    <td className="p-2 tabular-nums">{r.row}</td>
                    <td className="p-2">{[r.structure, r.unit].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="p-2">{LABEL[r.status] ?? r.status}</td>
                    <td className="p-2">{r.fields.join(", ").replace("area_sqft", "area").replace("unit_type", "type") || "—"}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
