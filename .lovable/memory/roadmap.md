---
name: Phase Roadmap
description: Ordered six-phase rebuild plan with the scope of each phase
type: feature
---
Phase 1 — DONE. Mobile shell primitives (`MobileScreen`, `MobileTopBar`), society drawer, FAB, splash hydration fix.
Phase 2 — Auth (Phone OTP primary, Google with mandatory phone verify) + Onboarding rewrite (Create Society / Join Society only). Join flow lands on Pending Approval screen.
Phase 3 — Society Setup Wizard (Society Info → Structure Type/Count → Maintenance Policy → Accounts opening balances → Finish). Excel import path for hierarchy. `society_settings`, `custom_fields`, `custom_field_values` tables. Opening balances locked after wizard.
Phase 4 — Maintenance Engine + Billing Engine (independent). `maintenance_periods` table, `bill_line_items`. Admin-only bill generation. Quick actions: WhatsApp/PNG/PDF/Print. Immutable bills, cancel-and-reissue.
Phase 5 — Accounting (income/expense/adjustment txns, derived balances). Reports with PDF + Excel export. UI says Income/Expenses/Transactions/Reports — never "Ledger".
Phase 6 — Visitors rewrite. `guard_links` (permanent/temporary, single device), expected + frequent visitors, manual walk-in. Admin gets notified on device-conflict.
