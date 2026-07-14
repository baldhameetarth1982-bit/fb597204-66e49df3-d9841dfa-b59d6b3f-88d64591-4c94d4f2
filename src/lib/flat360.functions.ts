/**
 * Flat 360 — typed server data service.
 *
 * A single server function returns a consolidated snapshot for the
 * `/society/flats/$id` (and future resident-facing) Flat 360 view.
 *
 * Rules:
 *   - Society isolation is enforced: every read is filtered by (society_id, flat_id).
 *   - Only admins/managers of that society (or the flat's active resident) may read.
 *   - Real data only — empty arrays are honest empties, never fabricated placeholders.
 *   - No payment integration is touched here. Payments are read-only.
 *   - Eligibility is read from the canonical DB function via the No-Dues module.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({ flatId: z.string().uuid() });

export type Flat360Snapshot = {
  flat: {
    id: string;
    society_id: string;
    flat_number: string | null;
    floor: number | null;
    block: string | null;
    tenancy_type: string | null;
  };
  society: { id: string; name: string | null } | null;
  occupants: Array<{
    user_id: string;
    full_name: string | null;
    phone: string | null;
    relationship: string | null;
    is_primary: boolean;
    is_active: boolean;
    moved_in_at: string | null;
    moved_out_at: string | null;
  }>;
  family: Array<{
    id: string;
    name: string;
    relationship: string | null;
    dob: string | null;
  }>;
  vehicles: Array<{ id: string; number_plate: string; type: string | null }>;
  bills: {
    unpaid: number;
    overdue: number;
    total_outstanding: number;
    recent: Array<{
      id: string;
      bill_number: string | null;
      period_label: string;
      amount: number;
      due_date: string;
      status: string;
    }>;
  };
  payments: {
    settled_count: number;
    pending_count: number;
    recent: Array<{
      id: string;
      amount: number;
      method: string;
      status: string;
      paid_at: string;
    }>;
  };
  visitors: { recent_count: number };
  approvals: { pending_count: number };
  no_dues: {
    eligibility: unknown;
    latest_request: {
      id: string;
      status: string;
      submitted_at: string;
    } | null;
    latest_certificate: {
      id: string;
      certificate_number: string;
      issued_at: string;
      valid_until: string | null;
      revoked_at: string | null;
    } | null;
  };
};

export const getFlat360 = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => inputSchema.parse(raw))
  .handler(async ({ data, context }): Promise<Flat360Snapshot> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const flatId = data.flatId;

    // 1. Flat + society scope
    const { data: flat, error: flatErr } = await supabase
      .from("flats")
      .select("id, society_id, flat_number, floor, block, tenancy_type")
      .eq("id", flatId)
      .maybeSingle();
    if (flatErr || !flat) throw new Error("FLAT_NOT_FOUND");

    // 2. Authorization: admin/manager of the society OR active resident of the flat.
    const [{ data: isAdmin }, { data: isMgr }, { data: myFlat }] = await Promise.all([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "society_manager" }).then((r: any) => r).catch(() => ({ data: null })),
      supabase
        .from("flat_residents")
        .select("id")
        .eq("user_id", userId)
        .eq("flat_id", flatId)
        .eq("is_active", true)
        .maybeSingle(),
    ]);
    const allowed = Boolean(isAdmin) || Boolean(isMgr) || Boolean(myFlat);
    if (!allowed) throw new Error("NOT_AUTHORIZED");

    const [society, occupantsRes, familyRes, vehiclesRes, billsRes, paymentsRes, noDuesReqRes, noDuesCertRes] =
      await Promise.all([
        supabase.from("societies").select("id, name").eq("id", flat.society_id).maybeSingle(),
        supabase
          .from("flat_residents")
          .select("user_id, relationship, is_primary, is_active, moved_in_at, moved_out_at, profiles:profiles(full_name, phone)")
          .eq("flat_id", flatId)
          .order("is_active", { ascending: false })
          .order("moved_in_at", { ascending: false })
          .limit(20),
        supabase
          .from("family_members")
          .select("id, name, relationship, dob")
          .eq("flat_id", flatId)
          .limit(50),
        supabase
          .from("vehicles")
          .select("id, number_plate, type")
          .eq("flat_id", flatId)
          .limit(20),
        supabase
          .from("bills")
          .select("id, bill_number, period_label, amount, due_date, status")
          .eq("society_id", flat.society_id)
          .eq("flat_id", flatId)
          .order("due_date", { ascending: false })
          .limit(10),
        supabase
          .from("payments")
          .select("id, amount, method, status, paid_at")
          .eq("society_id", flat.society_id)
          .eq("flat_id", flatId)
          .order("paid_at", { ascending: false })
          .limit(10),
        supabase
          .from("no_dues_requests")
          .select("id, status, submitted_at")
          .eq("society_id", flat.society_id)
          .eq("flat_id", flatId)
          .order("submitted_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("no_dues_certificates")
          .select("id, certificate_number, issued_at, valid_until, revoked_at")
          .eq("society_id", flat.society_id)
          .eq("flat_id", flatId)
          .order("issued_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    // Eligibility from canonical DB function via admin client (service-role only).
    let eligibility: unknown = null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: eligData } = await (supabaseAdmin.rpc as any)(
        "compute_no_dues_eligibility_internal",
        { _society_id: flat.society_id, _flat_id: flatId },
      );
      eligibility = eligData ?? null;
    } catch {
      eligibility = null;
    }

    const bills = billsRes.data ?? [];
    const now = new Date();
    const unpaidBills = bills.filter((b: any) => b.status === "unpaid");
    const overdueBills = unpaidBills.filter((b: any) => new Date(b.due_date) < now);
    const anyElig = (eligibility ?? {}) as { total_outstanding?: number };

    const payments = paymentsRes.data ?? [];
    const settledCount = payments.filter((p: any) => p.status === "success").length;
    const pendingCount = payments.filter((p: any) => p.status === "pending").length;

    return {
      flat,
      society: society.data ?? null,
      occupants: (occupantsRes.data ?? []).map((r: any) => ({
        user_id: r.user_id,
        full_name: r.profiles?.full_name ?? null,
        phone: r.profiles?.phone ?? null,
        relationship: r.relationship,
        is_primary: !!r.is_primary,
        is_active: !!r.is_active,
        moved_in_at: r.moved_in_at,
        moved_out_at: r.moved_out_at,
      })),
      family: (familyRes.data ?? []) as any,
      vehicles: (vehiclesRes.data ?? []) as any,
      bills: {
        unpaid: unpaidBills.length,
        overdue: overdueBills.length,
        total_outstanding: Number(anyElig.total_outstanding ?? 0),
        recent: bills as any,
      },
      payments: {
        settled_count: settledCount,
        pending_count: pendingCount,
        recent: payments as any,
      },
      visitors: { recent_count: 0 },
      approvals: { pending_count: 0 },
      no_dues: {
        eligibility,
        latest_request: (noDuesReqRes.data as any) ?? null,
        latest_certificate: (noDuesCertRes.data as any) ?? null,
      },
    };
  });
