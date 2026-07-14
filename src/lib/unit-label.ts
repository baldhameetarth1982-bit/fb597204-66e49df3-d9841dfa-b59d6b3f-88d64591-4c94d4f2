/**
 * Unit-label builder — shared between admin flat-detail routes.
 *
 * Supports both society structures:
 *   - Structured: `<Block> · Floor <n> · Flat <number>`
 *   - Serial:     `House <number>`
 */

export type UnitLabelInput = {
  flat_number: string | null;
  floor: number | null;
  block_name?: string | null;
};

export function buildUnitLabel(u: UnitLabelInput): string {
  const number = (u.flat_number ?? "").trim();
  const hasBlock = !!(u.block_name && u.block_name.trim().length > 0);
  const hasFloor = u.floor != null;

  if (!hasBlock && !hasFloor) {
    // Serial-number society (direct houses).
    return number ? `House ${number}` : "House";
  }
  const parts: string[] = [];
  if (hasBlock) parts.push(u.block_name!.trim());
  if (hasFloor) parts.push(`Floor ${u.floor}`);
  if (number) parts.push(`Flat ${number}`);
  return parts.join(" · ");
}

export function isSerialStructure(u: Pick<UnitLabelInput, "block_name" | "floor">): boolean {
  return !u.block_name && u.floor == null;
}
