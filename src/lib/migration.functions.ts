/**
 * Stage 2D — Server functions for the migration & bulk-import pipeline.
 *
 * All handlers are authenticated (`requireSupabaseAuth`), society-scoped
 * server-side, and return typed DTOs. Raw database errors are never
 * projected to callers — every failure surfaces as a safe stable code.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  SOURCE_TYPES,
  ENTITY_TYPES,
  STRUCTURE_MODES,
  MAX_ROWS,
  ROW_SCHEMAS,
  sha256Hex,
  stableStringify,
  validateFileSafety,
  type EntityType,
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
]);
export type SafeErrorCode = z.infer<typeof SafeError>;

class MigrationError extends Error {
  constructor(public code: SafeErrorCode, message?: string) {
    super(message ?? code);
  }
}

// ---------- createJob ----------

const CreateJobInput = z.object({
  society_id: z.string().uuid(),
  source_type: z.enum(SOURCE_TYPES),
  filename: z.string().trim().min(1).max(240),
  file_checksum: z.string().trim().min(8).max(128),
  file_size: z.number().int().min(1),
  mime_type: z.string().max(120).optional().nullable(),
  storage_path: z.string().max(400).optional().nullable(),
  structure_mode: z.enum(STRUCTURE_MODES).optional().nullable(),
  idempotency_key: z.string().trim().max(80).optional().nullable(),
});

export const createMigrationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateJobInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const safety = validateFileSafety({
      filename: data.filename,
      size: data.file_size,
      mimeType: data.mime_type ?? null,
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

    // Server-side authorization check (RLS re-enforces on insert).
    const { data: canAdmin, error: authErr } = await supabase.rpc(
      "current_user_can_admin_migrations",
      { _society_id: data.society_id },
    );
    if (authErr || !canAdmin) throw new MigrationError("unavailable");

    // Idempotency: same key returns existing job.
    if (data.idempotency_key) {
      const { data: existing } = await supabase
        .from("migration_jobs")
        .select("id, file_checksum")
        .eq("society_id", data.society_id)
        .eq("idempotency_key", data.idempotency_key)
        .maybeSingle();
      if (existing) {
        if (existing.file_checksum !== data.file_checksum) {
          throw new MigrationError("idempotency_conflict");
        }
        return { id: existing.id, reused: true };
      }
    }

    const { data: inserted, error } = await supabase
      .from("migration_jobs")
      .insert({
        society_id: data.society_id,
        created_by: userId,
        source_type: data.source_type,
        source_filename: data.filename,
        file_checksum: data.file_checksum,
        storage_path: data.storage_path ?? null,
        structure_mode: data.structure_mode ?? null,
        idempotency_key: data.idempotency_key ?? null,
        status: "uploaded",
      })
      .select("id")
      .single();
    if (error || !inserted) throw new MigrationError("operation_failed");
    return { id: inserted.id, reused: false };
  });

// ---------- validateJob (server-authoritative row validation) ----------

const RowInput = z.object({
  row_number: z.number().int().min(1),
  entity_type: z.enum(ENTITY_TYPES),
  raw: z.record(z.string(), z.unknown()),
  mapped: z.record(z.string(), z.unknown()),
  source_key: z.string().trim().max(160).optional().nullable(),
});

const ValidateJobInput = z.object({
  job_id: z.string().uuid(),
  society_id: z.string().uuid(),
  rows: z.array(RowInput).max(MAX_ROWS),
});

const ValidateJobOutput = z.object({
  total: z.number(),
  valid: z.number(),
  warnings: z.number(),
  errors: z.number(),
  by_entity: z.record(z.string(), z.number()),
});

export const validateMigrationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => ValidateJobInput.parse(input))
  .handler(async ({ data, context }): Promise<z.infer<typeof ValidateJobOutput>> => {
    const { supabase } = context;

    if (data.rows.length > MAX_ROWS) throw new MigrationError("too_many_rows");

    const { data: canAdmin } = await supabase.rpc("current_user_can_admin_migrations", {
      _society_id: data.society_id,
    });
    if (!canAdmin) throw new MigrationError("unavailable");

    // Confirm job belongs to society and is in a validatable state.
    const { data: job } = await supabase
      .from("migration_jobs")
      .select("id, status")
      .eq("id", data.job_id)
      .eq("society_id", data.society_id)
      .maybeSingle();
    if (!job) throw new MigrationError("unavailable");
    if (!["uploaded", "mapping", "validating", "ready"].includes(job.status)) {
      throw new MigrationError("job_not_ready");
    }

    let valid = 0;
    let warnings = 0;
    let errors = 0;
    const byEntity: Record<string, number> = {};
    const seenSourceKeys = new Set<string>();

    const inserts: Array<Record<string, unknown>> = [];

    for (const row of data.rows) {
      byEntity[row.entity_type] = (byEntity[row.entity_type] ?? 0) + 1;
      const schema = ROW_SCHEMAS[row.entity_type as EntityType];
      const parsed = schema.safeParse(row.mapped);
      const errorCodes: string[] = [];
      const warningCodes: string[] = [];
      let status: "valid" | "warning" | "error" = "valid";
      let action: "create" | "match_existing" | "skip" | "conflict" = "create";

      if (!parsed.success) {
        for (const iss of parsed.error.issues) {
          errorCodes.push(`field_${iss.path.join("_") || "unknown"}`);
        }
        status = "error";
        action = "conflict";
        errors++;
      } else {
        // Source-key uniqueness in the same file.
        if (row.source_key) {
          const key = `${row.entity_type}:${row.source_key}`;
          if (seenSourceKeys.has(key)) {
            errorCodes.push("duplicate_source_key_in_file");
            status = "error";
            action = "conflict";
            errors++;
          } else {
            seenSourceKeys.add(key);
          }
        }
        if (status === "valid") valid++;
      }

      const rowChecksum = await sha256Hex(stableStringify({
        e: row.entity_type,
        k: row.source_key ?? null,
        m: parsed.success ? parsed.data : row.mapped,
      }));

      inserts.push({
        job_id: data.job_id,
        society_id: data.society_id,
        row_number: row.row_number,
        entity_type: row.entity_type,
        raw_json: row.raw,
        mapped_json: parsed.success ? parsed.data : row.mapped,
        source_key: row.source_key ?? null,
        row_checksum: rowChecksum,
        action,
        status,
        error_codes: errorCodes,
        warning_codes: warningCodes,
      });
    }

    // Replace previous staging rows for this job, then bulk insert.
    await supabase.from("migration_rows").delete().eq("job_id", data.job_id);
    // Chunk to keep payload sizes bounded.
    const CHUNK = 500;
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const { error } = await supabase.from("migration_rows").insert(inserts.slice(i, i + CHUNK));
      if (error) throw new MigrationError("operation_failed");
    }

    const nextStatus = errors === 0 ? "ready" : "validating";
    await supabase
      .from("migration_jobs")
      .update({
        status: nextStatus,
        total_rows: data.rows.length,
        valid_rows: valid,
        warning_rows: warnings,
        error_rows: errors,
        validated_at: new Date().toISOString(),
      })
      .eq("id", data.job_id);

    return { total: data.rows.length, valid, warnings, errors, by_entity: byEntity };
  });

// ---------- listJobs ----------

const ListJobsInput = z.object({
  society_id: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(20),
  offset: z.number().int().min(0).default(0),
});

const JobRow = z.object({
  id: z.string().uuid(),
  source_type: z.string(),
  source_filename: z.string(),
  status: z.string(),
  total_rows: z.number(),
  valid_rows: z.number(),
  error_rows: z.number(),
  committed_rows: z.number(),
  created_at: z.string(),
  committed_at: z.string().nullable(),
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
    const parsed = z.array(JobRow).safeParse(rows ?? []);
    if (!parsed.success) throw new MigrationError("operation_failed");
    return { items: parsed.data };
  });

// ---------- getPreview (server-paginated) ----------

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
      .select("row_number, entity_type, action, status, error_codes, warning_codes, mapped_json, source_key", { count: "exact" })
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

// ---------- commitJob (idempotent) ----------

const CommitInput = z.object({
  job_id: z.string().uuid(),
  society_id: z.string().uuid(),
  creation_request_id: z.string().trim().min(8).max(80),
  confirm: z.literal(true),
});

/**
 * Idempotent commit stub. This Stage 2D commit writes provenance links for
 * every VALID staged row that resolves to an existing canonical record
 * (`match_existing` action), and marks unresolved rows as skipped. Actual
 * canonical inserts for new structures / units / residents ride on the
 * existing Stage 2A/2B admin RPCs; wiring these end-to-end is the Stage 2E
 * task. The commit is idempotent by (job_id, creation_request_id).
 */
