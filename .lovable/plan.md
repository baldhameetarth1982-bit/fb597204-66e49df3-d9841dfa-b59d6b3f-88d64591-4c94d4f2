# Phase 2 — Authentication, Onboarding & Payment Abstraction

Frontend + minimal backend work to replace the login/onboarding stack. Maintenance, Billing, Accounts, Visitors, Reports, Society Structure and Dashboard are OUT of scope.

---

## 1. Authentication Rebuild

Replace the current email-first login with a mobile-first stack. Order of precedence:

1. **Truecaller One-Tap** (Android WebView / SDK-supported devices) — fetches verified phone; on success we mint a Supabase session server-side.
2. **Phone + OTP** (fallback for all other devices).
3. **Google Sign-In** — allowed only as a convenience; if the Google account has no linked verified phone in `phone_verifications`, force an OTP step before the session is considered "active".

**Removed:** Email + Password. `/_auth/login`, `/_auth/forgot-password`, `/_auth/reset-password` deleted. Existing email users continue to log in via their linked verified phone.

New route: `src/routes/_auth/index.tsx` — single screen with Logo, "Welcome to SocioHub", three buttons (Truecaller shown only if `window.TruecallerSDK` / UA detection succeeds).

Server functions in `src/lib/auth.functions.ts`:

- `startPhoneOtp({ phone })` — rate-limited, Firebase SMS (existing infra).
- `verifyPhoneOtp({ phone, firebaseIdToken })` — verifies Firebase token server-side, upserts `phone_verifications`, links to `auth.users` (creates via Supabase admin if new), returns Supabase session.
- `verifyTruecallerToken({ requestId, accessToken })` — server-side call to Truecaller profile endpoint, same account resolution as above.
- `linkPhoneAfterGoogle({ phone, firebaseIdToken })` — for Google users missing a verified phone.

Guard component `<PhoneVerifiedGate />` wraps `_authenticated` layout: if session exists but no row in `phone_verifications`, redirect to `/auth/verify-phone`.

Session persistence unchanged (Supabase localStorage), so reinstall + Google/Truecaller relogin is instant.

## 2. Route & Guard Hardening (no flash)

`__root.tsx` and `_authenticated` gate must resolve `{ session, phoneVerified, societyId, primaryRole }` **before** any child renders. Implementation:

- Extend `AuthContext` to expose `bootstrapping: boolean` — true until initial `getUser()` + `user_roles` + `phone_verifications` queries settle.
- Root shell renders `<SocioHubLoader />` while `bootstrapping`. No route body mounts until resolved.
- `_auth` layout: if `session && phoneVerified && societyId` → `Navigate` to `ROLE_HOME[role]`.
- `/onboarding/*`: same guard; existing members are redirected in `beforeLoad`, not in-component, to avoid flash.

## 3. Onboarding Redesign

New route `src/routes/onboarding.index.tsx` (rewrite): two large gradient cards — **Create Society** / **Join Society**. Progress stepper component added to `src/components/system/OnboardingStepper.tsx` (1/4 → 4/4).

### 3a. Create Society (`/onboarding/create` rewrite)

Single-form: Society Logo (optional, Supabase Storage), Society Name, Registration Number (optional), Full Address, State, City, PIN Code, Creator Name (prefilled), Creator Mobile (prefilled read-only from verified phone). Aadhaar + captcha blocks REMOVED. Idempotency key on submit prevents double-tap duplicate societies.

After save → `/onboarding/plan` (pricing) → payment → **Society Structure Wizard placeholder** at `/society/setup` (existing) — no wizard changes in this phase.

### 3b. Join Society (`/onboarding/join` rewrite)

New workflow, one screen per step:

1. **Search** — by name or city; server function `searchSocieties({ q })` returns `{ id, name, city, state, logo_url }`. Debounced query, cards list.
2. **Enter Society Code** — 6-digit code; `verifySocietyCode({ societyId, code })` server function; wrong code → toast, cannot advance.
3. **Basic Details** — Full Name, Flat Number, Owner/Tenant toggle, verified mobile (read-only).
4. **Submit** → creates `join_requests` row (unique index on `(user_id, society_id) WHERE status='pending'` — already needed, add migration if missing).
5. **Waiting screen** (`/onboarding/pending`) — refresh + logout buttons, existing.

