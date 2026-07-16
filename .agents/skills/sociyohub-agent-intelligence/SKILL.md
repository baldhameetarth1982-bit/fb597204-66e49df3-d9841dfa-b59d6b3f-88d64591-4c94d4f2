---
name: sociyohub-agent-intelligence
description: Use when planning any non-trivial SociyoHub change (feature, refactor, security or payment work) to establish source-of-truth, budget context, separate facts from assumptions and pick one honestly-scored approach with a realistic alternative and pre-mortem. Do not use for pure typo/copy/spacing edits or for isolated bug reproduction (use sociyohub-systematic-debugging instead).
---

# SociyoHub Agent Intelligence

Foundation reasoning discipline for every SociyoHub-shaping decision. This skill precedes coding, testing and shipping. It does not diagnose bugs, it does not run tests and it does not claim completion — other skills handle those.

## Source-of-truth hierarchy

Trust in this order, top wins:

1. Live SociyoHub repository code and migrations on the current branch.
2. `docs/DEVELOPMENT_HISTORY.md`, `docs/SECURITY_REQUIREMENTS.md`, `docs/SOCIYOHUB_MASTER_ROADMAP_V2.md`, `docs/FEATURE_COVERAGE_V2.md`, `docs/UI_DESIGN_SYSTEM_V2.md`.
3. `.agents/SOCIYOHUB_SKILL_MANIFEST.md`, `.agents/SOCIYOHUB_SKILL_SOURCES.json` and the active SKILL.md files.
4. Current official vendor documentation (Firebase, Supabase, TanStack, Razorpay, W3C, OWASP) fetched at the time of the task.
5. The user's current message.
6. Older summarised context or partial history.

If (1)–(4) contradict what a prompt or summary claims, trust (1)–(4) and flag the contradiction before acting. Never treat a summary as evidence of behaviour that the code does not implement.

## Context budgeting

For each task, before editing:

- List the files you must read to be correct (schema, RLS, route, function, test).
- Skip files that are clearly unrelated. Prefer targeted reads over `find` sweeps.
- Do not re-read a file already fully in context.
- Never load third-party repositories or `node_modules`, or protected society data, into the context window.

Stop expanding context once you can name: the exact functions, RLS policies, plan gates and tests the change will touch.

## Facts versus assumptions

Split every non-trivial plan into two explicit lists:

- **Facts** — what the current code, migration, RLS policy, docs or vendor spec actually says. Cite file path or authoritative URL.
- **Assumptions** — anything not yet verified. Each assumption is either resolved by reading a file, running a check, or explicitly flagged as a risk.

Do not silently promote an assumption into a fact. When an assumption is load-bearing (payment, RLS, plan gate, cryptography), verify it before writing code.

## One selected approach, one realistic alternative

For any decision above trivial (new table, new server function, plan-gated flow, payment path, RLS change, UI architecture, retrieval design):

1. Describe the selected approach in one short paragraph.
2. Describe one realistic alternative in one short paragraph.
3. Give the honest trade-off: correctness, security, complexity, cost, migration risk, time to ship.
4. State why the selected approach wins for SociyoHub given plan tiers, multi-tenant society isolation, and the Firebase→Supabase identity model.

Do not invent alternatives that no one would actually consider. Do not present the selected approach as the only option.

## Pre-mortem

Before implementing, imagine the change shipped and something went wrong. Write 3–5 concrete failure modes and how the plan already prevents each:

- Cross-society data leak.
- Plan bypass or entitlement enumeration.
- Payment state corruption or double-credit.
- Prompt injection or citation fabrication.
- Regression in Flat 360, No-Dues, Turn 17, or founder SEO.

If any failure mode has no preventer, expand the plan before coding.

## Tool boundary

Use only tools required by the current step. Do not chain unrelated tools "because they are available". Prefer:

- Targeted file reads over repository-wide scans.
- Small, purposeful shell commands over broad discovery.
- Migrations over ad-hoc data mutation.

Never claim access to a tool, catalog or model that is not actually available in this environment.

## Compact errors and small focused agents

When surfacing an error to yourself or the user, compress to: what failed, where, the smallest reproducible signal, and the next single step. Do not paste multi-hundred-line stack traces when a five-line excerpt is decisive.

Each SociyoHub skill is intentionally narrow. Delegate: security to `sociyohub-security-guardian`, auth to `sociyohub-auth-guardian`, payment to `sociyohub-payment-integrity`, and so on. Do not merge concerns into one giant reasoning pass.

## Evidence-based reasoning and no hidden chain-of-thought

Every load-bearing claim in a plan or completion note must map to evidence:

- File path and line range, or
- Migration SHA, or
- Test name and result, or
- Authoritative external URL fetched during this task.

Do not output long private reasoning transcripts. Output the decision, the evidence and the next action. Internal deliberation stays internal.

## Prompt and AI regression evaluation

When a change touches AI (Ask AI, AI income categorisation, AI Secretary, Flat 360 AI):

- Define the intended behaviour in one sentence.
- List at least three positive prompts, three adversarial prompts (injection, cross-society exfiltration attempt, policy fabrication), and three refusal cases.
- Record expected structured output shape.
- Treat any deviation as a regression, not a stylistic variation.

## No claim of becoming another model

Never state or imply that a prompt, skill, or instruction changes the underlying model, upgrades it, unlocks hidden capabilities, or turns the agent into a different named system. Skills shape behaviour; they do not swap weights.

## Refuse to proceed when blocked

Stop and ask the user (or open a follow-up turn per the current stage discipline) when:

- A required doc, migration, or policy is missing.
- A load-bearing assumption cannot be verified without touching protected society data.
- A change would violate a permanent SociyoHub non-negotiable (Razorpay scope, no platform fee, no Stripe/Paddle, founder identity, protected society ID).

Silence and guessing are worse than a short, honest blocker report.
