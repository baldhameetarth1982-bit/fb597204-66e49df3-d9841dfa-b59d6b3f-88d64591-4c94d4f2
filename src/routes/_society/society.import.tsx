import { createFileRoute } from "@tanstack/react-router";
import { FeatureGate } from "@/components/subscription/FeatureGate";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Upload, Loader2, CheckCircle2, AlertTriangle, Info, ClipboardList,
  ListChecks, Send, Lock, RefreshCw, History,
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
  commitMigrationJob,
  listMigrationJobs,
  getMigrationJobFailure,
  type MigrationCommitResult,
  type MigrationCommitStatus,
} from "@/lib/migration.functions";
import {
  SOURCE_TYPES,
  ENTITY_TYPES,
  SOURCE_PRESETS,
  ROW_SCHEMAS,
  type SourceType,
  type EntityType,
} from "@/lib/migration-pipeline";

// Stage 2E — human-readable guidance for stored failure codes. Kept in
// one place so the UX never leaks raw DB errors.
const FAILURE_GUIDANCE: Record<string, { title: string; hint: string }> = {
  occupancy_rows_unsupported: {
    title: "Occupancy rows are not imported directly",
    hint: "Occupancy is derived automatically when a resident row lands on a matching unit. Re-map the file to the Residents entity and validate again.",
  },
  structure_rows_not_allowed_serial: {
    title: "This society uses serial numbering",
    hint: "Serial-mode societies do not accept Structure rows. Either switch the structure mode in Setup, or drop the structure rows and re-upload.",
  },
  unit_not_found: {
    title: "A resident references a unit that does not exist",
    hint: "Create the missing units first (Units entity), then re-run this import. Structure name is compared case-insensitively; unit label ignores dashes and spaces.",
  },
  structure_not_found: {
    title: "A unit references a missing structure",
    hint: "Add the referenced block/tower first (Structures entity) or correct the structure_name column.",
  },
  resident_link_missing: {
    title: "Family or vehicle row could not find its resident",
    hint: "Family/vehicle rows link by external_resident_key within the same import source. Ensure the resident sheet was imported first with the same source type.",
  },
  resident_link_invalid: {
    title: "Resident link no longer resolves to a society row",
    hint: "The linked resident is not in this society. Verify the source data and re-run.",
  },
  resident_not_in_society: {
    title: "Matched resident is not in this society",
    hint: "The row matched an existing profile that belongs to a different society. Clear the match and let import create a new offline resident.",
  },
  duplicate_active_plate: {
    title: "Vehicle plate already exists",
    hint: "One or more plate numbers are already active in this society. Deactivate the duplicates or remove the row.",
  },
  invalid_plate: {
    title: "Vehicle plate is too short or malformed",
    hint: "Ensure registration numbers are at least 3 characters after normalization.",
  },
  provenance_mismatch: {
    title: "A matched record no longer exists",
    hint: "The chosen match was deleted before commit. Re-run validation to refresh matches.",
  },
  rows_unresolved: {
    title: "Some staged rows were never committed",
    hint: "Refresh validation — earlier fixes may have left orphan rows. If it persists, start a new import.",
  },
  operation_failed: {
    title: "Commit failed with an internal error",
    hint: "Retry with a fresh request id. If the error persists, contact support.",
  },
};

function guidanceFor(code: string | null | undefined): { title: string; hint: string } {
  if (!code) return { title: "Commit not completed", hint: "You can retry the commit." };
  return (
    FAILURE_GUIDANCE[code] ?? {
      title: "Commit blocked",
      hint: "The server reported: " + code + ". Fix the underlying data and retry.",
    }
  );
}

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

type JobListItem = {
  id: string;
  source_type: string;
  source_filename: string | null;
  status: string;
  total_rows: number | null;
  valid_rows: number | null;
  error_rows: number | null;
  committed_rows: number | null;
  created_at: string;
  committed_at: string | null;
};

