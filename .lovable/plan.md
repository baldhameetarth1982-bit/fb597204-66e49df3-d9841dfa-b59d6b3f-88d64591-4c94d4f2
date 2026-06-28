## Why residents see ₹0 even after Bill Studio runs

Bills in Postgres are tied to a **flat** (`bills.flat_id`). The resident Bills/Dues screens query:

```
bills WHERE society_id = me.society_id AND flat_id IN (my flat_residents.flat_id)
```

I checked your live data: bills exist for 3 flats in society `1907a9…cc34`, but the two residents in that society (`baldhameetarth1982@gmail.com`, `baldhasharmila85@gmail.com`) have **no row in `flat_residents**` — they joined via invite code, which links them to the society but not to any specific flat. So the `IN (...)` list is empty → 0 bills shown. This is data, not a query bug.

There are also **no pending `join_requests**`, meaning nobody ever picked a flat for them.

## Fix (3 parts, one update)

### 1. Admin → "Residents" linker (primary fix)

On `society.residents.tsx` (or Bill Studio's flat drawer), add an **"Assign resident"** action per flat:

- Searchable dropdown of unassigned residents in the society
- Pick relationship (owner / tenant / family) + primary toggle
- Inserts into `public.flat_residents` via a new SECURITY DEFINER RPC `admin_assign_resident_to_flat(_flat_id, _user_id, _relationship, _is_primary)` that verifies caller is `is_society_admin_for(society)` and the resident's `profiles.society_id` matches.
- Also surface an "Unassigned residents" banner on the Residents page count so the admin notices.

### 2. Resident → "Claim my flat" prompt

On `app.bills.tsx` and `app.dashboard.tsx`, when `flat_residents` is empty for the user, replace the empty state with a card:

- "You're not linked to a flat yet — pick yours to start receiving bills."
- Button opens a sheet using existing `list_society_flats_public` + `request_join_flat` RPC (already in DB).
- Admin approves from existing `society.approvals.tsx` (already wired to `respond_join_request`, which inserts `flat_residents`).

### 3. One-shot backfill for existing societies

Migration helper RPC `admin_backfill_link_resident(_user_id, _flat_id)` — same as #1 but callable from a tiny "Link to flat" button next to each orphan resident in the admin Residents list, so your current two residents can be linked in 2 clicks without going through the request/approve loop.

## Files touched

- New migration: `admin_assign_resident_to_flat` RPC + grants
- `src/routes/_society/society.residents.tsx` — assign action + orphan badge
- `src/routes/_society/society.bill-studio.tsx` — show orphan count warning before generating
- `src/routes/_resident/app.bills.tsx` and `app.dues.tsx` — empty-state → claim flat sheet
- `src/routes/_resident/app.dashboard.tsx` — banner when unlinked
- New component: `src/components/resident/ClaimFlatSheet.tsx`

## What I'm NOT changing

- Bill generation logic (already correct — per flat)
- RLS on `bills` (residents already have read access for their flat)
- Existing `request_join_flat` / `respond_join_request` flow

Approve and I'll ship all of this in one build.

i am uploading my own resident website maded with lovable it has exel file upload option to put every single resident if someone not using app society admin can still keep accounts and review that website and put stuff which we do not have because in my thinking that society is more good and easy to use our has more feature but main feature is not that good