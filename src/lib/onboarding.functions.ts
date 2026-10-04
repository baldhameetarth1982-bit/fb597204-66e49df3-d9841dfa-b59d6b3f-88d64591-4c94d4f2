/**
 * Onboarding server functions — thin wrappers over the SECURITY DEFINER
 * SQL RPCs added in the Phase 2 migration. Every call is authenticated
 * (RLS + explicit `auth.uid()` checks inside the RPC).
 */
import { supabase } from "@/integrations/supabase/client";

export interface CreateSocietyInput {
  name: string;
  registration_number?: string;
  full_address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  logo_url?: string;
  total_units?: number;
  referral_code?: string;
}

export async function createSocietyFull(input: CreateSocietyInput) {
  const { data, error } = await (supabase as any)
    .rpc("create_society_full", {
      _name: input.name,
      _registration_number: (input.registration_number ?? undefined) as any,
      _full_address: (input.full_address ?? undefined) as any,
      _city: (input.city ?? undefined) as any,
      _state: (input.state ?? undefined) as any,
      _pincode: (input.pincode ?? undefined) as any,
      _logo_url: (input.logo_url ?? undefined) as any,
      _total_units: (input.total_units ?? undefined) as any,
      _referral_code: (input.referral_code ?? undefined) as any,
    })
    .single();
  if (error) throw new Error(error.message);
  return data as { id: string; name: string; invite_code: string };
}

export async function searchSocietiesPublic(q: string) {
  const { data, error } = await supabase.rpc("search_societies_public", { _q: q });
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{
    id: string;
    name: string;
    city: string | null;
    state: string | null;
    logo_url: string | null;
  }>;
}

export interface JoinStructure {
  mode: "structured" | "serial" | null;
  blocks: Array<{ id: string; name: string }>;
  units: Array<{ id: string; label: string; floor: number | null; block_id: string | null }>;
}

export async function getJoinStructure(societyId: string, code: string): Promise<JoinStructure> {
  const { data, error } = await (supabase.rpc as any)("get_join_structure", { _society_id: societyId, _code: code });
  if (error) throw new Error("Could not load houses. Please try again.");
  if (!data?.ok) throw new Error("That code doesn't match this society");
  return { mode: data.mode ?? null, blocks: data.blocks ?? [], units: data.units ?? [] };
}

const JOIN_REASONS: Record<string, string> = {
  invalid_code: "That code doesn't match this society",
  already_member: "You already belong to a society",
  invalid_unit: "That house isn't available in the selected block. Please choose again.",
  already_linked: "You're already linked to this house.",
  unit_unavailable: "This house can't be claimed here. Ask your Society Admin for help.",
  name_required: "Please enter your full name",
  role_required: "Choose owner or tenant",
  pending_elsewhere: "You already have a request waiting at another society. Ask that society's admin to approve or decline it first.",
};

export async function submitJoinRequestForUnit(input: {
  societyId: string; code: string; fullName: string; blockId: string | null; flatId: string;
  mobile?: string | null; ownerOrTenant: "owner" | "tenant";
}) {
  const { data, error } = await (supabase.rpc as any)("submit_join_request_unit", {
    _society_id: input.societyId, _code: input.code, _full_name: input.fullName,
    _block_id: input.blockId, _flat_id: input.flatId, _mobile: input.mobile ?? "", _owner_or_tenant: input.ownerOrTenant,
  });
  if (error) throw new Error("Could not submit your request. Please try again.");
  if (!data?.ok) throw new Error(JOIN_REASONS[data?.reason] ?? "Could not submit your request.");
  return data.id as string;
}
