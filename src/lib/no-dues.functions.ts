/**
 * No-Dues server functions — trusted-actor model.
 *
 * Security invariants:
 *  - All state mutations go through service-role-only `_internal` RPCs that
 *    receive the trusted actor id from the authenticated server session
 *    (never from browser input). Each RPC independently verifies the actor's
 *    role/membership.
 *  - Direct client INSERT/UPDATE/DELETE on no_dues_* tables is revoked.
 *  - Certificate PDFs are stored in a private bucket; clients receive short-lived
 *    signed URLs, never storage_path.
 *  - Errors surface as structured codes; raw Postgres messages stay server-side.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

/* -------------------------------------------------------------------- */
/*  Error taxonomy                                                       */
/* -------------------------------------------------------------------- */

type NoDuesErrorCode =
  | "UNAUTHENTICATED"
  | "NOT_AUTHORIZED"
  | "INVALID_REQUEST"
  | "INVALID_TRANSITION"
  | "BLOCKED_BY_DUES"
  | "REQUEST_NOT_FOUND"
  | "CERTIFICATE_NOT_FOUND"
  | "ISSUE_FAILED"
  | "DOWNLOAD_FAILED"
  | "RATE_LIMITED";

class NoDuesError extends Error {
  code: NoDuesErrorCode;
  constructor(code: NoDuesErrorCode, publicMessage?: string) {
    super(publicMessage ?? code);
    this.code = code;
  }
}

function mapPgError(msg: string | undefined): NoDuesErrorCode {
  const m = (msg ?? "").toUpperCase();
  if (m.includes("UNAUTHENTICATED")) return "UNAUTHENTICATED";
  if (m.includes("NOT_AUTHORIZED")) return "NOT_AUTHORIZED";
  if (m.includes("INVALID_TRANSITION")) return "INVALID_TRANSITION";
  if (m.includes("REQUEST_NOT_FOUND")) return "REQUEST_NOT_FOUND";
  if (m.includes("CERTIFICATE_NOT_FOUND")) return "CERTIFICATE_NOT_FOUND";
  if (m.includes("INVALID_REQUEST")) return "INVALID_REQUEST";
  return "ISSUE_FAILED";
}

function logServerError(scope: string, e: unknown) {
  // eslint-disable-next-line no-console
  console.error(`[no-dues:${scope}]`, e);
}

/* -------------------------------------------------------------------- */
/*  Canonical eligibility (shared source of truth)                       */
/* -------------------------------------------------------------------- */

type Eligibility = {
  eligible: boolean;
  computed_at: string;
  outstanding_bills: Array<{
    id: string;
    bill_number: string | null;
    amount: number;
    due_date: string | null;
    status: string;
    period_label: string | null;
  }>;
  total_outstanding: number;
  pending_payments: Array<{ id: string; amount: number; method: string | null }>;
  blockers: string[];
};

async function computeEligibility(
  supabase: any,
  societyId: string,
  flatId: string,
): Promise<Eligibility> {
  const [billsRes, paymentsRes] = await Promise.all([
    supabase
      .from("bills")
      .select("id,bill_number,amount,due_date,status,period_label")
      .eq("society_id", societyId)
      .eq("flat_id", flatId)
      .in("status", ["unpaid", "overdue", "partial"]),
    supabase
      .from("payments")
      .select("id,amount,method,status")
      .eq("society_id", societyId)
      .eq("flat_id", flatId)
      .eq("status", "pending"),
  ]);
  if (billsRes.error) {
    logServerError("eligibility.bills", billsRes.error);
    throw new NoDuesError("ISSUE_FAILED");
  }
  if (paymentsRes.error) {
    logServerError("eligibility.payments", paymentsRes.error);
    throw new NoDuesError("ISSUE_FAILED");
  }

  const outstanding = (billsRes.data ?? []).map((b: any) => ({
    id: b.id as string,
    bill_number: b.bill_number ?? null,
    amount: Number(b.amount ?? 0),
    due_date: b.due_date ?? null,
    status: b.status as string,
    period_label: b.period_label ?? null,
  }));
  const pending = (paymentsRes.data ?? []).map((p: any) => ({
    id: p.id as string,
    amount: Number(p.amount ?? 0),
    method: p.method ?? null,
  }));

  const totalDue = outstanding.reduce((s, b) => s + b.amount, 0);
  const blockers: string[] = [];
  if (outstanding.length > 0) blockers.push(`${outstanding.length} unpaid bill(s)`);
  if (pending.length > 0) blockers.push(`${pending.length} pending payment(s) awaiting verification`);

  return {
    eligible: outstanding.length === 0 && pending.length === 0,
    computed_at: new Date().toISOString(),
    outstanding_bills: outstanding,
    total_outstanding: totalDue,
    pending_payments: pending,
    blockers,
  };
}

