import { createFileRoute } from "@tanstack/react-router";

/**
 * Digital Asset Links for the Android Trusted Web Activity.
 * Values come from server env so no signing fingerprint is fabricated or committed:
 *   ANDROID_PACKAGE_NAME            e.g. live.sociohub.app
 *   ANDROID_SHA256_CERT_FINGERPRINTS comma-separated Play App Signing SHA-256 values
 * Returns an empty list (no verification) until both are configured.
 */
export const Route = createFileRoute("/.well-known/assetlinks.json")({
  server: {
    handlers: {
      GET: async () => {
        const pkg = process.env.ANDROID_PACKAGE_NAME?.trim();
        const prints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS ?? "")
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
        const body =
          pkg && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(pkg) && prints.length
            ? [
                {
                  relation: ["delegate_permission/common.handle_all_urls"],
                  target: { namespace: "android_app", package_name: pkg, sha256_cert_fingerprints: prints },
                },
              ]
            : [];
        return new Response(JSON.stringify(body), {
          headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
        });
      },
    },
  },
});