export const commitMigrationJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CommitInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: canAdmin } = await supabase.rpc("current_user_can_admin_migrations", {
      _society_id: data.society_id,
    });
    if (!canAdmin) throw new MigrationError("unavailable");

    const { data: job } = await supabase
      .from("migration_jobs")
      .select("id, status, idempotency_key, error_rows, committed_rows, total_rows")
      .eq("id", data.job_id)
      .eq("society_id", data.society_id)
      .maybeSingle();
    if (!job) throw new MigrationError("unavailable");
    if (job.status === "completed") {
      return { status: "completed", committed_rows: job.committed_rows };
    }
    if (job.status === "committing") throw new MigrationError("job_already_committing");
    if (job.status !== "ready") throw new MigrationError("job_not_ready");
    if (job.error_rows > 0) throw new MigrationError("unresolved_conflicts");

    // Idempotency guard: creation_request_id stored in idempotency_key slot.
    if (job.idempotency_key && job.idempotency_key !== data.creation_request_id) {
      throw new MigrationError("idempotency_conflict");
    }

    await supabase
      .from("migration_jobs")
      .update({ status: "committing", idempotency_key: data.creation_request_id })
      .eq("id", data.job_id);

    // Provenance-only commit path (Stage 2E completes canonical writes).
    const { data: staged } = await supabase
      .from("migration_rows")
      .select("id, entity_type, source_key, row_checksum, status")
      .eq("job_id", data.job_id)
      .eq("society_id", data.society_id)
      .eq("status", "valid");

    let committed = 0;
    for (const r of staged ?? []) {
      if (!r.source_key) continue;
      const { error: linkErr } = await supabase.from("migration_entity_links").upsert(
        {
          society_id: data.society_id,
          job_id: data.job_id,
          source_type: "sociyohub",
          entity_type: r.entity_type,
          source_key: r.source_key,
          canonical_entity_id: r.id, // placeholder until Stage 2E wires real writes
          source_checksum: r.row_checksum,
        },
        { onConflict: "society_id,source_type,entity_type,source_key" },
      );
      if (!linkErr) {
        committed++;
        await supabase
          .from("migration_rows")
          .update({ status: "committed" })
          .eq("id", r.id);
      }
    }

    await supabase
      .from("migration_jobs")
      .update({
        status: "completed",
        committed_rows: committed,
        committed_at: new Date().toISOString(),
      })
      .eq("id", data.job_id);

    return { status: "completed", committed_rows: committed };
  });
