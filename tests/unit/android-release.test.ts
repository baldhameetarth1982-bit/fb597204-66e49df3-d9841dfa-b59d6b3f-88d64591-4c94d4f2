import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Stage 15 Android release contract", () => {
  it("pins the production TWA identity and disables native feature bridges", () => {
    const manifest = JSON.parse(read("android/twa-manifest.json"));
    expect(manifest).toMatchObject({
      packageId: "live.sociohub.app",
      host: "sociohub.live",
      startUrl: "/?source=twa",
      appVersionName: "1.0.0",
      appVersionCode: 1,
      fallbackType: "customtabs",
      orientation: "portrait",
      enableNotifications: true,
      features: {},
    });
    expect(manifest).not.toHaveProperty("targetSdkVersion");
  });

  it("keeps App Links fail-closed and pins the application ID", () => {
    const route = read("src/routes/[.well-known]/assetlinks[.]json.ts");
    expect(route).toContain('const ANDROID_PACKAGE_NAME = "live.sociohub.app"');
    expect(route).toContain("ANDROID_SHA256_CERT_FINGERPRINTS");
    expect(route).not.toContain("ANDROID_PACKAGE_NAME?.");
    expect(route).toContain('"no-store"');
  });

  it("requires external signing and a pinned release generator", () => {
    const script = read("android/release.sh");
    const ignore = read("android/.gitignore");
    expect(script).toContain("@bubblewrap/cli@1.25.0");
    expect(script).toContain("BUBBLEWRAP_KEYSTORE_PASSWORD");
    expect(script).toContain("BUBBLEWRAP_KEY_PASSWORD");
    expect(script).not.toContain("keytool -genkey");
    expect(ignore).toContain("/.build/");
    expect(ignore).toContain("*.jks");
  });

  it("preserves the approved payment boundary", () => {
    const handoff = read("android/README.md");
    expect(handoff).toContain("Razorpay is only for SociyoHub SaaS subscriptions");
    expect(handoff).toContain("society maintenance remains Cash or Bank Transfer");
  });
});
describe("Stage 18 app discoverability", () => {
  it("links the web manifest to the Play package and keeps private areas out of search", () => {
    const m = JSON.parse(read("public/manifest.webmanifest"));
    expect(m.related_applications[0]).toMatchObject({ platform: "play", id: "live.sociohub.app" });
    expect(m.prefer_related_applications).toBe(false);
    for (const f of ["_admin", "_society", "_resident", "onboarding"]) {
      expect(read(`src/routes/${f}.tsx`)).toContain("noindex, nofollow");
    }
    const home = read("src/routes/index.tsx");
    expect(home).toContain("structuredDataScript");
    const ld = read("src/lib/structured-data.ts");
    expect(ld).toContain('"SoftwareApplication"');
    expect(ld).toMatch(/operatingSystem: "Web, Android"/);
    expect(home + ld).not.toMatch(/aggregateRating|ratingValue/);
  });
});
