# Architecture rules

- Shared visual foundations live in `src/styles.css` and existing design-system components; keeps all roles coherent.
- Sora headings, Manrope body, loaded in the root document head; avoids CSS import failures.
- Motion is brief, transform/opacity only, respects reduced motion.
- Domain/backend rules (finance, billing, gate, governance, AI, payments, exports) live in `src/lib/AGENTS.md`; read it before backend work.
- Temporary occupants live in temporary_occupants (dated, ≤180 days, ≤10 current per home), written only via add/end_temporary_occupant RPCs with server-resolved home, rate limit and audit; kept separate from family_members so permanent household history stays clean.
- Income bill + income entry are created together only via create_income_with_bill (wraps the idempotent income RPC and issue_finance_bill in one transaction); printable bills/vouchers read through RLS at /society/document/$id; keeps one income, one bill, one numbering source.
- UI languages: en/hi/gu live in tuple catalogs; every other language is a validated JSON bundle in src/locales/extra/ (generated offline, checked by tests/unit/locale-extra-bundles.test.ts) and only bundles that exist become selectable; rtl direction, script fonts and locale tags come from LANGUAGE_REGISTRY in src/lib/i18n.ts; keeps one localisation system with no runtime AI dependency. Screen files read fixed text with tu(key) and pages re-mount on language change (TransitionedOutlet key), so text outside hooks stays current.
