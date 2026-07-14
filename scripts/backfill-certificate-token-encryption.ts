#!/usr/bin/env bun
/**
 * Legacy plaintext → AES-GCM encrypted certificate-token backfill.
 *
 * SAFETY GUARDS (all required to run):
 *   ALLOW_CERTIFICATE_TOKEN_BACKFILL=true          # explicit opt-in
 *   BACKFILL_PROJECT_REF=<ref>                     # explicit project ref
 *   BACKFILL_ENVIRONMENT=<staging|production>      # explicit env label
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY        # service credentials
 *   CERTIFICATE_TOKEN_ENCRYPTION_KEY               # 32-byte hex/base64
 *
 * Production additionally requires:
 *   ALLOW_PRODUCTION_CERTIFICATE_BACKFILL=true
 *
 * Defaults:
 *   DRY_RUN=true (must be explicitly set to "false" to write)
 *   BATCH_SIZE=25  MAX_BATCHES=200
 *
 * Never runs on the known SocioHub production project by default.
 * Never prints tokens, hashes, ciphertext, or IVs.
 */
import { createClient } from "@supabase/supabase-js";
import { classifyBackfillRow, type BackfillRow } from "../src/lib/certificate-backfill";

const KNOWN_PRODUCTION_PROJECT_REF = "kfnpyzvhyjmfkcnvjjji";

function req(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`[backfill] missing env: ${name}`); process.exit(2); }
  return v;
}

const allow = process.env.ALLOW_CERTIFICATE_TOKEN_BACKFILL === "true";
if (!allow) {
  console.error("[backfill] refusing to run without ALLOW_CERTIFICATE_TOKEN_BACKFILL=true");
  process.exit(2);
}
const projectRef = req("BACKFILL_PROJECT_REF");
const envLabel = req("BACKFILL_ENVIRONMENT");
const dryRun = (process.env.DRY_RUN ?? "true").toLowerCase() !== "false";
const batchSize = Math.max(1, Math.min(500, Number(process.env.BATCH_SIZE ?? "25")));
const maxBatches = Math.max(1, Math.min(2000, Number(process.env.MAX_BATCHES ?? "200")));

if (projectRef === KNOWN_PRODUCTION_PROJECT_REF || envLabel === "production") {
  if (process.env.ALLOW_PRODUCTION_CERTIFICATE_BACKFILL !== "true") {
    console.error("[backfill] refusing production without ALLOW_PRODUCTION_CERTIFICATE_BACKFILL=true");
    process.exit(2);
  }
  console.warn("[backfill] PRODUCTION run explicitly authorized");
}

const url = req("SUPABASE_URL");
const key = req("SUPABASE_SERVICE_ROLE_KEY");
req("CERTIFICATE_TOKEN_ENCRYPTION_KEY");

const admin = createClient(url, key, { auth: { persistSession: false } });

async function run() {
  const { encryptCertificateToken } = await import("../src/lib/certificate-token.server");

  const stats = {
    scanned: 0,
    already_encrypted: 0,
    eligible: 0,
    migrated: 0,
    hash_mismatch: 0,
    malformed: 0,
    failed: 0,
    skipped: 0,
  };

  // Keyset pagination: order by id, always fetch rows with id > cursor.
  // OFFSET is unsafe for a mutable backfill — processed rows disappear from
  // the query in write mode and would shift the window backwards.
  let cursor: string | null = null;

  for (let batch = 0; batch < maxBatches; batch++) {
    let q = admin
      .from("no_dues_certificates")
      .select("id, verification_token, verification_token_hash, verification_token_ciphertext")
      .order("id", { ascending: true })
      .limit(batchSize);
    if (cursor != null) q = q.gt("id", cursor);

    const { data: rows, error } = await q;
    if (error) { console.error("[backfill] fetch failed"); stats.failed++; break; }
    if (!rows || rows.length === 0) break;

    for (const row of rows as BackfillRow[]) {
      stats.scanned++;
      cursor = row.id;
      const cls = classifyBackfillRow(row);
      if (cls === "already_encrypted") { stats.already_encrypted++; continue; }
      if (cls === "malformed") { stats.malformed++; continue; }
      if (cls === "hash_mismatch") { stats.hash_mismatch++; continue; }
      stats.eligible++;
      if (dryRun) continue;

      const rawToken = row.verification_token as string;
      try {
        const enc = await encryptCertificateToken(rawToken);
        const { error: uErr } = await admin
          .from("no_dues_certificates")
          .update({
            verification_token_ciphertext: enc.ciphertext,
            verification_token_iv: enc.iv,
            verification_token_key_version: enc.keyVersion,
            token_storage_version: 1,
            verification_token: null,
          })
          .eq("id", row.id)
          .is("verification_token_ciphertext", null);
        if (uErr) { stats.failed++; continue; }

        const { data: verify } = await admin
          .from("no_dues_certificates")
          .select("verification_token_ciphertext, verification_token")
          .eq("id", row.id)
          .maybeSingle();
        if (!verify?.verification_token_ciphertext || verify?.verification_token) {
          stats.failed++;
          continue;
        }
        stats.migrated++;
      } catch {
        stats.failed++;
      }
    }

    if (rows.length < batchSize) break;
  }

  console.log("[backfill] result", { dryRun, ...stats });
}

run().catch((e) => { console.error("[backfill] fatal", e?.message ?? "error"); process.exit(1); });

