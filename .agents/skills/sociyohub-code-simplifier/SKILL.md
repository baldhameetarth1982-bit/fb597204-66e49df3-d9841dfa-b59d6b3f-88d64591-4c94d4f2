---
name: sociyohub-code-simplifier
description: Use when a specific SociyoHub file, function, or small module is clearly over-engineered, has dead branches, or has one-use wrappers that hurt readability, and behaviour must be preserved. Do not use for repo-wide refactors, framework migrations, dependency swaps, or areas without existing tests that pin behaviour.
---

# SociyoHub Code Simplifier

Simplify only when it is safe, scoped, and evidence-driven. This skill removes friction; it never rewrites SociyoHub.

## Scope: changed files and direct orphan chain only

Allowed edit surface:

- The specific file(s) named by the current task.
- Files that become fully unreferenced as a direct result of the simplification (an "orphan chain": a helper only used by a wrapper that is being deleted).

Not allowed:

- Repository-wide sweeps.
- Renaming public exports used across features.
- "While I was here" edits to unrelated files.

If simplification requires touching many features, stop and route the work through `sociyohub-feature-architecture` instead.

## Preserve behaviour

Behaviour is the contract:

- Same HTTP inputs → same HTTP outputs and status codes.
- Same rendered DOM for the same props and route state.
- Same database side effects, in the same order where order is observable.
- Same error surface (message identity is not required, but error class and status must match tests).

Any observable change is a feature change, not a simplification.

## YAGNI

Delete or refuse code that exists "just in case":

- Unused config flags.
- Options never passed by any caller.
- Adapter layers with one adapter.
- Generic types parameterised for a single instantiation.

Confirm by search: reference count in the workspace is zero (or one, the wrapper itself). If reference count is uncertain, do not delete.

## Useful DRY, not compulsive DRY

Extract shared code when:

- Two or more call sites truly implement the same rule (e.g. plan normalisation, money formatting).
- The rule is stable and named in the domain.

Do not extract when:

- The similarity is coincidental (two functions happen to loop over arrays).
- The rule is likely to diverge per feature (bill formatting vs. receipt formatting).

Duplication is cheaper than the wrong abstraction.

## Clear TypeScript

Prefer:

- Explicit domain types over `Record<string, any>`.
- Discriminated unions for state machines (`type BillStatus = 'unpaid' | 'paid' | ...`).
- `readonly` on props and returned arrays.
- Zod-inferred types for validated inputs.

Avoid:

- `any`. Use `unknown` and narrow.
- Type assertions (`as`) unless the narrowing is provably safe and commented.
- Deep generic gymnastics that no caller reads.

## Remove one-use wrappers

If a function is called exactly once, inline it unless it materially aids readability at the call site. One-use wrappers hide behaviour and inflate the call graph.

Exceptions:

- Named business rules (`hasPlanEntitlement(...)`, `verifyNoDuesToken(...)`) — keep even at one use.
- Test seams that make integration testing possible.

## Confirm dead code before deletion

Before deleting:

- Grep repository for the symbol.
- Check dynamic references: dynamic imports, route file-based routing, string keys in registries.
- Check tests for the symbol.
- Check `.agents/`, `docs/`, and `scripts/` for named references.

If any doubt remains, do not delete. Mark with a `// TODO: candidate for removal` and leave it.

## No public API break

Do not change:

- Exported server function names, input schemas or return shapes.
- Route paths.
- Component prop names visible outside a feature.
- Migration filenames.

If a public API needs to change, that is not simplification.

## No unrelated repo-wide refactor

Even if a global rename would be nicer, do it in a dedicated task. This skill exits when the change grows past the changed file(s) and their orphan chain.

## No dependency merely to save lines

Adding a dependency to shorten code is prohibited by this skill:

- Bundle cost, supply-chain risk, and future upgrade burden outweigh a few saved lines.
- Prefer standard library, existing utils, or in-repo helpers.

## Tests before and after

Simplification without tests is destruction:

- Confirm the affected code is covered. If not, add characterising tests first (input/output pairs derived from current behaviour).
- Run the relevant test scope before simplifying — record green.
- Simplify.
- Run the same test scope — must still be green.
- No test that passed before is allowed to be deleted or weakened during simplification.

Hand off to `sociyohub-verification-gate` before claiming the simplification complete.
