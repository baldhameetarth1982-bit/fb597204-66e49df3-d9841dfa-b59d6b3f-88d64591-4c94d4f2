# Finish Stage 17 security hardening

## Goal
Harden the existing SociyoHub application against the highest-impact remaining abuse paths without changing its product, authentication, tenant, or payment architecture.

## Constraints
- Do not touch `src/lib/utils.ts`; the reported line-8 error is stale.
- Never query, inspect, seed, test against, or modify the protected production society or real society data.
- Preserve Firebase Phone OTP and Google identity → trusted server verification → application session → database access rules.
- Preserve Cash and Bank Transfer for maintenance, Razorpay for SociyoHub subscriptions only, zero platform fees, and append-only financial history.
- Use forward-only database migrations, least privilege, generic public errors, and no new secrets, paid services, test bypasses, or duplicate security systems.
- Do not weaken tests or assertions to make checks pass.

## Implementation
1. **Establish the attack surface and baseline**
   - Map public routes, authentication/session exchange, AI endpoints, uploads/storage, privileged mutations, browser-callable database functions, and audit/payment state transitions.
   - Classify scanner and linter findings as intentional public contracts or verified defects; inspect grants and function bodies before changing access.

2. **Harden public and authentication endpoints**
   - Reuse the atomic database-backed limiter and HMAC subjects for endpoint-specific per-IP and per-account limits.
   - Add bounded, strict request schemas and unknown-field rejection to sensitive endpoints.
   - Add temporary exponential backoff where abuse risk warrants it, while keeping responses generic and avoiding permanent account lockout.
   - Preserve issuer, audience, expiry, provider, and verified-identity checks in the Firebase session exchange; eliminate raw provider/database error disclosure.

3. **Harden database and storage boundaries**
   - Review client-callable `SECURITY DEFINER` functions for fixed search paths, necessary grants, actor-derived authorization, society isolation, plan checks, and non-enumerating failures.
   - Revoke exposure from verified internal-only helpers through a forward-only migration without broadening any policy.
   - Resolve genuine storage exposure only if the asset is not intentionally public; retain intentional public plan/catalog reads with documented narrow projections.

4. **Harden high-risk workflows**
   - Verify upload magic bytes, size, path ownership, private access, and server-derived metadata.
   - Verify AI retrieval is society/role scoped, treats documents as untrusted, limits payloads/tool steps, and cannot disclose cross-society data.
   - Verify webhook signatures, event identity, replay conflicts, atomic/idempotent finalization, and safe logging.
   - Verify financial/admin mutations derive actor, society, totals, plan, state, timestamps, and audit identity on trusted boundaries.

5. **Regression protection and closure**
   - Add focused negative tests for each verified defect, including direct-call, cross-society, wrong-role, malformed-input, replay, and duplicate-request cases where applicable.
   - Simplify only changed code and remove no stable public APIs.
   - Run focused tests, full tests, type checking, production build, database lint/security scans, bundle-secret scan, dependency scan, and diff checks.
   - Report runtime/database behavior as verified only when directly exercised; list unavailable checks and genuine blockers explicitly.

## Technical scope
- Reuse `src/lib/rate-limit.server.ts`, existing authenticated middleware, canonical payment finalizers, existing permission RPCs, and current storage/upload validators.
- Expected changes: a focused set of existing route/server files, regression tests, security documentation, and at most one forward-only migration.
- No new runtime dependency is expected.
- Highest-risk failure to prevent: a public or browser-callable path bypassing actor, society, plan, replay, or state-transition enforcement.

## Completion evidence
- No unresolved verified critical/high-impact gap remains in the inspected Stage 17 boundaries.
- Negative authorization and tenant-isolation tests pass without production fixtures.
- Type check, production build, full applicable test suite, bundle-secret scan, database lint/security scan, and dependency review have fresh recorded outcomes.
- The protected society and all real society data remain untouched.