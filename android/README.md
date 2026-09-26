# SociyoHub Android (Trusted Web Activity)

SociyoHub ships on Android as a Trusted Web Activity wrapping the production PWA at `https://sociohub.live`.
All auth, RLS, tenant isolation and payments stay on the same server path as web; the Android shell contains no secrets.

## Build (owner machine with JDK 17 + Android SDK)
```
npm i -g @bubblewrap/cli
cd android
bubblewrap init --manifest=https://sociohub.live/manifest.webmanifest   # reuse twa-manifest.json values
bubblewrap build                                                         # produces app-release-bundle.aab
```
Never commit `android.keystore`, `*.jks`, or passwords (ignored in `.gitignore`).

## Owner-provided values
1. Confirm package ID `live.sociohub.app` (permanent after first upload).
2. Upload keystore + Play App Signing enabled; copy the Play App Signing SHA-256.
3. Set server env `ANDROID_PACKAGE_NAME` and `ANDROID_SHA256_CERT_FINGERPRINTS` so `/.well-known/assetlinks.json` verifies the app (otherwise the URL bar shows).
4. Play Console: Data safety form, content rating, store listing, screenshots (capture from the live app), privacy policy URL `https://sociohub.live/privacy`, account deletion URL `https://sociohub.live/gdpr`.

## Permissions
The TWA declares no camera/storage permissions; camera and file pickers are requested by the browser only when the user starts an upload or QR scan. Notifications use the existing Firebase web push path (Android 13+ runtime prompt via notification delegation).
