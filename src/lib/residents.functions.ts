import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const societyIdInput = z.object({ societyId: z.string().uuid() });

export const listSocietyResidents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { societyId: string }) => societyIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const [profilesRes, assignmentsRes, flatsRes, customValsRes] = await Promise.all([
      supabase
        .from("profiles")
        .select(
          "id, full_name, email, phone, avatar_url, property_number, ugvcl_number, share_certificate_number, move_in_date, aadhaar_verified, is_offline",
        )
        .eq("society_id", data.societyId)
        .order("full_name", { ascending: true }),
      supabase
        .from("flat_residents")
        .select("id, user_id, flat_id, relationship, is_primary, is_active, moved_in_at, moved_out_at, flats!inner(society_id, flat_number, block_id, blocks(name))")
        .eq("flats.society_id", data.societyId),
      supabase
        .from("flats")
        .select("id, flat_number, block_id, blocks(name)")
        .eq("society_id", data.societyId),
      supabase
        .from("custom_field_values")
        .select("user_id, field_id, value")
        .eq("society_id", data.societyId),
    ]);

    if (profilesRes.error) throw new Error(profilesRes.error.message);
    if (assignmentsRes.error) throw new Error(assignmentsRes.error.message);
    if (flatsRes.error) throw new Error(flatsRes.error.message);

    const residents = (profilesRes.data ?? []).map((p) => {
      const active = (assignmentsRes.data ?? []).filter(
        (a: any) => a.user_id === p.id && a.is_active !== false,
      );
      const primary = active.find((a: any) => a.is_primary) ?? active[0];
      const cf: Record<string, any> = {};
      for (const v of customValsRes.data ?? []) if (v.user_id === p.id) cf[v.field_id] = v.value;
      return {
        ...p,
        flat_resident_id: primary?.id ?? null,
        flat_id: primary?.flat_id ?? null,
        flat_number: (primary as any)?.flats?.flat_number ?? null,
        block_name: (primary as any)?.flats?.blocks?.name ?? null,
        relationship: (primary?.relationship as string | undefined) ?? null,
        moved_in_at: (primary as any)?.moved_in_at ?? null,
        assignments_count: active.length,
        custom_fields: cf,
      };
    });

    // occupied flat_ids (active only)
    const occupied = new Set(
      (assignmentsRes.data ?? [])
        .filter((a: any) => a.is_active !== false)
        .map((a: any) => a.flat_id),
    );
    const flats = (flatsRes.data ?? []).map((f: any) => ({
      id: f.id,
      flat_number: f.flat_number,
      block_name: f.blocks?.name ?? null,
      occupied: occupied.has(f.id),
    }));

    return { residents, flats };
  });

const updateInput = z.object({
  userId: z.string().uuid(),
  patch: z.object({
    full_name: z.string().max(120).optional(),
    phone: z.string().max(20).optional().nullable(),
    email: z.string().email().max(255).optional().nullable(),
    property_number: z.string().max(60).optional().nullable(),
    ugvcl_number: z.string().max(60).optional().nullable(),
    share_certificate_number: z.string().max(60).optional().nullable(),
    move_in_date: z.string().optional().nullable(),
  }),
});

export const updateResidentProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; patch: Record<string, unknown> }) =>
    updateInput.parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ ...data.patch, updated_at: new Date().toISOString() })
      .eq("id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const deactivateInput = z.object({
  flatResidentId: z.string().uuid(),
  reason: z.string().max(200).optional(),
});

export const deactivateResident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { flatResidentId: string; reason?: string }) => deactivateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("deactivate_flat_resident", {
      _flat_resident_id: data.flatResidentId,
      _reason: data.reason ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });


const outstandingInput = z.object({ flatId: z.string().uuid() });
export const flatOutstanding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { flatId: string }) => outstandingInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .rpc("flat_outstanding", { _flat_id: data.flatId })
      .single();
    if (error) throw new Error(error.message);
    return row as { pending: number; overdue_count: number; next_due: string | null };
  });

export const societyMaintenanceSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { societyId: string }) => societyIdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .rpc("society_maintenance_summary", { _society_id: data.societyId })
      .single();
    if (error) throw new Error(error.message);
    return row as {
      total_houses: number;
      paid_periods: number;
      pending_periods: number;
      advance_periods: number;
      overdue_periods: number;
      outstanding_amount: number;
      advance_amount: number;
      collection_percent: number;
    };
  });

const historyInput = z.object({ flatId: z.string().uuid() });
export const flatOccupancyHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { flatId: string }) => historyInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("flat_residents")
      .select("id, user_id, relationship, is_primary, is_active, moved_in_at, moved_out_at, ended_reason, created_at, profiles:profiles!flat_residents_user_id_fkey(full_name, phone)")
      .eq("flat_id", data.flatId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
