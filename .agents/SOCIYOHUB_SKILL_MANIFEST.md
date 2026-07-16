# SociyoHub Skill Manifest

Project-local Agent Skills for SociyoHub. These are not runtime code, are not imported by the application, and are not bundled to the browser. They exist under `.agents/skills/` as guidance for future agent turns.

Every skill below is original, self-contained SociyoHub content. External repositories (see `SOCIYOHUB_SKILL_SOURCES.json`) were used only as temporary research sources; no third-party repository was committed, no submodule was added, and no new package dependency was introduced by this task.

---

## 1. sociyohub-agent-intelligence

- **Purpose**: Foundation reasoning — source-of-truth hierarchy, context budgeting, facts vs. assumptions, selected approach + realistic alternative, pre-mortem, evidence-based reasoning.
- **Trigger (narrow)**: Any non-trivial SociyoHub change (feature, refactor, security, payment, AI) before implementation begins.
- **When not to use**: Pure typo/copy/spacing edits; isolated bug reproduction (use systematic-debugging).
- **Sources informed**: anthropics/skills, obra/superpowers, humanlayer/12-factor-agents, openai/openai-cookbook, davidondrej/skills.
- **Files created**: `.agents/skills/sociyohub-agent-intelligence/SKILL.md`
- **Status**: created.

## 2. sociyohub-systematic-debugging

- **Purpose**: Reproduce → read complete error → inspect recent changes → find earliest incorrect state → one hypothesis → minimal experiment → architecture stop after three failed fixes.
- **Trigger**: Any SociyoHub bug, regression, failing test, or wrong RLS/plan/payment outcome.
- **When not to use**: New-feature planning; release approval; one-line copy edits.
- **Sources informed**: obra/superpowers, mattpocock/skills, davidondrej/skills.
- **Files created**: `.agents/skills/sociyohub-systematic-debugging/SKILL.md`
- **Status**: created.

## 3. sociyohub-verification-gate

- **Purpose**: Gate completion behind fresh, categorised evidence (static, unit, integration, PostgreSQL runtime, browser, visual) with exit codes and freshness rules.
- **Trigger**: Before claiming any SociyoHub task, turn, stage, migration or fix is complete.
- **When not to use**: Early exploration, in-progress work, planning-only tasks.
- **Sources informed**: obra/superpowers, mattpocock/skills, promptfoo/promptfoo, vitest-dev/vitest, microsoft/playwright.
- **Files created**: `.agents/skills/sociyohub-verification-gate/SKILL.md`
- **Status**: created.

## 4. sociyohub-risk-based-tdd

- **Purpose**: RED/GREEN/REFACTOR for risky behaviour (money, permissions, RLS, plan entitlements, state transitions, validation). Test behaviour, not implementation.
- **Trigger**: Any SociyoHub change touching risky domains listed above.
- **When not to use**: Pure copy, spacing, colour tokens, documentation.
- **Sources informed**: mattpocock/skills, vitest-dev/vitest, testing-library/react-testing-library.
- **Files created**: `.agents/skills/sociyohub-risk-based-tdd/SKILL.md`
- **Status**: created.

## 5. sociyohub-code-simplifier

- **Purpose**: Scoped simplification — changed files + orphan chain only, preserve behaviour, YAGNI, useful DRY, no unrelated refactor, no dependency to save lines, tests before and after.
- **Trigger**: A specific file/function is clearly over-engineered and behaviour must be preserved.
- **When not to use**: Repo-wide refactors, framework migrations, dependency swaps.
- **Sources informed**: caarlos0/dotfiles (skills/code-simplifier/), mattpocock/skills.
- **Files created**: `.agents/skills/sociyohub-code-simplifier/SKILL.md`
- **Status**: created.

## 6. sociyohub-feature-architecture

