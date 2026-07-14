/**
 * Certificate verification-token cryptography — SERVER ONLY.
 *
 * Uses AES-GCM via Web Crypto (Cloudflare-Worker compatible).
 * The 256-bit key is loaded from CERTIFICATE_TOKEN_ENCRYPTION_KEY at
 * first use and MUST be exactly 32 bytes decoded from either:
 *   - 64-character hex, or
 *   - base64 (standard or URL-safe) representing 32 bytes.
 *
 * Never import this module from client code — it is server-only by filename.
 */

const CURRENT_KEY_VERSION = 1 as const;
export const CERTIFICATE_TOKEN_KEY_VERSION = CURRENT_KEY_VERSION;

let cachedKey: CryptoKey | null = null;

function b64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const std = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeKeyMaterial(raw: string): Uint8Array {
  const s = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(s)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  try {
    const bytes = b64UrlDecode(s);
    if (bytes.length === 32) return bytes;
  } catch {
    /* fallthrough */
  }
  throw new Error("CERTIFICATE_TOKEN_ENCRYPTION_KEY invalid encoding (need 32 bytes hex or base64)");
}

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = process.env.CERTIFICATE_TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("CERTIFICATE_TOKEN_ENCRYPTION_KEY missing");
  const material = decodeKeyMaterial(raw);
  cachedKey = await crypto.subtle.importKey(
    "raw",
    material.buffer.slice(material.byteOffset, material.byteOffset + material.byteLength) as ArrayBuffer,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return cachedKey;
}

export interface EncryptedToken {
  ciphertext: string; // base64url of (ciphertext || auth tag)
  iv: string; // base64url of 12-byte IV
  keyVersion: number;
}

export async function encryptCertificateToken(rawToken: string): Promise<EncryptedToken> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder().encode(rawToken);
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc);
  return {
    ciphertext: b64UrlEncode(new Uint8Array(buf)),
    iv: b64UrlEncode(iv),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export async function decryptCertificateToken(
  ciphertext: string,
  iv: string,
  keyVersion: number | null | undefined,
): Promise<string> {
  if (keyVersion != null && keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error("CERT_TOKEN_KEY_VERSION_MISMATCH");
  }
  const key = await getKey();
  const ivBytes = b64UrlDecode(iv);
  const ctBytes = b64UrlDecode(ciphertext);
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: ivBytes.buffer.slice(ivBytes.byteOffset, ivBytes.byteOffset + ivBytes.byteLength) as ArrayBuffer },
    key,
    ctBytes.buffer.slice(ctBytes.byteOffset, ctBytes.byteOffset + ctBytes.byteLength) as ArrayBuffer,
  );
  return new TextDecoder().decode(buf);
}