Single-society rule enforced server-side: `create_society_for_current_user` and `submit_join_request` both check the user has no active society membership.

## 4. Society Code

Reuses the existing `societies.invite_code` column (already 6-digit). Add a "Regenerate Code" action on `/society/settings` (or business-profile) — server function `regenerate_society_invite_code` gated by `has_role(auth.uid(), 'society_admin')`.

## 5. Pricing Engine (dynamic)

New tables (migration):

- `pricing_config` — singleton row managed by super admin: `enterprise_threshold_units int`, `trial_days int`, per-module rates for Custom.
- `plan_prices` — existing? extend with `plan_key`, `billing_cycle`, `price_inr`, `active`. Editable from `/admin/plans`.

Server function `getApplicablePlans({ totalUnits })`:

- If `totalUnits > enterprise_threshold_units` → return `{ tier: 'enterprise', contactOnly: true }`.
- Else → return `[trial, basic, pro, premium, custom(moduleCatalog)]` with live prices.

`/onboarding/plan` route rewritten to consume this; no hardcoded prices.

`/pricing` public route redesigned: mobile-first, light/dark polished, trial hero band, custom plan module picker with live totals, enterprise CTA card. **Resident plan removed** everywhere.

## 6. One-Time, Server-Controlled Trial

Add column `societies.trial_consumed_at timestamptz`. Server function `startTrial({ societyId })`:

- Rejects if `trial_consumed_at IS NOT NULL`.
- Sets `trial_consumed_at = now()`, creates `subscriptions` row with `status='trial'`, `trial_ends_at = now() + interval '{trial_days} days'`.

Access enforcement moved to a single server function `getSocietyAccessStatus()` used by `_society` and `_resident` guards:

- `active | trial | trial_expired | past_due | canceled`.
- On `trial_expired` / `past_due`: admin sees only `/society/plan-required` + `/checkout/*`; residents see `/app/plan-required`. Client cannot bypass — RLS on maintenance/bills/etc. gates via `has_active_subscription(society_id)` (already exists or add helper).

## 7. Payment Gateway Abstraction

New folder `src/lib/payments/`:

```
payments/
  types.ts              // PaymentIntent, PaymentResult, SubscriptionPlan, Webhook types
  gateway.interface.ts  // interface PaymentGateway { createSubscription, cancel, verifyWebhook, ... }
  payu.adapter.ts
  cashfree.adapter.ts
  index.ts              // getGateway(name) factory, reads env PAYMENT_GATEWAY
```

- Onboarding checkout calls `gateway.createSubscription({ planId, societyId, customer })` — returns a redirect URL or hosted-checkout token. UI is gateway-agnostic.
- Webhook route `src/routes/api/public/hooks/payments.$gateway.ts` dispatches to the adapter's `verifyWebhook` + `handleEvent`. Existing `razorpay.ts` webhook kept read-only for legacy rows; new subscriptions go through the abstraction.
- Recurring/AutoPay mandate handled per-adapter (PayU: SI, Cashfree: Subscriptions API).
- Env: `PAYMENT_GATEWAY=payu|cashfree`, plus provider keys via `add_secret`.

Post-payment success page shows: monthly charge, next billing date, "Cancel anytime" link, then routes to `/society/setup`.

## 8. Admin Approvals — Bulk Actions

Update `/society/approvals`:

- Checkbox per row + header "select all".
- Buttons: **Approve**, **Reject**, **Approve Selected**, **Approve All**.
- New server function `bulkApproveJoinRequests({ ids | all: true, societyId })` — batches, respects `has_role`.

## 9. Cleanup / Deletions

- Remove: `src/routes/_auth/login.tsx`, `forgot-password.tsx`, `reset-password.tsx`, resident subscription plan entries in seed & `/admin/plans` UI, Aadhaar block in create-society, all hardcoded plan arrays.
- Keep AuthContext, Supabase client, RLS, existing dashboards untouched.

## 10. Technical Details

**New/edited routes**

- `src/routes/_auth/index.tsx` (new unified login), `_auth/verify-phone.tsx` (new).
- `src/routes/onboarding.index.tsx`, `onboarding.create.tsx`, `onboarding.join.tsx`, `onboarding.plan.tsx`, `onboarding.pending.tsx` — rewritten.
- `src/routes/checkout.$planId.tsx` — gateway-agnostic.
- `src/routes/pricing.tsx` — redesign.
- `src/routes/api/public/hooks/payments.$gateway.ts` — new.

