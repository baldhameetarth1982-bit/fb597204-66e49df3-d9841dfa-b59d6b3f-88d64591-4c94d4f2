import { afterEach, describe, expect, it } from "vitest";
import {
  isStage3DisposableHostAllowed,
  requireStage3RuntimeEnv,
} from "../helpers/stage3-runtime-env";

const names = [
  "ALLOW_SOCIOHUB_LIVE_STAGE3C",
  "ALLOW_SOCIOHUB_LIVE_STAGE3D",
  "SOCIOHUB_TEST_SUPABASE_URL",
  "SOCIOHUB_TEST_SUPABASE_SERVICE_ROLE_KEY",
  "SOCIOHUB_TEST_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
] as const;

afterEach(() => {
  for (const name of names) delete process.env[name];
});

describe("neutral Stage 3 disposable runtime guard", () => {
  it("accepts only explicitly allowed local hosts", () => {
    expect(isStage3DisposableHostAllowed("http://127.0.0.1:54321")).toBe(true);
    expect(isStage3DisposableHostAllowed("http://localhost:54321")).toBe(true);
    expect(isStage3DisposableHostAllowed("https://example.invalid")).toBe(false);
    expect(isStage3DisposableHostAllowed("not-a-url")).toBe(false);
  });

  it("keeps the Stage 3D opt-in independent from Stage 3C", () => {
    process.env.ALLOW_SOCIOHUB_LIVE_STAGE3D = "true";
    process.env.SOCIOHUB_TEST_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SOCIOHUB_TEST_SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-key";
    process.env.SOCIOHUB_TEST_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable-key";

    expect(requireStage3RuntimeEnv("ALLOW_SOCIOHUB_LIVE_STAGE3D", "Stage 3D")).toEqual({
      url: "http://127.0.0.1:54321",
      serviceRoleKey: "synthetic-service-key",
      publishableKey: "synthetic-publishable-key",
    });
    expect(() => requireStage3RuntimeEnv("ALLOW_SOCIOHUB_LIVE_STAGE3C", "Stage 3C")).toThrow(
      /ALLOW_SOCIOHUB_LIVE_STAGE3C=true/,
    );
  });

  it("rejects a shared or non-disposable target", () => {
    process.env.ALLOW_SOCIOHUB_LIVE_STAGE3D = "true";
    process.env.SOCIOHUB_TEST_SUPABASE_SERVICE_ROLE_KEY = "synthetic-service-key";
    process.env.SOCIOHUB_TEST_SUPABASE_PUBLISHABLE_KEY = "synthetic-publishable-key";
    process.env.SOCIOHUB_TEST_SUPABASE_URL = "https://example.invalid";
    expect(() => requireStage3RuntimeEnv("ALLOW_SOCIOHUB_LIVE_STAGE3D", "Stage 3D")).toThrow(
      /non-disposable/,
    );

    process.env.SOCIOHUB_TEST_SUPABASE_URL = "http://localhost:54321";
    process.env.SUPABASE_URL = "http://localhost:54321";
    expect(() => requireStage3RuntimeEnv("ALLOW_SOCIOHUB_LIVE_STAGE3D", "Stage 3D")).toThrow(
      /shared SUPABASE_URL/,
    );
  });
});