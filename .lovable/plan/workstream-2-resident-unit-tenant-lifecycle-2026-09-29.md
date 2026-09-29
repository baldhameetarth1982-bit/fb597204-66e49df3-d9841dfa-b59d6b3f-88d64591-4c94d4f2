# Workstream 2 — Resident, Unit & Tenant Lifecycle

Extends what already exists (lease dates, access expiry, expiring-tenancy list, daily expiry job, Flat 360, No-Dues). No new resident, tenancy, notification or dues system.

## What gets built

1. **Tenancy lifecycle states**: invited, active, expiring, expired, terminated, moved out, archived. The state is worked out from the stored dates and records. Admins can never just type a state in.
2. **Admin actions** (each checked on the server, logged in the activity history, and limited to the admin's own society):
   - Renew or extend a lease
   - Give notice or end a lease early
   - Move in (assign to a home)
   - Move out: checks the existing No-Dues status first. If dues are outstanding, the move-out is blocked and the admin sees why. An admin override needs a written reason.
   - Archive old records
3. **Renewal warnings**: each society sets how many days ahead to warn (default 30). The existing daily job sends one reminder per tenancy per warning window to the tenant and admins, using the existing notification inbox. Running the job again never sends duplicates.
4. **Automatic expiry**: stays on the existing daily job. Expiry ends access to that home only. Other active homes, including homes in other societies, keep working.
5. **Flat 360**: a new "Occupancy" section showing the current owner, tenant and household members, with lease dates, lifecycle badge, history, and the renew / terminate / move-out actions. Financial, complaint, vehicle, visitor and document sections stay as they are.
6. **Residents page**: filter tabs for Current, Expiring and Expired tenancies.
7. **History is kept**: bills, payments, receipts, audit records, complaints and visitor history are never deleted. Former residents lose future access through the existing access rules.
8. **Elder mode (optional)**: a toggle in the resident's profile that stores a display preference. The existing resident home then shows larger text and buttons, higher contrast and fewer main actions. It is the same pages and navigation, just styled differently.

## Validation
- Typecheck and build.
- Live checks inside a database run that undoes itself in QA Demo Society, using only the existing QA admin and demo user:
  - An expired tenant cannot get access back
  - One society cannot change another society's tenancy
  - A user with homes in more than one society keeps only the homes that are still active
  - A resident cannot create or change tenancies
  - Move-out is blocked while dues are outstanding
  - Running the reminder job twice sends each reminder only once
  - A moved-out user can no longer see the home's data
- The protected society is never touched. No new accounts. The guard account check stays unavailable.

## Technical details
- Migration: add `invited_at`, `archived_at`, `renewed_from` and `move_out_override_reason` to `flat_residents` (all optional). Add `tenancy_warning_days` to `society_settings` (default 30). Add a `tenancy_reminders_sent (flat_resident_id, window_key)` table with a unique key so reminders are sent once. Add an `elder_mode` column to `profiles` (default false).
- SECURITY DEFINER RPCs: `admin_renew_tenancy`, `admin_terminate_tenancy`, `admin_move_out_resident` (calls the existing No-Dues eligibility function) and `admin_archive_tenancy`. Each works out the society from the row, checks `residents.manage` membership, takes a row lock, applies the rate limit and writes an audit entry.
- `get_flat_occupancy(flat_id)` provides the Flat 360 data. `list_tenancies(status)` replaces the calls to `list_expiring_tenancies`.
- `expire_stale_tenancies()` is extended to send reminders through `_notify_user` / `_notify_flat`.
- UI: a new Flat 360 occupancy panel, residents filter tabs, and an elder-mode class on the resident home layout.
