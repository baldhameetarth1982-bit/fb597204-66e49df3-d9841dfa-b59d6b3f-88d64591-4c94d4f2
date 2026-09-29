# Workstream 4: Operations & Facilities

## What already exists (and will be extended, not duplicated)
- **Helpdesk**: tickets with numbers, category, priority, assignment to a team member, committee approval, resolve/close, and an unchangeable event timeline. Committee queue and resident screens are already built.
- **Team & Roles**: existing logins and permissions. Staff records hang off this; there is no new login system.
- **Vendors**: the finance vendor list (name, category, phone, email, active). Expenses already link to a vendor and post to the ledger.
- **Smart QR**: currently used only for collecting payments. Asset QR codes will get their own non-guessable token field on the asset record, and the public page will show only the asset name and a "report a problem" prompt. No second QR database.
- **Notifications**: the existing notify helpers and notification store.

## 1. Helpdesk additions
- New states: **On hold / waiting** (with a reason), **Escalated** (flag, level and reason), **Reopened** (the resident or committee can reopen within 7 days of resolving; after that it becomes a linked new ticket).
- **SLA targets** per priority (default response and resolution hours, editable in the society's settings). Due times are set by the server; a breach shows as "Overdue".
- **Evidence**: photos or PDFs in a private storage bucket. Only the requester, the assignee and ticket managers can view them (short-lived signed links, with size and type limits).
- **Satisfaction**: a 1–5 rating plus a comment, once per resolved ticket, from the requester only.
- **Repeat issues**: a ticket can link to an asset; the asset shows its history and a "repeat issue" count.
- Every change goes through the existing `helpdesk_admin_update` path (extended). Society, requester and assignee are worked out by the server; allowed status changes are enforced by a database trigger.

## 2. Staff
- A new staff record: name, job type, phone (visible to managers only), active/inactive, an optional linked login, and a shift pattern.
- Attendance and leave: simple daily entries (present, absent, leave, half day) that one manager records, audited.
- Assigned work: tickets can be assigned to a staff member or a team login.

## 3. Vendors
- Extend the existing vendor list with contract/AMC dates, value, notes and a document.
- A vendor page shows linked tickets, linked assets and service history. It also lists linked approved expenses, read-only from Expenses. There is no vendor payment feature.

## 4. Assets and service history
- A new asset record: name, category, location (block or common area), status (active, under repair, retired), purchase/installation date, warranty and AMC end dates, linked vendor, and a QR token.
- Service history entries: date, type (repair, service, AMC visit), linked ticket, vendor, notes, and an optional existing expense ID (reference only).
- The daily job sends one reminder each for upcoming warranty/AMC expiry and SLA breaches, with duplicates prevented.

## 5. Inventory
- Items: name, location, unit, quantity, reorder level, active/inactive.
- Stock changes are recorded one by one with a reason (quantity can't go below zero) and can't be edited afterwards. Items no longer have a money value; any purchases go through Expenses.

## 6. Screens
- The committee **Helpdesk** gets filters for On hold, Escalated, Overdue and Reopened; SLA chips; evidence; an escalate/hold/reopen menu; and staff or vendor assignment.
- A new committee **Operations** area with tabs for Staff, Vendors, Assets and Inventory. It's mobile-first and reuses existing components, linked from the More menu.
- Residents' **Helpdesk** gets evidence upload, rating, reopen and a public status label. Staff and vendor private details are never shown to residents.

## Security
- Every new table is society-scoped, with row-level security plus writes only through server-checked database functions. These check the society and the relevant `helpdesk.manage` / `operations.manage` permission, write an audit row, and apply rate limits.
- Residents can see only their own tickets and evidence. They have no access to staff, vendors, assets or inventory.

## Validation
Rollback-only database checks in QA Demo Society:
- cross-society denial and resident-role denial
- assignment authority, and hold/escalate/reopen changes
- SLA overdue status and one-time notifications
- evidence access
- vendor/asset/expense links, and an asset QR revealing no private data
- inventory not going negative, audit rows, and no duplicate notifications

Then TypeScript/build checks and a preview of the committee screens as the demo account.

## Out of scope
- Vendor payments, a second ledger, stock valuation, hardware, and new login systems.
- Guard/resident live checks, which are limited by the available accounts.

## Technical notes
- New tables: `society_staff`, `staff_attendance`, `society_assets`, `asset_service_log`, `inventory_items`, `inventory_movements`, `ticket_attachments`, `ticket_ratings`.
- New columns: `support_tickets` gets `sla_due_at`, `escalation_level`, `hold_reason`, `asset_id`, `staff_id`, `vendor_id`, `reopened_count`, `parent_ticket_id`. `finance_vendors` gets `contract_start`, `contract_end`, `amc`, `contract_notes`.
- New status values: `on_hold` and `reopened`.
- Scheduling reuses the existing hourly/daily cron hook, with a dedupe table for sent reminders.
