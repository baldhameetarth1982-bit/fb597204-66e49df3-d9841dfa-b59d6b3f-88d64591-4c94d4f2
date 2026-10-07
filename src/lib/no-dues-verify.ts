/**
 * Public No-Dues certificate verification — pure decision logic.
 *
 * The public route (`/api/public/verify/no-dues/$token`) and the QR code on
 * the certificate both reach this same function, so QR and direct checks use
 * identical rules. All side effects (rate limiting, hashing, database lookup)
 * are injected so the rules can be tested without a database.
 *
 * Contract:
 *   - every request burns the general rate-limit slot first
 *   - malformed or unknown tokens burn the tighter invalid-attempt slot and
 *     return the same generic body (no enumeration signal)
 *   - lookup is ONLY by SHA-256 hash of the presented token
 *   - the response carries only the intended public fields: certificate
 *     number, dates, status, society name/city and unit label
 */

export const NO_DUES_GENERIC_INVALID = {
  valid: false,
  reason: "Invalid or expired certificate",
} as const;

export const NO_DUES_RATE_LIMITED = {
  valid: false,
  reason: "Too many requests. Please try again shortly.",
} as const;

export interface NoDuesCertRow {
  id: string;
  certificate_number: string;
  issued_at: string;
  valid_until: string | null;
  revoked_at: string | null;
  society_id: string;
  flat_id: string;
}

export interface NoDuesVerifyDeps {
  /** Throws (optionally with retryAfterSeconds) when over the limit. */
  checkGeneral: () => Promise<void>;
  checkInvalid: () => Promise<void>;
  hash: (raw: string) => string;
  findByHash: (hash: string) => Promise<NoDuesCertRow | null>;
  loadSociety: (societyId: string) => Promise<{ name: string | null; city: string | null } | null>;
  loadFlat: (flatId: string) => Promise<{ flat_number: string | null } | null>;
  now?: () => number;
}

export type NoDuesVerifyResult =
  | { status: 429; retryAfter: number; body: typeof NO_DUES_RATE_LIMITED }
  | { status: 200; body: typeof NO_DUES_GENERIC_INVALID }
  | {
      status: 200;
      body: {
        valid: boolean;
        status: "active" | "expired" | "revoked";
        certificate_number: string;
        issued_at: string;
        valid_until: string | null;
        society_name: string | null;
        society_city: string | null;
        unit_label: string | null;
      };
    };

export function isWellFormedNoDuesToken(raw: string): boolean {
  return !!raw && raw.length >= 20 && raw.length <= 128 && /^[A-Za-z0-9_-]+$/.test(raw);
}

function retryOf(e: unknown): number {
  return (e as { retryAfterSeconds?: number })?.retryAfterSeconds ?? 60;
}

export async function verifyNoDuesToken(
  rawInput: unknown,
  deps: NoDuesVerifyDeps,
): Promise<NoDuesVerifyResult> {
  try {
    await deps.checkGeneral();
  } catch (e) {
    return { status: 429, retryAfter: retryOf(e), body: NO_DUES_RATE_LIMITED };
  }

  const invalid = async (): Promise<NoDuesVerifyResult> => {
    try {
      await deps.checkInvalid();
    } catch (e) {
      return { status: 429, retryAfter: retryOf(e), body: NO_DUES_RATE_LIMITED };
    }
    return { status: 200, body: NO_DUES_GENERIC_INVALID };
  };

  const raw = String(rawInput ?? "");
  if (!isWellFormedNoDuesToken(raw)) return invalid();

  const cert = await deps.findByHash(deps.hash(raw));
  if (!cert) return invalid();

  const [society, flat] = await Promise.all([
    deps.loadSociety(cert.society_id),
    deps.loadFlat(cert.flat_id),
  ]);

  const now = (deps.now ?? Date.now)();
  const isRevoked = !!cert.revoked_at;
  const isExpired = !!cert.valid_until && new Date(cert.valid_until).getTime() < now;

  return {
    status: 200,
    body: {
      valid: !isRevoked && !isExpired,
      status: isRevoked ? "revoked" : isExpired ? "expired" : "active",
      certificate_number: cert.certificate_number,
      issued_at: cert.issued_at,
      valid_until: cert.valid_until,
      society_name: society?.name ?? null,
      society_city: society?.city ?? null,
      unit_label: flat?.flat_number ?? null,
    },
  };
}
