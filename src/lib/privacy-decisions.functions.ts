/**
 * Stage 2C — Server-enforced privacy decisions.
 *
 * These server functions delegate to the SECURITY DEFINER helpers introduced
 * in the Stage 2C completion migration:
 *   - resolve_privacy_access(_society_id, _resource, _subject_user_id)
 *   - resolve_financial_visibility(_society_id)
 *   - list_society_residents_safe_page(_society_id, _search, _limit, _offset)
 *
 * All calls are typed against the generated Database["public"]["Functions"]
 * shape — no `as any`.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type Fns = Database["public"]["Functions"];

const uuid = z.string().uuid();
const PRIVACY_RESOURCE = z.enum([
  "directory", "contacts", "finances", "vehicles", "documents",
]);
export type PrivacyResource = z.infer<typeof PRIVACY_RESOURCE>;

const FIN_VIS = z.enum(["admin", "detailed", "summary", "none"]);
export type FinancialVisibility = z.infer<typeof FIN_VIS>;

function safeErr(): Error {
  return new Error("operation_failed");
}

// ---------------------------------------------------------------------------
// Boolean privacy decision (does the caller have access to a resource?)
// ---------------------------------------------------------------------------
const decideInput = z.object({
  societyId: uuid,
  resource: PRIVACY_RESOURCE,
  subjectUserId: uuid.optional().nullable(),
});

export const decidePrivacyAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => decideInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ allowed: boolean }> => {
    const args = {
      _society_id: data.societyId,
      _resource: data.resource,
      _subject_user_id: data.subjectUserId ?? undefined,
    } satisfies Fns["resolve_privacy_access"]["Args"];
    const { data: result, error } = await context.supabase.rpc(
      "resolve_privacy_access", args,
    );
    if (error) return { allowed: false };
    return { allowed: z.boolean().catch(false).parse(result) };
  });

// ---------------------------------------------------------------------------
// Financial visibility tier — authoritative from server.
// ---------------------------------------------------------------------------
const finInput = z.object({ societyId: uuid });

export const getFinancialVisibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => finInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ tier: FinancialVisibility }> => {
    const args = { _society_id: data.societyId } satisfies Fns["resolve_financial_visibility"]["Args"];
    const { data: result, error } = await context.supabase.rpc(
      "resolve_financial_visibility", args,
    );
    if (error) return { tier: "none" };
    const parsed = FIN_VIS.safeParse(result);
    return { tier: parsed.success ? parsed.data : "none" };
  });

// ---------------------------------------------------------------------------
// Resident-safe directory (privacy-enforced projection).
// ---------------------------------------------------------------------------
const SafeRowSchema = z.object({
  user_id: uuid,
  full_name: z.string().nullable(),
  flat_number: z.string().nullable(),
  block_name: z.string().nullable(),
  total_count: z.number().nullable(),
});
export type SafeDirectoryRow = z.infer<typeof SafeRowSchema>;

const dirInput = z.object({
  societyId: uuid,
  search: z.string().trim().max(80).optional().nullable(),
  limit: z.number().int().min(1).max(100).optional().default(25),
  offset: z.number().int().min(0).optional().default(0),
});

export const listSafeResidentDirectory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => dirInput.parse(raw))
  .handler(async ({ data, context }) => {
    const args = {
      _society_id: data.societyId,
      _search: data.search ?? undefined,
      _limit: data.limit,
      _offset: data.offset,
    } satisfies Fns["list_society_residents_safe_page"]["Args"];
    const { data: rows, error } = await context.supabase.rpc(
      "list_society_residents_safe_page", args,
    );
    if (error) {
      const msg = (error as { message?: string }).message ?? "";
      if (msg.includes("forbidden")) throw new Error("forbidden");
      throw safeErr();
    }
    const parsed = z.array(SafeRowSchema).safeParse(rows ?? []);
    if (!parsed.success) throw safeErr();
    const total = parsed.data[0]?.total_count ?? 0;
    // Extra safety: strip any accidental sensitive columns (defense in depth).
    const items = parsed.data.map((r) => ({
      user_id: r.user_id,
      full_name: r.full_name,
      flat_number: r.flat_number,
      block_name: r.block_name,
    }));
    return { items, total: Number(total ?? 0) };
  });

// ---------------------------------------------------------------------------
// Vehicle access — resource-derived ownership (Stage 2C closure).
// The DB helper joins vehicles + society_settings; caller-provided subject
// user IDs cannot grant access. Cross-society lookups return false without
// enumerating whether the record exists.
// ---------------------------------------------------------------------------
const vehicleInput = z.object({ societyId: uuid, vehicleId: uuid });

export const canAccessVehicle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => vehicleInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ allowed: boolean }> => {
    const args = {
      _society_id: data.societyId,
      _vehicle_id: data.vehicleId,
    } satisfies Fns["can_access_vehicle"]["Args"];
    const { data: result, error } = await context.supabase.rpc(
      "can_access_vehicle", args,
    );
    if (error) return { allowed: false };
    return { allowed: z.boolean().catch(false).parse(result) };
  });
