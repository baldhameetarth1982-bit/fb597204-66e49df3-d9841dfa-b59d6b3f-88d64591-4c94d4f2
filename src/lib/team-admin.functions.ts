/**
 * Stage 2C — Team & Roles + Privacy admin server functions.
 *
 * All privileged operations authenticate via `requireSupabaseAuth` and delegate
 * authorization + last-admin protection + audit to SECURITY DEFINER RPCs.
 * Raw DB errors are mapped to fixed, non-enumerating safe codes.
 *
 * NOTE: All Supabase RPC calls use generated `Database["public"]["Functions"]`
 * types via `satisfies` — no `as any`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import {
  PRIVACY_DIRECTORY, PRIVACY_CONTACTS, PRIVACY_FINANCES,
  PRIVACY_VEHICLES, PRIVACY_DOCUMENTS, normalizePrivacy,
  type SocietyPrivacySettings,
} from "@/lib/role-permissions";

type Fns = Database["public"]["Functions"];

const KNOWN_ERRORS = new Set([
  "forbidden", "target_not_in_society", "invalid_role",
  "block_scope_required", "invalid_block_scope",
  "block_admin_unavailable_serial_mode",
  "last_society_admin", "role_not_found",
  "invalid_directory", "invalid_contacts", "invalid_finances",
  "invalid_vehicles", "invalid_documents",
]);

function safeError(e: unknown): Error {
  const msg = (e as { message?: string } | null)?.message ?? "";
  for (const code of KNOWN_ERRORS) if (msg.includes(code)) return new Error(code);
  return new Error("operation_failed");
}

const uuid = z.string().uuid();
const TEAM_ROLE = z.enum(["society_admin", "block_admin", "security"]);

// ---------------------------------------------------------------------------
// Strict output schemas (server responses are validated before UI sees them)
// ---------------------------------------------------------------------------

const TeamMemberSchema = z.object({
  role_id: uuid,
  user_id: uuid,
  full_name: z.string(),
  role: TEAM_ROLE,
  block_ids: z.array(uuid).default([]),
  block_names: z.array(z.string()).default([]),
  is_active: z.boolean(),
  assigned_by: z.string().nullable(),
  updated_at: z.string(),
  created_at: z.string(),
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;

const CandidateSchema = z.object({
  id: uuid,
  full_name: z.string().nullable(),
  email: z.string().nullable(),
});
export type AssignmentCandidate = z.infer<typeof CandidateSchema>;

const RoleScopeSchema = z.object({ block_id: uuid, block_name: z.string() });

const PrivacyRowSchema = z.object({
  privacy_directory: z.string(),
  privacy_contacts: z.string(),
  privacy_finances: z.string(),
  privacy_vehicles: z.string(),
  privacy_documents: z.string(),
});

// ---------------------------------------------------------------------------
// List team members (multi-block-aware)
// ---------------------------------------------------------------------------
const listInput = z.object({
  societyId: uuid,
  includeInactive: z.boolean().optional().default(true),
});

export const listTeamMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => listInput.parse(raw))
  .handler(async ({ data, context }) => {
    const args = {
      _society_id: data.societyId,
      _include_inactive: data.includeInactive,
    } satisfies Fns["list_society_team_members_v2"]["Args"];
    const { data: rows, error } = await context.supabase.rpc(
      "list_society_team_members_v2", args,
    );
    if (error) throw safeError(error);
    const parsed = z.array(TeamMemberSchema).safeParse(rows ?? []);
    if (!parsed.success) throw new Error("operation_failed");
    return { members: parsed.data };
  });

// ---------------------------------------------------------------------------
// Assign / update role (multi-block, array of block IDs)
// ---------------------------------------------------------------------------
const upsertInput = z.object({
  societyId: uuid,
  targetUserId: uuid,
  role: TEAM_ROLE,
  blockIds: z.array(uuid).max(50).optional().default([]),
});

export const upsertTeamRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => upsertInput.parse(raw))
  .handler(async ({ data, context }) => {
    const args = {
      _society_id: data.societyId,
      _target_user_id: data.targetUserId,
      _new_role: data.role,
      _block_ids: data.role === "block_admin" ? Array.from(new Set(data.blockIds)) : [],
    } satisfies Fns["admin_upsert_team_role_v2"]["Args"];
    const { data: id, error } = await context.supabase.rpc(
      "admin_upsert_team_role_v2", args,
    );
    if (error) throw safeError(error);
    return { roleId: z.string().uuid().parse(id) };
  });

// ---------------------------------------------------------------------------
// Activate / deactivate a team role (soft, audited, last-admin protected)
// ---------------------------------------------------------------------------
const setActiveInput = z.object({
  societyId: uuid,
  roleId: uuid,
  isActive: z.boolean(),
});

export const setTeamActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => setActiveInput.parse(raw))
  .handler(async ({ data, context }) => {
    const args = {
      _society_id: data.societyId,
      _role_id: data.roleId,
      _is_active: data.isActive,
    } satisfies Fns["admin_set_team_active"]["Args"];
    const { data: id, error } = await context.supabase.rpc(
      "admin_set_team_active", args,
    );
    if (error) throw safeError(error);
    return { roleId: z.string().uuid().parse(id) };
  });

// ---------------------------------------------------------------------------
// List a single role's active block scopes
// ---------------------------------------------------------------------------
const roleScopesInput = z.object({ roleId: uuid });

export const listRoleBlockScopes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => roleScopesInput.parse(raw))
  .handler(async ({ data, context }) => {
    const args = { _role_id: data.roleId } satisfies Fns["list_role_block_scopes"]["Args"];
    const { data: rows, error } = await context.supabase.rpc(
      "list_role_block_scopes", args,
    );
    if (error) throw safeError(error);
    const parsed = z.array(RoleScopeSchema).safeParse(rows ?? []);
    if (!parsed.success) throw new Error("operation_failed");
    return { scopes: parsed.data };
  });

// ---------------------------------------------------------------------------
// Assignable candidates (Society Admin only) — safe projection.
// Emails included ONLY to disambiguate members with the same full_name.
// ---------------------------------------------------------------------------
const candidatesInput = z.object({
  societyId: uuid,
  search: z.string().trim().max(80).optional().nullable(),
  limit: z.number().int().min(1).max(50).optional().default(25),
});

export const listAssignmentCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => candidatesInput.parse(raw))
  .handler(async ({ data, context }) => {
    const guardArgs = { _society_id: data.societyId } satisfies Fns["current_user_is_society_admin_for"]["Args"];
    const guard = await context.supabase.rpc("current_user_is_society_admin_for", guardArgs);
    if (guard.error) throw safeError(guard.error);
    if (!guard.data) throw new Error("forbidden");

    let q = context.supabase
      .from("profiles")
      .select("id, full_name, email")
      .eq("society_id", data.societyId)
      .order("full_name", { ascending: true, nullsFirst: false })
      .limit(data.limit);
    if (data.search && data.search.length > 0) {
      const like = `%${data.search.replace(/[%_]/g, "\\$&")}%`;
      q = q.or(`full_name.ilike.${like},email.ilike.${like}`);
    }
    const { data: rows, error } = await q;
    if (error) throw safeError(error);
    const parsed = z.array(CandidateSchema).safeParse(rows ?? []);
    if (!parsed.success) throw new Error("operation_failed");
    return { candidates: parsed.data };
  });

// ---------------------------------------------------------------------------
// Privacy — read / write
// ---------------------------------------------------------------------------
const privacyReadInput = z.object({ societyId: uuid });

export const getSocietyPrivacy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => privacyReadInput.parse(raw))
  .handler(async ({ data, context }): Promise<SocietyPrivacySettings> => {
    const args = { _society_id: data.societyId } satisfies Fns["get_society_privacy"]["Args"];
    const { data: rows, error } = await context.supabase.rpc("get_society_privacy", args);
    if (error) throw safeError(error);
    const row = Array.isArray(rows) ? rows[0] : rows;
    const parsed = PrivacyRowSchema.safeParse(row);
    // Fail-closed on malformed shape.
    return normalizePrivacy(parsed.success ? parsed.data : {});
  });

const privacyWriteInput = z.object({
  societyId: uuid,
  privacy_directory: z.enum(PRIVACY_DIRECTORY),
  privacy_contacts:  z.enum(PRIVACY_CONTACTS),
  privacy_finances:  z.enum(PRIVACY_FINANCES),
  privacy_vehicles:  z.enum(PRIVACY_VEHICLES),
  privacy_documents: z.enum(PRIVACY_DOCUMENTS),
});

export const setSocietyPrivacy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => privacyWriteInput.parse(raw))
  .handler(async ({ data, context }) => {
    const args = {
      _society_id: data.societyId,
      _directory: data.privacy_directory,
      _contacts:  data.privacy_contacts,
      _finances:  data.privacy_finances,
      _vehicles:  data.privacy_vehicles,
      _documents: data.privacy_documents,
    } satisfies Fns["admin_set_society_privacy"]["Args"];
    const { error } = await context.supabase.rpc("admin_set_society_privacy", args);
    if (error) throw safeError(error);
    return { ok: true as const };
  });
