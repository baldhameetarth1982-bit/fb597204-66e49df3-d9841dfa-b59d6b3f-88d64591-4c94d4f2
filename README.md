# SocioHub

A housing-society management app — notices, billing, visitors, polls, payments
and resident communications. Built on TanStack Start, React 19, Tailwind v4
and Lovable Cloud (Supabase).

## Local setup

```bash
cp .env.example .env       # then fill in real values
bun install
bun dev
```

The app starts on `http://localhost:8080`.

## Environment variables

See [`.env.example`](./.env.example) for the full list. Quick reference:

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` | Browser Supabase client (publishable key — safe in bundle). |
| `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` | Server-side mirrors for `createServerFn`. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only.** Managed by Lovable Cloud — do not commit. |
| `VITE_FIREBASE_*` | Push notifications + phone OTP. |
| `VITE_GA_MEASUREMENT_ID` / `VITE_META_PIXEL_ID` | Optional analytics. |
| `VITE_SENTRY_DSN` | Optional error monitoring. |

## Security model

- **Auth**: Supabase email/password, Google OAuth (via Lovable broker) and
  phone OTP through Firebase.
- **Authorization**: every protected route lives under
  `src/routes/_authenticated/` (managed gate); `/admin/*` additionally checks
  `super_admin` role; role storage is in the separate `user_roles` table.
- **RLS**: enabled on every public-schema table. Service-role usage is limited
  to verified webhooks and admin maintenance jobs.
- **Secrets**: never commit `.env`. Runtime secrets (Razorpay, Firebase admin,
  etc.) are added through the Lovable Cloud secret manager and read inside
  server-function handlers.
- **Privacy**: see [`/privacy`](./src/routes/privacy.tsx) and
  [`/gdpr`](./src/routes/gdpr.tsx) for the user-facing policies. Account
  deletion is exposed in Settings → More.

## Accessibility

- Base font 16px with 48px tap targets.
- Accessibility Mode toggle (Settings → Appearance) bumps to 18px, looser
  line-height and larger focus rings — designed for elderly residents.
- All interactive elements expose `:focus-visible` outlines.

## Project structure

- `src/routes/` — file-based routes (TanStack Start). Server routes under
  `src/routes/api/`.
- `src/lib/*.functions.ts` — server functions called from the client.
- `src/integrations/supabase/` — auto-generated Supabase clients; do not edit.
- `supabase/migrations/` — database schema.
