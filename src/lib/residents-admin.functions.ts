/**
 * Stage 2B — Resident, Occupancy, Family, Vehicle admin services.
 *
 * All operations are performed server-side under `requireSupabaseAuth`.
 * Authorization is enforced inside SECURITY DEFINER RPCs on the DB; this
 * module is a thin, strictly-typed adapter with generic user-safe errors.
 *
 * Design rules:
 *   - No browser Supabase client for private resident data.
 *   - No `supabase.rpc as any` casts. Types come from the generated Database types.
 *   - Strict Zod on inputs; safe projections on outputs.
 *   - Raw error messages are mapped to short, generic codes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";

const KNOWN_CODES = new Set([
  "forbidden",
  "resident_not_in_society",
  "unit_not_in_society",
  "unit_inactive",
  "duplicate_active_assignment",
  "duplicate_active_plate",
  "invalid_relationship",
  "invalid_relation",
  "invalid_plate",
  "moved_out_before_moved_in",
  "relationship_not_found",
  "family_member_not_found",
  "vehicle_not_found",
]);

function safeError(e: unknown): Error {
  const msg = (e as { message?: string } | null)?.message ?? "";
  for (const code of KNOWN_CODES) if (msg.includes(code)) return new Error(code);
  return new Error("operation_failed");
}

const uuid = z.string().uuid();

const listInput = z.object({
  societyId: uuid,
  search: z.string().trim().max(80).optional().nullable(),
  flatId: uuid.optional().nullable(),
  relationship: z.enum(["owner", "co-owner", "tenant", "resident", "family"]).optional().nullable(),
  activeOnly: z.boolean().optional().default(true),
  limit: z.number().int().min(1).max(100).optional().default(25),
  offset: z.number().int().min(0).max(100_000).optional().default(0),
});
const overviewInput = z.object({ societyId: uuid });
const detailInput = z.object({ societyId: uuid, userId: uuid });
const assignInput = z.object({
  societyId: uuid,
  userId: uuid,
  flatId: uuid,
  relationship: z.enum(["owner", "co-owner", "tenant", "resident", "family"]),
  isPrimary: z.boolean().optional().default(false),
  movedInAt: z.string().datetime().optional(),
});
const endInput = z.object({
  societyId: uuid,
  flatResidentId: uuid,
  movedOutAt: z.string().datetime().optional(),
  reason: z.string().trim().max(200).optional().nullable(),
});
const nameSchema = z.string().trim().min(1).max(80).regex(/^[^<>]+$/, "invalid_name");
const phoneSchema = z
  .string()
  .trim()
  .max(20)
  .regex(/^[+\d\s\-()]*$/, "invalid_phone")
  .optional()
  .nullable();
const familyUpsertInput = z.object({
  societyId: uuid,
  residentUserId: uuid,
  id: uuid.optional().nullable(),
  fullName: nameSchema,
  relation: z.enum(["spouse", "child", "parent", "sibling", "helper", "other"]),
  phone: phoneSchema,
  age: z.number().int().min(0).max(120).optional().nullable(),
});
const familyDeleteInput = z.object({ societyId: uuid, id: uuid });
const vehicleUpsertInput = z.object({
  societyId: uuid,
  id: uuid.optional().nullable(),
  residentUserId: uuid,
  flatId: uuid.optional().nullable(),
  plateNumber: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9\s-]+$/, "invalid_plate"),
  type: z.enum(["car", "bike", "cycle", "ev", "other"]).optional().default("car"),
  makeModel: z.string().trim().max(60).optional().nullable(),
  color: z.string().trim().max(30).optional().nullable(),
});
const vehicleDeleteInput = z.object({ societyId: uuid, id: uuid });

export const residentRowSchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().nullable(),
  avatar_url: z.string().nullable(),
  flat_id: z.string().uuid().nullable(),
  flat_number: z.string().nullable(),
  block_name: z.string().nullable(),
  structure_mode: z.string().nullable(),
  relationship: z.string().nullable(),
  is_active: z.boolean(),
  is_primary: z.boolean(),
  moved_in_at: z.string().nullable(),
});
export type ResidentRow = z.infer<typeof residentRowSchema>;

// -- helpers -------------------------------------------------
function undef<T>(v: T | null | undefined): T | undefined {
  return v == null ? undefined : v;
}

// -- server functions ---------------------------------------
export const listResidentsPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof listInput>) => listInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("list_society_residents_page", {
      _society_id: data.societyId,
      _search: undef(data.search),
      _flat_id: undef(data.flatId),
      _relationship: undef(data.relationship),
      _active_only: data.activeOnly ?? true,
      _limit: data.limit ?? 25,
      _offset: data.offset ?? 0,
    });
    if (error) throw safeError(error);
    const list = rows ?? [];
    const total = list[0]?.total_count ? Number(list[0].total_count) : 0;
    const items: ResidentRow[] = list.map((r) => ({
      user_id: r.user_id,
      full_name: r.full_name,
      avatar_url: r.avatar_url,
      flat_id: r.flat_id,
      flat_number: r.flat_number,
      block_name: r.block_name,
      structure_mode: r.structure_mode,
      relationship: r.relationship,
      is_active: r.is_active,
      is_primary: r.is_primary,
      moved_in_at: r.moved_in_at,
    }));
    return {
      items,
      total,
      limit: data.limit ?? 25,
      offset: data.offset ?? 0,
      has_next: (data.offset ?? 0) + items.length < total,
    };
  });

export const getResidentDirectoryOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof overviewInput>) => overviewInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("get_resident_directory_overview", {
      _society_id: data.societyId,
    });
    if (error) throw safeError(error);
    const row = rows?.[0];
    return {
      total_residents: Number(row?.total_residents ?? 0),
      active_residents: Number(row?.active_residents ?? 0),
      owners: Number(row?.owners ?? 0),
      tenants: Number(row?.tenants ?? 0),
      occupied_units: Number(row?.occupied_units ?? 0),
      vacant_units: Number(row?.vacant_units ?? 0),
      active_vehicles: Number(row?.active_vehicles ?? 0),
    };
  });

export const getResidentPrivateDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof detailInput>) => detailInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: json, error } = await context.supabase.rpc("get_resident_private_detail", {
      _society_id: data.societyId,
      _user_id: data.userId,
    });
    if (error) throw safeError(error);
    return (json as Json) ?? null;
  });

export const assignResidentToUnit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof assignInput>) => assignInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("assign_resident_to_unit", {
      _society_id: data.societyId,
      _user_id: data.userId,
      _flat_id: data.flatId,
      _relationship: data.relationship,
      _is_primary: data.isPrimary ?? false,
      _moved_in_at: data.movedInAt ?? new Date().toISOString(),
    });
    if (error) throw safeError(error);
    return { id: id as string };
  });

export const endResidentUnitRelationship = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof endInput>) => endInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("end_resident_unit_relationship", {
      _society_id: data.societyId,
      _flat_resident_id: data.flatResidentId,
      _moved_out_at: data.movedOutAt ?? new Date().toISOString(),
      _reason: undef(data.reason),
    });
    if (error) throw safeError(error);
    return { ok: true };
  });

export const upsertFamilyMemberAsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof familyUpsertInput>) => familyUpsertInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("admin_upsert_family_member", {
      _society_id: data.societyId,
      _resident_user_id: data.residentUserId,
      _id: undef(data.id) as string,
      _full_name: data.fullName,
      _relation: data.relation,
      _phone: undef(data.phone) as string,
      _age: undef(data.age) as number,
    });
    if (error) throw safeError(error);
    return { id: id as string };
  });

export const deleteFamilyMemberAsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof familyDeleteInput>) => familyDeleteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("admin_delete_family_member", {
      _society_id: data.societyId,
      _id: data.id,
    });
    if (error) throw safeError(error);
    return { ok: true };
  });

export const upsertVehicleAsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof vehicleUpsertInput>) => vehicleUpsertInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("admin_upsert_vehicle", {
      _society_id: data.societyId,
      _id: undef(data.id) as string,
      _resident_user_id: data.residentUserId,
      _flat_id: undef(data.flatId) as string,
      _plate_number: data.plateNumber,
      _type: data.type ?? "car",
      _make_model: undef(data.makeModel) as string,
      _color: undef(data.color) as string,
    });
    if (error) throw safeError(error);
    return { id: id as string };
  });

export const deleteVehicleAsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof vehicleDeleteInput>) => vehicleDeleteInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("admin_delete_vehicle", {
      _society_id: data.societyId,
      _id: data.id,
    });
    if (error) throw safeError(error);
    return { ok: true };
  });

const listVehiclesInput = z.object({
  societyId: uuid,
  search: z.string().trim().max(40).optional().nullable(),
  limit: z.number().int().min(1).max(200).optional().default(50),
  offset: z.number().int().min(0).optional().default(0),
});

export const listSocietyVehicles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof listVehiclesInput>) => listVehiclesInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: allowed } = await context.supabase.rpc("current_user_is_society_admin_for", {
      _society_id: data.societyId,
    });
    if (!allowed) throw new Error("forbidden");
    let q = context.supabase
      .from("vehicles")
      .select(
        "id, plate_number, type, make_model, color, flat_id, user_id, created_at, flats(flat_number, blocks(name))",
      )
      .eq("society_id", data.societyId)
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (data.search) q = q.ilike("plate_number", `%${data.search.toUpperCase()}%`);
    const { data: rows, error } = await q;
    if (error) throw safeError(error);
    return (rows ?? []).map((v) => ({
      id: v.id,
      plate_number: v.plate_number,
      type: v.type,
      make_model: v.make_model,
      color: v.color,
      flat_id: v.flat_id,
      user_id: v.user_id,
      flat_number: (v as { flats?: { flat_number?: string | null } | null }).flats?.flat_number ?? null,
      block_name:
        (v as { flats?: { blocks?: { name?: string | null } | null } | null }).flats?.blocks?.name ?? null,
      created_at: v.created_at,
    }));
  });
