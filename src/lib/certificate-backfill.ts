/**
 * Pure classification logic for the certificate-token backfill.
 *
 * Kept in a shared module so the CLI script AND unit tests exercise the
 * SAME implementation instead of duplicating the rules.
 *
 * No I/O. No environment reads. No crypto that isn't Web-Crypto safe.
 */
import { createHash } from "node:crypto";

export type BackfillRow = {
  id: string;
  verification_token: string | null;
  verification_token_hash: string | null;
  verification_token_ciphertext: string | null;
};

export type BackfillClassification =
  | "already_encrypted"
  | "malformed"
  | "hash_mismatch"
  | "eligible";

const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export function classifyBackfillRow(row: BackfillRow): BackfillClassification {
  if (row.verification_token_ciphertext) return "already_encrypted";
  const t = row.verification_token;
  if (!t || !TOKEN_RE.test(t)) return "malformed";
  if (row.verification_token_hash) {
    const h = createHash("sha256").update(t).digest("hex");
    if (h !== row.verification_token_hash.toLowerCase()) return "hash_mismatch";
  }
  return "eligible";
}

/**
 * In-memory keyset-pagination driver. Extracted for test coverage so the
 * pagination algorithm can be validated without a real database.
 *
 * `fetchBatch(afterId, limit)` must return rows with `id` STRICTLY greater
 * than `afterId` in ascending id order. It must return `[]` when exhausted.
 */
export type BackfillStats = {
  scanned: number;
  already_encrypted: number;
  eligible: number;
  malformed: number;
  hash_mismatch: number;
  processed_ids: string[];
};

export async function runBackfillDryRun(opts: {
  fetchBatch: (afterId: string | null, limit: number) => Promise<BackfillRow[]>;
  batchSize: number;
  maxBatches: number;
}): Promise<BackfillStats> {
  const stats: BackfillStats = {
    scanned: 0,
    already_encrypted: 0,
    eligible: 0,
    malformed: 0,
    hash_mismatch: 0,
    processed_ids: [],
  };
  let cursor: string | null = null;
  for (let b = 0; b < opts.maxBatches; b++) {
    const rows = await opts.fetchBatch(cursor, opts.batchSize);
    if (!rows || rows.length === 0) break;
    for (const row of rows) {
      stats.scanned++;
      stats.processed_ids.push(row.id);
      const c = classifyBackfillRow(row);
      stats[c]++;
      cursor = row.id;
    }
    if (rows.length < opts.batchSize) break;
  }
  return stats;
}
