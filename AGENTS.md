# Architecture rules

- Shared visual foundations live in `src/styles.css` and existing design-system components; keeps all roles coherent.
- Sora headings, Manrope body, loaded in the root document head; avoids CSS import failures.
- Motion is brief, transform/opacity only, respects reduced motion.
- Domain/backend rules (finance, billing, gate, governance, AI, payments, exports) live in `src/lib/AGENTS.md`; read it before backend work.
