/**
 * Society branding — pure, browser-safe helpers. Colours are strict 6-digit
 * uppercase hex only; nothing here ever produces CSS text beyond a validated
 * colour value, so branding cannot inject arbitrary styles.
 */
export const HEX_RE = /^#[0-9A-F]{6}$/;
export const NAME_MAX = 60;

export function normalizeHex(v: string): string | null {
  const s = v.trim().toUpperCase();
  const withHash = s.startsWith("#") ? s : `#${s}`;
  return HEX_RE.test(withHash) ? withHash : null;
}

export function isSafeName(v: string): boolean {
  const s = v.trim();
  return s.length >= 2 && s.length <= NAME_MAX && !/[<>{}]/.test(s);
}

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Readable text colour (white or near-black) on a validated background. */
export function readableOn(bg: string): "#FFFFFF" | "#111111" {
  return contrast(bg, "#FFFFFF") >= contrast(bg, "#111111") ? "#FFFFFF" : "#111111";
}

export type EffectiveBranding = {
  entitled: boolean;
  custom: boolean;
  display_name: string | null;
  primary_color: string | null;
  accent_color: string | null;
  logo_path: string | null;
  updated_at: string | null;
};

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/**
 * Validates a picked file is a real raster image and re-encodes it to a
 * ≤512px PNG. Re-encoding strips any embedded payload and keeps the asset small.
 */
export async function prepareLogo(file: File): Promise<Blob> {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) throw new Error("invalid_type");
  if (!/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error("invalid_type");
  if (file.size > LOGO_MAX_BYTES) throw new Error("too_large");
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error("not_image"); }
  if (bmp.width < 32 || bmp.height < 32) throw new Error("too_small");
  const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("not_image");
  return blob;
}
