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
      _registration_number: input.registration_number ?? null,
      _full_address: input.full_address ?? null,
      _city: input.city ?? null,
      _state: input.state ?? null,
      _pincode: input.pincode ?? null,
      _logo_url: input.logo_url ?? null,
      _total_units: input.total_units ?? null,
      _referral_code: input.referral_code ?? null,
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

export async function submitJoinRequest(input: {
  societyId: string;
  code: string;
  fullName: string;
  flatNumber: string;
  mobile?: string | null;
  ownerOrTenant: "owner" | "tenant";
}) {
  const { data, error } = await supabase.rpc("submit_join_request", {
    _society_id: input.societyId,
    _code: input.code,
    _full_name: input.fullName,
    _flat_number: input.flatNumber,
    _mobile: (input.mobile ?? "") as any,
    _owner_or_tenant: input.ownerOrTenant,
  });
  if (error) throw new Error(error.message);
  return data as string;
}
