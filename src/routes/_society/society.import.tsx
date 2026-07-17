import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Upload, Loader2, CheckCircle2, AlertTriangle, Info, ClipboardList,
  ListChecks, Send, Lock,
} from "lucide-react";
import { useSocietyId } from "@/hooks/useSocietyId";
import { MobileHero } from "@/components/shared/MobileHero";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/system/StatusChip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  initializeMigrationUpload,
  finalizeMigrationUpload,
  validateMigrationJob,
  getMigrationPreview,
} from "@/lib/migration.functions";
import {
  SOURCE_TYPES,
  ENTITY_TYPES,
  SOURCE_PRESETS,
  ROW_SCHEMAS,
  type SourceType,
  type EntityType,
} from "@/lib/migration-pipeline";

function suggestedMapping(headers: string[], entity: EntityType, source: SourceType): Record<string, string> {
  const preset = SOURCE_PRESETS[entity][source] ?? {};
  const canonicalSet = new Set<string>(Object.keys(ROW_SCHEMAS[entity].shape));
  const mapping: Record<string, string> = {};
  for (const h of headers) {
    const key = h.trim().toLowerCase();
    if (preset[key]) mapping[h] = preset[key];
    else if (canonicalSet.has(key)) mapping[h] = key;
  }
  return mapping;
}



export const Route = createFileRoute("/_society/society/import")({
  head: () => ({ meta: [{ title: "Bulk Import — SociyoHub" }] }),
  component: () => (
    <FeatureGate feature="resident_import">
      <ImportPage />
    </FeatureGate>
  ),
});

type PreviewRow = {
  row_number: number;
  entity_type: string;
  action: string;
  status: string;
  error_codes: string[];
  warning_codes: string[];
  mapped_json: Record<string, unknown>;
  source_key: string | null;
};

