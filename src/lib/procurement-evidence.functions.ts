/**
 * Procurement evidence (quotation / vendor invoice files). Private bucket with no
 * storage policies. The caller's own session authorizes via finance-admin RPCs
 * (society resolved server-side from the record); the admin client only writes/signs
 * after that check. Files never touch expenses, ledger or payments.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "procurement-evidence";
const MAX = 5 * 1024 * 1024;
const KNOWN = ["not_authorized", "too_many_files", "rate_limited", "invalid_file", "locked", "reason_required"];
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
const EXT_OK: Record<string, string[]> = { jpg: ["jpg", "jpeg"], png: ["png"], webp: ["webp"], pdf: ["pdf"] };

export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || "file";
}

export const uploadProcurementEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) =>
    z.object({
      requestId: z.string().uuid(),
      quotationId: z.string().uuid().nullable(),
      kind: z.enum(["quotation", "invoice"]),
      fileName: z.string().min(1).max(200),
      base64: z.string().min(8).max(Math.ceil(MAX * 1.37)),
    }).refine((d) => (d.kind === "quotation") === (d.quotationId !== null)).parse(raw))
  .handler(async ({ data, context }) => {
    const bytes = Uint8Array.from(Buffer.from(data.base64, "base64"));
    if (bytes.length < 8 || bytes.length > MAX) throw new Error("invalid_file");
    const kind = sniff(bytes);
    const name = cleanFileName(data.fileName);
    const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
    if (!kind || !EXT_OK[kind.ext].includes(ext)) throw new Error("invalid_file");
    const { data: sid, error: tErr } = await context.supabase.rpc("proc_attachment_target", { _request: data.requestId, _quotation: data.quotationId as string, _kind: data.kind });
    if (tErr || typeof sid !== "string") throw safeError(tErr ?? new Error("not_authorized"));
    const path = `${sid}/${data.requestId}/${crypto.randomUUID().replace(/-/g, "")}.${kind.ext}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false });
    if (up.error) throw new Error("operation_failed");
    const { error } = await context.supabase.rpc("proc_record_attachment", {
      _request: data.requestId, _quotation: data.quotationId as string, _kind: data.kind, _path: path, _mime: kind.mime, _size: bytes.length, _name: name,
    });
    if (error) { await supabaseAdmin.storage.from(BUCKET).remove([path]); throw safeError(error); }
    return { ok: true };
  });

export const listProcurementEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ requestId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    // RLS limits rows to finance admins of the record's society.
    const { data: rows, error } = await context.supabase.from("procurement_attachments")
      .select("id, quotation_id, kind, path, mime, size_bytes, file_name, created_at, removed_at, remove_reason")
      .eq("request_id", data.requestId).order("created_at").limit(60);
    if (error) throw safeError(error);
    if (!rows?.length) return [];
    const live = rows.filter((r) => !r.removed_at);
    let urls: Record<string, string | null> = {};
    if (live.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrls(live.map((r) => r.path), 300);
      live.forEach((r, i) => { urls[r.id] = signed.data?.[i]?.signedUrl ?? null; });
    }
    return rows.map((r) => ({
      id: r.id, quotation_id: r.quotation_id, kind: r.kind, mime: r.mime, size: r.size_bytes, name: r.file_name,
      created_at: r.created_at, removed_at: r.removed_at, remove_reason: r.remove_reason, url: urls[r.id] ?? null,
    }));
  });
