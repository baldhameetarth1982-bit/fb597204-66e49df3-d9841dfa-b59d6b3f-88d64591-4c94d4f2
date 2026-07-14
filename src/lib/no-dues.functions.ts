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
/*  Canonical eligibility — DB-level source of truth                     */
/* -------------------------------------------------------------------- */

export type EligibilityBlocker = {
  type: "bill_due" | "pending_offline_payment" | "financial_data_inconsistency";
  bill_id?: string;
  bill_number?: string | null;
  due_date?: string | null;
  total_amount?: number;
  paid_amount?: number;
  remaining_amount?: number;
  payment_state?: "unpaid" | "partial" | "other";
  overdue?: boolean;
  inconsistent?: boolean;
  unknown_status?: boolean;
  payment_id?: string;
  method?: string;
  amount?: number;
};

export type Eligibility = {
  eligible: boolean;
  total_outstanding: number;
  counts: {
    overdue: number;
    partial: number;
    unpaid: number;
    pending_offline: number;
    unknown_status: number;
    inconsistent: number;
  };
  blockers: EligibilityBlocker[];
  calculated_at: string;
};

async function computeEligibilityAdmin(societyId: string, flatId: string): Promise<Eligibility> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin.rpc as any)(
    "compute_no_dues_eligibility_internal",
    { _society_id: societyId, _flat_id: flatId },
  );
  if (error) {
    logServerError("eligibility", error);
    throw new NoDuesError("ISSUE_FAILED");
  }
  return data as Eligibility;
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
/*  Public: check eligibility (DB-derived, never client-supplied)        */
/* -------------------------------------------------------------------- */

export const checkNoDuesEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { societyId: string; flatId: string }) =>
    z.object({ societyId: uuid, flatId: uuid }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertResidentOfFlat(supabase, userId, data.flatId, data.societyId);
    return await computeEligibilityAdmin(data.societyId, data.flatId);
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await (supabaseAdmin.rpc as any)(
      "submit_no_dues_request_internal",
      {
        _actor_id: userId,
        _society_id: data.societyId,
        _flat_id: data.flatId,
        _purpose: data.purpose ?? null,
      },
    );
    if (error) {
      logServerError("submit", error);
      throw new NoDuesError(mapPgError(error.message));
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
      id: row.request_id as string,
      status: row.status as string,
      snapshot: row.eligibility as Eligibility,
    };
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

    // Transition RPC recomputes eligibility internally and, on approve, moves
    // to `blocked_by_dues` automatically if new dues appeared.
    const { data: rows, error: tErr } = await (supabaseAdmin.rpc as any)(
      "transition_no_dues_request_internal",
      {
        _actor_id: userId,
        _request_id: data.requestId,
        _decision: data.decision, // 'approve' | 'reject'
        _notes: data.notes ?? null,
        _reason: data.decision === "reject" ? data.reason ?? null : null,
      },
    );
    if (tErr) {
      logServerError("review.transition", tErr);
      throw new NoDuesError(mapPgError(tErr.message));
    }
    const row = Array.isArray(rows) ? rows[0] : rows;
    return {
      status: row?.new_status as string,
      eligibility: (row?.eligibility ?? null) as Eligibility | null,
    };
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

    // Reserve certificate number (service-role RPC with trusted actor).
    // The finalization RPC recomputes eligibility inside the same transaction;
    // no client-side pre-check needed.
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
