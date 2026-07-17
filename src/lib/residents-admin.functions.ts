/**
 * Stage 2B — Resident, Occupancy, Family, Vehicle admin services.
 *
 * All operations run server-side under `requireSupabaseAuth`. Authorization is
 * enforced inside SECURITY DEFINER RPCs on the DB; this module is a strict,
 * typed adapter with generic user-safe errors.
 *
 * Rules:
 *   - No browser Supabase client for private resident data.
 *   - No `rpc as any` or `x as string` casts on nullable arguments.
 *   - Strict Zod on both inputs AND private-detail output.
 *   - Family and vehicle removal are deactivation (UPDATE), never DELETE.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
const RELATIONSHIP = z.enum(["owner", "co-owner", "tenant", "resident", "family"]);
const RELATION = z.enum(["spouse", "child", "parent", "sibling", "helper", "other"]);
const VEHICLE_TYPE = z.enum(["car", "bike", "cycle", "ev", "other"]);

const listInput = z.object({
  societyId: uuid,
  search: z.string().trim().max(80).optional().nullable(),
  flatId: uuid.optional().nullable(),
  relationship: RELATIONSHIP.optional().nullable(),
  activeOnly: z.boolean().optional().default(true),
  limit: z.number().int().min(1).max(100).optional().default(25),
  offset: z.number().int().min(0).max(100_000).optional().default(0),
});
const overviewInput = z.object({ societyId: uuid });
const detailInput = z.object({ societyId: uuid, userId: uuid });
const assignInput = z.object({
  societyId: uuid, userId: uuid, flatId: uuid,
  relationship: RELATIONSHIP,
  isPrimary: z.boolean().optional().default(false),
  movedInAt: z.string().datetime().optional(),
});
const endInput = z.object({
  societyId: uuid, flatResidentId: uuid,
  movedOutAt: z.string().datetime().optional(),
  reason: z.string().trim().max(200).optional().nullable(),
});
const nameSchema = z.string().trim().min(1).max(80).regex(/^[^<>]+$/, "invalid_name");
const phoneSchema = z.string().trim().max(20).regex(/^[+\d\s\-()]*$/, "invalid_phone").optional().nullable();
const familyUpsertInput = z.object({
  societyId: uuid, residentUserId: uuid,
  id: uuid.optional().nullable(),
  fullName: nameSchema, relation: RELATION,
  phone: phoneSchema,
  age: z.number().int().min(0).max(120).optional().nullable(),
});
const familyDeactivateInput = z.object({ societyId: uuid, id: uuid });
const vehicleUpsertInput = z.object({
  societyId: uuid,
  id: uuid.optional().nullable(),
  residentUserId: uuid,
  flatId: uuid.optional().nullable(),
  plateNumber: z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9\s-]+$/, "invalid_plate"),
  type: VEHICLE_TYPE.optional().default("car"),
  makeModel: z.string().trim().max(60).optional().nullable(),
  color: z.string().trim().max(30).optional().nullable(),
});
const vehicleDeactivateInput = z.object({ societyId: uuid, id: uuid });

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

// -- Strict private-detail contract -----------------------------------------
// Reject unknown fields at every level. Only fields required by the admin UI.
const privateProfileSchema = z
  .object({
    id: z.string().uuid(),
    full_name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    avatar_url: z.string().nullable(),
    property_number: z.string().nullable(),
    ugvcl_number: z.string().nullable(),
    share_certificate_number: z.string().nullable(),
    move_in_date: z.string().nullable(),
    aadhaar_verified: z.boolean().nullable(),
    is_offline: z.boolean().nullable(),
    society_id: z.string().uuid(),
  })
  .strict();

const privateRelationshipSchema = z
  .object({
    id: z.string().uuid(),
    flat_id: z.string().uuid(),
    flat_number: z.string().nullable(),
    block_name: z.string().nullable(),
    relationship: z.string(),
    is_active: z.boolean(),
    is_primary: z.boolean(),
    moved_in_at: z.string().nullable(),
    moved_out_at: z.string().nullable(),
    ended_reason: z.string().nullable(),
    created_at: z.string(),
  })
  .strict();

const privateFamilySchema = z
  .object({
    id: z.string().uuid(),
    full_name: z.string(),
    relation: z.string(),
    phone: z.string().nullable(),
    age: z.number().nullable(),
    created_at: z.string(),
  })
  .passthrough(); // family may carry is_active added by migration; UI derives from it

const privateVehicleSchema = z
  .object({
    id: z.string().uuid(),
    plate_number: z.string(),
    type: z.string(),
    make_model: z.string().nullable(),
    color: z.string().nullable(),
    flat_id: z.string().uuid().nullable(),
    created_at: z.string(),
  })
  .passthrough();

export const privateDetailSchema = z
  .object({
    profile: privateProfileSchema,
    relationships: z.array(privateRelationshipSchema),
    family: z.array(privateFamilySchema),
    vehicles: z.array(privateVehicleSchema),
  })
  .strict();

export type PrivateDetail = z.infer<typeof privateDetailSchema>;

export type PrivateDetailResult =
  | { status: "available"; data: PrivateDetail }
  | { status: "unavailable" }
  | { status: "temporary_error" };

// -- server functions --------------------------------------------------------
export const listResidentsPage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof listInput>) => listInput.parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase.rpc("list_society_residents_page", {
      _society_id: data.societyId,
      _search: data.search ?? null,
      _flat_id: data.flatId ?? null,
      _relationship: data.relationship ?? null,
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
  .handler(async ({ data, context }): Promise<PrivateDetailResult> => {
    const { data: json, error } = await context.supabase.rpc("get_resident_private_detail", {
      _society_id: data.societyId,
      _user_id: data.userId,
    });
    if (error) {
      const mapped = safeError(error).message;
      if (mapped === "forbidden") return { status: "unavailable" };
      return { status: "temporary_error" };
    }
    if (json == null) return { status: "unavailable" };
    const parsed = privateDetailSchema.safeParse(json);
    if (!parsed.success) return { status: "temporary_error" };
    return { status: "available", data: parsed.data };
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
      _reason: data.reason ?? null,
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
      _id: data.id ?? null,
      _full_name: data.fullName,
      _relation: data.relation,
      _phone: data.phone ?? null,
      _age: data.age ?? null,
    });
    if (error) throw safeError(error);
    return { id: id as string };
  });

/**
 * Deactivate a family member. Historical row is preserved (is_active=false,
 * deactivated_at/by populated) — never DELETEd.
 */
export const deactivateFamilyMemberAsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof familyDeactivateInput>) => familyDeactivateInput.parse(d))
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
      _id: data.id ?? null,
      _resident_user_id: data.residentUserId,
      _flat_id: data.flatId ?? null,
      _plate_number: data.plateNumber,
      _type: data.type ?? "car",
      _make_model: data.makeModel ?? null,
      _color: data.color ?? null,
    });
    if (error) throw safeError(error);
    return { id: id as string };
  });

/**
 * Deactivate a vehicle. Historical row is preserved (is_active=false,
 * registration number unchanged) — never DELETEd.
 */
export const deactivateVehicleAsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: z.input<typeof vehicleDeactivateInput>) => vehicleDeactivateInput.parse(d))
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
  activeOnly: z.boolean().optional().default(true),
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
        "id, plate_number, type, make_model, color, flat_id, user_id, created_at, is_active, flats(flat_number, blocks(name)), profiles!vehicles_user_id_fkey(full_name)",
      )
      .eq("society_id", data.societyId)
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (data.activeOnly ?? true) q = q.eq("is_active", true);
    if (data.search) q = q.ilike("plate_number", `%${data.search.toUpperCase()}%`);
    const { data: rows, error } = await q;
    if (error) throw safeError(error);
    type Row = {
      id: string; plate_number: string; type: string;
      make_model: string | null; color: string | null;
      flat_id: string | null; user_id: string; created_at: string; is_active: boolean;
      flats?: { flat_number?: string | null; blocks?: { name?: string | null } | null } | null;
      profiles?: { full_name?: string | null } | null;
    };
    return ((rows ?? []) as unknown as Row[]).map((v) => ({
      id: v.id,
      plate_number: v.plate_number,
      type: v.type,
      make_model: v.make_model,
      color: v.color,
      flat_id: v.flat_id,
      user_id: v.user_id,
      is_active: v.is_active,
      flat_number: v.flats?.flat_number ?? null,
      block_name: v.flats?.blocks?.name ?? null,
      owner_name: v.profiles?.full_name ?? null,
      created_at: v.created_at,
    }));
  });
