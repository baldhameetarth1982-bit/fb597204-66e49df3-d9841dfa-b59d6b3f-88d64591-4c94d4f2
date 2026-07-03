/**
 * Server-adjacent helpers for the Society Setup Wizard.
 * Every RPC in here is already `SECURITY DEFINER` on the DB side.
 */
import { supabase } from "@/integrations/supabase/client";
import type { GeneratedUnit } from "@/lib/hierarchy/numbering";

export interface WizardStructure {
  name: string;
  code?: string;
  floors: number;
  units_per_floor: number;
  ground_floor: boolean;
  numbering_format: string;
  custom_pattern?: string;
  units: GeneratedUnit[];
}

export interface DynamicField {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "dropdown" | "checkbox" | "file" | "image";
  required?: boolean;
  options?: string[];
}

export interface WizardPayload {
  info: {
    name: string;
    registration_no?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    logo_url?: string;
    email?: string;
  };
  layout: "structured" | "serial";
  structure_label: string;
  structures: WizardStructure[];
  serial_units: GeneratedUnit[];
  opening: { cash: number; bank: number; as_of: string };
  maintenance: {
    amount: number;
    billing_type: "prepaid" | "current" | "postpaid";
    due_day: number;
    grace_days: number;
    late_fee_amount: number;
    late_fee_type: "flat" | "percent";
    auto_generate: boolean;
    frequency: "monthly" | "quarterly" | "half_yearly" | "yearly";
  };
  dynamic_fields: DynamicField[];
  financial_year_label: string;
}

export async function saveWizardDraft(societyId: string, state: Record<string, unknown>) {
  const { error } = await (supabase as any).rpc("save_wizard_draft", {
    _society_id: societyId,
    _state: state,
  });
  if (error) throw new Error(error.message);
}

export async function loadWizardDraft(societyId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await (supabase as any)
    .from("society_settings")
    .select("wizard_state, setup_completed_at")
    .eq("society_id", societyId)
    .maybeSingle();
  if (error) return null;
  if (!data || data.setup_completed_at) return null;
  return (data.wizard_state as Record<string, unknown>) ?? null;
}

export async function commitSocietyWizard(societyId: string, payload: WizardPayload) {
  const { error } = await (supabase as any).rpc("commit_society_wizard", {
    _society_id: societyId,
    _payload: payload,
  });
  if (error) throw new Error(error.message);
}
