import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "uploads";
const uuid = z.string().uuid();
const key = z.string().regex(/^[0-9a-f-]{36}-[A-Za-z0-9._-]{1,120}$/);
const allowedMime = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

const baseInput = z.object({ societyId: uuid, residentUserId: uuid });
const keyInput = baseInput.extend({ key });

async function requireResidentAdmin(
  supabase: Parameters<Parameters<typeof requireSupabaseAuth>["options"]["server"]>[0] extends never ? never : any,
  societyId: string,
  residentUserId: string,
) {
  const [{ data: allowed }, { data: profile }] = await Promise.all([
    supabase.rpc("current_user_is_society_admin_for", { _society_id: societyId }),
    supabase.from("profiles").select("society_id").eq("id", residentUserId).maybeSingle(),
  ]);
  if (!allowed || profile?.society_id !== societyId) throw new Error("forbidden");
}

function pathFor(residentUserId: string, itemKey: string) {
  return `residents/${residentUserId}/${itemKey}`;
}

export const listResidentDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => baseInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireResidentAdmin(context.supabase, data.societyId, data.residentUserId);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await checkRateLimit({ bucket: "resident_documents_list", subject: context.userId, limit: 120, windowSec: 3600 });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list(`residents/${data.residentUserId}`, { limit: 100, sortBy: { column: "updated_at", order: "desc" } });
    if (error) throw new Error("documents_unavailable");
    return (rows ?? []).filter((row) => key.safeParse(row.name).success).map((row) => ({
      name: row.name,
      size: Number((row.metadata as { size?: number } | null)?.size ?? 0),
      updated_at: row.updated_at ?? null,
    }));
  });

export const initializeResidentDocumentUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => baseInput.extend({
    filename: z.string().trim().min(1).max(120),
    size: z.number().int().min(1).max(15 * 1024 * 1024),
    mime: z.string().max(100),
  }).parse(input))
  .handler(async ({ data, context }) => {
    await requireResidentAdmin(context.supabase, data.societyId, data.residentUserId);
    if (!allowedMime.has(data.mime)) throw new Error("unsupported_file_type");
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await checkRateLimit({ bucket: "resident_documents_upload", subject: context.userId, limit: 30, windowSec: 3600 });
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
    await checkRateLimit({ bucket: "resident_documents_open", subject: context.userId, limit: 120, windowSec: 3600 });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(pathFor(data.residentUserId, data.key), 300);
    if (error || !signed?.signedUrl) throw new Error("document_unavailable");
    return { url: signed.signedUrl };
  });

export const deleteResidentDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => keyInput.parse(input))
  .handler(async ({ data, context }) => {
    await requireResidentAdmin(context.supabase, data.societyId, data.residentUserId);
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    await checkRateLimit({ bucket: "resident_documents_delete", subject: context.userId, limit: 30, windowSec: 3600 });
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.storage.from(BUCKET).remove([pathFor(data.residentUserId, data.key)]);
    if (error) throw new Error("delete_failed");
    return { ok: true };
  });