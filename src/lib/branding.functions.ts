/**
 * Custom Branding — reads/writes via SECURITY DEFINER RPCs that enforce auth,
 * society-admin authorization, Premium entitlement, validation and audit.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const KNOWN = ["forbidden", "plan_required", "invalid_color", "invalid_name", "invalid_logo", "unauthenticated"];
function safeError(e: unknown): Error {
  const msg = (e as { message?: string } | null)?.message ?? "";
  for (const k of KNOWN) if (msg.includes(k)) return new Error(k);
  return new Error("operation_failed");
}

const Hex = z.string().regex(/^#[0-9A-F]{6}$/);
const Effective = z.object({
  entitled: z.boolean(),
  custom: z.boolean(),
  display_name: z.string().nullable(),
  primary_color: Hex.nullable(),
  accent_color: Hex.nullable(),
  logo_path: z.string().nullable(),
  updated_at: z.string().nullable(),
});

export const getBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ societyId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("get_society_branding", { _society_id: data.societyId });
    if (error) throw safeError(error);
    const parsed = Effective.safeParse(row);
    if (!parsed.success) throw new Error("operation_failed");
    return parsed.data;
  });

const SetInput = z.object({
  societyId: z.string().uuid(),
  displayName: z.string().trim().max(60).regex(/^[^<>{}]*$/).nullable(),
  primaryColor: Hex.nullable(),
  accentColor: Hex.nullable(),
  logoPath: z.string().regex(/^[0-9a-f-]{36}\/brand-logo-[0-9]{10,16}\.(png|webp|jpg)$/).nullable(),
});

export const setBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SetInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("admin_set_society_branding", {
      _society_id: data.societyId,
      _display_name: (data.displayName || null) as unknown as string,
      _primary_color: data.primaryColor as unknown as string,
      _accent_color: data.accentColor as unknown as string,
      _logo_path: data.logoPath as unknown as string,
    });
    if (error) throw safeError(error);
    return { previousLogoPath: ((row as { previous_logo_path?: string | null } | null)?.previous_logo_path) ?? null };
  });

export const resetBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => z.object({ societyId: z.string().uuid() }).parse(raw))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase.rpc("admin_reset_society_branding", { _society_id: data.societyId });
    if (error) throw safeError(error);
    return { previousLogoPath: ((row as { previous_logo_path?: string | null } | null)?.previous_logo_path) ?? null };
  });