/* -------------------------------------------------------------------- */
/*  Authorization helpers                                                */
/* -------------------------------------------------------------------- */

async function assertResidentOfFlat(
  supabase: any,
  userId: string,
  flatId: string,
  societyId: string,
) {
  const { data, error } = await supabase
    .from("flat_residents")
    .select("id,flats!inner(society_id)")
    .eq("user_id", userId)
    .eq("flat_id", flatId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) {
    logServerError("assertResidentOfFlat", error);
    throw new NoDuesError("NOT_AUTHORIZED");
  }
  if (!data || (data as any).flats?.society_id !== societyId) {
    throw new NoDuesError("NOT_AUTHORIZED");
  }
}

async function assertSocietyAdmin(supabase: any, societyId: string, userId: string) {
  const { data } = await supabase.rpc("is_society_admin_for", {
    _user_id: userId,
    _society_id: societyId,
  });
  if (data) return;
  const { data: sa } = await supabase.rpc("is_super_admin", { _user_id: userId });
  if (!sa) throw new NoDuesError("NOT_AUTHORIZED");
}

/* -------------------------------------------------------------------- */
/*  Public: check eligibility                                            */
/* -------------------------------------------------------------------- */

export const checkNoDuesEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { societyId: string; flatId: string }) =>
    z.object({ societyId: uuid, flatId: uuid }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertResidentOfFlat(supabase, userId, data.flatId, data.societyId);
    return await computeEligibility(supabase, data.societyId, data.flatId);
  });

/* -------------------------------------------------------------------- */
/*  Submit request (resident)                                            */
/* -------------------------------------------------------------------- */

export const submitNoDuesRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { societyId: string; flatId: string; purpose?: string }) =>
    z
      .object({
        societyId: uuid,
        flatId: uuid,
        purpose: z.string().trim().max(500).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertResidentOfFlat(supabase, userId, data.flatId, data.societyId);
    const snapshot = await computeEligibility(supabase, data.societyId, data.flatId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin.rpc as any)(
      "submit_no_dues_request_internal",
      {
        _actor_id: userId,
        _society_id: data.societyId,
        _flat_id: data.flatId,
        _purpose: data.purpose ?? null,
        _snapshot: snapshot,
        _eligible: snapshot.eligible,
      },
    );
    if (error) {
      logServerError("submit", error);
      throw new NoDuesError(mapPgError(error.message));
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { id: row.request_id as string, status: row.status as string, snapshot };
  });

/* -------------------------------------------------------------------- */
/*  Listings + detail                                                    */
/* -------------------------------------------------------------------- */

export const listMyNoDuesRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    const { data, error } = await supabase
      .from("no_dues_requests")
      .select(
        "id,society_id,flat_id,status,purpose,submitted_at,reviewed_at,admin_notes,rejection_reason,eligibility_snapshot",
      )
      .eq("requester_id", userId)
      .order("submitted_at", { ascending: false })
      .limit(50);
    if (error) {
      logServerError("listMy", error);
      throw new NoDuesError("INVALID_REQUEST");
    }
    return data ?? [];
  });

