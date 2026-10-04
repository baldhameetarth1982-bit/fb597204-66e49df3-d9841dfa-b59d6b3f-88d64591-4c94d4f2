import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "uploads";
const uuid = z.string().uuid();
const key = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-[A-Za-z0-9._-]{1,100}$/i,
  );
const allowedMime = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

const baseInput = z.object({ societyId: uuid, residentUserId: uuid });
const keyInput = baseInput.extend({ key });

async function requireResidentAdmin(supabase: any, societyId: string, residentUserId: string) {
  const [{ data: allowed }, { data: profile }] = await Promise.all([
    supabase.rpc("current_user_is_society_admin_for", { _society_id: societyId }),
    supabase.from("profiles").select("society_id").eq("id", residentUserId).maybeSingle(),
  ]);
  if (!allowed || profile?.society_id !== societyId) throw new Error("forbidden");
}

function pathFor(residentUserId: string, itemKey: string) {
  return `residents/${residentUserId}/${itemKey}`;
}

/** Stored type of an object, read server-side (the signed upload URL lets the browser choose it). */
async function storedMime(admin: any, residentUserId: string, itemKey: string): Promise<string | null> {
  const { data } = await admin.storage.from(BUCKET).list(`residents/${residentUserId}`, { limit: 1, search: itemKey });
  const row = (data ?? []).find((r: { name: string }) => r.name === itemKey);
  const mime = (row?.metadata as { mimetype?: string } | null)?.mimetype;
  return typeof mime === "string" ? mime.toLowerCase() : null;
}

async function audit(admin: any, actorId: string, societyId: string, action: string, residentUserId: string, itemKey: string) {
  const { error } = await admin.from("audit_log").insert({
    actor_id: actorId, action, target_table: "resident_documents", target_id: residentUserId, society_id: societyId,
    metadata: { key: itemKey.slice(0, 160) },
  });
  if (error) console.error("resident_document_audit_failed");
}

export const listResidentDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => baseInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireResidentAdmin(context.supabase, data.societyId, data.residentUserId);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await checkRateLimit({
      bucket: "resident_documents_list",
      subject: context.userId,
      limit: 120,
      windowSec: 3600,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(`residents/${data.residentUserId}`, {
        limit: 100,
        sortBy: { column: "updated_at", order: "desc" },
      });
    if (error) throw new Error("documents_unavailable");
    return (rows ?? [])
      .filter((row) => key.safeParse(row.name).success)
      .filter((row) => allowedMime.has(String((row.metadata as { mimetype?: string } | null)?.mimetype ?? "").toLowerCase()))
      .map((row) => ({
        name: row.name,
        size: Number((row.metadata as { size?: number } | null)?.size ?? 0),
        updated_at: row.updated_at ?? null,
      }));
  });

export const initializeResidentDocumentUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    baseInput
      .extend({
        filename: z.string().trim().min(1).max(120),
        size: z
          .number()
          .int()
          .min(1)
          .max(15 * 1024 * 1024),
        mime: z.string().max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireResidentAdmin(context.supabase, data.societyId, data.residentUserId);
    if (!allowedMime.has(data.mime)) throw new Error("unsupported_file_type");
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await checkRateLimit({
      bucket: "resident_documents_upload",
      subject: context.userId,
      limit: 30,
      windowSec: 3600,
    });
    const safeName = data.filename.replace(/[^A-Za-z0-9._-]/g, "_").slice(-100);
    const itemKey = `${crypto.randomUUID()}-${safeName}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUploadUrl(pathFor(data.residentUserId, itemKey));
    if (error || !signed) throw new Error("upload_unavailable");
    return { key: itemKey, path: pathFor(data.residentUserId, itemKey), token: signed.token };
  });

export const openResidentDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => keyInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireResidentAdmin(context.supabase, data.societyId, data.residentUserId);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await checkRateLimit({
      bucket: "resident_documents_open",
      subject: context.userId,
      limit: 120,
      windowSec: 3600,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Never hand out a link to a file whose stored type isn't an allowed document type.
    const mime = await storedMime(supabaseAdmin, data.residentUserId, data.key);
    if (!mime || !allowedMime.has(mime)) {
      if (mime) await supabaseAdmin.storage.from(BUCKET).remove([pathFor(data.residentUserId, data.key)]);
      throw new Error("document_unavailable");
    }
    const { data: signed, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(pathFor(data.residentUserId, data.key), 300, { download: true });
    if (error || !signed?.signedUrl) throw new Error("document_unavailable");
    await audit(supabaseAdmin, context.userId, data.societyId, "resident_document.opened", data.residentUserId, data.key);
    return { url: signed.signedUrl };
  });

export const deleteResidentDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => keyInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireResidentAdmin(context.supabase, data.societyId, data.residentUserId);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await checkRateLimit({
      bucket: "resident_documents_delete",
      subject: context.userId,
      limit: 30,
      windowSec: 3600,
    });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.storage
      .from(BUCKET)
      .remove([pathFor(data.residentUserId, data.key)]);
    if (error) throw new Error("delete_failed");
    await audit(supabaseAdmin, context.userId, data.societyId, "resident_document.deleted", data.residentUserId, data.key);
    return { ok: true };
  });
