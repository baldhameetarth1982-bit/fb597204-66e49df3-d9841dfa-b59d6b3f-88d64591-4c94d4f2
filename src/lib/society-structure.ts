/**
 * Stage 2A — Canonical society-structure client helpers.
 *
 * The authoritative source of truth for society structure is:
 *   - `public.societies.structure_mode` ('structured' | 'serial')
 *   - `public.blocks` (structures, only when structured)
 *   - `public.flats` (units; block_id NULL when serial)
 *
 * `public.hierarchy_nodes` is retained for backward compatibility only.
 * Do not treat it as an independent write source.
 */
import { supabase } from "@/integrations/supabase/client";

export type StructureMode = "structured" | "serial";

export interface StructureOverview {
  structure_mode: StructureMode | null;
  configured: boolean;
  total_structures: number;
  active_structures: number;
  total_units: number;
  active_units: number;
  units_with_block: number;
  units_without_block: number;
  inconsistent_units: number;
}

export interface UnitListItem {
  id: string;
  flat_number: string;
  floor: number | null;
  unit_type: string;
  status: string;
  is_active: boolean;
  display_order: number;
  block_id: string | null;
  block_name: string | null;
}

export interface UnitListPage {
  items: UnitListItem[];
  total: number;
  limit: number;
  offset: number;
  has_next: boolean;
}

export type ConfigureModeResult =
  | { ok: true; structure_mode: StructureMode }
  | { ok: false; reason: string };

export type UnitMutationResult =
  | { ok: true; id?: string }
  | { ok: false; reason: string };

/** Case-insensitive, whitespace-trimmed label used for uniqueness. */
export function normalizeLabel(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

export async function getSocietyStructureOverview(societyId: string): Promise<StructureOverview> {
  const { data, error } = await (supabase.rpc as any)(
    "get_society_structure_overview",
    { _society_id: societyId },
  );
  if (error) throw new Error(error.message);
  return data as StructureOverview;
}

export async function configureSocietyStructureMode(
  societyId: string,
  mode: StructureMode,
): Promise<ConfigureModeResult> {
  const { data, error } = await (supabase.rpc as any)(
    "configure_society_structure_mode",
    { _society_id: societyId, _mode: mode },
  );
  if (error) throw new Error(error.message);
  return data as ConfigureModeResult;
}

export async function listSocietyUnitsPage(input: {
  societyId: string;
  search?: string | null;
  blockId?: string | null;
  floor?: number | null;
  unitType?: string | null;
  active?: boolean | null;
  limit?: number;
  offset?: number;
}): Promise<UnitListPage> {
  const { data, error } = await (supabase.rpc as any)("list_society_units_page", {
    _society_id: input.societyId,
    _search: input.search ?? null,
    _block_id: input.blockId ?? null,
    _floor: input.floor ?? null,
    _unit_type: input.unitType ?? null,
    _active: input.active ?? null,
    _limit: input.limit ?? 25,
    _offset: input.offset ?? 0,
  });
  if (error) throw new Error(error.message);
  return data as UnitListPage;
}

export async function createSocietyUnit(input: {
  societyId: string;
  flatNumber: string;
  blockId?: string | null;
  floor?: number | null;
  unitType?: string;
}): Promise<UnitMutationResult> {
  const { data, error } = await (supabase.rpc as any)("create_society_unit", {
    _society_id: input.societyId,
    _flat_number: input.flatNumber,
    _block_id: input.blockId ?? null,
    _floor: input.floor ?? null,
    _unit_type: input.unitType ?? "flat",
  });
  if (error) throw new Error(error.message);
  return data as UnitMutationResult;
}

export async function updateSocietyUnit(input: {
  unitId: string;
  flatNumber?: string;
  floor?: number | null;
  unitType?: string;
  displayOrder?: number;
}): Promise<UnitMutationResult> {
  const { data, error } = await (supabase.rpc as any)("update_society_unit", {
    _unit_id: input.unitId,
    _flat_number: input.flatNumber ?? null,
    _floor: input.floor ?? null,
    _unit_type: input.unitType ?? null,
    _display_order: input.displayOrder ?? null,
  });
  if (error) throw new Error(error.message);
  return data as UnitMutationResult;
}

export async function setSocietyUnitActive(unitId: string, active: boolean): Promise<UnitMutationResult> {
  const { data, error } = await (supabase.rpc as any)("set_society_unit_active", {
    _unit_id: unitId,
    _active: active,
  });
  if (error) throw new Error(error.message);
  return data as UnitMutationResult;
}

export async function setSocietyBlockActive(blockId: string, active: boolean): Promise<UnitMutationResult> {
  const { data, error } = await (supabase.rpc as any)("set_society_block_active", {
    _block_id: blockId,
    _active: active,
  });
  if (error) throw new Error(error.message);
  return data as UnitMutationResult;
}

/** Client-side guard mirroring the server rule for UI hints. */
export function isModeConversionBlocked(overview: StructureOverview, target: StructureMode): boolean {
  if (!overview.structure_mode) return false;
  if (overview.structure_mode === target) return false;
  return overview.total_units > 0;
}
