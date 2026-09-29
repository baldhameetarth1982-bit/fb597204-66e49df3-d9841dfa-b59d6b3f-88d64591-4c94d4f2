/**
 * Helpdesk evidence: private bucket, no storage policies. The caller's own
 * session decides access via helpdesk_ticket_access / helpdesk_record_attachment;
 * the admin client is used only after that check, to write/sign objects.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "helpdesk-evidence";
const MAX = 5 * 1024 * 1024;
const KNOWN = ["not_authorized", "too_many_files", "rate_limited", "invalid_file"];
function safeError(e: unknown): Error {
  const msg = (e as { message?: string } | null)?.message ?? "";
  for (const k of KNOWN) if (msg.includes(k)) return new Error(k);
  return new Error("operation_failed");
}

function sniff(b: Uint8Array): { mime: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: "image/webp", ext: "webp" };
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { mime: "application/pdf", ext: "pdf" };
  return null;
}

export const uploadTicketEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ ticketId: z.string().uuid(), base64: z.string().min(8).max(Math.ceil(MAX * 1.37)) }).parse(raw))
  .handler(async ({ data, context }) => {
    const bytes = Uint8Array.from(Buffer.from(data.base64, "base64"));
    if (bytes.length < 8 || bytes.length > MAX) throw new Error("invalid_file");
    const kind = sniff(bytes);
    if (!kind) throw new Error("invalid_file");
    const { data: acc, error: aErr } = await context.supabase.rpc("helpdesk_ticket_access", { _ticket: data.ticketId });
    const row = (acc as { society_id: string | null; can_upload: boolean }[] | null)?.[0];
    if (aErr || !row?.can_upload || !row.society_id) throw new Error("not_authorized");
    const rand = crypto.randomUUID().replace(/-/g, "");
    const path = `${row.society_id}/${data.ticketId}/${rand}.${kind.ext}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false });
    if (up.error) throw new Error("operation_failed");
    const { error } = await context.supabase.rpc("helpdesk_record_attachment", { _ticket: data.ticketId, _path: path, _mime: kind.mime, _size: bytes.length });
    if (error) { await supabaseAdmin.storage.from(BUCKET).remove([path]); throw safeError(error); }
    return { ok: true };
  });

export const listTicketEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ ticketId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    // RLS on ticket_attachments limits rows to requester / assignee / society admins.
    const { data: rows, error } = await context.supabase.from("ticket_attachments")
      .select("id, path, mime, size_bytes, created_at").eq("ticket_id", data.ticketId).order("created_at").limit(10);
    if (error) throw safeError(error);
    if (!rows?.length) return [];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.path), 300);
    return rows.map((r, i) => ({ id: r.id, mime: r.mime, size: r.size_bytes, created_at: r.created_at, url: signed.data?.[i]?.signedUrl ?? null }));
  });
