# SociyoHub Router Evaluation

Synthetic evaluation of `sociyohub-ceo-orchestrator` routing decisions against 15 representative requests. No application code, database, authentication, payments, or production data were touched during this evaluation. This is a router-only check.

Legend:

- **Class** — QUICK / NORMAL / HIGH-RISK / RELEASE.
- **Selected** — specialists the CEO would route to under section 2 of the CEO skill (in addition to the CEO itself).
- **Rejected** — plausible but unnecessary specialists deliberately not selected, with the reason.
- **Result** — pass / fail against the expectation in the source request.

---

## 1. Change one button label

- **Class**: QUICK.
- **Selected**: CEO only.
- **Rejected**: `sociyohub-premium-ui` (no reusable-component or a11y risk), `sociyohub-testing-e2e` (a label change of a rendered string doesn't warrant a new browser test).
- **Reason**: pure copy edit, 1 file, no risk axis engaged.
- **Result**: pass.

## 2. Fix mobile spacing on a card

- **Class**: QUICK (edge to NORMAL if the card is a reusable primitive).
- **Selected**: CEO only for a one-off page; if the card is a shared component reused across screens, promote to NORMAL and select `sociyohub-premium-ui`.
- **Rejected**: `sociyohub-performance-engine` (spacing does not affect metrics), `sociyohub-testing-e2e` (Playwright not required for a single Tailwind class change).
- **Reason**: token/spacing correction; escalate only when the surface is shared.
- **Result**: pass.

## 3. Create a reusable admin table

- **Class**: NORMAL.
- **Selected**: `sociyohub-premium-ui`.
- **Rejected**: `sociyohub-feature-architecture` (single reusable component, not a new feature domain), `sociyohub-testing-e2e` (unit + Testing Library sufficient at this scope), `sociyohub-performance-engine` (no measured perf goal yet).
- **Reason**: reusable UI surface with a11y, tokens, keyboard, responsive concerns.
- **Result**: pass.

## 4. Reduce dashboard loading time

- **Class**: NORMAL.
- **Selected**: `sociyohub-performance-engine`.
- **Rejected**: `sociyohub-premium-ui` (no visual redesign asked), `sociyohub-feature-architecture` (not a restructure).
- **Reason**: measured performance work with baseline + after-measurement.
- **Result**: pass.

## 5. Simplify an over-generated form

- **Class**: NORMAL.
- **Selected**: `sociyohub-code-simplifier` (scoped to changed files and direct orphan chain).
- **Rejected**: `sociyohub-feature-architecture` (no structural move), `sociyohub-risk-based-tdd` (no risky behaviour change; use existing tests to protect behaviour).
- **Reason**: behaviour-preserving cleanup only.
- **Result**: pass.

## 6. Add a new feature domain structure

- **Class**: NORMAL.
- **Selected**: `sociyohub-feature-architecture`.
- **Rejected**: `sociyohub-premium-ui` (not the primary concern; UI comes later), `sociyohub-code-simplifier` (do not simplify new code that has no baseline).
- **Reason**: predictable UI/schema/API/hooks/types/tests locations and public interfaces.
- **Result**: pass.

## 7. Fix an unexplained failed build

- **Class**: NORMAL (may escalate to HIGH-RISK if the root cause is auth, RLS or payment).
- **Selected**: `sociyohub-systematic-debugging`; `sociyohub-verification-gate` before completion (CEO + 2 allowed because verification-gate is a gate, not additional depth).
- **Rejected**: `sociyohub-risk-based-tdd` (only if a risky behaviour is uncovered), `sociyohub-feature-architecture` (no restructure yet).
- **Reason**: reproduce, earliest incorrect state, fresh evidence before completion claim.
- **Result**: pass.

## 8. Add a plan-entitlement business rule

- **Class**: HIGH-RISK.
- **Selected**: `sociyohub-risk-based-tdd` + `sociyohub-security-guardian`.
- **Rejected**: `sociyohub-payment-integrity` (only if the rule actually gates a money path), `sociyohub-feature-architecture` (only if a new feature domain is introduced).
- **Reason**: plan entitlement is a risk axis; server-side gate + negative tests + cross-society isolation.
- **Result**: pass.

## 9. Fix cross-society data access

- **Class**: HIGH-RISK.
- **Selected**: `sociyohub-security-guardian` + `sociyohub-verification-gate` (mandatory).
- **Rejected**: `sociyohub-auth-guardian` (no identity-flow change asked), `sociyohub-feature-architecture` (fix policy, not restructure).
- **Reason**: RLS or authorization defect; requires PostgreSQL role tests.
- **Result**: pass.

## 10. Change Firebase-to-Supabase session exchange

- **Class**: HIGH-RISK.
- **Selected**: `sociyohub-auth-guardian` + `sociyohub-security-guardian`.
- **Rejected**: `sociyohub-payment-integrity` (unless money paths are directly involved), `sociyohub-testing-e2e` (invoked implicitly through verification, not as a second-depth specialist).
- **Reason**: identity exchange is HIGH-RISK; preserve trusted-server verification and session mapping.
- **Result**: pass.

## 11. Add Razorpay subscription webhook

- **Class**: HIGH-RISK.
- **Selected**: `sociyohub-payment-integrity` + `sociyohub-security-guardian`.
- **Rejected**: `sociyohub-feature-architecture` (single endpoint), `sociyohub-premium-ui` (no UI surface).
- **Reason**: signature verification, idempotency, out-of-order handling, state-machine correctness.
- **Result**: pass.

## 12. Draft privacy policy

- **Class**: NORMAL.
- **Selected**: `sociyohub-legal-privacy`.
- **Rejected**: `sociyohub-security-guardian` (no code path change), `sociyohub-premium-ui` (page layout is secondary to content).
- **Reason**: versioned draft pending legal review; content-first.
- **Result**: pass.

## 13. Add source-grounded AI Secretary response

- **Class**: HIGH-RISK.
- **Selected**: `sociyohub-ai-knowledge-engine` + `sociyohub-security-guardian`.
- **Rejected**: `sociyohub-premium-ui` (UI is downstream), `sociyohub-performance-engine` (no measured perf goal set), `sociyohub-legal-privacy` (unless disclosure text needs updating).
- **Reason**: permission-scoped retrieval, citations, prompt-injection resistance, no cross-society leak.
- **Result**: pass.

## 14. Run role-based browser flows

- **Class**: NORMAL.
- **Selected**: `sociyohub-testing-e2e`.
- **Rejected**: `sociyohub-verification-gate` (as a follow-up, not the primary specialist), `sociyohub-security-guardian` (unless a new authorization surface is added).
- **Reason**: Playwright role-based flows against local preview with synthetic fixtures.
- **Result**: pass.

## 15. Close a roadmap stage

- **Class**: RELEASE.
- **Selected**: `sociyohub-release-readiness` + `sociyohub-verification-gate` + at most one domain specialist relevant to what actually shipped in the stage.
- **Rejected**: everything else — a release audit does not redesign features.
- **Reason**: full evidence matrix required (security, RLS, tests, secrets, deps, build, perf, a11y, responsive, backups).
- **Result**: pass.

---

## Summary

- Cases evaluated: 15.
- Passing: 15.
- Failing: 0.
- Skill ceilings observed: QUICK ≤ CEO only; NORMAL ≤ CEO + 1; HIGH-RISK ≤ CEO + 2; RELEASE ≤ CEO + `sociyohub-release-readiness` + up to 2 others. `sociyohub-verification-gate` is treated as a completion gate that may attach to HIGH-RISK and RELEASE work without breaking the ceiling.
- Permanent SociyoHub rules referenced by every high-risk routing decision: Firebase→Supabase exchange, strict RLS, multi-tenant isolation, protected society untouched, payment scope limited to Razorpay SaaS + Cash/Bank Transfer + approved offline non-member income.
- Protected society protected society (`1907a918-c4b8-4f43-a837-450530cc7c34`) was **not** queried, seeded, mutated, probed, or referenced as a fixture during this evaluation.
- No application source, database, migration, RLS policy, dependency, or environment variable was modified by this evaluation.

This document evaluates routing decisions only; it does not assert any runtime behaviour of the SociyoHub application.
