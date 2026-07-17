/**
 * Stage 2C — Team & Roles + Privacy admin server functions.
 *
 * All privileged operations authenticate via `requireSupabaseAuth` and delegate
 * authorization + last-admin protection + audit to SECURITY DEFINER RPCs.
 * Raw DB errors are mapped to fixed, non-enumerating safe codes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  PRIVACY_DIRECTORY, PRIVACY_CONTACTS, PRIVACY_FINANCES,
  PRIVACY_VEHICLES, PRIVACY_DOCUMENTS, normalizePrivacy,
  type SocietyPrivacySettings,
} from "@/lib/role-permissions";

const KNOWN = new Set([
  "forbidden", "target_not_in_society", "invalid_role",
  "block_scope_required", "invalid_block_scope",
  "block_admin_unavailable_serial_mode",
  "last_society_admin", "role_not_found",
  "invalid_directory", "invalid_contacts", "invalid_finances",
  "invalid_vehicles", "invalid_documents",
]);

function safeError(e: unknown): Error {
  const msg = (e as { message?: string } | null)?.message ?? "";
  for (const code of KNOWN) if (msg.includes(code)) return new Error(code);
  return new Error("operation_failed");
}

const uuid = z.string().uuid();

const TEAM_ROLE = z.enum(["society_admin", "block_admin", "security"]);

// -----------------------------
// List team members
// -----------------------------
const listInput = z.object({
  societyId: uuid,
  includeInactive: z.boolean().optional().default(true),
});

export const listTeamMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => listInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (supabase as any).rpc("list_society_team_members", {
      _society_id: data.societyId,
      _include_inactive: data.includeInactive,
    });
    if (error) throw safeError(error);
    return {
      members: (rows ?? []) as Array<{
        role_id: string;
        user_id: string;
        full_name: string;
        role: "society_admin" | "block_admin" | "security";
        block_id: string | null;
        block_name: string | null;
        is_active: boolean;
        assigned_by: string | null;
        updated_at: string;
        created_at: string;
      }>,
    };
  });

// -----------------------------
// Assign / update role
// -----------------------------
const upsertInput = z.object({
  societyId: uuid,
  targetUserId: uuid,
  role: TEAM_ROLE,
  blockId: uuid.optional().nullable(),
});

export const upsertTeamRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => upsertInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: id, error } = await (supabase as any).rpc("admin_upsert_team_role", {
      _society_id: data.societyId,
      _target_user_id: data.targetUserId,
      _new_role: data.role,
      _block_id: data.blockId ?? null,
    });
    if (error) throw safeError(error);
    return { roleId: id as string };
  });

// -----------------------------
// Activate / deactivate
// -----------------------------
const setActiveInput = z.object({
  societyId: uuid,
  roleId: uuid,
  isActive: z.boolean(),
});

export const setTeamActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => setActiveInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: id, error } = await (supabase as any).rpc("admin_set_team_active", {
      _society_id: data.societyId,
      _role_id: data.roleId,
      _is_active: data.isActive,
    });
    if (error) throw safeError(error);
    return { roleId: id as string };
  });

// -----------------------------
// Directory of assignable candidates (residents in the society)
// -----------------------------
const candidatesInput = z.object({
  societyId: uuid,
  search: z.string().trim().max(80).optional().nullable(),
  limit: z.number().int().min(1).max(50).optional().default(25),
});

export const listAssignmentCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => candidatesInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    // Only society admins can browse candidates; enforced by the RLS on profiles
    // and by the role-list RPC (below rejects unauthorized callers).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const guard = await (supabase as any).rpc("current_user_is_society_admin_for", {
      _society_id: data.societyId,
    });
    if (guard.error) throw safeError(guard.error);
    if (!guard.data) throw new Error("forbidden");

    let q = supabase
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
    return {
      candidates: (rows ?? []).map((r) => ({
        id: r.id as string,
        full_name: (r.full_name as string | null) ?? null,
        email: (r.email as string | null) ?? null,
      })),
    };
  });

// -----------------------------
// Privacy — read
// -----------------------------
const privacyReadInput = z.object({ societyId: uuid });

export const getSocietyPrivacy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => privacyReadInput.parse(raw))
  .handler(async ({ data, context }): Promise<SocietyPrivacySettings> => {
    const { supabase } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rows, error } = await (supabase as any).rpc("get_society_privacy", {
      _society_id: data.societyId,
    });
    if (error) throw safeError(error);
    const row = Array.isArray(rows) ? rows[0] : rows;
    return normalizePrivacy(row);
  });

// -----------------------------
// Privacy — write
// -----------------------------
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
    const { supabase } = context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).rpc("admin_set_society_privacy", {
      _society_id: data.societyId,
      _directory: data.privacy_directory,
      _contacts:  data.privacy_contacts,
      _finances:  data.privacy_finances,
      _vehicles:  data.privacy_vehicles,
      _documents: data.privacy_documents,
    });
    if (error) throw safeError(error);
    return { ok: true as const };
  });
