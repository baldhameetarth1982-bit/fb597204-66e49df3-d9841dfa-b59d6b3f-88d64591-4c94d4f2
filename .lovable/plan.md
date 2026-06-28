## Why you keep landing on Plan Required

The Super Admin grant is working — `admin_grant_society_plan` does flip `plan_status='active'` and sets `plan_expires_at`. The problem is downstream:

- `society_has_access(uuid)` and its helpers (`get_user_society_id`, `is_active_society_plan`, `is_super_admin`, `authorize_membership`) currently have **EXECUTE granted only to `service_role**`, not to `authenticated`.
- When the signed-in user (society admin or resident) hits `/society/plan-required` or `/app/plan-required`, the guard calls `supabase.rpc('society_has_access', …)`. Postgres returns `permission denied for function …`, supabase-js resolves `{ data: null }`, the guard reads `Boolean(null) === false`, and redirects right back to `plan-required`.
- The same error is what you see as the red toast on the Settings page — `get_user_society_id` is called by RLS / a query there and fails identically.

So no amount of granting plans will help until the helper functions are callable.

## Fix (single migration)

Grant EXECUTE on the auth/plan helpers to `authenticated`. They are all `SECURITY DEFINER` and already do their own `auth.uid()` / role checks internally, so this is safe and matches how every other RPC in the project is exposed.

```sql
GRANT EXECUTE ON FUNCTION public.society_has_access(uuid)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_society_id(uuid)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_society_plan(uuid)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_membership(uuid,uuid) TO authenticated;
```

(If `authorize_membership` has a different signature in the DB I'll match the actual one — I'll verify before writing the migration.)

## Verification after migration runs

1. From the granted society admin's session, `supabase.rpc('society_has_access', { _society_id })` must return `true` (not `null`, not an error).
2. `/society/plan-required` auto-redirects to `/society/dashboard` within the 2-second poll already wired in `society.plan-required.tsx`.
3. The red `permission denied for function get_user_society_id` toast disappears from `/settings`.
4. No code changes needed in `_society.tsx`, `_resident.tsx`, or the plan-required screens — they already poll and redirect correctly the moment access returns `true`.

## What I will NOT touch

- No edits to `admin_grant_society_plan` (it's correct).
- No edits to the React guards or polling logic.
- No new RLS policies — only EXECUTE grants on existing helpers.                       first check my action last 30 minute review what happen than fix 