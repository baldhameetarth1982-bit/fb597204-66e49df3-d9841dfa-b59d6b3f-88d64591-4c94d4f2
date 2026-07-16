---
name: sociyohub-legal-privacy
description: Use when SociyoHub work drafts or updates terms, privacy, refund policy, cookie notice, data-processing disclosure, acceptance records or consent flows. Do not use for pure UI/UX changes to legal pages that keep the underlying content unchanged, or as a substitute for actual legal counsel.
---

# SociyoHub Legal and Privacy

This skill drafts legal and privacy content that is honest, versioned, and clearly labelled as pending review. Nothing produced by this skill is legal advice.

## Draft, not final

Every artefact this skill produces is a draft:

- Marked at the top with a clear "Draft — pending legal review" banner in the file or page.
- Never presented to users as approved legal advice.
- Approved only after external qualified legal review for the jurisdictions SociyoHub operates in.

## Versioned documents

Each legal document (Terms, Privacy Policy, Refund Policy, Cookie Notice, DPA/Sub-processor list where relevant) carries:

- A visible version identifier (e.g. `v2026-07-16`).
- An "effective date".
- A change log entry describing what changed and why.

Older versions are retained (in-repo or in a stable published archive) so any resident can review the terms they accepted.

## Acceptance version and timestamp

When a resident, society admin or super admin accepts terms:

- Store the exact version identifier and effective date they accepted.
- Store the timestamp and (where lawful) a coarse audit context (e.g. society membership at the time).
- Do not backfill acceptance for older users silently; require re-acceptance when material changes occur.

## No dark patterns

Prohibited:

- Pre-checked consent boxes for optional processing.
- Confusing "Cancel" buttons that actually confirm.
- Loss-framed language coercing acceptance.
- Hiding data-sharing behind link labels like "learn more" that lead nowhere useful.

Consent must be affirmative, informed, and revocable.

## Data minimization

The privacy policy reflects code reality:

- Only fields the app actually collects are listed.
- Each listed field states why it is collected and how long it is kept.
- Optional fields are marked optional in the app and the policy.

If the code collects less than the policy claims, shrink the policy. If it collects more, shrink the code or update the policy — do not let them diverge.

## Retention

For each data category (identity, contact, financial, uploads, activity logs, AI query logs):

- State the retention period.
- State the trigger that resets or extends retention (last login, subscription end, legal hold).
- Reference the deletion mechanism.

Retention statements must match server-side deletion or anonymisation jobs.

## Export and deletion

- Residents can request an export of their personal data in a portable format.
- Residents can request deletion of their account and personal data, subject to legal retention obligations (e.g. financial records).
- Society admins receive clear instructions on their own equivalent rights and on how to handle resident requests for their society.

Draft the workflows; do not invent SLAs that operations cannot meet.

## Processor disclosure

The privacy policy lists sub-processors used by SociyoHub with a clear purpose for each (identity via Firebase, database and storage via Supabase, subscription billing via Razorpay, hosting on Cloudflare-compatible edge, AI providers where used).

Do not name a processor SociyoHub does not actually use. Do not omit one that is used.

## No invented company facts

Never write into any legal document, marketing page or metadata:

- A CEO, CTO, or sole founder (SociyoHub has two equal co-founders: Meetarth Baldha and Divyaraj Vaghela).
- An incorporation status, registered office, GST/CIN number, or trademark registration that has not been verified.
- Certifications (ISO, SOC 2, PCI DSS) that have not been formally awarded.
- Awards, press mentions, or customer counts that are not documented.

Placeholders like "TBD" are acceptable during drafting only when clearly marked.

## Current official-source verification

For India- and US-relevant obligations (DPDP Act, IT Rules, state consumer protection, applicable tax and refund norms, US state privacy where relevant):

- Fetch the current authoritative source at draft time.
- Cite it in the internal draft notes (not necessarily in the user-facing page).
- Do not rely on older summaries or third-party blog posts as the sole basis.

Legal review supersedes anything this skill drafts.

## No copying another company's legal text

- Do not copy GitHub, Stripe, MyGate, ADDA, or other companies' terms or privacy prose.
- Structural inspiration (section headings, versioning conventions) is fine; verbatim clauses are not.
- Draft in SociyoHub's own voice, describing SociyoHub's actual processing.

## Marketing and public-page hygiene

- No fabricated testimonials or metrics.
- No implied endorsements from Firebase, Supabase, Razorpay or any other vendor.
- Founder pages reflect the two co-founders equally; do not elevate one above the other.
- SEO metadata for legal pages is accurate: title reflects the document, description reflects the content.

## Handoff

Route the final legal review to qualified counsel through the user. This skill's output is ready to be reviewed, not ready to be published.
