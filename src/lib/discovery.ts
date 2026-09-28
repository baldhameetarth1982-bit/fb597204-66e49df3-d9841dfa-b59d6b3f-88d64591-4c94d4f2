// Client-safe validation for Services & Discovery. The database CHECKs mirror
// these rules, so a bypassed browser still cannot store unsafe content.

const HTTPS_RE = /^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]{2,}(\/[^\s<>"]*)?$/;
const PHONE_RE = /^\+?[0-9]{8,15}$/;
const UNSAFE_TEXT = /[<>{}]/;

export function safeHttpsUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const s = u.trim();
  if (s.length > 500 || !HTTPS_RE.test(s)) return null;
  try {
    const url = new URL(s);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normalizePhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const s = p.replace(/[\s()-]/g, "");
  return PHONE_RE.test(s) ? s : null;
}

export function telHref(p: string | null) {
  const n = normalizePhone(p);
  return n ? `tel:${n}` : null;
}

export function whatsappHref(p: string | null) {
  const n = normalizePhone(p);
  if (!n) return null;
  const digits = n.replace(/^\+/, "");
  return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}`;
}

export type ListingDraft = {
  kind: "service" | "campaign" | "banner";
  title: string;
  description: string;
  business_name: string;
  phone: string;
  whatsapp: string;
  link_url: string;
  cta_label: string;
};

/** Returns field → message for every invalid field. */
export function validateListing(d: ListingDraft): Record<string, string> {
  const e: Record<string, string> = {};
  const text = (k: keyof ListingDraft, min: number, max: number, required: boolean) => {
    const v = d[k].trim();
    if (!v) { if (required) e[k] = "Required."; return; }
    if (v.length < min || v.length > max) e[k] = `Use ${min}–${max} characters.`;
    else if (UNSAFE_TEXT.test(v)) e[k] = "Remove < > { } characters.";
  };
  text("title", 2, 80, true);
  text("description", 0, 600, false);
  text("business_name", 2, 80, false);
  text("cta_label", 2, 24, false);
  if (d.phone.trim() && !normalizePhone(d.phone)) e.phone = "Enter 8–15 digits, optional +.";
  if (d.whatsapp.trim() && !normalizePhone(d.whatsapp)) e.whatsapp = "Enter 8–15 digits, optional +.";
  if (d.link_url.trim() && !safeHttpsUrl(d.link_url)) e.link_url = "Only full https:// links are allowed.";
  if (d.kind !== "banner" && !d.phone.trim() && !d.whatsapp.trim() && !d.link_url.trim()) e.phone = "Add a phone, WhatsApp or link.";
  return e;
}

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