- **Purpose**: Gradual feature-based structure, clear public feature interfaces, predictable UI/schema/API/hooks/types/tests locations, no cross-feature deep imports, one canonical business rule per domain concept, TanStack Query/Router compatibility.
- **Trigger**: Adding a new SociyoHub feature or gradually restructuring an existing one.
- **When not to use**: Framework swaps; full-repo rewrites; cosmetic UI changes.
- **Sources informed**: alan2207/bulletproof-react, feature-sliced/documentation, TanStack/query, TanStack/router.
- **Files created**: `.agents/skills/sociyohub-feature-architecture/SKILL.md`
- **Status**: created.

## 7. sociyohub-security-guardian

- **Purpose**: OWASP-style verification, multi-tenant isolation, authorization, plan entitlement, validation, rate limits, error safety, secret scan, dependency audits, safe uploads, safe `SECURITY DEFINER` with minimum EXECUTE and safe `search_path`, cross-society enumeration resistance, direct PostgreSQL role testing. No frontend-only authorization.
- **Trigger**: Any change touching authorization, RLS, `SECURITY DEFINER`, plan entitlement, validation, uploads, secrets, or dependency risk.
- **When not to use**: Pure UI copy or spacing.
- **Sources informed**: OWASP/ASVS, OWASP/CheatSheetSeries, OWASP/API-Security, OWASP/www-project-top-10-for-large-language-model-applications, semgrep/semgrep-rules, gitleaks/gitleaks, google/osv-scanner, supabase/supabase.
- **Files created**: `.agents/skills/sociyohub-security-guardian/SKILL.md`
- **Status**: created.

## 8. sociyohub-auth-guardian

- **Purpose**: Preserve Firebase Phone OTP + Google → trusted-server verification → Supabase session exchange. Rate-limited OTP, safe account linking, session refresh, redirect safety, no raw token logging, no service-role in frontend, reauthentication for sensitive actions, no user enumeration.
- **Trigger**: Changes to sign-in, sign-up, OTP, Google identity, session refresh, logout, account linking, or reauthentication.
- **When not to use**: Post-auth feature logic; RLS design; payment flows.
- **Sources informed**: firebase/quickstart-js, supabase/supabase, OWASP/CheatSheetSeries (Authentication, Session Management).
- **Files created**: `.agents/skills/sociyohub-auth-guardian/SKILL.md`
- **Status**: created.

## 9. sociyohub-performance-engine

- **Purpose**: Baseline before optimisation; Lighthouse and Web Vitals; bundle inspection; route lazy loading; TanStack Query dedup and stable keys; appropriate stale times; N+1 prevention; minimum-column selection; pagination; image/font loading; CLS; skeleton correctness; server-only code excluded from client; measured after-result; no invented score.
- **Trigger**: Performance-focused work with measured evidence.
- **When not to use**: Correctness or security fixes; as justification to cut features, tests, or a11y.
- **Sources informed**: GoogleChrome/lighthouse, GoogleChrome/web-vitals, TanStack/query.
- **Files created**: `.agents/skills/sociyohub-performance-engine/SKILL.md`
- **Status**: created.

## 10. sociyohub-premium-ui

- **Purpose**: Existing-component-first, shadcn + Radix reuse, 44×44 targets, keyboard support, focus visibility, screen-reader labels, reduced motion, responsive at 360/390/414/768/1280, restrained motion 160–220ms, honest empty/error/loading/success, SociyoHub tokens.
- **Trigger**: Building or refining any SociyoHub UI surface.
- **When not to use**: Server-only work, migrations, RLS, docs.
- **Sources informed**: shadcn-ui/ui, radix-ui/primitives, emilkowalski/skills, nextlevelbuilder/ui-ux-pro-max-skill, w3c/wcag.
- **Files created**: `.agents/skills/sociyohub-premium-ui/SKILL.md`
- **Status**: created.

## 11. sociyohub-payment-integrity

