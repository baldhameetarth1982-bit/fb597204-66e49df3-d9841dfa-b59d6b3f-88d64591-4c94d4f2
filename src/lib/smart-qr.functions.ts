/**
 * Smart QR Collections — server functions.
 *
 * Money flow (unchanged financial rules):
 *   payer scans QR → sees society bank-transfer details → pays OUTSIDE the app
 *   → submits a payment claim (status "submitted", never "paid")
 *   → society admin records it into canonical income (verification "pending")
 *   → verification + reconciliation happen on the existing Income detail page.
 *
 * All authorization, plan entitlement, token validation, replay protection and
 * audit logging live in SECURITY DEFINER RPCs. The browser never supplies an
 * authoritative society: admin reads are RLS-scoped and every mutation RPC
 * derives society from the target row.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type Ctx = { supabase: any; userId: string };

const TOKEN_RE = /^[A-Za-z0-9_-]{40,64}$/;

function rpcStatus(data: unknown): { status: string; [k: string]: unknown } {
  if (data && typeof data === "object" && "status" in (data as any)) return data as any;
  return { status: "temporary_error" };
}

async function assertAdmin(ctx: Ctx, societyId: string) {
  const { data, error } = await ctx.supabase.rpc("is_society_admin_for", {
    _user_id: ctx.userId,
    _society_id: societyId,
  });
  if (error || !data) throw new Error("permission denied");
}

export interface SmartQrListItem {
  id: string; title: string; purpose: string | null; fixedAmount: number | null; isActive: boolean;
  expiresAt: string | null; createdAt: string; categoryName: string; pendingCount: number;
}
export interface SmartQrSubmission {
  id: string; payerName: string; payerPhone: string | null; amount: number; method: "bank_transfer" | "cash";
  reference: string | null; paidOn: string; note: string | null; status: "submitted" | "recorded" | "rejected";
  reviewReason: string | null; createdAt: string; incomeRecordId: string | null;
  verification: string | null; reconciliation: string | null;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export const listSmartQrFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ societyId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    await assertAdmin(ctx, data.societyId);
    const { data: rows, error } = await ctx.supabase
      .from("smart_qr_codes")
      .select("id, title, purpose, fixed_amount, is_active, expires_at, created_at, category:society_income_categories(display_name)")
      .eq("society_id", data.societyId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("list_failed");
    const ids = (rows ?? []).map((r: any) => r.id);
    const pending: Record<string, number> = {};
    if (ids.length) {
      const { data: subs } = await ctx.supabase
        .from("smart_qr_submissions")
        .select("qr_id")
        .eq("society_id", data.societyId)
        .eq("status", "submitted")
        .limit(1000);
      for (const s of subs ?? []) pending[s.qr_id] = (pending[s.qr_id] ?? 0) + 1;
    }
    const items: SmartQrListItem[] = (rows ?? []).map((r: any) => ({
        id: r.id as string,
        title: r.title as string,
        purpose: r.purpose as string | null,
        fixedAmount: r.fixed_amount === null ? null : Number(r.fixed_amount),
        isActive: r.is_active as boolean,
        expiresAt: r.expires_at as string | null,
        createdAt: r.created_at as string,
        categoryName: (r.category?.display_name as string) ?? "Income",
        pendingCount: pending[r.id] ?? 0,
    }));
    return { items };
  });

export const getSmartQrFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    // RLS returns the row only to admins of its society.
    const { data: q, error } = await ctx.supabase
      .from("smart_qr_codes")
      .select("id, token, title, purpose, fixed_amount, payee_name, bank_name, account_number, ifsc, instructions, accepts_cash, is_active, expires_at, created_at, category:society_income_categories(display_name)")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error("load_failed");
    if (!q) return { found: false as const };
    const { data: subs, error: subErr } = await ctx.supabase
      .from("smart_qr_submissions")
      .select("id, payer_name, payer_phone, amount, payment_method, reference_number, paid_on, note, status, review_reason, reviewed_at, created_at, income_record_id, income:society_income_records(verification_status, reconciliation_status)")
      .eq("qr_id", data.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (subErr) throw new Error("load_failed");
    return {
      found: true as const,
      qr: {
        id: q.id as string,
        token: q.token as string,
        title: q.title as string,
        purpose: q.purpose as string | null,
        fixedAmount: q.fixed_amount === null ? null : Number(q.fixed_amount),
        payeeName: q.payee_name as string,
        bankName: q.bank_name as string | null,
        accountNumber: q.account_number as string,
        ifsc: q.ifsc as string,
        instructions: q.instructions as string | null,
        acceptsCash: q.accepts_cash as boolean,
        isActive: q.is_active as boolean,
        expiresAt: q.expires_at as string | null,
        createdAt: q.created_at as string,
        categoryName: ((q as any).category?.display_name as string) ?? "Income",
      },
      submissions: (subs ?? []).map((s: any): SmartQrSubmission => ({
        id: s.id as string,
        payerName: s.payer_name as string,
        payerPhone: s.payer_phone as string | null,
        amount: Number(s.amount),
        method: s.payment_method as "bank_transfer" | "cash",
        reference: s.reference_number as string | null,
        paidOn: s.paid_on as string,
        note: s.note as string | null,
        status: s.status as "submitted" | "recorded" | "rejected",
        reviewReason: s.review_reason as string | null,
        createdAt: s.created_at as string,
        incomeRecordId: s.income_record_id as string | null,
        verification: (s.income?.verification_status as string | null) ?? null,
        reconciliation: (s.income?.reconciliation_status as string | null) ?? null,
      })),
    };
  });

const CreateInput = z.object({
  title: z.string().trim().min(2).max(80),
  purpose: z.string().trim().max(300).optional().nullable(),
  categoryId: z.string().uuid(),
  fixedAmount: z.number().positive().max(10_000_000).multipleOf(0.01).nullable(),
  payeeName: z.string().trim().min(2).max(100),
  bankName: z.string().trim().max(100).optional().nullable(),
  accountNumber: z.string().regex(/^[0-9]{6,20}$/),
  ifsc: z.string().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
  instructions: z.string().trim().max(500).optional().nullable(),
  acceptsCash: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
});

export const createSmartQrFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => CreateInput.parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const { data: res, error } = await ctx.supabase.rpc("smart_qr_create", {
      _title: data.title,
      _purpose: data.purpose ?? null,
      _category_id: data.categoryId,
      _fixed_amount: data.fixedAmount,
      _payee_name: data.payeeName,
      _bank_name: data.bankName ?? null,
      _account_number: data.accountNumber,
      _ifsc: data.ifsc,
      _instructions: data.instructions ?? null,
      _accepts_cash: data.acceptsCash,
      _expires_at: data.expiresAt,
    });
    if (error) return { status: "temporary_error" as string, id: null as string | null };
    const r = rpcStatus(res);
    return { status: r.status, id: (r.id as string) ?? null };
  });

export const setSmartQrActiveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => z.object({ id: z.string().uuid(), active: z.boolean() }).parse(raw))
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const { data: res, error } = await ctx.supabase.rpc("smart_qr_set_active", {
      _qr_id: data.id,
      _active: data.active,
    });
    if (error) return { status: "temporary_error" };
    return { status: rpcStatus(res).status };
  });

export const reviewSmartQrSubmissionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) =>
    z
      .object({
        id: z.string().uuid(),
        action: z.enum(["record", "reject"]),
        reason: z.string().trim().max(300).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as Ctx;
    const { data: res, error } = await ctx.supabase.rpc("smart_qr_review_submission", {
      _submission_id: data.id,
      _action: data.action,
      _reason: data.reason ?? null,
    });
    if (error) return { status: "temporary_error", incomeRecordId: null as string | null };
    const r = rpcStatus(res);
    return { status: r.status, incomeRecordId: (r.income_record_id as string) ?? null };
  });

// ---------------------------------------------------------------------------
// Public (scanned QR). Anonymous by design; token is only a locator, never
// authorization to read anything beyond the published collection details.
// ---------------------------------------------------------------------------

function publicClient() {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export type PublicQr =
  | { status: "not_found" }
  | { status: "inactive"; societyName: string; title: string }
  | {
      status: "ok";
      societyName: string;
      title: string;
      purpose: string | null;
      fixedAmount: number | null;
      payeeName: string;
      bankName: string | null;
      accountNumber: string;
      ifsc: string;
      instructions: string | null;
      acceptsCash: boolean;
    };

export const getPublicQrFn = createServerFn({ method: "GET" })
  .inputValidator((raw) => z.object({ token: z.string().max(80) }).parse(raw))
  .handler(async ({ data }): Promise<PublicQr> => {
    if (!TOKEN_RE.test(data.token)) return { status: "not_found" };
    const { data: res, error } = await publicClient().rpc("smart_qr_public_view", { _token: data.token });
    if (error) throw new Error("unavailable");
    const r = rpcStatus(res) as any;
    if (r.status === "inactive") return { status: "inactive", societyName: r.society_name, title: r.title };
    if (r.status !== "ok") return { status: "not_found" };
    return {
      status: "ok",
      societyName: r.society_name,
      title: r.title,
      purpose: r.purpose ?? null,
      fixedAmount: r.fixed_amount === null ? null : Number(r.fixed_amount),
      payeeName: r.payee_name,
      bankName: r.bank_name ?? null,
      accountNumber: r.account_number,
      ifsc: r.ifsc,
      instructions: r.instructions ?? null,
      acceptsCash: !!r.accepts_cash,
    };
  });

const SubmitInput = z.object({
  token: z.string().regex(TOKEN_RE),
  payerName: z.string().trim().min(2).max(100),
  payerPhone: z.string().regex(/^[0-9]{10}$/).optional().or(z.literal("")),
  amount: z.number().positive().max(10_000_000).multipleOf(0.01),
  method: z.enum(["bank_transfer", "cash"]),
  reference: z.string().trim().max(64).optional().or(z.literal("")),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(300).optional().or(z.literal("")),
  idempotencyKey: z.string().uuid(),
});

export const submitPublicQrFn = createServerFn({ method: "POST" })
  .inputValidator((raw) => SubmitInput.parse(raw))
  .handler(async ({ data }) => {
    // Per-IP limit (hashed, raw IP never stored) on top of the per-QR limit in the RPC.
    try {
      const { getRequestIP } = await import("@tanstack/react-start/server");
      const { checkRateLimit, fingerprintSubject, RateLimitedError } = await import("@/lib/rate-limit.server");
      let ip = "anon";
      try { ip = getRequestIP({ xForwardedFor: true }) ?? "anon"; } catch { /* ignore */ }
      try {
        await checkRateLimit({ bucket: "smart_qr_submit_ip", subject: fingerprintSubject(ip, "smart_qr"), limit: 8, windowSec: 600 });
      } catch (e) {
        if (e instanceof RateLimitedError) return { status: "rate_limited" };
        throw e;
      }
    } catch {
      return { status: "temporary_error" };
    }
    const { data: res, error } = await publicClient().rpc("smart_qr_public_submit", {
      _token: data.token,
      _payer_name: data.payerName,
      _payer_phone: data.payerPhone || (null as unknown as string),
      _amount: data.amount,
      _payment_method: data.method,
      _reference_number: data.reference || (null as unknown as string),
      _paid_on: data.paidOn,
      _note: data.note || (null as unknown as string),
      _idempotency_key: data.idempotencyKey,
    });
    if (error) return { status: "temporary_error" };
    return { status: rpcStatus(res).status };
  });
