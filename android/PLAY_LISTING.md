# Google Play listing copy (Stage 18)

Source of truth: `src/config/brand.ts`, `android/twa-manifest.json`. Do not add ratings, user counts, awards, certifications or approvals.

- App name (30): SociyoHub: Society Management  (29 chars; plain "SociyoHub" is the fallback)
- Package: live.sociohub.app
- Category: Business (alternative: Productivity)
- Short description (80): Apartment & society management: maintenance bills, notices, visitors, helpdesk.
- Full description:

  SociyoHub is a society management app for Indian apartment and residential societies. It brings maintenance billing, society accounts, notices, complaints and visitor management into one place for the committee, residents and security staff.

  For committees: create maintenance bills, record Cash and Bank Transfer payments, verify or reverse entries with written reasons, track society accounts and expenses, share notices, handle help-desk complaints and manage residents, blocks and flats.
  For residents: view maintenance bills and payment history, read notices, raise complaints and requests, and pre-approve visitors.
  For security guards: log visitors at the gate.

  Each society's data is kept separate. Online maintenance payment is not offered in the app.

  SociyoHub is built by SociyoHub Technologies, co-founded by Meetarth Baldha and Divyaraj Vaghela.

- Website: https://sociohub.live
- Privacy policy: https://sociohub.live/privacy
- Account/data deletion: https://sociohub.live/gdpr
- Support email: support@sociohub.live

## Wording rules
- Each search term (society management, apartment, maintenance, visitors, complaints) appears naturally, not repeated.
- No ranking, rating, user-count or "best/#1" claims.

## Owner-only Play Console steps
1. Paste the copy above; pick category and contact details.
2. Upload screenshots and feature graphic made from the real app (no generated mock claims).
3. Complete Data safety, content rating and target audience forms truthfully.
4. After Play App Signing, set ANDROID_SHA256_CERT_FINGERPRINTS so `/.well-known/assetlinks.json` verifies App Links.
5. The web manifest already lists `live.sociohub.app` under related_applications; it resolves once the listing is published.
