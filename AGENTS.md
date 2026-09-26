# Architecture rules

- Shared visual foundations belong in `src/styles.css` and existing design-system components; this keeps every role coherent without duplicating UI systems.
- Sora is the heading face and Manrope is the interface/body face; both are loaded in the root document head to avoid CSS import failures.
- Motion is brief, functional, transform/opacity based, and must respect reduced-motion preferences.
- Security integration fixtures use deterministic synthetic Society A/B adapters around production services; this avoids production data and keeps tests repeatable without Docker.