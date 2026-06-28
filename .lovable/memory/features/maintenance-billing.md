---
name: Maintenance & Billing
description: Independent maintenance and billing engines, policy fields, bill workflow
type: feature
---
**Maintenance Engine** (operational): tracks per-flat per-month status — Paid, Pending, Upcoming, Outstanding. Pending notifications are the only auto behavior.
**Billing Engine** (financial documents): generates bills with bill_number, bill_date (generation date), due_date (last pay date), maintenance month(s) covered, additional charges, PDF, PNG, WhatsApp, history.
**Independence rule**: a resident can have pending maintenance even when no bill exists. Never derive maintenance status from bill rows.
**Policy** (per society): collection_type (prepaid | current | postpaid), monthly_amount, due_day, grace_days, late_fee.
**Bill generation**: admin only. UI shows resident's pending months + outstanding, admin selects months to include, adds unlimited additional charges (category, description, amount), previews, generates.
**After generation**: quick actions — Send WhatsApp, Download PNG, Download PDF, Print.
**Immutability**: bills cannot be edited. Mistake → cancel bill + generate corrected bill.
