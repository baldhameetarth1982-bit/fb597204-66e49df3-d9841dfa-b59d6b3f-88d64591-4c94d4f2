import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseBankCsv, BANK_CSV_MAX_BYTES } from "@/lib/bank-reconciliation";

const uuid = z.string().uuid();
const lineStatus = z.enum(["unmatched", "suggested", "conflict", "already_reconciled", "matched", "ignored"]);

type Ctx = { supabase: unknown; userId: string };
type RpcClient = { rpc: (n: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }> };

function safeError(message: string): Error {
  const m = message.toLowerCase();
  if (m.includes("plan_required")) return new Error("Bank reconciliation needs an active Pro or Premium plan.");
  if (m.includes("not_authorized") || m.includes("unauthenticated") || m.includes("permission denied"))
    return new Error("You don't have permission to manage reconciliation.");
  if (m.includes("already_reconciled")) return new Error("That record is already reconciled to another bank line.");
  if (m.includes("invalid_input")) return new Error("The statement has invalid values. Check the file and try again.");
  if (m.includes("not_found")) return new Error("That bank line was not found.");
  return new Error("The reconciliation request could not be completed.");
}

async function rpc(ctx: Ctx, name: string, args: Record<string, unknown>) {
  const { data, error } = await (ctx.supabase as RpcClient).rpc(name, args);
  if (error) {
    console.error("[bank-recon]", name, error.message);
    throw safeError(error.message);
  }
  return data;
}

const actionResult = z.object({ status: z.string() }).passthrough();
const STATUS_TEXT: Record<string, string> = {
  already_processed: "This line was already updated. Refreshing.",
  invalid_transition: "This line can't be changed from its current state.",
  not_eligible: "That record no longer matches this bank line (amount, date or status changed).",
  already_reconciled: "That record is already reconciled.",
  invalid_input: "Enter a reason of at least 5 characters.",
};
function ensureSuccess(r: z.infer<typeof actionResult>) {
  if (r.status !== "success") throw new Error(STATUS_TEXT[r.status] ?? "The request could not be completed.");
  return { ok: true as const };
}

export const importBankStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    societyId: uuid,
    fileName: z.string().trim().min(1).max(120).regex(/\.csv$/i, "Only .csv files are accepted."),
    fileSha256: z.string().regex(/^[0-9a-f]{64}$/),
    csv: z.string().min(1).max(BANK_CSV_MAX_BYTES),
  }))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as Ctx;
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    try {
      await checkRateLimit({ bucket: "bank_statement_import", subject: ctx.userId, limit: 10, windowSec: 3600 });
    } catch {
      throw new Error("Too many imports. Try again in an hour.");
    }
    // Re-parse on the server: never trust client-parsed rows.
    const { createHash } = await import("node:crypto");
    if (createHash("sha256").update(data.csv).digest("hex") !== data.fileSha256) throw new Error("File check failed. Pick the file again.");
    const parsed = parseBankCsv(data.csv);
    if (!parsed.ok) return { status: "invalid" as const, errors: parsed.errors };
    const r = z.object({
      status: z.enum(["imported", "already_imported"]),
      rows: z.number().optional(), possible_duplicates: z.number().optional(), suggested: z.number().optional(),
    }).passthrough().parse(await rpc(ctx, "import_bank_statement", {
      _society_id: data.societyId, _file_name: data.fileName, _file_sha256: data.fileSha256, _rows: parsed.rows,
    }));
    return { status: r.status, rows: r.rows ?? 0, duplicates: r.possible_duplicates ?? 0, suggested: r.suggested ?? 0 };
  });

const lineSchema = z.object({
  id: uuid, line_no: z.number(), txn_date: z.string(), description: z.string(), reference: z.string().nullable(),
  direction: z.enum(["credit", "debit"]), amount: z.coerce.number(), status: lineStatus, is_duplicate: z.boolean(),
  match_strength: z.enum(["strong", "possible"]).nullable(), candidate_count: z.number(), note: z.string().nullable(),
  record_kind: z.enum(["payment", "income"]).nullable(), record_id: uuid.nullable(), record_label: z.string().nullable(),
  record_reversed: z.boolean(),
});
export type BankLine = z.infer<typeof lineSchema>;

export const listBankLines = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ societyId: uuid, status: lineStatus.nullable().default(null), limit: z.number().int().min(1).max(200).default(100), offset: z.number().int().min(0).max(100_000).default(0) }))
  .handler(async ({ data, context }) => {
    const r = z.object({
      rows: z.array(lineSchema),
      summary: z.record(z.string(), z.object({ count: z.coerce.number(), amount: z.coerce.number() })),
    }).parse(await rpc(context as unknown as Ctx, "list_bank_statement_lines", { _society_id: data.societyId, _status: data.status, _limit: data.limit, _offset: data.offset }));
    return r;
  });

const candidateSchema = z.object({
  kind: z.enum(["payment", "income"]), record_id: uuid, record_date: z.string(), amount: z.coerce.number(),
  reference: z.string().nullable(), label: z.string(), already_reconciled: z.boolean(), score: z.number(),
});
export type BankCandidate = z.infer<typeof candidateSchema>;

export const listBankCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ lineId: uuid }))
  .handler(async ({ data, context }) =>
    z.array(candidateSchema).parse(await rpc(context as unknown as Ctx, "list_bank_line_candidates", { _line_id: data.lineId })));

export const confirmBankMatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ lineId: uuid, kind: z.enum(["payment", "income"]), recordId: uuid }))
  .handler(async ({ data, context }) =>
    ensureSuccess(actionResult.parse(await rpc(context as unknown as Ctx, "confirm_bank_line_match", { _line_id: data.lineId, _kind: data.kind, _record_id: data.recordId }))));

export const unmatchBankLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ lineId: uuid, reason: z.string().trim().min(5).max(300) }))
  .handler(async ({ data, context }) =>
    ensureSuccess(actionResult.parse(await rpc(context as unknown as Ctx, "unmatch_bank_line", { _line_id: data.lineId, _reason: data.reason }))));

export const ignoreBankLine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ lineId: uuid, reason: z.string().trim().min(5).max(300) }))
  .handler(async ({ data, context }) =>
    ensureSuccess(actionResult.parse(await rpc(context as unknown as Ctx, "ignore_bank_line", { _line_id: data.lineId, _reason: data.reason }))));

export const refreshBankSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ societyId: uuid }))
  .handler(async ({ data, context }) => {
    await rpc(context as unknown as Ctx, "refresh_bank_statement_suggestions", { _society_id: data.societyId });
    return { ok: true as const };
  });
