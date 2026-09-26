import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const manifestPath = resolve(root, "android/twa-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
const failures: string[] = [];

function equal(key: string, expected: unknown) {
  if (manifest[key] !== expected) failures.push(`${key} must be ${JSON.stringify(expected)}`);
}

equal("packageId", "live.sociohub.app");
equal("host", "sociohub.live");
equal("name", "SociyoHub");
equal("launcherName", "SociyoHub");
equal("startUrl", "/?source=twa");
equal("appVersionName", "1.0.0");
equal("appVersionCode", 1);
equal("orientation", "portrait");
equal("fallbackType", "customtabs");
equal("enableNotifications", true);
equal("minSdkVersion", 23);
equal("webManifestUrl", "https://sociohub.live/manifest.webmanifest");

if ("targetSdkVersion" in manifest) failures.push("targetSdkVersion must come from pinned Bubblewrap, not stale manifest metadata");
if (JSON.stringify(manifest.features) !== "{}") failures.push("native feature bridges must remain disabled");

for (const key of ["iconUrl", "maskableIconUrl"]) {
  const value = String(manifest[key] ?? "");
  if (!value.startsWith("https://sociohub.live/icons/")) failures.push(`${key} must use the production origin`);
}

for (const path of ["public/icons/icon-192.png", "public/icons/icon-512.png", "public/icons/maskable-512.png"]) {
  if (statSync(resolve(root, path)).size < 1_000) failures.push(`${path} is missing or unexpectedly small`);
}

const trackedSources = [
  "android/twa-manifest.json",
  "android/README.md",
  "android/release.sh",
  "public/manifest.webmanifest",
  "src/routes/[.well-known]/assetlinks[.]json.ts",
].map((path) => readFileSync(resolve(root, path), "utf8")).join("\n");

for (const forbidden of [/127\.0\.0\.1/, /razorpay_key_secret/i, /BEGIN (RSA |EC )?PRIVATE KEY/]) {
  if (forbidden.test(trackedSources)) failures.push(`release sources contain forbidden pattern ${forbidden}`);
}

const dal = readFileSync(resolve(root, "src/routes/[.well-known]/assetlinks[.]json.ts"), "utf8");
if (!dal.includes('const ANDROID_PACKAGE_NAME = "live.sociohub.app"')) failures.push("assetlinks package is not pinned");
if (!dal.includes('process.env.ANDROID_SHA256_CERT_FINGERPRINTS')) failures.push("assetlinks fingerprint is not server-configured");

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log("Android release configuration verified: live.sociohub.app → https://sociohub.live (signed AAB not built). ");