export const listSocietyNoDuesRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { societyId: string; status?: string }) =>
    z.object({ societyId: uuid, status: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertSocietyAdmin(supabase, data.societyId, userId);
    let q = supabase
      .from("no_dues_requests")
      .select(
        "id,flat_id,requester_id,status,purpose,submitted_at,reviewed_at,admin_notes,rejection_reason,eligibility_snapshot",
      )
      .eq("society_id", data.societyId)
      .order("submitted_at", { ascending: false })
      .limit(200);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) {
      logServerError("listSociety", error);
      throw new NoDuesError("INVALID_REQUEST");
    }
    return rows ?? [];
  });

export const getNoDuesRequestDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { requestId: string }) =>
    z.object({ requestId: uuid }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: req, error } = await supabase
      .from("no_dues_requests")
      .select(
        "id,society_id,flat_id,requester_id,status,purpose,submitted_at,reviewed_at,admin_notes,rejection_reason,eligibility_snapshot",
      )
      .eq("id", data.requestId)
      .maybeSingle();
    if (error || !req) throw new NoDuesError("REQUEST_NOT_FOUND");

    let ok = req.requester_id === userId;
    if (!ok) {
      const { data: adm } = await supabase.rpc("is_society_admin_for", {
        _user_id: userId,
        _society_id: req.society_id,
      });
      ok = !!adm;
      if (!ok) {
        const { data: sa } = await supabase.rpc("is_super_admin", { _user_id: userId });
        ok = !!sa;
      }
    }
    if (!ok) throw new NoDuesError("NOT_AUTHORIZED");

    const [{ data: flat }, { data: resident }, { data: audit }, { data: cert }] =
      await Promise.all([
        supabase.from("flats").select("id,flat_number,floor,block_id").eq("id", req.flat_id).maybeSingle(),
        supabase.from("profiles").select("id,full_name").eq("id", req.requester_id).maybeSingle(),
        supabase
          .from("no_dues_audit")
          .select("id,action,previous_status,new_status,actor_id,metadata,created_at")
          .eq("request_id", req.id)
          .order("created_at", { ascending: true }),
        supabase
          .from("no_dues_certificates")
          .select("id,certificate_number,issued_at,valid_until,revoked_at,revoke_reason")
          .eq("request_id", req.id)
          .maybeSingle(),
      ]);

    return { request: req, flat, resident, audit: audit ?? [], certificate: cert };
  });

/* -------------------------------------------------------------------- */
/*  Approve / Reject                                                     */
/* -------------------------------------------------------------------- */

export const reviewNoDuesRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      requestId: string;
      decision: "approve" | "reject";
      notes?: string;
      reason?: string;
    }) =>
      z
        .object({
          requestId: uuid,
          decision: z.enum(["approve", "reject"]),
          notes: z.string().trim().max(1000).optional(),
          reason: z.string().trim().min(3).max(500).optional(),
        })
        .refine((v) => v.decision !== "reject" || !!v.reason, {
          message: "Rejection reason required",
          path: ["reason"],
        })
        .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: req, error } = await supabase
      .from("no_dues_requests")
      .select("id,society_id,flat_id,status")
      .eq("id", data.requestId)
      .maybeSingle();
    if (error || !req) throw new NoDuesError("REQUEST_NOT_FOUND");
    await assertSocietyAdmin(supabase, req.society_id, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // On approve: re-check eligibility. If blocked, transition to blocked_by_dues instead.
    if (data.decision === "approve") {
      const snap = await computeEligibility(supabase, req.society_id, req.flat_id);
      if (!snap.eligible) {
        const { error: bErr } = await (supabaseAdmin.rpc as any)(
          "transition_no_dues_request_internal",
          {
            _actor_id: userId,
            _request_id: data.requestId,
            _decision: "block",
            _notes: data.notes ?? null,
            _reason: null,
            _new_snapshot: snap,
          },
        );
        if (bErr) {
          logServerError("review.block", bErr);
          throw new NoDuesError(mapPgError(bErr.message));
        }
        return { status: "blocked_by_dues", eligibility: snap };
      }
    }

    const { data: rows, error: tErr } = await (supabaseAdmin.rpc as any)(
      "transition_no_dues_request_internal",
      {
        _actor_id: userId,
        _request_id: data.requestId,
        _decision: data.decision,
        _notes: data.notes ?? null,
        _reason: data.decision === "reject" ? data.reason ?? null : null,
        _new_snapshot: null,
      },
    );
    if (tErr) {
      logServerError("review.transition", tErr);
      throw new NoDuesError(mapPgError(tErr.message));
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    return { status: row?.new_status as string };
  });

