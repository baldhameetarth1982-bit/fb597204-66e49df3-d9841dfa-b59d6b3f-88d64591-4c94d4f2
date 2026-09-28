# Architecture rules

- Shared visual foundations belong in `src/styles.css` and existing design-system components; this keeps every role coherent without duplicating UI systems.
- Sora is the heading face and Manrope is the interface/body face; both are loaded in the root document head to avoid CSS import failures.
- Motion is brief, functional, transform/opacity based, and must respect reduced-motion preferences.
- Security service integration uses deterministic synthetic Society A/B adapters; Flat 360 role decisions use authenticated self-check RPCs, while only canonical eligibility uses the trusted server client.
- Razorpay SaaS payments use one server-only provider module, atomic request/event/refund records, and canonical database finalizers; maintenance remains Cash and Bank Transfer only to prevent duplicate payment domains.
- Android releases use the pinned Bubblewrap manifest and release script; generated Gradle output and signing material stay outside source control.
- Public ingress uses strict bounded schemas, redacted failures, and the shared atomic HMAC-fingerprinted limiter; this prevents amplification and race-prone local throttles.
- Vulnerable transitive runtime packages are pinned via package.json overrides to in-major patched releases; this fixes advisories without forcing breaking upgrades.
- Scheduler hooks accept CRON_SECRET or the DB-held pg_cron token (verify_scheduler_token); automation config writes go only through admin_set_society_automation, which enforces permission, Premium and audit.
- Society Custom Branding lives in society_branding (strict hex/name/logo-path CHECKs) written only via admin_set/reset_society_branding RPCs (admin + Premium + audit); logos are re-encoded PNGs in the private branding bucket; this keeps branding separate from bill-template logo_url/bill_theme.
- Bank-statement reconciliation stores imported rows in bank_statement_imports/lines as evidence only; the only path to "matched" is the human confirm_bank_line_match RPC, serialised per society by an advisory lock, with a unique index so one record links to one bank line. Never alter payments/receipts/ledger from a bank match.
