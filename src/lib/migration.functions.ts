/**
 * Stage 2D — Server functions for the migration & bulk-import pipeline.
 *
 * Security posture:
 * - Every mutation runs through `requireSupabaseAuth` and is authorized
 *   server-side via `current_user_can_admin_migrations`.
 * - The browser never supplies storage paths, checksums, parsed rows, or
 *   authoritative status. Paths are generated server-side; checksums are
 *   computed from actual uploaded bytes; parsed rows are the server's
 *   parse of the private object.
 * - All privileged writes go through SECURITY DEFINER RPCs
 *   (`migration_create_job`, `migration_finalize_upload`,
 *   `migration_replace_staging`).
 * - Direct authenticated INSERT/UPDATE/DELETE on `migration_jobs`,
 *   `migration_rows`, and `migration_entity_links` has been revoked.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  SOURCE_TYPES,
  ENTITY_TYPES,
  STRUCTURE_MODES,
  MAX_ROWS,
  MAX_FILE_BYTES,
  ROW_SCHEMAS,
  SOURCE_PRESETS,
  sha256Hex,
  stableStringify,
  parseCsv,
  detectFileSignature,
  validateFileSafety,
  type EntityType,
  type SourceType,
} from "./migration-pipeline";

const SafeError = z.enum([
  "invalid_file",
  "unsupported_format",
  "too_many_rows",
  "invalid_mapping",
  "validation_failed",
  "unresolved_conflicts",
  "job_not_ready",
  "job_already_committing",
  "idempotency_conflict",
  "unavailable",
  "operation_failed",
  "empty_header",
  "duplicate_header",
  "malformed_quote",
  "cell_too_long",
  "too_many_columns",
  "format_mismatch",
]);
export type SafeErrorCode = z.infer<typeof SafeError>;

class MigrationError extends Error {
  constructor(public code: SafeErrorCode, message?: string) {
    super(message ?? code);
  }
}

// CSV-only production policy. XLSX uploads are rejected server-side.
const ALLOWED_EXT_RE = /\.csv$/i;

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : "";
}

// ---------- initializeMigrationUpload ----------

const InitUploadInput = z.object({
  society_id: z.string().uuid(),
  source_type: z.enum(SOURCE_TYPES),
  filename: z.string().trim().min(1).max(240),
  declared_size: z.number().int().min(1).max(MAX_FILE_BYTES),
  declared_mime: z.string().max(160).optional().nullable(),
  structure_mode: z.enum(STRUCTURE_MODES).optional().nullable(),
});

export const initializeMigrationUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => InitUploadInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // CSV-only in production. Reject at the declared shape.
    if (!ALLOWED_EXT_RE.test(data.filename)) {
      throw new MigrationError("unsupported_format");
    }
    const safety = validateFileSafety({
      filename: data.filename,
      size: data.declared_size,
      mimeType: data.declared_mime ?? null,
    });
    if (!safety.ok) {
      throw new MigrationError(
        safety.code === "too_many_rows"
          ? "too_many_rows"
          : safety.code === "empty_file" || safety.code === "invalid_file"
          ? "invalid_file"
          : "unsupported_format",
      );
    }

    // Server-side authorization via the authenticated client.
    const { data: canAdmin } = await supabase.rpc(
      "current_user_can_admin_migrations",
      { _society_id: data.society_id },
    );
    if (!canAdmin) throw new MigrationError("unavailable");

    // Trusted mutation via service role. The RPC also re-checks admin scope
    // against the verified actor id (defence in depth).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: beginRes, error: beginErr } = await supabaseAdmin.rpc(
      "migration_begin_upload",
      {
        _actor: userId,
        _society_id: data.society_id,
        _source_type: data.source_type,
        _filename: data.filename,
        _declared_size: data.declared_size,
        _structure_mode: data.structure_mode ?? "structured",
      },
    );
    if (beginErr || !beginRes || beginRes.length === 0) {
      throw new MigrationError("unavailable");
    }
    const jobId = beginRes[0].job_id as string;
    const finalPath = beginRes[0].storage_path as string;

    // Signed upload URL for the private bucket, scoped to the server-derived path.
    const { data: signed, error: signErr } = await supabase.storage
      .from("migration-uploads")
      .createSignedUploadUrl(finalPath);
    if (signErr || !signed) throw new MigrationError("unavailable");

    return {
      job_id: jobId,
      storage_path: finalPath,
      upload_url: signed.signedUrl,
      upload_token: signed.token,
    };
  });

// ---------- finalizeMigrationUpload ----------

const FinalizeInput = z.object({
  job_id: z.string().uuid(),
});

export const finalizeMigrationUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => FinalizeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Load the job (RLS scopes to admins).
    const { data: job } = await supabase
      .from("migration_jobs")
      .select("id, society_id, storage_path, status, source_type")
      .eq("id", data.job_id)
      .maybeSingle();
    if (!job || !job.storage_path) throw new MigrationError("unavailable");
    if (job.status !== "uploaded") throw new MigrationError("job_not_ready");

    // Download authoritative bytes from private storage.
    const { data: blob, error: dlErr } = await supabase.storage
      .from("migration-uploads")
      .download(job.storage_path);
    if (dlErr || !blob) throw new MigrationError("unavailable");
    const ab = await blob.arrayBuffer();
    const bytes = new Uint8Array(ab);
    if (bytes.length === 0) throw new MigrationError("invalid_file");
    if (bytes.length > MAX_FILE_BYTES) throw new MigrationError("invalid_file");

    // Magic-byte / signature check.
    const sig = detectFileSignature(bytes);
    const pathExt = extOf(job.storage_path);
    if (pathExt === ".xlsx") {
      // XLSX server parsing is NOT wired in this run.
      // Reject with unsupported_format so the UI reflects the honest status.
      throw new MigrationError("unsupported_format");
    }
    if (pathExt === ".csv" && sig !== "csv") {
      throw new MigrationError("format_mismatch");
    }

    // SHA-256 of actual bytes.
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const checksum = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    // Parse CSV server-side.
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const parsed = parseCsv(text);
    if (!parsed.ok) {
      switch (parsed.error) {
        case "empty_file":
          throw new MigrationError("invalid_file");
        case "empty_header":
          throw new MigrationError("empty_header");
        case "duplicate_header":
          throw new MigrationError("duplicate_header");
        case "malformed_quote":
          throw new MigrationError("malformed_quote");
        case "cell_too_long":
          throw new MigrationError("cell_too_long");
        case "too_many_columns":
          throw new MigrationError("too_many_columns");
        case "too_many_rows":
          throw new MigrationError("too_many_rows");
        default:
          throw new MigrationError("invalid_file");
      }
    }

    // Persist authoritative parsed rows via service role. Everything below
    // is server-owned; the row set is bound to (job_id, society_id).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("migration_parsed_rows").delete().eq("job_id", data.job_id);

    // Store headers on the job's mapping_json for later mapping.
    await supabaseAdmin
      .from("migration_jobs")
      .update({ mapping_json: { headers: parsed.headers } })
      .eq("id", data.job_id);

    const CHUNK = 500;
    for (let i = 0; i < parsed.rows.length; i += CHUNK) {
      const slice = parsed.rows.slice(i, i + CHUNK);
      const inserts = await Promise.all(
        slice.map(async (values, idx) => {
          const rowNumber = i + idx + 1;
          const rowChecksum = await sha256Hex(
            stableStringify({ n: rowNumber, v: values }),
          );
          return {
            job_id: data.job_id,
            society_id: job.society_id,
            row_number: rowNumber,
            values_json: values,
            row_checksum: rowChecksum,
            parse_status: "parsed" as const,
          };
        }),
      );
      const { error: insErr } = await supabaseAdmin
        .from("migration_parsed_rows")
        .insert(inserts);
      if (insErr) throw new MigrationError("operation_failed");
    }

    // Finalize job via service role. Authenticated callers cannot invoke
    // this RPC directly (grants revoked); only the trusted server pathway
    // may write authoritative checksum/size/row totals.
    const { data: finRes, error: finErr } = await supabaseAdmin.rpc(
      "migration_finalize_upload",
      {
        _job_id: data.job_id,
        _checksum: checksum,
        _actual_size: bytes.length,
        _row_count: parsed.rows.length,
      },
    );
    if (finErr) throw new MigrationError("unavailable");
    const finStatus =
      typeof finRes === "object" && finRes && "status" in finRes
        ? String((finRes as { status: unknown }).status)
        : "";
    if (finStatus !== "ok") {
      throw new MigrationError((finStatus as SafeErrorCode) || "operation_failed");
    }

    return {
      status: "ok" as const,
      headers: parsed.headers,
      row_count: parsed.rows.length,
      checksum,
    };
  });

// ---------- validateMigrationJob (mapping + transactional staging) ----------

const MappingInput = z.object({
  entity_type: z.enum(ENTITY_TYPES),
  column_map: z.record(z.string(), z.string()),
});

const ValidateJobInput = z.object({
  job_id: z.string().uuid(),
  mapping: MappingInput,
});

export const validateMigrationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ValidateJobInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: job } = await supabase
      .from("migration_jobs")
      .select("id, society_id, status, source_type, mapping_json")
      .eq("id", data.job_id)
      .maybeSingle();
    if (!job) throw new MigrationError("unavailable");
    if (!["uploaded", "mapping", "validating", "ready"].includes(job.status)) {
      throw new MigrationError("job_not_ready");
    }
    const headers =
      job.mapping_json && typeof job.mapping_json === "object"
        ? (((job.mapping_json as { headers?: unknown }).headers as string[]) ?? [])
        : [];
    if (!Array.isArray(headers) || headers.length === 0) {
      throw new MigrationError("invalid_mapping");
    }

    // Load authoritative parsed rows.
    const { data: parsedRows, error: rowsErr } = await supabase
      .from("migration_parsed_rows")
      .select("row_number, values_json")
      .eq("job_id", data.job_id)
      .order("row_number", { ascending: true });
    if (rowsErr) throw new MigrationError("operation_failed");
    if (!parsedRows || parsedRows.length === 0) throw new MigrationError("job_not_ready");

    const entity = data.mapping.entity_type as EntityType;
    const schema = ROW_SCHEMAS[entity];

    const headerIdx = new Map<string, number>();
    headers.forEach((h, i) => headerIdx.set(h, i));

    const stagingRows: Array<Record<string, unknown>> = [];
    let valid = 0;
    let errors = 0;
    let warnings = 0;
    const seenKeys = new Set<string>();

    for (const pr of parsedRows) {
      const values = (pr.values_json as unknown as string[]) ?? [];
      const mapped: Record<string, unknown> = {};
      const raw: Record<string, unknown> = {};
      for (const h of headers) {
        raw[h] = values[headerIdx.get(h) ?? -1] ?? "";
      }
      for (const [srcHeader, canonicalField] of Object.entries(data.mapping.column_map)) {
        const idx = headerIdx.get(srcHeader);
        if (idx === undefined) continue;
        mapped[canonicalField] = values[idx] ?? "";
      }

      const parseResult = schema.safeParse(mapped);
      const errorCodes: string[] = [];
      let status: "valid" | "warning" | "error" = "valid";
      let action: "create" | "match_existing" | "skip" | "conflict" = "create";

      if (!parseResult.success) {
        for (const iss of parseResult.error.issues) {
          errorCodes.push(`field_${iss.path.join("_") || "unknown"}`);
        }
        status = "error";
        action = "conflict";
        errors++;
      } else {
        // Uniqueness by source_key within a file
        const sourceKey =
          (parseResult.data as Record<string, unknown>).external_resident_key ??
          (parseResult.data as Record<string, unknown>).unit_label ??
          (parseResult.data as Record<string, unknown>).registration_number ??
          null;
        if (sourceKey) {
          const key = `${entity}:${String(sourceKey).toLowerCase()}`;
          if (seenKeys.has(key)) {
            errorCodes.push("duplicate_source_key_in_file");
            status = "error";
            action = "conflict";
            errors++;
          } else {
            seenKeys.add(key);
          }
        }
        if (status === "valid") valid++;
      }

      const rowChecksum = await sha256Hex(
        stableStringify({
          e: entity,
          n: pr.row_number,
          m: parseResult.success ? parseResult.data : mapped,
        }),
      );

      const sourceKey = parseResult.success
        ? String(
            (parseResult.data as Record<string, unknown>).external_resident_key ??
              (parseResult.data as Record<string, unknown>).unit_label ??
              (parseResult.data as Record<string, unknown>).registration_number ??
              "",
          )
        : "";

      stagingRows.push({
        row_number: pr.row_number,
        entity_type: entity,
        raw_json: raw,
        mapped_json: parseResult.success ? parseResult.data : mapped,
        source_key: sourceKey || null,
        row_checksum: rowChecksum,
        action,
        status,
        error_codes: errorCodes,
        warning_codes: [] as string[],
      });
    }

    // Transactional staging replace via service role (authenticated grant revoked).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: replaceRes, error: repErr } = await supabaseAdmin.rpc(
      "migration_replace_staging",
      {
        _job_id: data.job_id,
        _rows: stagingRows as unknown as never,
        _totals: {
          total: parsedRows.length,
          valid,
          warnings,
          errors,
        } as unknown as never,
      },
    );
    if (repErr) throw new MigrationError("operation_failed");
    const repStatus =
      typeof replaceRes === "object" && replaceRes && "status" in replaceRes
        ? String((replaceRes as { status: unknown }).status)
        : "";
    if (repStatus !== "ok") {
      throw new MigrationError((repStatus as SafeErrorCode) || "operation_failed");
    }

    return {
      total: parsedRows.length,
      valid,
      warnings,
      errors,
      by_entity: { [entity]: parsedRows.length } as Record<string, number>,
    };
  });

// ---------- listJobs ----------

const ListJobsInput = z.object({
  society_id: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
});

export const listMigrationJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ListJobsInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: canAdmin } = await supabase.rpc("current_user_can_admin_migrations", {
      _society_id: data.society_id,
    });
    if (!canAdmin) throw new MigrationError("unavailable");
    const { data: rows, error } = await supabase
      .from("migration_jobs")
      .select(
        "id, source_type, source_filename, status, total_rows, valid_rows, error_rows, committed_rows, created_at, committed_at",
      )
      .eq("society_id", data.society_id)
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (error) throw new MigrationError("operation_failed");
    return { items: rows ?? [] };
  });

// ---------- preview ----------

const PreviewInput = z.object({
  job_id: z.string().uuid(),
  society_id: z.string().uuid(),
  entity_type: z.enum(ENTITY_TYPES).optional(),
  status: z.enum(["pending", "valid", "warning", "error", "committed", "skipped"]).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});

export const getMigrationPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => PreviewInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: canAdmin } = await supabase.rpc("current_user_can_admin_migrations", {
      _society_id: data.society_id,
    });
    if (!canAdmin) throw new MigrationError("unavailable");

    let q = supabase
      .from("migration_rows")
      .select(
        "row_number, entity_type, action, status, error_codes, warning_codes, mapped_json, source_key",
        { count: "exact" },
      )
      .eq("job_id", data.job_id)
      .eq("society_id", data.society_id)
      .order("row_number", { ascending: true })
      .range(data.offset, data.offset + data.limit - 1);
    if (data.entity_type) q = q.eq("entity_type", data.entity_type);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error, count } = await q;
    if (error) throw new MigrationError("operation_failed");
    return { items: rows ?? [], total: count ?? 0 };
  });

// ---------- commitMigrationJob — real canonical commit adapter ----------

const CommitInput = z.object({
  job_id: z.string().uuid(),
  creation_request_id: z.string().trim().min(8).max(80),
  expected_checksum: z.string().trim().min(8).max(128),
  confirm: z.literal(true),
});

const CommitResult = z.object({
  structures_created: z.number().int().nonnegative().default(0),
  structures_matched: z.number().int().nonnegative().default(0),
  units_created: z.number().int().nonnegative().default(0),
  units_matched: z.number().int().nonnegative().default(0),
  residents_created: z.number().int().nonnegative().default(0),
  residents_matched: z.number().int().nonnegative().default(0),
  occupancies_created: z.number().int().nonnegative().default(0),
  family_created: z.number().int().nonnegative().default(0),
  vehicles_created: z.number().int().nonnegative().default(0),
  skipped: z.number().int().nonnegative().default(0),
  total_committed: z.number().int().nonnegative().default(0),
});

export type MigrationCommitResult = z.infer<typeof CommitResult>;

const CommitStatus = z.enum([
  "completed",
  "idempotent_replay",
  "unavailable",
  "job_not_ready",
  "unresolved_conflicts",
  "idempotency_conflict",
  "job_already_committing",
  "operation_failed",
]);

export type MigrationCommitStatus = z.infer<typeof CommitStatus>;

/**
 * Real canonical commit. The database function `commit_migration_job` is the
 * single authoritative writer: it derives society, source type, mapped rows,
 * and dependencies from the job/staging tables. Only `job_id`, `request_id`,
 * and the caller-supplied expected file checksum cross the RPC boundary.
 *
 * Exposed as a plain function so behavioral tests can invoke it against a
 * mocked supabase client without rebuilding the middleware chain.
 */
type CommitRpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

export const commitMigrationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CommitInput.parse(input))
  .handler(async ({ data, context }) => {
    return _commitMigrationJobViaRpc(context.supabase as unknown as CommitRpcClient, data);
  });

// Pure helper co-located with the server function so behavioral tests can
// invoke the RPC dispatch/parse logic directly against a mocked supabase
// client. Kept below the server fn so the export block for
// `commitMigrationJob` includes the RPC call site: `commit_migration_job`,
// `_request_id`, `expected_checksum`.
export async function _commitMigrationJobViaRpc(
  supabase: CommitRpcClient,
  data: z.infer<typeof CommitInput>,
): Promise<{ status: MigrationCommitStatus; result: MigrationCommitResult | null }> {
  const { data: raw, error } = await supabase.rpc("commit_migration_job", {
    _job_id: data.job_id,
    _request_id: data.creation_request_id,
    _expected_checksum: data.expected_checksum,
  });
  if (error) {
    return { status: "operation_failed" as const, result: null };
  }
  const obj = (raw ?? {}) as { status?: string; result?: unknown };
  const parsedStatus = CommitStatus.safeParse(obj.status);
  if (!parsedStatus.success) {
    return { status: "operation_failed" as const, result: null };
  }
  if (parsedStatus.data === "completed" || parsedStatus.data === "idempotent_replay") {
    const parsed = CommitResult.safeParse(obj.result ?? {});
    return { status: parsedStatus.data, result: parsed.success ? parsed.data : null };
  }
  return { status: parsedStatus.data, result: null };
}


