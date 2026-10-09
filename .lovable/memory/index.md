# Project Memory

## Core
Mobile-first Android-style app. Design at 360–414px; desktop is responsive scale-up. Material 3 — rounded-2xl cards, FAB, bottom sheets, drawer (admin), bottom nav (resident).
Hierarchy is fixed: Society → Structure Type (Blocks/Towers/Wings/Buildings) → Structure → Floors → Flats → Residents. Resident module always sits under this hierarchy.
One resident belongs to ONE society. Resident↔Flat link is permanent until an admin changes it.
Maintenance Engine (months: Paid/Pending/Upcoming/Outstanding) and Billing Engine (Bills: number/date/PDF/PNG/WhatsApp) are INDEPENDENT. A resident can have pending maintenance with no bill.
Auto billing is OFF by default and plan-gated; when on, the 5-day cycle bills only verified-paid homes without a bill that month and reminds due homes (see launch-decisions). Bills are immutable — cancel + reissue if wrong.
Opening cash + bank balances entered ONCE in Setup Wizard, then immutable. Current balances are always derived (opening + income − expenses + adjustments). Corrections use Adjustment Entries.
Accounting Center has 4 pill sections: Income & Expense, Ledger, Maintenance & Billing, Events (owner asked for "Ledger" by name).
RLS, plan-gate, Razorpay, KYC RPCs, audit_log, multi-tenant isolation triggers are working — preserve them; only add to them.
"Complete X" = build it fully end-to-end myself; no test campaigns/CI/runtime loops; security never skipped.

## Preferences
- [Build mode](mem://preferences/build-mode) — Autonomous feature completion rules, UI bar, what not to spend prompts on

## Memories
- [Phase Roadmap](mem://roadmap) — Six-phase rebuild plan (nav shell → auth/onboarding → setup wizard → billing → accounting → visitors)
- [Maintenance & Billing](mem://features/maintenance-billing) — Policy fields, bill workflow, additional charges, quick actions
- [Join Flow](mem://features/join-flow) — Search → select society → pick flat → owner/tenant → admin approval
- [Dynamic Fields](mem://features/dynamic-fields) — Per-society resident profile fields with order, required, visibility rules
- [Visitor Module](mem://features/visitors) — Guard links (permanent/temporary, single-device), expected/frequent visitors, manual walk-in
- [Super Admin Roadmap](mem://features/super-admin) — Societies, users, plans, custom pricing, discounts, lifetime access, revenue, ads, payment analytics
- [Society Dashboard](mem://features/society-dashboard) — Operational tiles (pending maintenance, balances, visitors, approvals, complaints)
- [Launch decisions](mem://features/launch-decisions) — Auto-billing rule, 4 accounting sections, pill tabs, hide test data, premium Indian theme, role shells
