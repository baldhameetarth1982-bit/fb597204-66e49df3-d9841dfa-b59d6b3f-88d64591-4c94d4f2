---
name: sociyohub-verification-gate
description: Use before claiming a SociyoHub task, turn, stage, migration or fix is complete, to gate the claim behind fresh, categorised evidence with recorded exit codes. Do not use for early exploration, planning, or work still in progress — those belong to sociyohub-agent-intelligence and sociyohub-systematic-debugging.
---

# SociyoHub Verification Gate

No SociyoHub change is "done" without fresh evidence gathered in the current attempt. Prior success from an earlier turn, a summary, or a sibling agent does not count.

## Evidence categories

Evidence must be labelled and separated. Do not conflate categories.

1. **Static** — TypeScript typecheck (`tsgo --noEmit` or equivalent), ESLint, Prettier, client-bundle secret scan.
2. **Unit** — Vitest on isolated pure logic, schemas, formatters, small helpers.
3. **Integration** — Vitest/PostgreSQL-backed tests that exercise server functions, RLS, and plan gating against synthetic fixtures.
4. **PostgreSQL runtime** — direct queries under distinct database roles (`anon`, `authenticated` as user A, user B in another society, admin, super_admin), confirming RLS blocks cross-society access, plan gates hold, and `SECURITY DEFINER` functions enforce their invariants.
5. **Browser** — Playwright driving the live preview through a real user role, capturing console errors, network status codes, and post-render DOM.
6. **Visual** — screenshots or short recordings, only when actually captured in this attempt.

Each category answers a different question. Passing static checks does not imply RLS is correct. Passing unit tests does not imply the UI renders.

## Report exit codes

For every command that produces evidence:

- Command run.
- Exit code (integer). Assume nothing; read it.
- Duration if relevant.
- Location of full log if truncated.

Do not paraphrase "tests pass" without an exit code. Do not say "build succeeded" without the final line and exit code.

## Report skipped checks

If a check was intentionally skipped, name it and give the reason. Examples:

- "Playwright not run: change is docs-only under `docs/`."
- "PostgreSQL role test not run: change does not touch RLS, migrations, or `SECURITY DEFINER` functions."
- "Visual screenshot not captured: change is server-only."

A silent gap is a failure of the gate, not a pass.

## Do not trust another agent's success summary

When a sub-agent, prior turn, or user message asserts "tests pass" or "build succeeded", re-verify what your current change actually touches. Trust the exit code you observed in this attempt, not the narrative.

Chain-of-custody rule: the evidence and the change must come from the same working tree state.

## Freshness

Evidence is fresh only if:

- Gathered after the last file write in this attempt.
- No files changed between the check and the completion claim.
- The build did not silently fall back to a cached artefact from before the change.

If a file changes after evidence is collected, re-collect the affected evidence.

## Category selection per change type

- **Docs-only** — static (spell/format optional); skip everything else with reason.
- **Pure client logic** — static + unit + browser render.
- **Server function** — static + unit + integration against synthetic fixtures.
- **Migration / RLS / `SECURITY DEFINER`** — static + integration + PostgreSQL role tests. Never skip role tests for RLS-touching changes.
- **UI screen** — static + unit for logic + browser + at least one visual screenshot at 390 or 414 width.
- **Payment path** — static + unit + integration + explicit webhook signature and idempotency tests. Never rely on visual alone.
- **AI path** — static + unit for prompt shape + adversarial prompt regression cases.

## Stage closure

Before closing a numbered SociyoHub stage:

- All required categories above are green with recorded exit codes.
- Secret scan against the client bundle is green.
- No new dependency was added silently.
- Protected society ([REDACTED-PROTECTED-SOCIETY-ID]) was not queried, mutated, seeded or probed.
- `docs/DEVELOPMENT_HISTORY.md` reflects the stage.

If any of these fails or is missing, the stage is open. State that plainly.

## Language for the user

Use exact, cautious phrasing:

- "Typecheck passed (exit 0)."
- "Vitest passed 41/41 (exit 0)."
- "RLS role test: cross-society read blocked, cross-plan write blocked."
- "Playwright not run — change is server-only."

Avoid: "everything works", "all good", "should be fine". These are unverifiable and misleading.

## When evidence is negative

If any check fails, the change is not done. Report:

- Which category failed.
- The precise failure (test name, exit code, error line).
- Whether the failure is pre-existing or caused by this change.
- Next single step.

Do not paper over failures to close a turn.
