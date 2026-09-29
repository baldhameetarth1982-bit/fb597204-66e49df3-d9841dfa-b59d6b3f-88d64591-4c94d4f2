# Workstream 3 — Gate, Visitor, Parking & Safety

## What exists today (inspected)
- One visitor record with an enforced status flow (expected → awaiting → approved/denied → inside → exited, plus cancelled/expired). Residents invite and approve; guards log walk-ins, verify pass codes, mark entry/exit.
- Guard screen, resident Visitors screen, admin Visitors screen.
- Vehicles with guard number-plate lookup; parking slots (resident/visitor type) with admin add/archive.
- Emergency screen is phone numbers only — no SOS alert exists yet.
- Shared notification and activity-history systems.

## What will be added (extending the existing records only)

1. **Recurring / frequent visitors** — residents create a regular pass (maid, cook, driver, milkman) with days of week, time window and end date. The guard checks it at each visit. Each visit is a normal visitor entry linked to the pass. Expired or paused passes are refused.
2. **Deliveries, movers, vendors, staff** — added as visitor types on the same record. Movers need admin approval with a date.
3. **Overstay** — each visitor type gets an allowed duration. Anyone still inside past it shows as "Overstayed" for the guard and admin, and the resident gets one notification per visit (checked on a timer, no repeats).
4. **Restricted visitors** — admins keep a list of restricted names/phones with a reason. The guard sees a warning at entry and cannot let the person in without an admin override. Only admins can change the list, and every change is recorded.
5. **Security incidents** — guards and admins can log an incident (type, severity, note, optional linked visitor). Admins can resolve it. An incident never changes dues, residents, leases or permissions.
6. **Override with reason** — a separately recorded "let in anyway" or "force exit" action, for admins and guards only, needing a written reason.
7. **Visitor parking** — guards and admins can assign a free visitor slot to a visitor at entry. It is released automatically when the visitor leaves. Only one active use per slot, with a capacity check. Resident slots stay admin-only. All changes are recorded.
8. **SOS** — a resident "Send SOS" button (hold to confirm) that alerts guards and admins of that society. States: raised → acknowledged → resolved. Duplicate taps are merged, it is rate limited, it has a clear failure message with emergency numbers still showing, and no ads.
9. **Offline guard mode** — only two actions can wait for a connection: logging a walk-in visitor (it arrives as "waiting for approval") and marking a known visitor as exited. Each carries a one-time ID so replays never double up. Both are rechecked on the server when sent, and a visitor who has already changed shows as "Conflict". Everything else (approvals, overrides, restricted list, SOS, parking) is blocked offline with a "Connection required" message. A queue panel shows waiting, sent, failed and conflict items.
10. **Hardware** — number-plate cameras, RFID, barriers and smart locks are shown as "Needs a provider" only. Manual entry stays the fallback.

## Security rules for every new action
Signed-in user, their society worked out on the server, a role check (resident for own home, guard for gate, admin for lists/overrides), the existing status rules, rate limits, one-time IDs where retries are possible, recorded history, and no ads on gate, visitor, SOS or incident screens.

## Validation
Tests roll back afterwards and run in QA Demo Society with existing accounts. Checks cover:
- status changes and pass expiry
- another society's visitor being refused
- the wrong role being refused
- overstay firing once
- restricted-list permissions
- the parking one-active-use rule
- repeated offline sends
- what is blocked offline
- conflicting replays
- SOS permissions and duplicates
- notification and history rows

Where safe, the resident and admin screens are clicked through in the preview. The live guard check stays listed as unavailable, since no guard account will be created. The protected society is never touched.

## Technical details
- One additive migration:
  - `visitors`: `recurring_pass_id`, `override_reason`, `overstay_notified_at`, `client_op_id` (unique per society), `parking_slot_id`
  - new tables `visitor_recurring_passes`, `visitor_restrictions`, `security_incidents`, `sos_alerts`, each with grants, row-level security and a society scope
  - category list extended
- SECURITY DEFINER RPCs: `resident_upsert_recurring_pass`, `guard_checkin_recurring`, `admin_upsert_visitor_restriction`, `gate_override`, `incident_create` / `incident_resolve`, `gate_assign_visitor_parking` (released inside the exit transition), `sos_raise` / `sos_ack` / `sos_resolve`, `guard_offline_replay(op_id, kind, payload)` with an allowlist and conflict result, and `mark_visitor_overstays` on the existing hourly cron.
- Notifications go through `_notify_user` / `_notify_flat`, and history is written to `audit_log`.
- The offline queue lives in guard-device local storage, holding only allowlisted kinds, and is replayed through React Query mutations. Nothing is auto-replayed except the explicit allowlist.
- UI extends `app.guard.tsx`, `app.visitors.tsx`, `app.emergency.tsx`, `society.visitors.tsx` and `society.parking.tsx`. No new visitor or parking pages beyond small sections.
