# Finish Stage 13: Isolated Security Integration Closure

## Goal
Close Stage 13 by replacing placeholder coverage with repeatable, synthetic two-society integration tests that exercise real server and database authorization paths without touching production data.

## Implementation
1. **Harden the isolated test boundary**
   - Reuse existing Vitest and live-test conventions where safe.
   - Add a small shared fixture harness that requires explicit opt-in and rejects the configured production backend before any connection or fixture creation.
   - Create deterministic synthetic Society A/B users, roles, blocks, homes, residents, and only the minimum related records required by each test.
   - Make setup and cleanup idempotent and scoped to generated test identifiers.

2. **Replace all 13 Flat 360 placeholders**
   - Exercise the actual Flat 360 service/server/database path.
   - Cover authorized same-society reads, cross-society identifier tampering, block scope, resident/guard denial, plan-gated sections, PII/certificate-secret exclusion, honest error/unsupported states, and serial/structured layouts.
   - Verify distinct data boundaries across residents, family/occupancy, money history, vehicles/parking/visitors, notices/documents, No-Dues/approvals, and AI summary inputs where supported.

3. **Resolve the remaining isolated test groups**
   - Inspect each existing skipped/TODO security integration group.
   - Enable current tests against the same synthetic fixture harness.
   - Update obsolete tests to the current production path without weakening their security assertion.
   - Fix production code only when a test proves a real authorization or isolation defect.

4. **Validate role and tenant isolation**
   - Prove A→A and B→B access succeeds where authorized.
   - Prove A→B and B→A requests fail through normal calls and direct application RPC/server paths.
   - Prove committee/admin, resident, block-admin, and guard boundaries are enforced server-side.

5. **Final closure checks**
   - Run Flat 360 integration tests, resolved isolated groups, XLSX security tests, permission/RLS tests, relevant full tests, typecheck, production build, and client secret scan.
   - Review changed files for production identifiers, secrets, broad policies, service-role exposure, disabled checks, and disguised skips.
   - Keep the documented email/password provider limitation unchanged and do not begin Stage 14.

## Constraints
- Do not edit `src/lib/utils.ts`; its reported line 8 is stale because the file has six lines.
- Never query, seed, copy, inspect, or reference the protected production society or real society/resident/financial data.
- Do not weaken RLS, tenant isolation, server-authoritative permissions, auditability, or financial controls.
- Do not redo verified XLSX work unless these tests expose a regression.
- Do not generate images or perform a broad manual browser campaign.
