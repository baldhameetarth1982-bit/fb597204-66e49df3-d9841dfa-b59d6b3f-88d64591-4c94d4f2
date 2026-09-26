import { createFileRoute } from "@tanstack/react-router";

/**
 * Digital Asset Links for the Android Trusted Web Activity.
 * Values come from server env so no signing fingerprint is fabricated or committed:
 *   ANDROID_SHA256_CERT_FINGERPRINTS comma-separated Play App Signing SHA-256 values
 * Returns an empty list (no verification) until the fingerprint is configured.
 */
const ANDROID_PACKAGE_NAME = "live.sociohub.app";

export const Route = createFileRoute("/.well-known/assetlinks.json")({
  server: {
    handlers: {
      GET: async () => {
        const prints = (process.env.ANDROID_SHA256_CERT_FINGERPRINTS ?? "")
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(s));
        const body =
          prints.length
            ? [
                {
                  relation: ["delegate_permission/common.handle_all_urls"],
                  target: {
                    namespace: "android_app",
                    package_name: ANDROID_PACKAGE_NAME,
                    sha256_cert_fingerprints: prints,
                  },
                },
              ]
            : [];
        return new Response(JSON.stringify(body), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": prints.length ? "public, max-age=3600" : "no-store",
          },
        });
      },
    },
  },
});
