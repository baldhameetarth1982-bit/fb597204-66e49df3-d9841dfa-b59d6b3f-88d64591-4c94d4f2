/**
 * Manual UPI QR maintenance payments. The society's UPI details live in
 * society_upi_settings (definer RPCs only). Residents pay outside the app,
 * then submit a reference + screenshot; the payment stays "pending" in the
 * canonical payments table until the committee verifies it with the existing
 * verify/reject flow. Images live in the private payment-proofs bucket (no
 * storage policies) and are only ever shown through short signed links after
 * the caller's own session passes the RPC check.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "payment-proofs";
const MAX = 5 * 1024 * 1024;
const KNOWN = [
  "not_authorized", "plan_required", "not_configured", "invalid_reference", "invalid_file",
  "duplicate_reference", "offline_payment_pending", "nothing_due", "bill_cancelled", "rate_limited",
  "idempotency_conflict",
];
function safeError(e: unknown): Error {
  const msg = (e as { message?: string } | null)?.message ?? "";
  for (const k of KNOWN) if (msg.includes(k)) return new Error(k);
  return new Error("operation_failed");
}

function sniffImage(b: Uint8Array): { mime: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: "image/webp", ext: "webp" };
  return null;
}

function decodeImage(base64: string) {
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  if (bytes.length < 16 || bytes.length > MAX) throw new Error("invalid_file");
  const kind = sniffImage(bytes);
  if (!kind) throw new Error("invalid_file");
  return { bytes, kind };
}

const b64 = z.string().min(16).max(Math.ceil(MAX * 1.37));

async function sign(path: string | null | undefined) {
  if (!path) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

/* ---------------------------- Committee setup ---------------------------- */

export const getSocietyUpiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ societyId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("admin_get_society_upi", { _society_id: data.societyId });
    if (error) throw safeError(error);
    const r = row as { plan_enabled: boolean; configured: boolean; enabled: boolean; upi_vpa: string | null; payee_name: string | null; qr_path: string | null };
    return { planEnabled: r.plan_enabled, configured: r.configured, enabled: r.enabled, upiVpa: r.upi_vpa, payeeName: r.payee_name, qrUrl: await sign(r.qr_path) };
  });

export const saveSocietyUpiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      societyId: z.string().uuid(),
      enabled: z.boolean(),
      upiVpa: z.string().trim().regex(/^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$/),
      payeeName: z.string().trim().min(2).max(80).regex(/^[^<>{}]+$/),
      qrBase64: b64.nullable(),
      removeQr: z.boolean(),
    }).strict().parse(d),
  )
  .handler(async ({ data, context }) => {
    // Permission + plan are checked first with the caller's own session.
    const { error: authErr } = await context.supabase.rpc("admin_get_society_upi", { _society_id: data.societyId });
    if (authErr) throw safeError(authErr);
    let path: string | null = null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.qrBase64) {
      const { bytes, kind } = decodeImage(data.qrBase64);
      path = `qr/${data.societyId}/${crypto.randomUUID()}.${kind.ext}`;
      const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false });
      if (up.error) throw new Error("operation_failed");
    }
    const { error } = await context.supabase.rpc("admin_set_society_upi", {
      _society_id: data.societyId, _enabled: data.enabled, _upi_vpa: data.upiVpa, _payee_name: data.payeeName,
      _qr_path: path as string, _keep_qr: !data.removeQr,
    });
    if (error) { if (path) await supabaseAdmin.storage.from(BUCKET).remove([path]); throw safeError(error); }
    return { ok: true };
  });

/* ------------------------------- Resident -------------------------------- */

export const getBillUpiDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ billId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("get_bill_upi_details", { _bill_id: data.billId });
    if (error) return { available: false as const, reason: safeError(error).message };
    const r = row as { available: boolean; reason?: string; upi_vpa?: string; payee_name?: string; qr_path?: string | null; amount_due?: number; pending_amount?: number; bill_number?: string | null };
    if (!r.available) return { available: false as const, reason: r.reason ?? "unavailable" };
    return {
      available: true as const,
      upiVpa: r.upi_vpa ?? "", payeeName: r.payee_name ?? "", qrUrl: await sign(r.qr_path),
      amountDue: Number(r.amount_due ?? 0), pendingAmount: Number(r.pending_amount ?? 0), billNumber: r.bill_number ?? null,
    };
  });

export const submitUpiQrPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      billId: z.string().uuid(),
      referenceNo: z.string().trim().regex(/^[A-Za-z0-9]{8,35}$/),
      idempotencyKey: z.string().trim().min(6).max(120),
      proofBase64: b64,
    }).strict().parse(d),
  )
  .handler(async ({ data, context }) => {
    const { bytes, kind } = decodeImage(data.proofBase64);
    const path = `${context.userId}/${crypto.randomUUID()}.${kind.ext}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false });
    if (up.error) throw new Error("operation_failed");
    const { data: pid, error } = await context.supabase.rpc("submit_upi_qr_payment", {
      _bill_id: data.billId, _reference_no: data.referenceNo, _proof_path: path, _idempotency_key: data.idempotencyKey,
    });
    if (error) { await supabaseAdmin.storage.from(BUCKET).remove([path]); throw safeError(error); }
    return { paymentId: String(pid) };
  });

/* ---------------------------- Review (either) ---------------------------- */

export const getPaymentProofUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ paymentId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { data: path, error } = await context.supabase.rpc("get_payment_proof_path", { _payment_id: data.paymentId });
    if (error) throw safeError(error);
    const p = typeof path === "string" ? path : null;
    // Only proofs stored by this flow are signed; legacy proof_url values are ignored.
    if (!p || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(p)) return { url: null };
    return { url: await sign(p) };
  });
