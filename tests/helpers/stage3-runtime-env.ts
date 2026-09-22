export type Stage3RuntimeEnv = {
  url: string;
  serviceRoleKey: string;
  publishableKey: string;
};

export function requireStage3DDatabaseUrl(): string {
  const databaseUrl = process.env.SOCIOHUB_TEST_DATABASE_URL ?? "";
  if (!databaseUrl) {
    throw new Error("Stage 3D live fixtures require SOCIOHUB_TEST_DATABASE_URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Stage 3D database URL is malformed.");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Stage 3D database URL must use PostgreSQL.");
  }
  if (!STAGE3_DISPOSABLE_HOSTS.includes(parsed.hostname.toLowerCase())) {
    throw new Error("Stage 3D refuses a non-disposable database connection.");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === databaseUrl) {
    throw new Error("Stage 3D refuses a database connection matching DATABASE_URL.");
  }
  return databaseUrl;
}

export const STAGE3_DISPOSABLE_HOSTS: readonly string[] = Object.freeze([
  "localhost",
  "127.0.0.1",
  "::1",
  "host.docker.internal",
  "kong",
  "supabase_kong",
  "supabase-kong",
]);

export function isStage3DisposableHostAllowed(url: string): boolean {
  if (typeof url !== "string" || url.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return STAGE3_DISPOSABLE_HOSTS.includes(parsed.hostname.toLowerCase());
}

export function requireStage3RuntimeEnv(
  gateName: "ALLOW_SOCIOHUB_LIVE_STAGE3C" | "ALLOW_SOCIOHUB_LIVE_STAGE3D",
  stageLabel: "Stage 3C" | "Stage 3D",
): Stage3RuntimeEnv {
  if (process.env[gateName] !== "true") {
    throw new Error(`${stageLabel} live fixtures require ${gateName}=true. Refusing to run.`);
  }

  const url = process.env.SOCIOHUB_TEST_SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SOCIOHUB_TEST_SUPABASE_SERVICE_ROLE_KEY ?? "";
  const publishableKey = process.env.SOCIOHUB_TEST_SUPABASE_PUBLISHABLE_KEY ?? "";
  if (!url || !serviceRoleKey || !publishableKey) {
    throw new Error(
      `${stageLabel} fixtures require SOCIOHUB_TEST_SUPABASE_URL / _SERVICE_ROLE_KEY / _PUBLISHABLE_KEY.`,
    );
  }

  const shared = process.env.SUPABASE_URL ?? "";
  if (shared && shared === url) {
    throw new Error(`${stageLabel} fixtures refuse to run against the shared SUPABASE_URL. Use a disposable isolated project.`);
  }
  if (!isStage3DisposableHostAllowed(url)) {
    throw new Error(
      `${stageLabel} fixtures refuse to run against a non-disposable Supabase host. Only local/isolated hostnames are permitted.`,
    );
  }

  return { url, serviceRoleKey, publishableKey };
}