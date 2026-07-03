/**
 * Numbering engine — pure functions used by the Society Setup Wizard and any
 * future module that needs to expand a numbering pattern into concrete flat/
 * house codes.
 *
 * Supports four formats:
 *  - "sequential"  : 101,102,... 201,202,...
 *  - "simple"      : 1,2,3,... (per structure)
 *  - "floor_unit"  : 1F-01, 1F-02, ...
 *  - "custom"      : user-defined pattern with tokens
 *
 * Custom pattern tokens:
 *   {S}     structure code / name        (e.g. "A", "T1", "BLK-C")
 *   {F}     floor number
 *   {FF}    floor number, 2-digit padded
 *   {N}     unit index on the floor (1-based)
 *   {NN}    unit index, 2-digit padded
 *   {G}     global unit index within structure (1-based)
 *   {GGG}   global unit index, 3-digit padded
 */

export type NumberingFormat = "sequential" | "simple" | "floor_unit" | "custom";

export interface StructureConfig {
  /** Displayed / editable name of the structure. */
  name: string;
  /** Short code used inside numbering patterns (e.g. "A", "T1"). Defaults to name. */
  code?: string;
  floors: number;
  unitsPerFloor: number;
  /** Include a ground floor (0) in addition to floors 1..N. */
  groundFloor?: boolean;
  numberingFormat: NumberingFormat;
  /** Only used when numberingFormat === "custom". */
  customPattern?: string;
}

export interface GeneratedUnit {
  code: string;
  name: string;
  floor: number;
  /** Optional freeform note the admin can attach in the editor. */
  note?: string;
}

function pad(n: number, width: number): string {
  const s = String(Math.abs(n));
  return (n < 0 ? "-" : "") + (s.length >= width ? s : "0".repeat(width - s.length) + s);
}

function expandCustom(
  pattern: string,
  ctx: { S: string; F: number; N: number; G: number },
): string {
  return pattern
    .replaceAll("{S}", ctx.S)
    .replaceAll("{FF}", pad(ctx.F, 2))
    .replaceAll("{F}", String(ctx.F))
    .replaceAll("{NN}", pad(ctx.N, 2))
    .replaceAll("{N}", String(ctx.N))
    .replaceAll("{GGG}", pad(ctx.G, 3))
    .replaceAll("{G}", String(ctx.G));
}

export function generateStructureUnits(cfg: StructureConfig): GeneratedUnit[] {
  const floors = Math.max(0, Math.floor(cfg.floors || 0));
  const perFloor = Math.max(0, Math.floor(cfg.unitsPerFloor || 0));
  if (floors === 0 || perFloor === 0) return [];

  const code = (cfg.code || cfg.name || "").trim();
  const startFloor = cfg.groundFloor ? 0 : 1;
  const endFloor = cfg.groundFloor ? floors - 1 : floors;
  const units: GeneratedUnit[] = [];

  let g = 0;
  for (let f = startFloor; f <= endFloor; f++) {
    for (let n = 1; n <= perFloor; n++) {
      g += 1;
      let unitCode = "";
      switch (cfg.numberingFormat) {
        case "sequential":
          // "101" on floor 1 unit 1, "202" on floor 2 unit 2, etc.
          unitCode = `${Math.max(f, 0)}${pad(n, 2)}`;
          break;
        case "simple":
          unitCode = String(g);
          break;
        case "floor_unit":
          unitCode = `${f}F-${pad(n, 2)}`;
          break;
        case "custom": {
          const pat = cfg.customPattern?.trim() || "{S}-{F}{NN}";
          unitCode = expandCustom(pat, { S: code, F: f, N: n, G: g });
          break;
        }
      }
      units.push({ code: unitCode, name: unitCode, floor: f });
    }
  }
  return units;
}

/**
 * Serial-number layout — generate N sequential house numbers.
 * `start` defaults to 1. `prefix` is optional (e.g. "H-").
 */
export function generateSerialUnits(count: number, opts?: { start?: number; prefix?: string }): GeneratedUnit[] {
  const start = Math.max(1, Math.floor(opts?.start ?? 1));
  const total = Math.max(0, Math.floor(count));
  const prefix = opts?.prefix ?? "";
  const out: GeneratedUnit[] = [];
  for (let i = 0; i < total; i++) {
    const label = `${prefix}${start + i}`;
    out.push({ code: label, name: label, floor: 0 });
  }
  return out;
}

/** Returns the set of duplicate codes present (case-insensitive). */
export function findDuplicateCodes(units: GeneratedUnit[]): Set<string> {
  const seen = new Map<string, number>();
  for (const u of units) {
    const key = (u.code || "").trim().toLowerCase();
    if (!key) continue;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const dups = new Set<string>();
  for (const [k, v] of seen) if (v > 1) dups.add(k);
  return dups;
}
