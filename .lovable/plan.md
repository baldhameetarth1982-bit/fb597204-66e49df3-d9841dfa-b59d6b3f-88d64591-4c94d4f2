## What the reference app does well (from your video)

Looking at the radhika-residency site, four ideas stand out that we don't fully have:

1. **Block grid → Flat grid → Flat detail.** Admin clicks a block, sees every flat as a tile with a colored dot ("Account clear" / "Maintenance pending"). Tapping a flat shows resident name, phone, total paid, and a 12-month grid (Paid / Pending / Not Due Yet) plus bill history.
2. **Excel bulk import of flats + residents.** So an admin can onboard the whole society in one shot, even for people who'll never install the app.
3. **Income & Expense Accounts page.** Financial Year / Monthly / Custom Range filter, opening cash + bank, income lines, expense lines, Net Surplus/Deficit, current cash + bank, with Excel / PDF / Print export.
4. **Society By-Laws page.** A static rules document the admin can upload/edit.

We already have residents, billing, expenses, reports (CSV/PDF), notices, complaints — so this is mostly new screens on top of existing tables, not new infrastructure. Video is review-only; not embedded anywhere.

---

## Plan

### 1. Excel / CSV bulk import — `society.import.tsx`

- New page under Society admin: **Residents → Import from Excel**.
- Download a template (`flat_no, block, name, phone, email, status`).
- Drag-and-drop `.xlsx` or `.csv`, parsed in-browser with `xlsx` (SheetJS).
- Preview table with row-level validation (duplicate flat, bad phone, missing block).
- Server fn `bulkImportFlatsAndResidents`: upserts blocks, flats, and optional placeholder profiles (no auth user yet — just "offline residents" the admin can manage manually until they sign up and claim).
- Adds a new column `profiles.is_offline boolean default false` so we can tell app-users from admin-entered shadow records.

### 2. Society Explorer — block grid + flat grid + flat detail

- `**society.explorer.tsx**`: 5-tile block grid (A/B/C/D/E…) mirroring the reference home.
- `**society.explorer.$blockId.tsx**`: grid of flat tiles. Each tile shows flat no. + a dot: green = no dues, amber = pending, red = overdue. Legend at the bottom matches the reference ("Account clear" / "Maintenance pending").
- `**society.explorer.flat.$flatId.tsx**`: header with resident name + phone, big stat ("10 paid / ₹2,000"), a 12-month grid (Paid / Pending / Not Due Yet / Overdue) built from `bills` joined on `period_label`, and below it the bill + payment history. "Mark as paid (cash)" inline for offline collections.

### 3. Income & Expense Accounts — `society.accounts.tsx`

- Top filter chips: **Financial Year** (FY 2025-26, 2026-27…), **Monthly**, **Custom range**.
- Cards: Opening Cash, Opening Bank, Net Surplus/Deficit, Current Cash, Current Bank (derived from a new `society_settings.opening_cash` / `opening_bank` plus all `payments` and `expenses` in range).
- Two tables side-by-side: **Income** (from `payments` grouped by category) and **Expense** (from `expenses` grouped by category).
- Three export buttons: **Excel** (SheetJS), **PDF** (jspdf — already in deps), **Print** (`window.print()` with a print-only stylesheet).
- Add `society_settings.financial_year_start_month int default 4` so April-start FYs work for Indian societies.

### 4. Society By-Laws — `society.bylaws.tsx`

- Admin: rich-text editor (tiptap, already in stack) + optional PDF upload to a new `bylaws` private bucket.
- Resident: read-only view at `app.bylaws.tsx` linked from the home tiles.
- Stored in `society_settings.bylaws_html` + `bylaws_pdf_path`.

### 5. Wiring & polish

- Add **Import from Excel**, **Society Explorer**, **Accounts**, **By-Laws** entries to the society admin drawer.
- Add **By-Laws** tile to the resident home so it matches the reference's information density.
- Keep existing Reports page; Accounts is the FY-style cashbook, Reports stays the operational export.

---

## Technical notes

- Schema migration: `profiles.is_offline`, `society_settings.opening_cash numeric`, `opening_bank numeric`, `financial_year_start_month int`, `bylaws_html text`, `bylaws_pdf_path text`. New private storage bucket `bylaws`.
- Excel parsing: `xlsx` (SheetJS) — pure JS, works in browser and inside the import server fn for validation.
- Server fns: `bulkImportFlatsAndResidents`, `getFlatExplorerSnapshot(blockId)`, `getFlatDetail(flatId)`, `getAccountsRollup(rangeStart, rangeEnd)`. All `requireSupabaseAuth` + `is_society_admin_for` check.
- Status dot logic: a flat is `overdue` if any bill `due_date < now() AND status != paid`, `pending` if any unpaid bill, else `clear`.
- The 12-month grid is rendered from `period_label` matching `'YYYY-MM'`; missing months render as "Not Due Yet" so the layout matches the reference exactly.
- No video assets are imported into the app — review-only as you asked.

---

## Out of scope (call out if you want them added)

- Auto-mapping residents to auth users on signup via phone match (would need a separate claim flow).
- Multi-currency accounts (INR only).
- Editable chart-of-accounts (we'll reuse the existing expense categories + payment types). this is not only feature we need from that video we need some more good feature from that video but that website is perticular for one society so only take feature that good for out app