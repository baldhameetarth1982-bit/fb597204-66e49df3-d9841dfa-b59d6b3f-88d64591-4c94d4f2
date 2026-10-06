import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAuditorPackExtras, type AuditorExtras } from "@/lib/workstream7.functions";
import { writeSafeWorkbook } from "@/lib/spreadsheet-safety";
import { tu } from "@/lib/i18n";

const PARTS: { key: keyof AuditorExtras; label: string; note: string }[] = [
  { key: "adjustments", label: "Bill adjustments", note: "Append-only corrections to dues" },
  { key: "opening_balances", label: "Opening balances", note: "Imported evidence, kept apart from bills" },
  { key: "resolutions", label: "Meeting resolutions", note: "Decisions recorded in meetings" },
];

/** Read-only extra evidence for the Auditor Pack period; loaded through a finance-admin, rate-limited server call. */
export function AuditorExtrasSection({ societyId, from, to }: { societyId: string; from: string; to: string }) {
  const get = useServerFn(getAuditorPackExtras);
  const q = useQuery({ queryKey: ["auditor-extras", societyId, from, to], queryFn: () => get({ data: { societyId, from, to } }), staleTime: 60_000 });
  if (q.isLoading) return <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{tu("common.loading")}</p>;
  if (q.isError) return <div className="p-4"><p className="text-sm text-destructive">{(q.error as Error).message}</p><Button variant="outline" className="mt-2 min-h-11" onClick={() => q.refetch()}>{tu("common.retry")}</Button></div>;
  const d = q.data!;
  return (
    <ul className="divide-y">{PARTS.map((p) => (
      <li key={p.key} className="flex min-h-14 items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1"><p className="text-sm font-medium">{p.label}</p><p className="text-xs text-muted-foreground">{p.note}</p></div>
        <span className="text-sm tabular-nums">{d[p.key].total}</span>
        <Button size="sm" variant="outline" className="min-h-11" disabled={!d[p.key].rows.length}
          onClick={() => writeSafeWorkbook(d[p.key].rows as Record<string, string | number>[], p.label.slice(0, 30), `${p.key}_${from}_${to}.xlsx`)}
          aria-label={`Download ${p.label}`}><Download className="h-4 w-4" /></Button>
      </li>
    ))}</ul>
  );
}