**New server functions** in `src/lib/`:

- `auth.functions.ts`, `societies.functions.ts` (search + code verify + regenerate), `join-requests.functions.ts` (submit + bulk approve), `pricing.functions.ts`, `subscription.functions.ts` (trial + access status).

**New components**

- `src/components/system/OnboardingStepper.tsx`
- `src/components/auth/TruecallerButton.tsx`, `PhoneOtpForm.tsx`, `GoogleButton.tsx`
- `src/components/payments/GatewayCheckout.tsx`

**Migrations** (`supabase/migrations/…`)

- `pricing_config` table + seed row.
- `plan_prices` extension (module pricing json).
- `societies.trial_consumed_at`.
- Unique partial index on `join_requests(user_id, society_id) WHERE status='pending'`.
- `regenerate_society_invite_code`, `submit_join_request`, `bulk_approve_join_requests`, `get_society_access_status`, `start_trial` SQL functions with `SECURITY DEFINER` + role checks.
- GRANTs + RLS policies for every new table.

**Untouched:** Maintenance, Billing, Accounts, Visitors, Reports, Society Structure Wizard, Dashboard pages and their RLS.

---

## Open questions before build

1. **Truecaller SDK** — the app is a web PWA. Truecaller One-Tap is Android-native SDK only; on the web the closest is Truecaller OAuth (redirect flow). Confirm: (a) treat Truecaller as a native-shell-only feature (hidden on web, shown only if you later wrap in Capacitor), or (b) implement Truecaller OAuth web redirect now? - Implement Truecaller OAuth for now because SocioHub is currently a PWA/web application. Keep the authentication architecture abstracted so that when we later release Android and iOS apps using Capacitor or native wrappers, the authentication provider can automatically switch to the native Truecaller SDK without changing the rest of the authentication flow. The login UI should not change between implementations.
2. **Payment gateway** — do you already have PayU + Cashfree merchant accounts / API keys ready to add via secrets, or should I stub both adapters behind a feature flag until keys are provided? - Implement the complete Payment Gateway Abstraction Layer now, but keep both PayU and Cashfree adapters behind feature flags until API credentials are provided. The onboarding, subscription engine and pricing engine must already use the abstraction layer instead of directly calling any gateway. This ensures we only need to add secrets later without changing business logic.
3. **Firebase Phone Auth** billing — current OTP flow uses Firebase. Keep Firebase, or switch to a cheaper SMS provider (MSG91 / Twilio Verify) as part of this phase? - Keep Firebase Phone Authentication for now because it is already integrated and stable. The OTP provider should also be abstracted behind an Authentication Service interface so we can migrate to MSG91, Twilio Verify or another provider later without changing onboarding, login or verification workflows. Do not migrate providers during this phase.                                                                                                                      Account Recovery
  Every account is permanently linked to its verified phone number.
  If the user reinstalls the app or changes devices:
  - Logging in with the same verified phone number or linked Google account should restore the same account.
  - No duplicate account should ever be created for the same verified phone.
  - Account identity must always resolve on the server before creating a new user.
  ---
  ## Session Recovery
  When the app starts:
  1. Check existing Supabase session.
  2. If no valid session exists:
    - Try Truecaller (when available).
    - Otherwise prompt for Phone OTP or Google Sign-In.
  3. Never create duplicate users because of repeated login attempts.
  ---
  # Another Addition
  In your plan, this part says:
  > `pricing_config` singleton.
  I recommend changing that.
  Instead of:
  ```

  ```
  ```
  pricing_config
  ```
  Make it:
  ```

  ```
  ```
  pricing_settings
  ```
  Because you're going to store much more than prices there:
  -   
  Unit threshold  

  -   
  Trial days  

  -   
  Enterprise settings  

  -   
  Custom module prices  

  -   
  Taxes (future)  

  -   
  Promotional pricing  

  -   
  Discounts  

  -   
  Feature toggles  

  `pricing_settings` is a more future-proof name.
  ---
  # One more recommendation
  Under:
  > Society Code
  Add:
  > **The Society Code should be configurable by the Society Admin. They should be able to regenerate it, manually customize it (subject to uniqueness rules), temporarily disable joining through the code, and view the current active code from Society Settings.**