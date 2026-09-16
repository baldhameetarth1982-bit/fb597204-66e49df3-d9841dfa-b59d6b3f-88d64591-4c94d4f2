# Audit-log contract consistency fix

## Scope

- Keep the existing `audit_log` contract: `actor_id`, `action`, `target_table`, `target_id`, `society_id`, `metadata`, `ip`, `user_agent`, `created_at`.
- Do not add duplicate columns or tables, change payment behavior, access production data, or start Stage 3D.

## Implementation

1. Add one forward corrective migration because the offending migrations are 
2. historical/shared.
3. Correct every currently installed function whose audit insert uses `entity_type`, `entity_id`, or `meta`, mapping them to `target_table`, `target_id`, and `metadata` without changing values, actions, authorization, or transaction flow.
4. Make the repair fail closed if any current stored function still contains a noncanonical audit insert.
5. Add focused source regression tests covering the canonical table schema, complete current-function repair, payment/receipt audit events, and absence of swallowed audit failures.
6. Run migration/static tests, relevant Stage 3C payment tests, typecheck, diff checks, and the fresh disposable migration command if local Docker tooling is available.

## Security review

- Confirm no RLS or grants are widened and no secrets or protected society data are accessed.
- Report the requested related finance risks separately without expanding this fix.
- Keep Stage 3C blocked until the canonical GitHub runtime reports exactly `93 passed, 0 failed, 0 skipped, 0 setup failures, 0 teardown failures`.             APPROVED — EXECUTE THIS PLAN, WITH THESE ADDITIONAL NON-NEGOTIABLE GUARDRAILS.
  Proceed with the surgical audit_log contract repair exactly as planned.
  Add these requirements:
  1. Do not rewrite historical/shared migrations merely for cosmetic cleanup. Preserve migration history unless a surgical change is genuinely required for fresh-install convergence.
  2. Verify BOTH:
     - fresh database from zero
     - upgraded database using the existing migration history
     converge to the same canonical audit_log contract and repaired stored functions.
  3. Static/source validation is not sufficient. In an isolated synthetic database, actually execute every affected audit path, especially payment verify/reject/reverse and receipt create/void where applicable, and prove the audit INSERT succeeds using the canonical columns.
  4. Audit logging must remain fail-closed wherever the existing transaction contract requires it. Do not swallow audit errors, make audit logging optional, or allow a financial/security-sensitive transaction to succeed while its required audit record fails.
  5. Do not widen any RLS policy, GRANT, role permission, or SECURITY DEFINER authority.
  6. Do not modify Stage 3D accounting, ledger, expenses, reports, transparency, pricing, auth, payment behavior, or any unrelated feature.
  7. Do not access production or the protected society.
  After implementation, stop if the FIRST/root validation failure occurs and report it rather than masking it.
  Stage 3C remains BLOCKED until the external canonical GitHub runtime proves exactly:
  93 passed, 0 failed, 0 skipped, 0 setup failures, 0 teardown failures.
  Stage 3D remains NOT STARTED.
  Now execute the approved plan; do not return another planning-only response.