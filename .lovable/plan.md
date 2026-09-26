# Finish Stage 13 security and reliability closure

## Scope
- Review every privileged database function for authorization, society isolation, safe execution context, validation, and audit identity.
- Review rate limits and server validation across authentication, public endpoints, AI, uploads, exports, invitations, payments, reports, and administration.
- Review financial state transitions, Razorpay callbacks, storage access, AI boundaries, audit immutability, error redaction, and high-risk concurrency paths.
- Fix only verified weaknesses with forward-only migrations or focused source changes; preserve existing authentication, payment, tenant, and financial rules.
- Run focused security tests, the existing unit suite, type checking, build, secret scan, database lint/security scan, and review skipped tests without enabling live fixtures.

## Safety constraints
- Do not inspect or modify the protected production society or use real identities, data, payments, or webhooks.
- Do not edit `src/lib/utils.ts`; its reported line 8 does not exist.
- Keep maintenance payments Cash and Bank Transfer only; keep Razorpay limited to SociyoHub subscriptions; never add platform fees.
- Preserve the known provider-level email/password limitation without weakening authentication or inventing a replacement password system.
- Do not begin Stage 14.

## Completion evidence
- Record each verified fix and rerun checks after changes.
- Close Stage 13 only if no known critical/high issue remains; report only runtime/provider checks that cannot be performed safely.
