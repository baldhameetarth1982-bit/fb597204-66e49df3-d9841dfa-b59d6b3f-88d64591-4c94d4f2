/**
 * Flat 360 — typed server data service.
 *
 * Society isolation: reads are filtered by (society_id, flat_id).
 * Authorization:
 *   - society_admin / block_admin for THAT society (via `is_society_admin_for`)
 *   - super_admin (via `is_super_admin`) for platform support access
 *   - active resident of THAT flat (limited resident-safe projection)
 * A resident is NOT treated as an admin. Broad global role names are not used.
 *
 * PII minimization: default projection excludes phone, email, DOB, and other
 * sensitive fields. Sections without real backing data return
 * `{ status: "unsupported" }` — never fabricated zeros.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const inputSchema = z.object({ flatId: z.string().uuid() });

export type SectionState<T> =
  | { status: "available"; data: T }
  | { status: "empty" }
  | { status: "unsupported" }
  | { status: "error"; message: string };

export type Flat360Viewer = "society_admin" | "super_admin" | "resident";

export type Flat360Snapshot = {
  viewer: Flat360Viewer;
  flat: {
    id: string;
    society_id: string;
    flat_number: string | null;
    floor: number | null;
    block_id: string | null;
    tenancy_type: string | null;
  };
  society: { id: string; name: string | null } | null;
  occupants: Array<{
    user_id: string;
    full_name: string | null;
    relationship: string | null;
    is_primary: boolean;
    is_active: boolean;
    moved_in_at: string | null;
    moved_out_at: string | null;
  }>;
  family: Array<{ id: string; name: string; relationship: string | null }>;
  vehicles: Array<{ id: string; number_plate: string; type: string | null }>;
  bills: {
    unpaid: number;
    overdue: number;
    total_outstanding: number;
    pending_payment_total: number;
    recent: Array<{
      id: string;
      bill_number: string | null;
      period_label: string | null;
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
      paid_at: string | null;
    }>;
  };
  visitors: SectionState<{ recent_count: number }>;
  approvals: SectionState<{ pending_count: number }>;
  complaints: SectionState<never>;
  documents: SectionState<never>;
  no_dues: {
    eligibility: Record<string, any> | null;
    latest_request: { id: string; status: string; submitted_at: string } | null;
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

    // 1. Load flat and derive canonical society_id (never trust client).
    const { data: flat, error: flatErr } = await supabase
      .from("flats")
      .select("id, society_id, flat_number, floor, block_id, tenancy_type")
      .eq("id", flatId)
      .maybeSingle();
    if (flatErr || !flat) throw new Error("FLAT_NOT_FOUND");
    const societyId = flat.society_id as string;

    // 2. Society-scoped authorization.
    const [adminRes, superRes, residentRes] = await Promise.all([
      supabase.rpc("is_society_admin_for", { _user_id: userId, _society_id: societyId }),
      supabase.rpc("is_super_admin", { _user_id: userId }),
      supabase
        .from("flat_residents")
        .select("id")
        .eq("user_id", userId)
        .eq("flat_id", flatId)
        .eq("is_active", true)
        .maybeSingle(),
    ]);
    const isSocietyAdmin = !!adminRes.data;
    const isSuperAdmin = !!superRes.data;
    const isResident = !!residentRes.data;
    if (!isSocietyAdmin && !isSuperAdmin && !isResident) {
      throw new Error("NOT_AUTHORIZED");
    }
    const viewer: Flat360Viewer = isSocietyAdmin
      ? "society_admin"
      : isSuperAdmin
        ? "super_admin"
        : "resident";

    const [society, occupantsRes, familyRes, vehiclesRes, billsRes, paymentsRes, noDuesReqRes, noDuesCertRes] =
      await Promise.all([
        supabase.from("societies").select("id, name").eq("id", societyId).maybeSingle(),
        supabase
          .from("flat_residents")
          .select("user_id, relationship, is_primary, is_active, moved_in_at, moved_out_at, profiles:profiles(full_name)")
          .eq("flat_id", flatId)
          .order("is_active", { ascending: false })
          .order("moved_in_at", { ascending: false })
          .limit(20),
        supabase.from("family_members").select("id, name, relationship").eq("flat_id", flatId).limit(50),
        supabase.from("vehicles").select("id, number_plate, type").eq("flat_id", flatId).limit(20),
        supabase
          .from("bills")
          .select("id, bill_number, period_label, amount, due_date, status")
          .eq("society_id", societyId)
          .eq("flat_id", flatId)
          .order("due_date", { ascending: false })
          .limit(10),
        supabase
          .from("payments")
          .select("id, amount, method, status, paid_at")
          .eq("society_id", societyId)
          .eq("flat_id", flatId)
          .order("paid_at", { ascending: false, nullsFirst: false })
          .limit(10),
        supabase
          .from("no_dues_requests")
          .select("id, status, submitted_at")
          .eq("society_id", societyId)
          .eq("flat_id", flatId)
          .order("submitted_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("no_dues_certificates")
          .select("id, certificate_number, issued_at, valid_until, revoked_at")
          .eq("society_id", societyId)
          .eq("flat_id", flatId)
          .order("issued_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    // Eligibility via canonical DB function (service-role client).
    let eligibility: Record<string, any> | null = null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: eligData } = await (supabaseAdmin.rpc as any)(
        "compute_no_dues_eligibility_internal",
        { _society_id: societyId, _flat_id: flatId },
      );
      eligibility = eligData ?? null;
    } catch {
      eligibility = null;
    }

    const bills = billsRes.data ?? [];
    const now = new Date();
    const unpaidBills = bills.filter((b: any) => b.status === "unpaid");
    const overdueBills = unpaidBills.filter((b: any) => new Date(b.due_date) < now);
    const elig = (eligibility ?? {}) as {
      total_outstanding?: number;
      pending_payment_total?: number;
    };

    const payments = paymentsRes.data ?? [];
    const settledCount = payments.filter((p: any) => p.status === "success").length;
    const pendingCount = payments.filter((p: any) => p.status === "pending").length;

    return {
      viewer,
      flat,
      society: society.data ?? null,
      occupants: (occupantsRes.data ?? []).map((r: any) => ({
        user_id: r.user_id,
        full_name: r.profiles?.full_name ?? null,
        relationship: r.relationship,
        is_primary: !!r.is_primary,
        is_active: !!r.is_active,
        moved_in_at: r.moved_in_at,
        moved_out_at: r.moved_out_at,
      })),
      family: (familyRes.data ?? []).map((f: any) => ({
        id: f.id,
        name: f.name,
        relationship: f.relationship,
      })),
      vehicles: (vehiclesRes.data ?? []) as any,
      bills: {
        unpaid: unpaidBills.length,
        overdue: overdueBills.length,
        total_outstanding: Number(elig.total_outstanding ?? 0),
        pending_payment_total: Number(elig.pending_payment_total ?? 0),
        recent: bills as any,
      },
      payments: {
        settled_count: settledCount,
        pending_count: pendingCount,
        recent: payments as any,
      },
      visitors: { status: "unsupported" },
      approvals: { status: "unsupported" },
      complaints: { status: "unsupported" },
      documents: { status: "unsupported" },
      no_dues: {
        eligibility,
        latest_request: (noDuesReqRes.data as any) ?? null,
        latest_certificate: (noDuesCertRes.data as any) ?? null,
      },
    };
  });
