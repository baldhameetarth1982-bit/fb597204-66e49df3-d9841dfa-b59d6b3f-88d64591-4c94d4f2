/**
 * Manual UPI for SociyoHub SaaS plans (temporary while Razorpay is locked).
 * The amount is always the server quote (GST + offers included); the DB
 * re-checks it on submit. Screenshots go to the private payment-proofs bucket
 * under saas-upi/<user>/<uuid>.<ext> and are shown only via short signed links
 * after a Super Admin check. Approval goes through admin_review_saas_upi_payment,
 * which writes the canonical subscription payment + receipt.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const BUCKET = "payment-proofs";
const MAX = 5 * 1024 * 1024;
export const UPI_CONSENT_VERSION = "saas-upi-2026-10";
const KNOWN = [
  "not_authorized", "upi_unavailable", "invalid_paid_at", "already_pending", "duplicate_reference",
  "custom_pricing", "nothing_due", "price_changed", "idempotency_conflict", "invalid_file", "rate_limited",
  "reason_required", "not_found", "quantity_below_current_flats",
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
function decodeBase64(s: string) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const vpa = /^[A-Za-z0-9._-]{2,64}@[A-Za-z0-9.-]{2,64}$/;

export const getSaasPaymentMethods = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("get_saas_payment_methods");
    if (error) throw safeError(error);
    const r = (data ?? {}) as { razorpay_locked?: boolean; upi_enabled?: boolean; upi_vpa?: string; payee_name?: string };
    return {
      razorpayLocked: r.razorpay_locked !== false,
      upiEnabled: Boolean(r.upi_enabled),
      upiVpa: r.upi_vpa ?? "",
      payeeName: r.payee_name ?? "SociyoHub",
    };
  });

export const submitSaasUpiPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      societyId: z.string().uuid(),
      planId: z.enum(["basic", "pro", "premium"]),
      flatQuantity: z.number().int().min(1).max(300).optional(),
      requestId: z.string().uuid(),
      expectedAmountPaise: z.number().int().positive(),
      utr: z.string().trim().regex(/^[A-Za-z0-9]{8,35}$/),
      payerName: z.string().trim().min(2).max(80).regex(/^[^<>{}]+$/),
      payerUpi: z.string().trim().regex(vpa).optional().or(z.literal("")),
      paidAt: z.string().datetime(),
      consent: z.literal(true),
      proofBase64: z.string().min(16).max(Math.ceil(MAX * 1.37)),
    }).strict().parse(d),
  )
  .handler(async ({ data, context }) => {
    const { checkRateLimit } = await import("@/lib/rate-limit.server");
    try {
      await Promise.all([
        checkRateLimit({ bucket: "saas_upi_submit_user", subject: context.userId, limit: 6, windowSec: 3600 }),
        checkRateLimit({ bucket: "saas_upi_submit_society", subject: data.societyId, limit: 10, windowSec: 86400 }),
      ]);
    } catch { throw new Error("rate_limited"); }
    const bytes = decodeBase64(data.proofBase64);
    if (bytes.length < 16 || bytes.length > MAX) throw new Error("invalid_file");
    const kind = sniffImage(bytes);
    if (!kind) throw new Error("invalid_file");
    const path = `saas-upi/${context.userId}/${crypto.randomUUID()}.${kind.ext}`;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType: kind.mime, upsert: false });
    if (up.error) throw new Error("operation_failed");
    const { data: res, error } = await context.supabase.rpc("submit_saas_upi_payment", {
      _society_id: data.societyId, _plan_id: data.planId, _flat_quantity: (data.flatQuantity ?? null) as number,
      _request_id: data.requestId, _expected_amount_paise: data.expectedAmountPaise, _utr: data.utr,
      _payer_name: data.payerName, _payer_upi: data.payerUpi || (null as unknown as string),
      _paid_at: data.paidAt, _proof_path: path, _consent_version: UPI_CONSENT_VERSION,
    });
    const r = res as { id?: string; status?: string; replayed?: boolean } | null;
    if (error || r?.replayed) await supabaseAdmin.storage.from(BUCKET).remove([path]);
    if (error) throw safeError(error);
    return { id: String(r?.id ?? ""), status: String(r?.status ?? "pending") };
  });

export type MyUpiPayment = {
  id: string; plan_id: string; amount_paise: number; utr: string; status: "pending" | "approved" | "rejected";
  reject_code: string | null; received_amount_paise: number | null; review_note: string | null;
  created_at: string; reviewed_at: string | null;
};

export const listMySaasUpiPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ societyId: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("list_my_saas_upi_payments", { _society_id: data.societyId });
    if (error) throw safeError(error);
    return (rows ?? []) as unknown as MyUpiPayment[];
  });

/* ------------------------------ Super Admin ------------------------------ */

export type AdminUpiPayment = MyUpiPayment & {
  society_id: string; society_name: string; plan_name: string; flat_count: number; price_per_flat_inr: number;
  base_amount_paise: number | null; tax_amount_paise: number | null; tax_percent: number | null;
  payee_vpa: string; payer_name: string; payer_upi: string | null; paid_at: string; term_months: number;
};

export const adminListSaasUpiPayments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ status: z.enum(["pending", "approved", "rejected"]).nullable(), before: z.string().datetime().nullable() }).strict().parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("admin_list_saas_upi_payments", {
      _status: data.status as string, _limit: 50, _before: data.before as string,
    });
    if (error) throw safeError(error);
    return (rows ?? []) as unknown as AdminUpiPayment[];
  });

export const adminGetSaasUpiProof = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).strict().parse(d))
  .handler(async ({ data, context }) => {
    const { data: path, error } = await context.supabase.rpc("admin_get_saas_upi_proof_path", { _id: data.id });
    if (error) throw safeError(error);
    if (typeof path !== "string" || !/^saas-upi\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(png|jpg|webp)$/.test(path)) return { url: null };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: s } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 300);
    return { url: s?.signedUrl ?? null };
  });

export const adminReviewSaasUpiPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      approve: z.boolean(),
      rejectCode: z.enum(["short_paid", "not_received", "wrong_reference", "unclear_proof", "duplicate", "other"]).nullable(),
      receivedAmountPaise: z.number().int().min(0).max(100_000_000).nullable(),
      note: z.string().trim().max(500).nullable(),
    }).strict().parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: res, error } = await context.supabase.rpc("admin_review_saas_upi_payment", {
      _id: data.id, _approve: data.approve, _reject_code: data.rejectCode as string,
      _received_amount_paise: data.receivedAmountPaise as number, _note: data.note as string,
    });
    if (error) throw safeError(error);
    return res as { status: string; replayed: boolean; receipt_number?: string };
  });

export const adminSetSaasPaymentMethods = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      razorpayLocked: z.boolean(), upiEnabled: z.boolean(),
      upiVpa: z.string().trim().regex(vpa), payeeName: z.string().trim().min(2).max(80).regex(/^[^<>{}]+$/),
    }).strict().parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("admin_set_saas_payment_methods", {
      _razorpay_locked: data.razorpayLocked, _upi_enabled: data.upiEnabled, _upi_vpa: data.upiVpa, _payee_name: data.payeeName,
    });
    if (error) throw safeError(error);
    return { ok: true };
  });
