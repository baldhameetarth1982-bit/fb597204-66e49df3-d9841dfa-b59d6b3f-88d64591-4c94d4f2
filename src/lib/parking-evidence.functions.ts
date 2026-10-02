/**
 * Parking violation photo evidence. Private bucket with no storage policies.
 * The caller's own session authorizes via parking_evidence_target /
 * parking_record_evidence (society + violation resolved server-side); the admin
 * client only writes/signs after that check. Paths are generated here, never
 * accepted from the browser. Residents have no read path.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "parking-evidence";
const MAX = 5 * 1024 * 1024;
const KNOWN = ["not_authorized", "too_many_files", "rate_limited", "invalid_file", "locked", "reason_required"];
function safeError(e: unknown): Error {
  const msg = (e as { message?: string } | null)?.message ?? "";
  for (const k of KNOWN) if (msg.includes(k)) return new Error(k);
  return new Error("operation_failed");
}

export function sniffImage(b: Uint8Array): { mime: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: "image/webp", ext: "webp" };
  return null;
}

export const uploadParkingEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ violationId: z.string().uuid(), base64: z.string().min(8).max(Math.ceil(MAX * 1.37)) }).parse(raw))
  .handler(async ({ data, context }) => {
    const bytes = Uint8Array.from(Buffer.from(data.base64, "base64"));
    if (bytes.length < 12 || bytes.length > MAX) throw new Error("invalid_file");
    const kind = sniffImage(bytes);
    if (!kind) throw new Error("invalid_file");
    const { data: sid, error: tErr } = await context.supabase.rpc("parking_evidence_target", { _violation: data.violationId });
    if (tErr || typeof sid !== "string") throw safeError(tErr ?? new Error("not_authorized"));
    const path = `${sid}/${data.violationId}/${crypto.randomUUID().replace(/-/g, "")}.${kind.ext}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false });
    if (up.error) throw new Error("operation_failed");
    const { error } = await context.supabase.rpc("parking_record_evidence", { _violation: data.violationId, _path: path, _mime: kind.mime, _size: bytes.length });
    if (error) { await supabaseAdmin.storage.from(BUCKET).remove([path]); throw safeError(error); }
    return { ok: true };
  });

export const listParkingEvidence = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ violationId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    // RLS limits rows to gate staff on shift and the committee of the violation's society.
    const { data: rows, error } = await context.supabase.from("parking_violation_evidence")
      .select("id, path, mime, size_bytes, created_at, removed_at, remove_reason")
      .eq("violation_id", data.violationId).order("created_at").limit(30);
    if (error) throw safeError(error);
    if (!rows?.length) return [];
    const live = rows.filter((r) => !r.removed_at);
    const urls: Record<string, string | null> = {};
    if (live.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const signed = await supabaseAdmin.storage.from(BUCKET).createSignedUrls(live.map((r) => r.path), 120);
      live.forEach((r, i) => { urls[r.id] = signed.data?.[i]?.signedUrl ?? null; });
    }
    return rows.map((r) => ({ id: r.id, mime: r.mime, size: r.size_bytes, created_at: r.created_at, removed_at: r.removed_at, remove_reason: r.remove_reason, url: r.removed_at ? null : urls[r.id] ?? null }));
  });