function ImportPage() {
  const { societyId } = useSocietyId();
  const initUpload = useServerFn(initializeMigrationUpload);
  const finalize = useServerFn(finalizeMigrationUpload);
  const validate = useServerFn(validateMigrationJob);
  const preview = useServerFn(getMigrationPreview);

  const [sourceType, setSourceType] = useState<SourceType>("sociyohub");
  const [entityType, setEntityType] = useState<EntityType>("resident");
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [totals, setTotals] = useState<{ total: number; valid: number; errors: number } | null>(null);
  const [busy, setBusy] = useState<null | "upload" | "validate" | "preview">(null);

  const step: 1 | 2 | 3 | 4 = totals ? 4 : previewRows.length || headers.length ? 3 : jobId ? 2 : 1;

  const canValidate = useMemo(() => headers.length > 0 && Object.keys(mapping).length > 0, [headers, mapping]);

  async function doUploadAndFinalize() {
    if (!societyId || !file) return;
    setBusy("upload");
    try {
      const init = await initUpload({
        data: {
          society_id: societyId,
          source_type: sourceType,
          filename: file.name,
          declared_size: file.size,
          declared_mime: file.type || null,
          structure_mode: "structured",
        },
      });
      // Upload via signed URL — private bucket, server-generated path.
      const uploadRes = await fetch(init.upload_url, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("upload_failed");

      const fin = await finalize({ data: { job_id: init.job_id } });
      setJobId(init.job_id);
      setHeaders(fin.headers);
      setRowCount(fin.row_count);
      setMapping(suggestedMapping(fin.headers, entityType, sourceType));
      toast.success(`Uploaded ${fin.row_count} rows`);
    } catch (e) {
      const code = (e as Error).message || "operation_failed";
      toast.error(`Upload failed: ${code}`);
    } finally {
      setBusy(null);
    }
  }

  async function doValidate() {
    if (!societyId || !jobId) return;
    setBusy("validate");
    try {
      const res = await validate({
        data: {
          job_id: jobId,
          mapping: { entity_type: entityType, column_map: mapping },
        },
      });
      setTotals({ total: res.total, valid: res.valid, errors: res.errors });
      const p = await preview({
        data: { job_id: jobId, society_id: societyId, limit: 100, offset: 0 },
      });
      setPreviewRows(p.items as PreviewRow[]);
      toast.success(`${res.valid} valid, ${res.errors} error rows`);
    } catch (e) {
      toast.error(`Validation failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  function updateMapping(header: string, canonical: string) {
    setMapping((m) => {
      const next = { ...m };
      if (canonical === "") delete next[header];
      else next[header] = canonical;
      return next;
    });
  }

  const steps = [
    { n: 1 as const, label: "Choose source", icon: Upload },
    { n: 2 as const, label: "Upload", icon: Upload },
    { n: 3 as const, label: "Map & validate", icon: ClipboardList },
    { n: 4 as const, label: "Preview", icon: ListChecks },
  ];

  return (
    <div className="pb-[calc(96px+env(safe-area-inset-bottom))]">
      <MobileHero
        eyebrow="Society Admin"
        title="Bulk import"
        subtitle="Upload a CSV file to import residents, units and vehicles. Server validates every row before staging."
        icon={Upload}
        variant="teal"
      />
      <div className="px-4 pt-4 space-y-4 max-w-5xl mx-auto md:px-8">
        <div className="mb-2 flex items-center gap-2 flex-wrap">
          {steps.map((s) => {
            const Icon = s.icon;
            const active = step === s.n;
            const done = step > s.n;
            return (
              <div
                key={s.n}
                className={cn(
                  "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium border",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : done
                    ? "border-success-container bg-success-container text-success-container-foreground"
                    : "border-border bg-card text-muted-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>Step {s.n}: {s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Step 1 — Source */}
        <Card className="rounded-2xl">
          <CardContent className="p-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-sm">
                <div className="text-xs text-muted-foreground mb-1">Source</div>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value as SourceType)}
                >
                  {SOURCE_TYPES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <div className="text-xs text-muted-foreground mb-1">Entity</div>
                <select
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
                  value={entityType}
                  onChange={(e) => setEntityType(e.target.value as EntityType)}
                >
                  {ENTITY_TYPES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground flex items-start gap-2">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p>Only <code>.csv</code> files are accepted in this release. Files up to 10&nbsp;MB and 5,000 rows.</p>
                <p>Macros, archives, and XLSX are rejected server-side. Uploads are private per society.</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="inline-flex">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <Button asChild variant="outline" className="rounded-xl">
                  <span>
                    <Upload className="h-4 w-4 mr-1.5" />
                    {file ? file.name : "Choose CSV"}
                  </span>
                </Button>
              </label>
              <Button
                onClick={doUploadAndFinalize}
                disabled={!file || busy !== null}
                className="rounded-xl"
              >
                {busy === "upload" ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-1.5" />
                )}
                Upload &amp; parse
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Step 2 — Mapping */}
        {jobId && headers.length > 0 && (
          <Card className="rounded-2xl">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">Column mapping</p>
                  <StatusChip tone="info">{rowCount} rows</StatusChip>
                </div>
                <Button
                  onClick={doValidate}
                  disabled={!canValidate || busy !== null}
                  className="rounded-xl"
                >
                  {busy === "validate" ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <ClipboardList className="h-4 w-4 mr-1.5" />
                  )}
                  Validate
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {headers.map((h) => (
                  <div key={h} className="flex items-center gap-2 text-sm">
                    <div className="flex-1 truncate rounded-lg bg-muted px-2 py-1.5">{h}</div>
                    <span className="text-muted-foreground">→</span>
                    <input
                      className="flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs"
                      placeholder="canonical field (leave blank to skip)"
                      value={mapping[h] ?? ""}
                      onChange={(e) => updateMapping(h, e.target.value.trim())}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3 — Preview */}
        {totals && (
          <Card className="rounded-2xl">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold">Server preview</p>
                  <StatusChip tone="success">{totals.valid} valid</StatusChip>
                  {totals.errors > 0 && (
                    <StatusChip tone="danger">{totals.errors} errors</StatusChip>
                  )}
                </div>
                <Button disabled className="rounded-xl" title="Import commit is not yet enabled">
                  <Lock className="h-4 w-4 mr-1.5" />
                  Import commit will be enabled after final validation
                </Button>
              </div>
              <div className="overflow-auto max-h-96 rounded-xl border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-muted sticky top-0">
                    <tr>
                      {["#", "Entity", "Status", "Source key", "Errors"].map((h) => (
                        <th key={h} className="p-2 text-left font-medium text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((r) => (
                      <tr
                        key={r.row_number}
                        className={cn("border-t border-border", r.status === "error" && "bg-danger-container/40")}
                      >
                        <td className="p-2 text-muted-foreground">{r.row_number}</td>
                        <td className="p-2">{r.entity_type}</td>
                        <td className="p-2 capitalize">{r.status}</td>
                        <td className="p-2">{r.source_key ?? "—"}</td>
                        <td className="p-2 text-destructive text-[10px]">
                          {r.error_codes.join("; ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="rounded-lg bg-warning-container/40 border border-warning-container p-3 text-xs flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
                <p>
                  Import commit will be enabled after canonical write and idempotency are wired.
                  Nothing has been written to your society yet.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {totals && totals.errors === 0 && (
          <Card className="rounded-2xl">
            <CardContent className="p-5 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <p className="text-sm">
                Staging preview is ready. Canonical commit is not yet enabled — remaining Stage 2D work.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