/* -------------------------------------------------------------------- */
/*  Issue certificate                                                    */
/* -------------------------------------------------------------------- */

export const issueNoDuesCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { requestId: string; validForDays?: number }) =>
    z
      .object({
        requestId: uuid,
        validForDays: z.number().int().min(1).max(365).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;

    const { data: req, error } = await supabase
      .from("no_dues_requests")
      .select("id,society_id,flat_id,status,requester_id")
      .eq("id", data.requestId)
      .maybeSingle();
    if (error || !req) throw new NoDuesError("REQUEST_NOT_FOUND");
    await assertSocietyAdmin(supabase, req.society_id, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Idempotent short-circuit
    const { data: existing } = await supabaseAdmin
      .from("no_dues_certificates")
      .select("id,certificate_number")
      .eq("request_id", data.requestId)
      .is("revoked_at", null)
      .maybeSingle();
    if (existing) {
      return {
        certificateId: existing.id as string,
        certificateNumber: existing.certificate_number as string,
      };
    }

    if (req.status !== "approved") throw new NoDuesError("INVALID_TRANSITION");

    // Pre-check (finalization RPC re-checks inside the transaction too)
    const snap = await computeEligibility(supabase, req.society_id, req.flat_id);

    // Reserve certificate number (service-role RPC with trusted actor)
    const { data: certNumber, error: nErr } = await (supabaseAdmin.rpc as any)(
      "next_no_dues_cert_number_internal",
      { _actor_id: userId, _society_id: req.society_id },
    );
    if (nErr || !certNumber) {
      logServerError("issue.nextNum", nErr);
      throw new NoDuesError(mapPgError(nErr?.message));
    }

    // Prepare PDF
    const [{ data: society }, { data: flat }, { data: resident }] = await Promise.all([
      supabaseAdmin.from("societies").select("name,address,city,state").eq("id", req.society_id).single(),
      supabaseAdmin.from("flats").select("flat_number,floor,block_id").eq("id", req.flat_id).single(),
      supabaseAdmin.from("profiles").select("full_name").eq("id", req.requester_id).single(),
    ]);

    const { generateRawToken, hashToken, renderCertificatePdf } = await import(
      "@/lib/no-dues.server"
    );
    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);
    const origin = process.env.PUBLIC_APP_URL ?? "https://sociohub.live";
    const verificationUrl = `${origin}/verify/no-dues/${rawToken}`;
    const validUntil = data.validForDays
      ? new Date(Date.now() + data.validForDays * 86400_000)
      : null;

    let pdfBytes: Uint8Array;
    try {
      pdfBytes = await renderCertificatePdf({
        societyName: society?.name ?? "Society",
        societyAddress:
          [society?.address, society?.city, society?.state].filter(Boolean).join(", ") || null,
        unitLabel: flat?.flat_number ?? "—",
        residentName: resident?.full_name ?? "Resident",
        certificateNumber: certNumber as string,
        issuedAt: new Date(),
        validUntil,
        verificationUrl,
      });
    } catch (e) {
      logServerError("issue.pdf", e);
      throw new NoDuesError("ISSUE_FAILED", "Failed to render certificate");
    }

    const storagePath = `${req.society_id}/${certNumber}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("no-dues-certificates")
      .upload(storagePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (upErr) {
      logServerError("issue.upload", upErr);
      throw new NoDuesError("ISSUE_FAILED", "Failed to upload certificate");
    }

    // Finalization RPC re-checks eligibility inside the transaction
    const { data: rpcRows, error: fErr } = await (supabaseAdmin.rpc as any)(
      "finalize_no_dues_issuance_internal",
      {
        _actor_id: userId,
        _request_id: req.id,
        _certificate_number: certNumber,
        _verification_token_hash: tokenHash,
        _storage_path: storagePath,
        _valid_until: validUntil ? validUntil.toISOString().slice(0, 10) : null,
        _eligibility_snapshot: snap,
        _eligible: snap.eligible,
      },
    );
    if (fErr) {
      await supabaseAdmin.storage.from("no-dues-certificates").remove([storagePath]);
      logServerError("issue.finalize", fErr);
      throw new NoDuesError(mapPgError(fErr.message), "Certificate finalization failed");
    }
    const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (row?.status === "blocked_by_dues") {
      // Compensation — remove staged PDF; no certificate row was created
      await supabaseAdmin.storage.from("no-dues-certificates").remove([storagePath]);
      throw new NoDuesError("BLOCKED_BY_DUES");
    }
    if (!row?.certificate_id) {
      await supabaseAdmin.storage.from("no-dues-certificates").remove([storagePath]);
      throw new NoDuesError("ISSUE_FAILED");
    }
    return {
      certificateId: row.certificate_id as string,
      certificateNumber: row.certificate_number as string,
      verificationUrl,
    };
  });

/* -------------------------------------------------------------------- */
/*  Download URL — signed, short-lived                                   */
/* -------------------------------------------------------------------- */

export const getCertificateDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { certificateId: string }) =>
    z.object({ certificateId: uuid }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: cert, error } = await supabase
      .from("no_dues_certificates")
      .select("id,storage_path,society_id,flat_id,request_id")
      .eq("id", data.certificateId)
      .maybeSingle();
    if (error || !cert) throw new NoDuesError("CERTIFICATE_NOT_FOUND");

    const { data: req } = await supabase
      .from("no_dues_requests")
      .select("requester_id")
      .eq("id", cert.request_id)
      .maybeSingle();
    let ok = req?.requester_id === userId;
    if (!ok) {
      const { data: adm } = await supabase.rpc("is_society_admin_for", {
        _user_id: userId,
        _society_id: cert.society_id,
      });
      ok = !!adm;
      if (!ok) {
        const { data: sa } = await supabase.rpc("is_super_admin", { _user_id: userId });
        ok = !!sa;
      }
    }
    if (!ok) throw new NoDuesError("NOT_AUTHORIZED");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("no-dues-certificates")
      .createSignedUrl(cert.storage_path, 300);
    if (sErr || !signed) {
      logServerError("dl.sign", sErr);
      throw new NoDuesError("DOWNLOAD_FAILED");
    }
    return { url: signed.signedUrl };
  });

/* -------------------------------------------------------------------- */
/*  Revoke certificate                                                   */
/* -------------------------------------------------------------------- */

export const revokeNoDuesCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { certificateId: string; reason: string }) =>
    z
      .object({ certificateId: uuid, reason: z.string().trim().min(3).max(500) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as any;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin.rpc as any)(
      "revoke_no_dues_certificate_internal",
      {
        _actor_id: userId,
        _certificate_id: data.certificateId,
        _reason: data.reason,
      },
    );
    if (error) {
      logServerError("revoke", error);
      throw new NoDuesError(mapPgError(error.message));
    }
    return { ok: true };
  });
