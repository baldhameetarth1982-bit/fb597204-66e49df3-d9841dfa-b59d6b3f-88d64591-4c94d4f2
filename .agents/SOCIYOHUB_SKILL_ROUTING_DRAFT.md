# SociyoHub Skill Routing (Draft for future CEO skill)

This draft lists the 15 project-local specialist skills and recommends inputs a future `sociyohub-ceo` routing skill should consider when dispatching a task to one or more of them. The CEO skill itself is not created in this task.

## Overview of specialists

| # | Skill | Primary concern |
|---|---|---|
| 1 | sociyohub-agent-intelligence | Foundation reasoning, planning discipline |
| 2 | sociyohub-systematic-debugging | Diagnose bugs and regressions |
| 3 | sociyohub-verification-gate | Gate completion behind evidence |
| 4 | sociyohub-risk-based-tdd | Test-first for risky behaviour |
| 5 | sociyohub-code-simplifier | Scoped, behaviour-preserving simplification |
| 6 | sociyohub-feature-architecture | Feature-based structure and public interfaces |
| 7 | sociyohub-security-guardian | Authorization, RLS, tenant isolation, secrets |
| 8 | sociyohub-auth-guardian | Firebase → Supabase identity |
| 9 | sociyohub-performance-engine | Measured performance work |
| 10 | sociyohub-premium-ui | Restrained UI, tokens, a11y, motion |
| 11 | sociyohub-payment-integrity | Money, state machines, idempotency, webhooks |
| 12 | sociyohub-legal-privacy | Terms/privacy drafts pending review |
| 13 | sociyohub-ai-knowledge-engine | Grounded AI on society documents |
| 14 | sociyohub-testing-e2e | Vitest / Testing Library / Playwright |
| 15 | sociyohub-release-readiness | Stage/release approval matrix |

## Recommended CEO routing inputs

The CEO skill should look at the incoming task and infer:

1. **Task class** — one of: plan, implement, debug, refactor, test, secure, ui, ai, payment, legal, release, docs.
2. **Surface touched** — one or more of: routes, server functions, migrations, RLS, `SECURITY DEFINER`, plan gates, UI components, uploads, AI pipelines, webhooks, docs.
3. **Risk axis** — one or more of: money, permissions, RLS, plan entitlement, state transitions, validation, identity, cross-society isolation, prompt injection, protected data.
4. **Stage context** — current SociyoHub stage letter and part (e.g. Stage 1D, Part B).
5. **Blast radius** — a single feature, a shared lib, the entire repo, or documentation only.
6. **Evidence required** — static, unit, integration, PostgreSQL role, browser, visual, AI regression, secret scan.

## Routing recommendations

Use these as a starting point:

- **Plan a non-trivial change** → agent-intelligence (always first). Add specialists based on risk axis and surface.
- **Diagnose a bug** → systematic-debugging → then the specialist for the affected surface → verification-gate.
- **Refactor/simplify a specific file** → code-simplifier + risk-based-tdd (if risky) + verification-gate.
- **New feature scaffolding** → agent-intelligence → feature-architecture → domain specialists (auth/security/payment/ai/ui) → testing-e2e → verification-gate.
- **Migration / RLS / `SECURITY DEFINER` change** → security-guardian → risk-based-tdd → testing-e2e (integration + PostgreSQL role tests) → verification-gate.
- **Payment or webhook change** → payment-integrity → security-guardian → testing-e2e → verification-gate.
- **AI feature change** → ai-knowledge-engine → security-guardian (permission leak) → verification-gate.
- **UI-only change** → premium-ui → testing-e2e (Testing Library + responsive) → verification-gate.
- **Performance work** → performance-engine (with baseline + after-measurement) → verification-gate.
- **Auth flow change** → auth-guardian → security-guardian → testing-e2e → verification-gate.
- **Legal/privacy draft** → legal-privacy (always ends as "draft pending review").
- **Stage or deployment approval** → release-readiness (aggregates evidence from all specialists).

## Non-negotiables the CEO must always enforce

Regardless of routing, the CEO skill must preserve:

- Firebase Phone OTP + Google identity; trusted-server verification; Supabase session exchange.
- Strict Supabase RLS on every per-society table; per-command policies + GRANTs; safe `SECURITY DEFINER`.
- No platform fee; Razorpay only for SaaS subscriptions; maintenance Cash + Bank Transfer; approved offline non-member income; society-owned gateway deferred; no Stripe or Paddle.
- Equal co-founders: Meetarth Baldha and Divyaraj Vaghela. No invented CEO/CTO, incorporation, trademark, or certification claims.
- Protected society ([REDACTED-PROTECTED-SOCIETY-ID]) is never queried, seeded, mutated, probed, or used as a fixture.
- Stage naming uses only a Stage number plus A–E; no nested stage names.

## Explicit non-goals of the CEO skill

- It does not implement code.
- It does not add dependencies.
- It does not approve releases directly — release-readiness does.
- It does not draft final legal text — legal-privacy always ends in draft-pending-review.
- It does not override any specialist's stop condition.

## Handoff format the CEO should produce

For each task, the CEO should output:

- Selected specialists in dispatch order.
- Explicit reason for each selection.
- Evidence categories required for closure.
- Any skipped specialists with reasons.

This draft is created for the next prompt to implement.
