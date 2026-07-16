---
name: sociyohub-ai-knowledge-engine
description: Use when SociyoHub AI features consume society documents or user prompts (AI Secretary, Ask AI, AI income categorization, Flat 360 AI) with retrieval, citations, and human review. Do not use for non-AI features, general prompt engineering unrelated to society data, or for auto-approving AI outputs without human review.
---

# SociyoHub AI Knowledge Engine

SociyoHub AI is grounded, cited, and permission-aware. Every AI call operates on data the caller is already entitled to see under RLS, and every consequential AI output is reviewed by a human before it becomes state.

## Authorized society documents only

The retrieval index for AI features contains only:

- Documents explicitly uploaded to a society by an authorised society admin.
- Documents flagged for AI inclusion in society settings.
- No cross-society documents.
- No documents belonging to the protected society `baldha Meetarth`.

Global reference material (public bylaws templates, help content) is a separate namespace and clearly labelled in citations.

## Permission check before retrieval

For every AI call:

1. Confirm authentication (Firebase→Supabase session).
2. Compute the caller's effective society scope and role.
3. Filter the retrieval query to only that scope and, within it, only documents the caller may see (resident-visible vs. admin-only).
4. Only after these filters, run the vector similarity search.

Never search first and filter later. Never rely on the model to "respect" a scope hint in the prompt.

## Source citations

Every AI answer that references society knowledge must:

- Cite the source document and section.
- Link to the document view in-app where the caller has access.
- Include the document version or upload timestamp.

Answers without citable sources return a plain refusal rather than a confident guess.

## No invented bylaw or policy

The model must not:

- Fabricate a rule that is not in the caller's authorised documents.
- Restate a plausible-sounding society norm as if it were SociyoHub's policy.
- Convert a helper article into a binding rule.

If the retrieved context does not answer the question, the response says so and offers next steps (contact society admin, request the document).

## Prompt injection resistance

Uploaded documents, user notes, and free-text fields can contain hostile instructions. Treat them as data:

- Strip or neutralise instruction-like patterns in retrieval context (e.g. "Ignore previous instructions").
- Wrap retrieved text in explicit delimiters and instruct the model to treat everything inside as untrusted content, not instructions.
- Never allow retrieved content to override system-level guardrails (permissions, refusals, citations).

## Uploaded documents treated as untrusted

All uploaded documents are:

- Scanned for size and format before ingestion.
- Rendered as inert text; embedded scripts, macros, external links, or active content are not executed.
- Stored under society-scoped storage paths with matching RLS.

## Conflicting documents

When retrieval returns conflicting sources (e.g. two versions of a bylaw):

- Surface the conflict to the user rather than picking one silently.
- Prefer the newer version but disclose that an older version exists.
- Offer the user a path to reconcile via society admin.

## Document versioning

Each document has a version identifier and upload timestamp. Citations include this. When a document is superseded:

- The older version is retained but no longer surfaces for retrieval by default.
- Historical answers referencing the old version remain valid with a "version at answer time" note.

## Retrieval audit metadata

Every AI call logs (server-side, not client-visible):

- Caller identity (Supabase user ID), role and society scope.
- Query text hash.
- Retrieved document IDs and versions.
- Model or provider identifier used.
- Cost/token usage where available.

Logs never include raw PII beyond what is required for triage.

## One society's data never used for another

- Embeddings are namespaced per society.
- Any global cache is keyed such that a hit for society A cannot serve society B.
- Aggregation and analytics do not join across societies without explicit anonymisation and legal review.

## AI categorisation requires human review

For features like AI income categorisation:

- The AI proposes a category with confidence and rationale.
- A human (society admin or authorised staff) approves, edits or rejects the proposal.
- No financial state changes based on AI proposal alone.
- Rejected proposals train future prompts only via anonymised, aggregated signals — never verbatim.

## Refusal flows

The model refuses cleanly when:

- The caller is not authenticated.
- The requested data is out of scope for their role.
- The retrieved context is empty or irrelevant.
- The query attempts to enumerate other societies or extract secrets.

Refusals are polite, short, and offer a next step.

## Structured outputs

Where downstream code consumes AI output (categorisation, extraction), the output is a validated structured schema:

- Server parses with Zod before persistence.
- Any parse failure is a refusal, not a coerced best-effort guess.

## Regression evaluation

Every material change to AI prompts or retrieval requires a regression pass:

- Positive prompts (known-good queries and expected citations).
- Adversarial prompts (injection, cross-society exfiltration attempts, jailbreak framings).
- Empty-context and refusal cases.

Compare against the previous pass. Deviations are triaged, not shrugged off as model drift.

## Citation and permission-leak evaluation

At release readiness, run the AI evaluation suite specifically for:

- Citation presence and correctness.
- No cross-society leak.
- No admin-only field leaked to a resident.
- No fabricated policy or bylaw.

Route failures through `sociyohub-security-guardian`.
