/**
 * No-Dues server functions.
 *
 * Security invariants:
 * - All state transitions are enforced server-side.
 * - Client cannot set approved/issued/revoked directly.
 * - Society/flat membership re-verified on every mutation.
 * - Raw verification token only lives in the URL/QR; DB stores SHA-256 hash.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const uuid = z.string().uuid();

/* -------------------------------------------------------------------- */
/*  Eligibility                                                          */
/* -------------------------------------------------------------------- */

async function computeEligibility(
  supabase: any,
  societyId: string,
  flatId: string,
) {
  const { data: bills, error } = await supabase
    .from("bills")
    .select("id,bill_number,amount,due_date,status,period_label")
    .eq("society_id", societyId)
    .eq("flat_id", flatId)
    .in("status", ["unpaid", "overdue", "partial"]);
  if (error) throw new Error(error.message);

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
  if (pErr) throw new Error(pErr.message);

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

export const checkNoDuesEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { societyId: string; flatId: string }) =>
    z.object({ societyId: uuid, flatId: uuid }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
    // Membership check via RLS: try to read the flat
    const { data: flat, error } = await supabase
      .from("flats")
      .select("id,society_id,flat_number")
      .eq("id", data.flatId)
      .eq("society_id", data.societyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!flat) throw new Error("Flat not found or access denied");
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
    // Confirm caller is a resident of this flat
    const { data: link, error: lErr } = await supabase
      .from("flat_residents")
      .select("id")
      .eq("flat_id", data.flatId)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (lErr) throw new Error(lErr.message);
    if (!link) throw new Error("You are not linked to this flat");

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
    if (error) throw new Error(error.message);

    await supabase.from("no_dues_audit").insert({
      request_id: row.id,
      society_id: data.societyId,
      actor_id: userId,
      action: "submitted",
      new_status: status,
      metadata: { eligible: snapshot.eligible },
    });

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
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const listSocietyNoDuesRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { societyId: string; status?: string }) =>
    z.object({ societyId: uuid, status: z.string().optional() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as any;
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
    if (error) throw new Error(error.message);
    return rows ?? [];
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

async function assertSocietyAdmin(supabase: any, societyId: string, userId: string) {
  const { data, error } = await supabase.rpc("is_society_admin_for", {
    _user_id: userId,
    _society_id: societyId,
  });
  if (error) throw new Error(error.message);
  if (!data) {
    const { data: sa } = await supabase.rpc("is_super_admin", { _user_id: userId });
    if (!sa) throw new Error("Not authorized");
  }
}

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
          reason: z.string().trim().max(500).optional(),
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
    if (error) throw new Error(error.message);
    if (!req) throw new Error("Request not found");

    await assertSocietyAdmin(supabase, req.society_id, userId);

    const nextStatus = data.decision === "approve" ? "approved" : "rejected";
    const allowed = ALLOWED_TRANSITIONS[req.status] ?? [];
    if (!allowed.includes(nextStatus)) {
      throw new Error(`Cannot transition ${req.status} → ${nextStatus}`);
    }

    // Re-verify eligibility on approve
    if (data.decision === "approve") {
      const snap = await computeEligibility(supabase, req.society_id, req.flat_id);
      if (!snap.eligible) {
        // Import admin only inside handler
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
        await supabaseAdmin.from("no_dues_audit").insert({
          request_id: data.requestId,
          society_id: req.society_id,
          actor_id: userId,
          action: "blocked_by_dues",
          previous_status: req.status,
          new_status: "blocked_by_dues",
          metadata: { total_outstanding: snap.total_outstanding },
        });
        return { status: "blocked_by_dues", eligibility: snap };
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
    if (uErr) throw new Error(uErr.message);

    await supabaseAdmin.from("no_dues_audit").insert({
      request_id: data.requestId,
      society_id: req.society_id,
      actor_id: userId,
      action: data.decision === "approve" ? "approved" : "rejected",
      previous_status: req.status,
      new_status: nextStatus,
      metadata: { reason: data.reason, notes: data.notes },
    });

    return { status: nextStatus };
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
    if (error) throw new Error(error.message);
    if (!req) throw new Error("Request not found");
    await assertSocietyAdmin(supabase, req.society_id, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Idempotent: return existing certificate if already issued
    const { data: existing } = await supabaseAdmin
      .from("no_dues_certificates")
      .select("id,certificate_number,storage_path")
      .eq("request_id", data.requestId)
      .is("revoked_at", null)
      .maybeSingle();
    if (existing) {
      return {
        certificateId: existing.id,
        certificateNumber: existing.certificate_number,
        storagePath: existing.storage_path,
      };
    }

    if (!ALLOWED_TRANSITIONS[req.status].includes("issued")) {
      throw new Error(`Cannot issue from status ${req.status}`);
    }

    // Re-verify eligibility at issue time
    const snap = await computeEligibility(supabase, req.society_id, req.flat_id);
    if (!snap.eligible) throw new Error("Unit no longer eligible for no-dues");

    // Load society + flat + resident
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

    // Reserve immutable cert number
    const { count } = await supabaseAdmin
      .from("no_dues_certificates")
      .select("id", { count: "exact", head: true })
      .eq("society_id", req.society_id);
    const certNumber = `ND-${new Date().getFullYear()}-${String((count ?? 0) + 1).padStart(5, "0")}`;

    // Token
    const { generateRawToken, hashToken, renderCertificatePdf } = await import(
      "@/lib/no-dues.server"
    );
    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);

    const origin = process.env.PUBLIC_APP_URL ?? "https://sociohub.live";
    const verificationUrl = `${origin}/verify/no-dues/${rawToken}`;

    const issuedAt = new Date();
    const validUntil = data.validForDays
      ? new Date(Date.now() + data.validForDays * 86400_000)
      : null;

    const pdfBytes = await renderCertificatePdf({
      societyName: society?.name ?? "Society",
      societyAddress: [society?.address, society?.city, society?.state]
        .filter(Boolean)
        .join(", ") || null,
      unitLabel: flat?.flat_number ?? "—",
      residentName: resident?.full_name ?? "Resident",
      certificateNumber: certNumber,
      issuedAt,
      validUntil,
      verificationUrl,
    });

    const storagePath = `${req.society_id}/${certNumber}.pdf`;
    const { error: upErr } = await supabaseAdmin.storage
      .from("no-dues-certificates")
      .upload(storagePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: false,
      });
    if (upErr) throw new Error(`Storage upload failed: ${upErr.message}`);

    // Insert cert row; if this fails, clean up storage
    const { data: cert, error: cErr } = await supabaseAdmin
      .from("no_dues_certificates")
      .insert({
        request_id: req.id,
        society_id: req.society_id,
        flat_id: req.flat_id,
        certificate_number: certNumber,
        verification_token_hash: tokenHash,
        issued_by: userId,
        issued_at: issuedAt.toISOString(),
        valid_until: validUntil ? validUntil.toISOString().slice(0, 10) : null,
        storage_path: storagePath,
      })
      .select("id,certificate_number")
      .single();
    if (cErr) {
      await supabaseAdmin.storage.from("no-dues-certificates").remove([storagePath]);
      throw new Error(`Certificate insert failed: ${cErr.message}`);
    }

    await supabaseAdmin
      .from("no_dues_requests")
      .update({ status: "issued" })
      .eq("id", req.id);

    await supabaseAdmin.from("no_dues_audit").insert({
      request_id: req.id,
      certificate_id: cert.id,
      society_id: req.society_id,
      actor_id: userId,
      action: "issued",
      previous_status: req.status,
      new_status: "issued",
      metadata: { certificate_number: certNumber },
    });

    return {
      certificateId: cert.id,
      certificateNumber: cert.certificate_number,
      storagePath,
      verificationUrl,
    };
  });

/* -------------------------------------------------------------------- */
/*  Signed URL for owner/admin                                           */
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
    if (error) throw new Error(error.message);
    if (!cert) throw new Error("Not found");

    // Authorization: society admin OR requester
    const { data: req } = await supabase
      .from("no_dues_requests")
      .select("requester_id")
      .eq("id", cert.request_id)
      .maybeSingle();
    const isRequester = req?.requester_id === userId;
    let ok = isRequester;
    if (!ok) {
      const { data: adm } = await supabase.rpc("is_society_admin_for", {
        _user_id: userId,
        _society_id: cert.society_id,
      });
      ok = !!adm;
    }
    if (!ok) throw new Error("Not authorized");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("no-dues-certificates")
      .createSignedUrl(cert.storage_path, 300);
    if (sErr) throw new Error(sErr.message);
    return { url: signed.signedUrl };
  });

/* -------------------------------------------------------------------- */
/*  Revoke                                                               */
/* -------------------------------------------------------------------- */

export const revokeNoDuesCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { certificateId: string; reason: string }) =>
    z
      .object({ certificateId: uuid, reason: z.string().trim().min(3).max(500) })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    const { data: cert, error } = await supabase
      .from("no_dues_certificates")
      .select("id,society_id,request_id,revoked_at")
      .eq("id", data.certificateId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!cert) throw new Error("Not found");
    if (cert.revoked_at) return { alreadyRevoked: true };
    await assertSocietyAdmin(supabase, cert.society_id, userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("no_dues_certificates")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: userId,
        revoke_reason: data.reason,
      })
      .eq("id", data.certificateId);
    await supabaseAdmin
      .from("no_dues_requests")
      .update({ status: "revoked" })
      .eq("id", cert.request_id);
    await supabaseAdmin.from("no_dues_audit").insert({
      request_id: cert.request_id,
      certificate_id: cert.id,
      society_id: cert.society_id,
      actor_id: userId,
      action: "revoked",
      previous_status: "issued",
      new_status: "revoked",
      metadata: { reason: data.reason },
    });
    return { ok: true };
  });
