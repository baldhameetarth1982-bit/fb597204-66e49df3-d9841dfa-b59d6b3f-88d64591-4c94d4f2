# Feature Coverage V2

Single source of truth for feature status across the SociyoHub V2 roadmap.
Read together with `SOCIYOHUB_MASTER_ROADMAP_V2.md`.

Legend for **Current implementation**:
- `done` — implemented and verified
- `partial` — implemented but incomplete
- `unverified` — implemented but not runtime-verified
- `missing` — not started
- `deferred` — intentionally postponed to a later stage
- `obsolete` — dropped by later product decision

Legend for **Release blocker**: `yes` / `no`.

| Feature | Original roadmap source | Latest product decision | Current implementation | Plan entitlement | Role access | Tests | Visual QA | Remaining stage | Release blocker |
|---|---|---|---|---|---|---|---|---|---|
| Auth (Supabase, phone OTP, Google) | Turn 3–5 | Firebase→Supabase migration retained | done | all | all | yes | yes | — | — |
| Society onboarding wizard | Prompt 4 | Kept | done | all | founder / admin | partial | partial | 2A / 2E | no |
| Blocks / units / hierarchy | Prompt 5 | Serial-number units | done | all | society admin | partial | partial | 2B | no |
| Residents & family | Prompt 6 | Kept | done | all | society admin | partial | partial | 2C | no |
| Bill Studio + recurring bills | Prompt 8 | Kept | done | Pro+ for advanced | society admin | partial | partial | 3A / 3B | no |
| Cash + Bank Transfer maintenance | Prompt 9 | Only offline for society collections | done | all plans | society admin + resident | yes | partial | 3C | no |
| Ledger / expenses / transparency | Prompt 10 | Kept | partial | Pro+ for reports | society admin | partial | partial | 3D / 3E | no |
| Flat 360 | Prompt 11 | Kept | done | Pro+ | society admin + resident | yes | partial | 4A | no |
| No-Dues certificate | Prompt 12 | Cryptography preserved | done | Pro+ | society admin + resident | yes | yes | 4B | no |
| +2 on-time points + leaderboard | Prompt 13 | Kept | done | Pro+ | resident | partial | partial | 4C | no |
| AI unit summary (permission-safe) | Prompt 14 | Lovable AI gateway | done | Pro+ | society admin | partial | partial | 4D | no |
| Complaints & helpdesk | Prompt 15 | Kept | partial | all | resident + admin | partial | partial | 5A–5E | no |
| Visitors & guards | Prompt 16 | Kept | partial | all | guard + resident + admin | partial | partial | 6A–6E | no |
| Notices, polls, emergency comm | Prompt 17 | Kept | partial | all | admin | partial | partial | 7A–7E | no |
| Push notifications | Prompt 18 | FCM retained | done | all | all | partial | partial | 7D | no |
| Super Admin console | Prompt 19 | Kept | partial | internal | super admin | partial | partial | 11A–11E | no |
| Razorpay SaaS subscriptions | Prompt 20 | Subscriptions only — NOT collections | done | all | founder / super admin | partial | partial | 14A | no |
| MCP (OAuth, read-only) | Turn 17 | Kept, sanitized | done | all | authenticated | yes | n/a | — | no |
| **Income backend (categories / payers / records)** | Turn 18A | Kept | done | Pro+ | society admin | yes | n/a | 1A | no |
| **Income read UI (dashboard / list / detail)** | Turn 18B.1 | Kept | done | Pro+ | society admin | yes | partial | 1B | no |
| **Verify / reject / reverse + transition RPC security** | Turn 18B.2 / 2A / 2B | Kept | done | Pro+ | society admin | yes | partial | 1C | no |
| **Category management screen** | Stage 1D | Society admin editable, system keys immutable, deactivate not delete | in progress | Pro+ | society admin | in progress | in progress | 1D | no |
| **Non-member payer directory** | Stage 1D | Data-minimized default list; contact fields on detail only | in progress | Pro+ | society admin | in progress | in progress | 1D | no |
| **Offline income entry (3-step)** | Stage 1D | Cash + Bank Transfer + Other Offline only; pending initial state | in progress | Pro+ | society admin | in progress | in progress | 1D | no |
| Authoritative SQL dashboard aggregate | Stage 1E | Kept | missing | Pro+ | society admin | missing | missing | 1E | no |
| Reconciliation foundation | Stage 1E | Kept | partial | Pro+ | society admin | missing | missing | 1E | no |
| AI income categorization | Prompt 22 / Stage 9 | Deferred to Stage 9 | deferred | Premium | society admin | — | — | 9A–9E | no |
| Smart QR collections | Prompt 23 / Stage 10 | Deferred to Stage 10 | deferred | Premium | society admin + resident | — | — | 10A–10E | no |
| Society-owned gateway adapter | Stage 14B | Deferred to Stage 14 | deferred | Premium | society admin | — | — | 14B | no |
| Android build + Play Store | Prompt 24 | Kept | missing | all | all | — | — | 15A–15E | yes |
| Launch readiness sign-off | — | Kept | missing | — | — | — | — | 16A–16E | yes |

Rows scoped to Stage 1D remain `in progress` until every Part-16 exit-gate
signal is green inside a single Stage 1D reply chain.

## Stage 2A closure (canonical structure model)

- Canonical: `societies` + `blocks` + `flats`. `hierarchy_nodes` is legacy compatibility only.
- `societies.structure_mode` is `'structured' | 'serial'` (nullable for legacy).
- `flats.block_id` is nullable in serial mode; a BEFORE-trigger enforces mode rules.
- New RPCs (SECURITY DEFINER, authenticated-only): `get_society_structure_overview`, `configure_society_structure_mode`, `list_society_units_page`, `create_society_unit`, `update_society_unit`, `set_society_unit_active`, `set_society_block_active`.
- Unsafe mode conversions with existing units are blocked; ambiguous legacy data left unchanged.
- `commit_society_wizard` writes canonical rows and no longer creates a fake "Houses" block for serial.