- **Purpose**: No platform fee; Razorpay only for SaaS subscriptions; maintenance Cash + Bank Transfer; approved offline non-member income; society-owned gateway deferred; no Stripe/Paddle; explicit state machines; verification separate from reconciliation; idempotency; webhook signatures; out-of-order webhooks; immutable audit; controlled reversals; no client-trusted amount/status/plan; integer minor units.
- **Trigger**: Any money-touching SociyoHub change.
- **When not to use**: Pure UI display of already-computed totals; non-financial features.
- **Sources informed**: razorpay/razorpay-node, OWASP/CheatSheetSeries (Transaction Authorization, Webhook security).
- **Files created**: `.agents/skills/sociyohub-payment-integrity/SKILL.md`
- **Status**: created.

## 12. sociyohub-legal-privacy

- **Purpose**: Drafts requiring legal review; versioned terms/privacy; acceptance version + timestamp; no dark patterns; data minimisation; retention; export/deletion; processor disclosure; no invented company/trademark/certification; current official-source verification; no copying other companies' text.
- **Trigger**: Drafting or updating legal/privacy content, consent flows, or acceptance records.
- **When not to use**: UI-only changes to legal pages; as a substitute for actual legal counsel.
- **Sources informed**: github/site-policy (structure only), OWASP privacy references.
- **Files created**: `.agents/skills/sociyohub-legal-privacy/SKILL.md`
- **Status**: created.

## 13. sociyohub-ai-knowledge-engine

- **Purpose**: Authorised society documents only; permission check before retrieval; source citations; no invented bylaws; prompt-injection resistance; uploads treated as untrusted; conflict handling; versioning; retrieval audit; no cross-society reuse; AI categorisation requires human review; structured outputs validated with Zod; regression and permission-leak evaluation.
- **Trigger**: AI features consuming society documents or user prompts.
- **When not to use**: Non-AI features; general prompt engineering unrelated to society data; auto-approving AI outputs.
- **Sources informed**: supabase-community/chatgpt-your-files, run-llama/llama_index, NVIDIA/NeMo-Guardrails, langchain-ai/langchain, OWASP LLM Top 10.
- **Files created**: `.agents/skills/sociyohub-ai-knowledge-engine/SKILL.md`
- **Status**: created.

## 14. sociyohub-testing-e2e

- **Purpose**: Focused Vitest units, Testing Library behaviour tests, Playwright role-based flows, responsive checks, Firebase session testing, cross-society negative workflows, upload/payment workflows, no brittle strings, screenshots only when captured.
- **Trigger**: Adding or updating unit, integration or browser tests.
- **When not to use**: Release approval; planning-only tasks.
- **Sources informed**: vitest-dev/vitest, testing-library/react-testing-library, microsoft/playwright.
- **Files created**: `.agents/skills/sociyohub-testing-e2e/SKILL.md`
- **Status**: created.

## 15. sociyohub-release-readiness

- **Purpose**: Requirements matrix; role-based E2E; security; RLS; PostgreSQL role tests; secret scan; dependency audit; build; bundle/performance; a11y; responsive inspection; backup/recovery; blocker report; no release approval with critical skipped evidence; protected-society check.
- **Trigger**: SociyoHub stage/milestone/deployment approval.
- **When not to use**: In-progress feature work; individual bug fixes; docs-only changes.
- **Sources informed**: OWASP/ASVS, gitleaks/gitleaks, google/osv-scanner, GoogleChrome/lighthouse, w3c/wcag, promptfoo/promptfoo.
- **Files created**: `.agents/skills/sociyohub-release-readiness/SKILL.md`
- **Status**: created.

---

## Isolation guarantees

- `.agents/` is not imported by any application source.
- `.agents/` is not copied into `public/` or `dist/`.
- `.agents/` is not referenced by any bundled module.
- No new npm, Python, Go or Rust dependency was added by this task.
- No third-party repository was committed, cloned into the repo, added as a submodule, or executed.
- No symbolic links were created inside the repository.
- Protected society `baldha Meetarth` (`1907a918-c4b8-4f43-a837-450530cc7c34`) was not queried, seeded, mutated, probed, or used as a fixture.
