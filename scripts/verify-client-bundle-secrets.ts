#!/usr/bin/env bun
/**
 * Client-bundle secret scan.
 *
 * Scans the production client bundle for indicators that server-only
 * secrets or server-only cryptographic implementation leaked into
 * browser-reachable JavaScript.
 *
 * Exits with code 1 if any indicator is found.
 * Never prints raw secret values.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BUNDLE_DIRS = [".output/public", "dist"]; // TanStack Start / Vite outputs
const EXTS = [".js", ".mjs", ".cjs", ".map", ".css", ".html"];

// Indicators of leakage. Each entry is a literal or regex that MUST NOT appear
// in browser-reachable output. We match on distinctive identifiers/code shapes,
// not on user-facing UI copy.
const INDICATORS: { name: string; pattern: RegExp; allowlist?: RegExp[] }[] = [
  { name: "SUPABASE_SERVICE_ROLE_KEY reference", pattern: /SUPABASE_SERVICE_ROLE_KEY/ },
  { name: "supabaseAdmin identifier", pattern: /\bsupabaseAdmin\b/ },
  { name: "RATE_LIMIT_HMAC_SECRET", pattern: /RATE_LIMIT_HMAC_SECRET/ },
  { name: "CERTIFICATE_TOKEN_ENCRYPTION_KEY", pattern: /CERTIFICATE_TOKEN_ENCRYPTION_KEY/ },
  { name: "encryptCertificateToken", pattern: /\bencryptCertificateToken\b/ },
  { name: "decryptCertificateToken", pattern: /\bdecryptCertificateToken\b/ },
  { name: "Razorpay key_secret", pattern: /key_secret\s*[:=]\s*["'][A-Za-z0-9_-]{10,}["']/ },
  { name: "Firebase private_key", pattern: /"private_key"\s*:\s*"-----BEGIN/ },
  { name: "storage_path property leak", pattern: /storage_path["']?\s*:\s*["'][^"']*\.pdf/ },
  { name: "verification_token_ciphertext", pattern: /verification_token_ciphertext/ },
  { name: "verification_token_iv", pattern: /verification_token_iv/ },
  { name: "verification_token_hash", pattern: /verification_token_hash/ },
  // sb_secret_* is the new-format service-role key prefix
  { name: "service-role key literal", pattern: /sb_secret_[A-Za-z0-9_-]{10,}/ },
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (EXTS.some((x) => p.endsWith(x))) out.push(p);
  }
  return out;
}

function main() {
  const dirs = BUNDLE_DIRS.filter((d) => {
    try { return statSync(d).isDirectory(); } catch { return false; }
  });
  if (dirs.length === 0) {
    console.error("[bundle-scan] No build output found. Run `bun run build` first.");
    process.exit(2);
  }

  const files: string[] = [];
  for (const d of dirs) walk(d, files);
  console.log(`[bundle-scan] Scanning ${files.length} files under: ${dirs.join(", ")}`);

  const hits: { file: string; indicator: string; line: number }[] = [];
  for (const f of files) {
    let content: string;
    try { content = readFileSync(f, "utf8"); } catch { continue; }
    for (const ind of INDICATORS) {
      const m = ind.pattern.exec(content);
      if (m) {
        const line = content.slice(0, m.index).split("\n").length;
        hits.push({ file: f, indicator: ind.name, line });
      }
    }
  }

  if (hits.length === 0) {
    console.log("[bundle-scan] OK — no server-only indicators found in client bundle.");
    process.exit(0);
  }
  console.error(`[bundle-scan] FAIL — ${hits.length} indicator hit(s):`);
  for (const h of hits) console.error(`  - ${h.indicator}  @  ${h.file}:${h.line}`);
  process.exit(1);
}

main();
