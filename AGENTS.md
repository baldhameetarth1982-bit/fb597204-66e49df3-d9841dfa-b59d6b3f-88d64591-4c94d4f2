# Architecture rules

- Shared visual foundations belong in `src/styles.css` and existing design-system components; this keeps every role coherent without duplicating UI systems.
- Sora is the heading face and Manrope is the interface/body face; both are loaded in the root document head to avoid CSS import failures.
- Motion is brief, functional, transform/opacity based, and must respect reduced-motion preferences.
- Security service integration uses deterministic synthetic Society A/B adapters; Flat 360 role decisions use authenticated self-check RPCs, while only canonical eligibility uses the trusted server client.
- Razorpay SaaS payments use one server-only provider module, atomic request/event/refund records, and canonical database finalizers; maintenance remains Cash and Bank Transfer only to prevent duplicate payment domains.