function ImportPage() {
  const { societyId } = useSocietyId();
  const initUpload = useServerFn(initializeMigrationUpload);
  const finalize = useServerFn(finalizeMigrationUpload);
  const validate = useServerFn(validateMigrationJob);
  const preview = useServerFn(getMigrationPreview);
  const commit = useServerFn(commitMigrationJob);
  const listJobs = useServerFn(listMigrationJobs);
  const jobFailure = useServerFn(getMigrationJobFailure);

  const [sourceType, setSourceType] = useState<SourceType>("sociyohub");
  const [entityType, setEntityType] = useState<EntityType>("resident");
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [checksum, setChecksum] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [totals, setTotals] = useState<{ total: number; valid: number; errors: number } | null>(null);
  const [busy, setBusy] = useState<null | "upload" | "validate" | "preview" | "commit" | "jobs">(null);
  const [confirmMode, setConfirmMode] = useState(false);
  const [commitStatus, setCommitStatus] = useState<MigrationCommitStatus | null>(null);
  const [commitResult, setCommitResult] = useState<MigrationCommitResult | null>(null);
  const [failureCode, setFailureCode] = useState<string | null>(null);
  const [jobsList, setJobsList] = useState<JobListItem[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);

  // Recovery UX — always fetch the recent-jobs list for this society so admins
  // can see in-flight or failed jobs, resume, and retry with a new request id.
  useEffect(() => {
    if (!societyId) return;
    let cancelled = false;
    setBusy("jobs");
    listJobs({ data: { society_id: societyId, limit: 20, offset: 0 } })
      .then((res) => { if (!cancelled) setJobsList(res.items as JobListItem[]); })
      .catch((e) => { if (!cancelled) setJobsError((e as Error).message); })
      .finally(() => { if (!cancelled) setBusy((b) => (b === "jobs" ? null : b)); });
    return () => { cancelled = true; };
  }, [societyId, listJobs, commitStatus]);

  const step: 1 | 2 | 3 | 4 = totals ? 4 : previewRows.length || headers.length ? 3 : jobId ? 2 : 1;

  const canValidate = useMemo(() => headers.length > 0 && Object.keys(mapping).length > 0, [headers, mapping]);
  const canCommit = totals !== null && totals.errors === 0 && commitStatus !== "completed";

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
      const uploadRes = await fetch(init.upload_url, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!uploadRes.ok) throw new Error("upload_failed");

      const fin = await finalize({ data: { job_id: init.job_id } });
      setJobId(init.job_id);
      setChecksum(fin.checksum);
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

  function newRequestId(): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function doCommit() {
    if (!jobId || !checksum) return;
    // Preserve the same request id across retries within one confirm attempt.
    const rid = requestId ?? newRequestId();
    if (!requestId) setRequestId(rid);
    setBusy("commit");
    try {
      const res = await commit({
        data: {
          job_id: jobId,
          creation_request_id: rid,
          expected_checksum: checksum,
          confirm: true,
        },
      });
      setCommitStatus(res.status);
      setCommitResult(res.result);
      if (res.status === "completed" || res.status === "idempotent_replay") {
        toast.success(`Import committed (${res.result?.total_committed ?? 0} rows)`);
        setConfirmMode(false);
      } else {
        toast.error(`Commit ${res.status}`);
      }
    } catch (e) {
      toast.error(`Commit failed: ${(e as Error).message}`);
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
                <Button
                  onClick={() => setConfirmMode(true)}
                  disabled={!canCommit || busy !== null}
                  className="rounded-xl"
                  title={canCommit ? "Confirm and write canonical records" : "Resolve errors before commit"}
                >
                  {canCommit ? <Send className="h-4 w-4 mr-1.5" /> : <Lock className="h-4 w-4 mr-1.5" />}
                  {commitStatus === "completed" || commitStatus === "idempotent_replay"
                    ? "Committed"
                    : "Confirm import"}
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
              {commitStatus && commitStatus !== "completed" && commitStatus !== "idempotent_replay" && (
                <div className="rounded-lg bg-warning-container/40 border border-warning-container p-3 text-xs flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5" />
                  <p>Commit {commitStatus}. Nothing has been written; you can retry.</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Confirm dialog card */}
        {confirmMode && (
          <Card className="rounded-2xl border-primary">
            <CardContent className="p-5 space-y-3">
              <p className="font-semibold">Confirm canonical import</p>
              <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-1">
                <li>Society records will be created — structures, units, residents, occupancy, family and vehicles as applicable.</li>
                <li>New non-login residents are created as offline residents (no login account is issued).</li>
                <li>Existing records will not be silently overwritten. Duplicate active vehicle plates block the commit.</li>
                <li>Provenance is recorded for every canonical row.</li>
                <li>This operation is idempotent — retrying with the same request replays the stored result.</li>
              </ul>
              <div className="flex gap-2 flex-wrap">
                <Button
                  onClick={doCommit}
                  disabled={busy !== null}
                  className="rounded-xl"
                >
                  {busy === "commit" ? (
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-1.5" />
                  )}
                  Yes, commit import
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setConfirmMode(false)}
                  disabled={busy !== null}
                  className="rounded-xl"
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Result screen */}
        {(commitStatus === "completed" || commitStatus === "idempotent_replay") && commitResult && (
          <Card className="rounded-2xl border-success">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" />
                <p className="font-semibold">Import committed</p>
                <StatusChip tone="success">
                  {commitStatus === "idempotent_replay" ? "replayed" : "completed"}
                </StatusChip>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div className="rounded-lg bg-muted p-2">
                  <div className="text-muted-foreground">Structures created</div>
                  <div className="font-semibold">{commitResult.structures_created}</div>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <div className="text-muted-foreground">Structures matched</div>
                  <div className="font-semibold">{commitResult.structures_matched}</div>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <div className="text-muted-foreground">Units created</div>
                  <div className="font-semibold">{commitResult.units_created}</div>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <div className="text-muted-foreground">Units matched</div>
                  <div className="font-semibold">{commitResult.units_matched}</div>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <div className="text-muted-foreground">Residents created</div>
                  <div className="font-semibold">{commitResult.residents_created}</div>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <div className="text-muted-foreground">Residents matched</div>
                  <div className="font-semibold">{commitResult.residents_matched}</div>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <div className="text-muted-foreground">Occupancies created</div>
                  <div className="font-semibold">{commitResult.occupancies_created}</div>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <div className="text-muted-foreground">Family created</div>
                  <div className="font-semibold">{commitResult.family_created}</div>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <div className="text-muted-foreground">Vehicles created</div>
                  <div className="font-semibold">{commitResult.vehicles_created}</div>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <div className="text-muted-foreground">Skipped</div>
                  <div className="font-semibold">{commitResult.skipped}</div>
                </div>
                <div className="rounded-lg bg-muted p-2">
                  <div className="text-muted-foreground">Total committed</div>
                  <div className="font-semibold">{commitResult.total_committed}</div>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground">Job {jobId}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
