# Workstream 6 — Governance, Documents & Privacy

Extend the existing Notices, Polls/Surveys, Documents & FAQs (knowledge sources), Privacy settings, Data export, audit log and notification store. No second communication, voting, document or export system.

## What already exists (reused)
- **Notices**: audience + block targeting, draft/scheduled publish, read tracking (`notice_reads`), committee-only publish, 7-day edit window.
- **Polls / Surveys**: one vote per person, draft/open/closed, anonymous aggregates.
- **Documents & FAQs**: private storage, audience field, version counter, archive, AI Secretary reads through the shared permission-aware retrieval.
- **Data export**: permission-checked, whitelisted columns, audited, rate-limited.
- **Notifications**: single `user_notifications` store via `_notify_user/_notify_flat`.

## What will be added

1. **Notices** — priority (normal/high/urgent), optional expiry (expired notices leave the resident feed), optional "acknowledgement required", acknowledgement records. Committee sees per-notice counts: notified / opened (from real read records) / acknowledged / pending. "Delivered" is never claimed — push delivery has no evidence, so it shows as "Sent". Scheduled notices notify once when they go live (idempotent, existing hourly job).
2. **Meetings** — new Meetings page (committee) and resident view: title, agenda, date/time, place or link, audience; statuses draft → scheduled → held → minutes published / cancelled. RSVP (yes/no/maybe) by eligible residents; committee records attendance, minutes, action items (owner, due date, done), resolutions (can link to a formal vote), and supporting documents from the vault. All society-scoped, audited, once-only reminders 24h before.
3. **Formal votes** — extend polls with `kind = 'vote'` (ordinary polls untouched): eligibility rule (one per active home / every active resident / committee), open/close window, secret ballot flag. Configuration frozen once opened (trigger). One vote per eligible person or home, enforced by unique index + server eligibility check. Closed votes cannot reopen. Secret ballots: results only as totals; audit log records "vote cast", never the choice; committee cannot read individual choices.
4. **Document vault** — extend Documents: categories (bylaws, rules, notices, minutes, resolutions, policies, records), visibility (all residents / committee only), and a version history table. Uploading a new version archives the prior file instead of overwriting. Committee-only documents are hidden from residents and from AI Secretary answers. Short-lived signed links only.
5. **Privacy requests** — resident "My privacy requests": export my data / correct my data / delete my data. Committee review queue: pending → under review → completed / partially completed / declined, with a required explanation. Export reuses the existing export rules scoped to the requester only. Deletion never touches financial, payment, gate/security or audit records — those are listed as "retained (legal/financial record)" in the outcome. Requester notified on each decision.

## Security
Every new table: society derived server-side, RLS, writes only through SECURITY DEFINER functions with role checks, rate limits, audit rows, validated state transitions. Client never supplies society, eligibility or totals.

## Validation (rollback-only, QA Demo Society)
Notice targeting/expiry/ack truthfulness, meeting permission denial, vote eligibility, duplicate vote, config freeze, secret-ballot privacy, document versioning + committee-only hiding + cross-society denial, privacy request authorization and retention protection, notification idempotency, audit rows. Preview available committee screens at phone and desktop sizes. Resident-only screens recorded as unavailable if no legitimate resident login exists.

## Out of scope
Workstream 7, video-conferencing integration, e-signatures, legal-grade proxy voting.

## Technical notes
- Migrations: `notices` add `priority`, `expires_at`, `requires_ack`; `notice_acks`; `meetings`, `meeting_rsvps`, `meeting_attendance`, `meeting_action_items`, `meeting_resolutions`; `polls` add `eligibility`, `secret_ballot`, `opens_at`, `frozen_at`; `society_knowledge_sources` add `category`, `visibility`; `society_document_versions`; `privacy_requests`.
- `get_society_export_section` reused with a new self-scope variant for personal data.
- AI retrieval filter extended to exclude `visibility='committee'` for non-admins.
