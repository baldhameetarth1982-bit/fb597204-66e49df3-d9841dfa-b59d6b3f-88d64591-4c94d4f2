---
name: Final product-building mode
description: How to handle "Complete [feature]" prompts — build end-to-end autonomously, no test campaigns, security never skipped
type: preference
---
Final product-building phase. Short prompts like "Complete X" mean: inspect existing work, keep what's correct, finish missing pieces across UI/nav/data/backend/DB/permissions/plan/states/mobile/a11y/polish, fix related small issues without asking. Never stop at a plan or analysis.

Do NOT spend prompts on: test campaigns, 93/11-case verification, Stage 3 runtime, GitHub Actions, Docker, manual workflow instructions, report bookkeeping, repetitive migration audits. Only lightweight validation so nothing is left broken.

Security never skipped: auth, Firebase verification, RLS, tenant isolation, server authz, roles, plan entitlements, financial integrity, audit, storage, secrets, rate limits, validation, idempotency, AI boundaries. Never trust client society ID. Fix real security defects found.

UI: real polished production app, navy + teal brand, light surfaces, restrained, mobile-first for real (thumb reach, safe areas, sticky actions, sheets, ₹ amounts). No admin-template look, no gradient/animation excess.

No feature bloat. Reuse existing architecture. Financial rules unchanged (Razorpay SaaS only, Cash + Bank Transfer maintenance, no fees, no false success). Protected society never touched.

Stale TS2322 on src/lib/utils.ts line 8: file has 6 lines, tsgo passes — ignore, don't edit.
