/**
 * No-Dues server functions.
 *
 * Security invariants:
 * - All state transitions run through DB RPCs (finalize_no_dues_issuance,
 *   revoke_no_dues_certificate) or authorized admin paths.
 * - Certificate numbers come from next_no_dues_cert_number(society)
 *   (per-society sequence — concurrency safe).
 * - Client never receives storage_path.
 * - Errors are structured codes; raw DB messages stay server-side.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

/** Structured error codes returned to clients. */
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
  if (m.includes("INVALID_REQUEST")) return "INVALID_REQUEST";
  if (m.includes("INVALID_TRANSITION")) return "INVALID_TRANSITION";
  if (m.includes("REQUEST_NOT_FOUND")) return "REQUEST_NOT_FOUND";
  if (m.includes("CERTIFICATE_NOT_FOUND")) return "CERTIFICATE_NOT_FOUND";
  return "ISSUE_FAILED";
}

function logServerError(scope: string, e: unknown) {
  // Server-side only — never returned to the client.
  // eslint-disable-next-line no-console
  console.error(`[no-dues:${scope}]`, e);
}

/* -------------------------------------------------------------------- */
/*  Eligibility                                                          */
/* -------------------------------------------------------------------- */

async function computeEligibility(
  supabase: any,
  societyId: string,
  flatId: string,
) {
  // Uses public.bills (status IN unpaid/overdue/partial) and payments (status = pending).
  // Cancelled bills excluded via status filter. Paid bills excluded.
  const { data: bills, error } = await supabase
    .from("bills")
    .select("id,bill_number,amount,due_date,status,period_label")
    .eq("society_id", societyId)
    .eq("flat_id", flatId)
    .in("status", ["unpaid", "overdue", "partial"]);
  if (error) {
    logServerError("eligibility.bills", error);
    throw new NoDuesError("INVALID_REQUEST");
  }

  const outstanding = (bills ?? []).map((b: any) => ({
    id: b.id,
    bill_number: b.bill_number,
    amount: Number(b.amount ?? 0),
    due_date: b.due_date,
    status: b.status,
    period_label: b.period_label,
  }));
  const totalDue = outstanding.reduce((s: number, b: any) => s + b.amount, 0);

  const { data: pending, error: pErr } = await supabase
    .from("payments")
    .select("id,amount,method,status")
    .eq("society_id", societyId)
    .eq("flat_id", flatId)
    .eq("status", "pending");
  if (pErr) {
    logServerError("eligibility.payments", pErr);
    throw new NoDuesError("INVALID_REQUEST");
  }

  const eligible = outstanding.length === 0 && (pending ?? []).length === 0;
  return {
    eligible,
    computed_at: new Date().toISOString(),
    outstanding_bills: outstanding,
    total_outstanding: totalDue,
    pending_payments: (pending ?? []).map((p: any) => ({
      id: p.id,
      amount: Number(p.amount ?? 0),
      method: p.method,
    })),
  };
}

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
  const { data, error } = await supabase.rpc("is_society_admin_for", {
    _user_id: userId,
    _society_id: societyId,
  });
  if (error) {
    logServerError("assertSocietyAdmin", error);
    throw new NoDuesError("NOT_AUTHORIZED");
  }
  if (!data) {
    const { data: sa } = await supabase.rpc("is_super_admin", { _user_id: userId });
    if (!sa) throw new NoDuesError("NOT_AUTHORIZED");
  }
}

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
      .object({ societyId: uuid, flatId: uuid, purpose: z.string().trim().max(500).optional() })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertResidentOfFlat(supabase, userId, data.flatId, data.societyId);

    const snapshot = await computeEligibility(supabase, data.societyId, data.flatId);
    const status = snapshot.eligible ? "submitted" : "blocked_by_dues";

    const { data: row, error } = await supabase
      .from("no_dues_requests")
      .insert({
        society_id: data.societyId,
        flat_id: data.flatId,
        requester_id: userId,
        purpose: data.purpose ?? null,
        status,
        eligibility_snapshot: snapshot,
      })
      .select("id,status")
      .single();
    if (error) {
      logServerError("submit.insert", error);
      throw new NoDuesError("INVALID_REQUEST");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: auditErr } = await supabaseAdmin.from("no_dues_audit").insert({
      request_id: row.id,
      society_id: data.societyId,
      actor_id: userId,
      action: "submitted",
      new_status: status,
      metadata: { eligible: snapshot.eligible },
    });
    if (auditErr) {
      // Audit write failed — surface as ISSUE_FAILED so operators notice; do not silently continue.
      logServerError("submit.audit", auditErr);
      throw new NoDuesError("ISSUE_FAILED", "Failed to record request audit");
    }

    return { id: row.id, status: row.status, snapshot };
  });

