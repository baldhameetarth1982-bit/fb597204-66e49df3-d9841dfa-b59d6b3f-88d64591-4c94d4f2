/**
 * Stage 2D — Canonical migration pipeline shared helpers (browser-safe).
 *
 * These utilities are used both by unit tests and the production admin UI.
 * They MUST NOT import any server-only module. Server functions live in
 * `src/lib/migration.functions.ts` and re-export the same schemas.
 */
import { z } from "zod";

/** Supported source presets. These are column-mapping presets, not integrations. */
export const SOURCE_TYPES = [
  "sociyohub",
  "generic",
  "mygate",
  "adda",
  "nobrokerhood",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export const ENTITY_TYPES = [
  "structure",
  "unit",
  "resident",
  "occupancy",
  "family",
  "vehicle",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const STATUSES = [
  "uploaded",
  "mapping",
  "validating",
  "ready",
  "committing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type MigrationStatus = (typeof STATUSES)[number];

export const STRUCTURE_MODES = ["structured", "serial"] as const;
export type StructureMode = (typeof STRUCTURE_MODES)[number];

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_ROWS = 5_000;

/** Allowed extensions/MIME. XLSM/macro-enabled explicitly rejected. */
export const ALLOWED_EXTENSIONS = [".csv", ".xlsx"] as const;
export const REJECTED_EXTENSIONS = [
  ".xlsm",
  ".xlsb",
  ".xltm",
  ".xls",
  ".exe",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".js",
  ".html",
] as const;
export const ALLOWED_MIME_PREFIXES = [
  "text/csv",
  "application/csv",
  "application/vnd.ms-excel", // some CSV uploaders emit this
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type FileSafetyCode =
  | "invalid_file"
  | "unsupported_format"
  | "too_large"
  | "too_many_rows"
  | "macro_enabled"
  | "empty_file";

export interface FileSafetyInput {
  filename: string;
  size: number;
  mimeType?: string | null;
  rowCount?: number;
}

/** Pure filename+size+mime validation. Row count validated after parse. */
export function validateFileSafety(input: FileSafetyInput): {
  ok: boolean;
  code?: FileSafetyCode;
} {
  const name = (input.filename ?? "").toLowerCase().trim();
  if (!name) return { ok: false, code: "invalid_file" };
  if (input.size <= 0) return { ok: false, code: "empty_file" };
  if (input.size > MAX_FILE_BYTES) return { ok: false, code: "too_large" };

  const lowered = name;
  for (const bad of REJECTED_EXTENSIONS) {
    if (lowered.endsWith(bad)) {
      return {
        ok: false,
        code: bad === ".xlsm" || bad === ".xlsb" || bad === ".xltm"
          ? "macro_enabled"
          : "unsupported_format",
      };
    }
  }
  const okExt = ALLOWED_EXTENSIONS.some((e) => lowered.endsWith(e));
  if (!okExt) return { ok: false, code: "unsupported_format" };

  if (input.mimeType) {
    const m = input.mimeType.toLowerCase();
    const okMime = ALLOWED_MIME_PREFIXES.some((p) => m.startsWith(p)) || m === "" || m === "application/octet-stream";
    if (!okMime) return { ok: false, code: "unsupported_format" };
  }

  if (typeof input.rowCount === "number" && input.rowCount > MAX_ROWS) {
    return { ok: false, code: "too_many_rows" };
  }

  return { ok: true };
}

/**
 * Escape a value for safe inclusion in a downloadable CSV/XLSX cell.
 * Values starting with `=`, `+`, `-`, `@`, TAB or CR are prefixed with `'`
 * to prevent formula execution when the file is re-opened in a spreadsheet.
 */
export function neutralizeFormula(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (!s) return "";
  const first = s.charAt(0);
  if (first === "=" || first === "+" || first === "-" || first === "@" || first === "\t" || first === "\r") {
    return "'" + s;
  }
  return s;
}

/** Column presets: keys = canonical field, values = candidate source headers. */
export const CANONICAL_HEADERS: Record<EntityType, readonly string[]> = {
  structure: ["structure_name", "structure_kind", "active"],
  unit: ["unit_label", "structure_name", "floor", "unit_type", "active"],
  resident: [
    "external_resident_key",
    "display_name",
    "phone",
    "email",
    "unit_label",
    "structure_name",
    "relationship",
    "move_in_date",
    "active",
  ],
  occupancy: ["external_resident_key", "unit_label", "structure_name", "move_in_date", "move_out_date"],
  family: ["external_resident_key", "family_member_name", "relationship", "phone", "email", "active"],
  vehicle: [
    "external_resident_key",
    "registration_number",
    "vehicle_type",
    "make_model",
    "colour",
    "unit_label",
    "active",
  ],
};

type PresetMap = Partial<Record<SourceType, Record<string, string>>>;

/** Source-specific header aliases → canonical field. Lowercase keys. */
export const SOURCE_PRESETS: Record<EntityType, PresetMap> = {
  structure: {
    mygate: { "tower name": "structure_name", "tower type": "structure_kind" },
    adda: { "block name": "structure_name", "block type": "structure_kind" },
    nobrokerhood: { "wing": "structure_name", "wing type": "structure_kind" },
    generic: { block: "structure_name", tower: "structure_name", wing: "structure_name" },
  },
  unit: {
    mygate: { "flat no": "unit_label", "tower name": "structure_name", floor: "floor" },
    adda: { "unit no": "unit_label", "block name": "structure_name" },
    nobrokerhood: { "flat number": "unit_label", "wing": "structure_name" },
    generic: { flat: "unit_label", house: "unit_label", block: "structure_name" },
  },
  resident: {
    mygate: {
      "resident name": "display_name",
      "mobile": "phone",
      "email id": "email",
      "flat no": "unit_label",
      "tower name": "structure_name",
      "resident type": "relationship",
    },
    adda: {
      "member name": "display_name",
      "mobile no": "phone",
      "email": "email",
      "unit no": "unit_label",
      "block name": "structure_name",
    },
    nobrokerhood: {
      "resident": "display_name",
      "phone number": "phone",
      "email": "email",
      "flat number": "unit_label",
      "wing": "structure_name",
    },
    generic: { name: "display_name", mobile: "phone" },
  },
  occupancy: {
    generic: {
      "resident id": "external_resident_key",
      "flat": "unit_label",
      "from": "move_in_date",
      "to": "move_out_date",
    },
  },
  family: {
    mygate: {
      "member name": "family_member_name",
      "relation": "relationship",
      "mobile": "phone",
      "primary resident": "external_resident_key",
    },
    adda: {
      "family member": "family_member_name",
      "relation": "relationship",
      "primary member": "external_resident_key",
    },
    nobrokerhood: {
      "family name": "family_member_name",
      "relation": "relationship",
    },
    generic: {},
  },
  vehicle: {
    mygate: {
      "vehicle number": "registration_number",
      "type": "vehicle_type",
      "make": "make_model",
      "colour": "colour",
      "flat no": "unit_label",
    },
    adda: {
      "vehicle no": "registration_number",
      "vehicle type": "vehicle_type",
      "unit no": "unit_label",
    },
    nobrokerhood: {
      "reg number": "registration_number",
      "type": "vehicle_type",
      "flat number": "unit_label",
    },
    generic: { plate: "registration_number", registration: "registration_number" },
  },
};

/** Case-insensitive header match against canonical + preset aliases. */
export function detectMapping(
  headers: readonly string[],
  entity: EntityType,
  source: SourceType,
): Record<string, string> {
  const canonical = new Set<string>(CANONICAL_HEADERS[entity]);
  const preset = SOURCE_PRESETS[entity][source] ?? {};
  const mapping: Record<string, string> = {};
  for (const raw of headers) {
    const key = raw.trim().toLowerCase();
    if (canonical.has(key)) mapping[raw] = key;
    else if (preset[key]) mapping[raw] = preset[key];
  }
  return mapping;
}

/** Registration plate normalization (strip spaces/hyphens, upper-case). */
export function normalizePlate(v: string | null | undefined): string {
  return String(v ?? "").replace(/[\s-]+/g, "").toUpperCase();
}

/** Row-level Zod schemas — used to validate mapped rows server-side. */
export const structureRowSchema = z.object({
  structure_name: z.string().trim().min(1).max(80),
  structure_kind: z.enum(["block", "tower", "wing", "building"]).default("block"),
  active: z.boolean().optional().default(true),
});

export const unitRowSchema = z.object({
  unit_label: z.string().trim().min(1).max(40),
  structure_name: z.string().trim().max(80).optional().nullable(),
  floor: z.coerce.number().int().min(-5).max(200).optional().nullable(),
  unit_type: z.string().trim().max(40).optional().nullable(),
  active: z.boolean().optional().default(true),
});

export const residentRowSchema = z.object({
  external_resident_key: z.string().trim().min(1).max(80),
  display_name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(20).optional().nullable(),
  email: z.string().trim().email().max(160).optional().nullable(),
  unit_label: z.string().trim().min(1).max(40),
  structure_name: z.string().trim().max(80).optional().nullable(),
  relationship: z.enum(["owner", "tenant", "family"]).default("owner"),
  move_in_date: z.coerce.date().optional().nullable(),
  active: z.boolean().optional().default(true),
});

export const familyRowSchema = z.object({
  external_resident_key: z.string().trim().min(1).max(80),
  family_member_name: z.string().trim().min(1).max(120),
  relationship: z.string().trim().max(40).default("family"),
  phone: z.string().trim().max(20).optional().nullable(),
  email: z.string().trim().email().max(160).optional().nullable(),
  active: z.boolean().optional().default(true),
});

export const vehicleRowSchema = z.object({
  external_resident_key: z.string().trim().min(1).max(80).optional().nullable(),
  registration_number: z
    .string()
    .trim()
    .min(4)
    .max(20)
    .transform(normalizePlate),
  vehicle_type: z.string().trim().max(20).optional().nullable(),
  make_model: z.string().trim().max(80).optional().nullable(),
  colour: z.string().trim().max(30).optional().nullable(),
  unit_label: z.string().trim().max(40).optional().nullable(),
  active: z.boolean().optional().default(true),
});

export const ROW_SCHEMAS = {
  structure: structureRowSchema,
  unit: unitRowSchema,
  resident: residentRowSchema,
  occupancy: residentRowSchema, // occupancy shares resident+unit fields
  family: familyRowSchema,
  vehicle: vehicleRowSchema,
} as const;

/** Deterministic checksum for a JSON payload (browser+Node). */
export async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  // Web Crypto is present in TanStack Worker runtime, Node 20+ and modern browsers.
  const digest = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Stable JSON stringification for checksums (sorted keys). */
export function stableStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  const walk = (v: unknown): unknown => {
    if (v === null || typeof v !== "object") return v;
    if (seen.has(v as object)) return null;
    seen.add(v as object);
    if (Array.isArray(v)) return v.map(walk);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = walk((v as Record<string, unknown>)[k]);
    }
    return out;
  };
  return JSON.stringify(walk(value));
}

// ============================================================
// Stage 2D — Safe CSV parser
// ============================================================

export const MAX_CSV_COLUMNS = 60;
export const MAX_CELL_LENGTH = 4000;

export type CsvParseError =
  | "empty_file"
  | "empty_header"
  | "duplicate_header"
  | "too_many_columns"
  | "cell_too_long"
  | "malformed_quote"
  | "too_many_rows";

export interface CsvParseResult {
  ok: boolean;
  headers: string[];
  rows: string[][];
  error?: CsvParseError;
  errorRow?: number;
}

/**
 * Robust RFC-4180-ish CSV parser. UTF-8 only, tolerant of BOM, CRLF/LF,
 * quoted commas, and escaped quotes. Rejects malformed quote structure and
 * enforces column / cell / row caps. Values are preserved as raw text —
 * formula-looking cells stay inert data.
 */
export function parseCsv(text: string): CsvParseResult {
  if (!text) return { ok: false, headers: [], rows: [], error: "empty_file" };
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  const pushCell = (): CsvParseError | null => {
    if (cell.length > MAX_CELL_LENGTH) return "cell_too_long";
    cur.push(cell);
    if (cur.length > MAX_CSV_COLUMNS) return "too_many_columns";
    cell = "";
    return null;
  };

  while (i < len) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      if (cell.length > 0) {
        return { ok: false, headers: [], rows: [], error: "malformed_quote", errorRow: rows.length + 1 };
      }
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      const err = pushCell();
      if (err) return { ok: false, headers: [], rows: [], error: err, errorRow: rows.length + 1 };
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      const err = pushCell();
      if (err) return { ok: false, headers: [], rows: [], error: err, errorRow: rows.length + 1 };
      // Skip fully blank lines
      if (cur.length === 1 && cur[0] === "") {
        cur = [];
        i++;
        continue;
      }
      rows.push(cur);
      cur = [];
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  if (inQuotes) {
    return { ok: false, headers: [], rows: [], error: "malformed_quote", errorRow: rows.length + 1 };
  }
  // Last cell / row (no trailing newline)
  if (cell.length > 0 || cur.length > 0) {
    const err = pushCell();
    if (err) return { ok: false, headers: [], rows: [], error: err };
    if (!(cur.length === 1 && cur[0] === "")) rows.push(cur);
  }

  if (rows.length === 0) return { ok: false, headers: [], rows: [], error: "empty_file" };

  const headers = rows.shift()!.map((h) => h.trim());
  if (headers.length === 0 || headers.some((h) => h === "")) {
    return { ok: false, headers: [], rows: [], error: "empty_header" };
  }
  const seen = new Set<string>();
  for (const h of headers) {
    const norm = h.toLowerCase();
    if (seen.has(norm)) return { ok: false, headers: [], rows: [], error: "duplicate_header" };
    seen.add(norm);
  }
  if (rows.length > MAX_ROWS) {
    return { ok: false, headers: [], rows: [], error: "too_many_rows" };
  }
  return { ok: true, headers, rows };
}

/**
 * Simple magic-byte / signature test. XLSX files begin with the PKZIP
 * signature 50 4B 03 04. CSV must not start with that signature.
 */
export function detectFileSignature(bytes: Uint8Array): "csv" | "xlsx" | "unknown" {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "xlsx";
  }
  // Reject obvious binary/executable prefixes
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return "unknown"; // MZ (exe)
  if (bytes.length >= 4 && bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46) return "unknown"; // ELF
  // Everything else: treat as CSV candidate (validated by parser below).
  return "csv";
}

