import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, DatabaseBackup, Download, FileJson, FileSpreadsheet, Loader2, RotateCw } from "lucide-react";
import { MobileHero } from "@/components/shared/MobileHero";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useSocietyId } from "@/hooks/useSocietyId";
import { getSocietyExportPage } from "@/lib/society-export.functions";
import { EXPORT_SECTIONS, exportToWorkbook, type SocietyExport } from "@/lib/society-export";
import { downloadBlob } from "@/lib/auditor-pack";
import { tu } from "@/lib/i18n";

export const Route = createFileRoute("/_society/society/data-export")({
  head: () => ({ meta: [
    { title: "Society data export — SociyoHub" },
    { name: "description", content: "Download a complete copy of your society's records for backup or migration." },
    { property: "og:title", content: "Society data export — SociyoHub" },
    { property: "og:description", content: "A complete, admin-only copy of your society's records." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: DataExportPage,
});

type Status = "idle" | "running" | "done" | "failed";

function DataExportPage() {
  const { societyId } = useSocietyId();
  const fetchPage = useServerFn(getSocietyExportPage);
  const [status, setStatus] = useState<Status>("idle");
  const [done, setDone] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SocietyExport | null>(null);
  // Partial progress is kept so Retry resumes from the failed section, not from scratch.
  const partial = useRef<{ sections: Record<string, Record<string, unknown>[]>; index: number; offset: number } | null>(null);

  async function run() {
    if (!societyId || status === "running") return;
    if (!partial.current) partial.current = { sections: {}, index: 0, offset: 0 };
    const p = partial.current;
    setStatus("running"); setError(null); setResult(null);
    try {
      while (p.index < EXPORT_SECTIONS.length) {
        const key = EXPORT_SECTIONS[p.index].key;
        const page = await fetchPage({ data: { societyId, section: key, offset: p.offset } });
        (p.sections[key] ??= []).push(...page.rows);
        if (page.has_more) { p.offset += page.page_size; continue; }
        p.index += 1; p.offset = 0; setDone(p.index);
      }
      const data: SocietyExport = {
        format: "sociyohub.society-export", version: 1,
        generated_at: new Date().toISOString(), society_id: societyId, sections: p.sections,
      };
      partial.current = null;
      setResult(data); setStatus("done");
    } catch (e) {
      setError(typeof navigator !== "undefined" && !navigator.onLine
        ? "You're offline. Reconnect, then tap Retry to continue where it stopped."
        : e instanceof Error ? e.message : "The export stopped. Tap Retry to continue.");
      setStatus("failed");
    }
  }

  const stamp = result?.generated_at.slice(0, 10) ?? "";
  const total = EXPORT_SECTIONS.length;
  const records = result ? Object.values(result.sections).reduce((n, r) => n + r.length, 0) : 0;

  return <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
    <MobileHero eyebrow={tu("op.society_data")} title={tu("op.full_data_export")} subtitle={tu("op.a_complete_copy_of_your")} icon={DatabaseBackup} variant="teal" />
    <div className="px-4 md:px-6 space-y-4 max-w-3xl">
      <SectionCard title={tu("op.what_s_included")}>
        <p className="text-sm text-muted-foreground">
          {tu("op.structure_flats_residents_family_team")}
        </p>
      </SectionCard>

      <SectionCard title={tu("op.export")}>
        <div className="space-y-4">
          {status !== "idle" && <div className="space-y-2">
            <Progress value={(done / total) * 100} aria-label={tu("op.export_progress")} />
            <p className="text-sm text-muted-foreground" aria-live="polite">
              {status === "running" && <>{tu("op.collecting")} {EXPORT_SECTIONS[Math.min(done, total - 1)].label.toLowerCase()} ({done}/{total})…</>}
              {status === "done" && <span className="inline-flex items-center gap-1.5 text-foreground"><CheckCircle2 className="h-4 w-4 text-primary" /> {tu("op.ready")} {records.toLocaleString("en-IN")} records.</span>}
            </p>
          </div>}
          {error && <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
          </div>}
          {status !== "done" && <Button className="min-h-11 w-full sm:w-auto" disabled={!societyId || status === "running"} onClick={run}>
            {status === "running" ? <Loader2 className="h-4 w-4 animate-spin" /> : status === "failed" ? <RotateCw className="h-4 w-4" /> : <Download className="h-4 w-4" />}
            {status === "running" ? tu("nd.preparing") : status === "failed" ? tu("common.retry") : tu("op.prepare_export")}
          </Button>}
          {result && <div className="flex flex-col sm:flex-row gap-2">
            <Button className="min-h-11" onClick={async () => downloadBlob(await exportToWorkbook(result), `society-export_${stamp}.xlsx`)}>
              <FileSpreadsheet className="h-4 w-4" /> {tu("op.download_spreadsheet")}
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => downloadBlob(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }), `society-export_${stamp}.json`)}>
              <FileJson className="h-4 w-4" /> {tu("op.download_json_for_migration")}
            </Button>
          </div>}
        </div>
      </SectionCard>
    </div>
  </div>;
}
