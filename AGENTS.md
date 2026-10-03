# Architecture rules

- Shared visual foundations live in `src/styles.css` and existing design-system components; keeps all roles coherent.
- Sora headings, Manrope body, loaded in the root document head; avoids CSS import failures.
- Motion is brief, transform/opacity only, respects reduced motion.
- Domain/backend rules (finance, billing, gate, governance, AI, payments, exports) live in `src/lib/AGENTS.md`; read it before backend work.
- Temporary occupants live in temporary_occupants (dated, ≤180 days, ≤10 current per home), written only via add/end_temporary_occupant RPCs with server-resolved home, rate limit and audit; kept separate from family_members so permanent household history stays clean.
