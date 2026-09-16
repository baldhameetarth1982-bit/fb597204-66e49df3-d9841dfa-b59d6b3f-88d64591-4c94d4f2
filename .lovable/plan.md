# Audit-log contract consistency fix

## Scope
- Keep the existing `audit_log` contract: `actor_id`, `action`, `target_table`, `target_id`, `society_id`, `metadata`, `ip`, `user_agent`, `created_at`.
- Do not add duplicate columns or tables, change payment behavior, access production data, or start Stage 3D.

## Implementation
1. Add one forward corrective migration because the offending migrations are historical/shared.
2. Correct every currently installed function whose audit insert uses `entity_type`, `entity_id`, or `meta`, mapping them to `target_table`, `target_id`, and `metadata` without changing values, actions, authorization, or transaction flow.
3. Make the repair fail closed if any current stored function still contains a noncanonical audit insert.
4. Add focused source regression tests covering the canonical table schema, complete current-function repair, payment/receipt audit events, and absence of swallowed audit failures.
5. Run migration/static tests, relevant Stage 3C payment tests, typecheck, diff checks, and the fresh disposable migration command if local Docker tooling is available.

## Security review
- Confirm no RLS or grants are widened and no secrets or protected society data are accessed.
- Report the requested related finance risks separately without expanding this fix.
- Keep Stage 3C blocked until the canonical GitHub runtime reports exactly `93 passed, 0 failed, 0 skipped, 0 setup failures, 0 teardown failures`.