/* -------------------------------------------------------------------- */
/*  List requests                                                        */
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
    if (error) {
      logServerError("detail.load", error);
      throw new NoDuesError("REQUEST_NOT_FOUND");
    }
    if (!req) throw new NoDuesError("REQUEST_NOT_FOUND");

    // Authorization: society admin OR requester
    let ok = req.requester_id === userId;
    if (!ok) {
      const { data: isAdmin } = await supabase.rpc("is_society_admin_for", {
        _user_id: userId,
        _society_id: req.society_id,
      });
      ok = !!isAdmin;
      if (!ok) {
        const { data: sa } = await supabase.rpc("is_super_admin", { _user_id: userId });
        ok = !!sa;
      }
    }
    if (!ok) throw new NoDuesError("NOT_AUTHORIZED");

    // Load related data
    const [{ data: flat }, { data: resident }, { data: audit }, { data: cert }] =
      await Promise.all([
        supabase
          .from("flats")
          .select("id,flat_number,floor,block_id")
          .eq("id", req.flat_id)
          .maybeSingle(),
        supabase
          .from("profiles")
          .select("id,full_name")
          .eq("id", req.requester_id)
          .maybeSingle(),
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

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  draft: ["submitted"],
  submitted: ["under_review", "approved", "rejected", "blocked_by_dues"],
  under_review: ["approved", "rejected", "blocked_by_dues"],
  blocked_by_dues: ["submitted", "rejected"],
  approved: ["issued", "rejected"],
  issued: ["revoked"],
  rejected: [],
  revoked: [],
};

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
        .refine((d) => d.decision !== "reject" || !!d.reason, {
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
    if (error) {
      logServerError("review.load", error);
      throw new NoDuesError("REQUEST_NOT_FOUND");
    }
    if (!req) throw new NoDuesError("REQUEST_NOT_FOUND");

    await assertSocietyAdmin(supabase, req.society_id, userId);

    const nextStatus = data.decision === "approve" ? "approved" : "rejected";
    const allowed = ALLOWED_TRANSITIONS[req.status] ?? [];
    if (!allowed.includes(nextStatus)) throw new NoDuesError("INVALID_TRANSITION");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Re-verify eligibility on approve
    if (data.decision === "approve") {
      const snap = await computeEligibility(supabase, req.society_id, req.flat_id);
      if (!snap.eligible) {
        await supabaseAdmin
          .from("no_dues_requests")
          .update({
            status: "blocked_by_dues",
            eligibility_snapshot: snap,
            reviewed_by: userId,
            reviewed_at: new Date().toISOString(),
            admin_notes: data.notes ?? null,
          })
          .eq("id", data.requestId);
        const { error: aErr } = await supabaseAdmin.from("no_dues_audit").insert({
          request_id: data.requestId,
          society_id: req.society_id,
          actor_id: userId,
          action: "blocked_by_dues",
          previous_status: req.status,
          new_status: "blocked_by_dues",
          metadata: { total_outstanding: snap.total_outstanding },
        });
        if (aErr) {
          logServerError("review.blocked.audit", aErr);
          throw new NoDuesError("ISSUE_FAILED");
        }
        return { status: "blocked_by_dues", eligibility: snap };
      }
    }

    const { error: uErr } = await supabaseAdmin
      .from("no_dues_requests")
      .update({
        status: nextStatus,
        reviewed_by: userId,
        reviewed_at: new Date().toISOString(),
        admin_notes: data.notes ?? null,
        rejection_reason: data.decision === "reject" ? data.reason ?? null : null,
      })
      .eq("id", data.requestId);
    if (uErr) {
      logServerError("review.update", uErr);
      throw new NoDuesError("ISSUE_FAILED");
    }

    const { error: aErr } = await supabaseAdmin.from("no_dues_audit").insert({
      request_id: data.requestId,
      society_id: req.society_id,
      actor_id: userId,
      action: data.decision === "approve" ? "approved" : "rejected",
      previous_status: req.status,
      new_status: nextStatus,
      metadata: { reason: data.reason, notes: data.notes },
    });
    if (aErr) {
      logServerError("review.audit", aErr);
      throw new NoDuesError("ISSUE_FAILED");
    }

    return { status: nextStatus };
  });

/* -------------------------------------------------------------------- */
/*  Issue certificate — atomic via RPC                                   */
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
    if (error) {
      logServerError("issue.load", error);
      throw new NoDuesError("REQUEST_NOT_FOUND");
    }
    if (!req) throw new NoDuesError("REQUEST_NOT_FOUND");
    await assertSocietyAdmin(supabase, req.society_id, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Idempotent short-circuit — already issued and not revoked
    const { data: existing } = await supabaseAdmin
      .from("no_dues_certificates")
      .select("id,certificate_number")
      .eq("request_id", data.requestId)
      .is("revoked_at", null)
      .maybeSingle();
    if (existing) {
      return {
        certificateId: existing.id,
        certificateNumber: existing.certificate_number,
      };
    }

    if (req.status !== "approved") throw new NoDuesError("INVALID_TRANSITION");

    // Re-verify eligibility at issue time
    const snap = await computeEligibility(supabase, req.society_id, req.flat_id);
    if (!snap.eligible) throw new NoDuesError("BLOCKED_BY_DUES");

    // Reserve certificate number atomically (per-society sequence)
    const { data: certNumber, error: nErr } = await supabase.rpc(
      "next_no_dues_cert_number",
      { _society_id: req.society_id },
    );
    if (nErr || !certNumber) {
      logServerError("issue.nextNum", nErr);
      throw new NoDuesError("ISSUE_FAILED");
    }

    // Load society + flat + resident for PDF
    const [{ data: society }, { data: flat }, { data: resident }] = await Promise.all([
      supabaseAdmin
        .from("societies")
        .select("name,address,city,state")
        .eq("id", req.society_id)
        .single(),
      supabaseAdmin
        .from("flats")
        .select("flat_number,floor,block_id")
        .eq("id", req.flat_id)
        .single(),
      supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", req.requester_id)
        .single(),
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
          [society?.address, society?.city, society?.state].filter(Boolean).join(", ") ||
          null,
        unitLabel: flat?.flat_number ?? "—",
        residentName: resident?.full_name ?? "Resident",
        certificateNumber: certNumber,
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

    // Atomic: insert cert + flip request status + write audit
    const { data: rpcRows, error: fErr } = await (supabaseAdmin.rpc as any)(
      "finalize_no_dues_issuance",
      {
        _request_id: req.id,
        _certificate_number: certNumber,
        _verification_token_hash: tokenHash,
        _storage_path: storagePath,
        _valid_until: validUntil ? validUntil.toISOString().slice(0, 10) : null,
      },
    );
    if (fErr) {
      // Compensation: remove uploaded PDF
      await supabaseAdmin.storage.from("no-dues-certificates").remove([storagePath]);
      logServerError("issue.finalize", fErr);
      throw new NoDuesError(mapPgError(fErr.message), "Certificate finalization failed");
    }
    const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!row?.certificate_id) {
      await supabaseAdmin.storage.from("no-dues-certificates").remove([storagePath]);
      throw new NoDuesError("ISSUE_FAILED");
    }

    return {
      certificateId: row.certificate_id,
      certificateNumber: row.certificate_number,
      verificationUrl,
    };
  });

/* -------------------------------------------------------------------- */
/*  Signed URL for owner/admin — never returns storage_path              */
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
    if (error) {
      logServerError("dl.load", error);
      throw new NoDuesError("CERTIFICATE_NOT_FOUND");
    }
    if (!cert) throw new NoDuesError("CERTIFICATE_NOT_FOUND");

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
/*  Revoke — atomic via RPC                                              */
/* -------------------------------------------------------------------- */

export const revokeNoDuesCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { certificateId: string; reason: string }) =>
    z
      .object({ certificateId: uuid, reason: z.string().trim().min(3).max(500) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    const { error } = await supabase.rpc("revoke_no_dues_certificate", {
      _certificate_id: data.certificateId,
      _reason: data.reason,
    });
    if (error) {
      logServerError("revoke", error);
      throw new NoDuesError(mapPgError(error.message));
    }
    return { ok: true };
  });
