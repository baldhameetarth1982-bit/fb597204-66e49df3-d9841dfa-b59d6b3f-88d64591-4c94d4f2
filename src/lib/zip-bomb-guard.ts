/**
 * Zip-bomb guard: reads only the ZIP central directory (no decompression) and
 * rejects archives whose declared unpacked size, entry count or compression
 * ratio is abusive, plus nested archives and ZIP64/odd structures.
 */
export const ZIP_MAX_ENTRIES = 200;
export const ZIP_MAX_UNPACKED = 50 * 1024 * 1024; // 50 MB total
export const ZIP_MAX_RATIO = 100; // per entry, for entries above 1 MB unpacked

export type ZipCheck = { ok: true } | { ok: false; reason: "corrupt" | "too_many_entries" | "too_large" | "ratio" | "nested" | "zip64" };

const NESTED = /\.(zip|rar|7z|gz|tar|xlsx|xlsm|xlsb|jar)$/i;

export function inspectZip(bytes: Uint8Array): ZipCheck {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const min = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= min; i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return { ok: false, reason: "corrupt" };
  const count = v.getUint16(eocd + 10, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (count === 0xffff || cdOffset === 0xffffffff) return { ok: false, reason: "zip64" };
  if (count > ZIP_MAX_ENTRIES) return { ok: false, reason: "too_many_entries" };
  let p = cdOffset, total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== 0x02014b50) return { ok: false, reason: "corrupt" };
    const comp = v.getUint32(p + 20, true), raw = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    if (comp === 0xffffffff || raw === 0xffffffff) return { ok: false, reason: "zip64" };
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (NESTED.test(name)) return { ok: false, reason: "nested" };
    total += raw;
    if (total > ZIP_MAX_UNPACKED) return { ok: false, reason: "too_large" };
    if (raw > 1024 * 1024 && raw / Math.max(comp, 1) > ZIP_MAX_RATIO) return { ok: false, reason: "ratio" };
    p += 46 + nameLen + extra + comment;
  }
  return { ok: true };
}
