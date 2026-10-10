# SociyoHub launch-gap roadmap (Oct 2026 tester + owner feedback)

Stage 3C/3D runtime verification paused by owner.

- [x] Role-aware shells: resident/guard never see society-admin sidebar (settings, legal, pricing pages)
- [x] Resident/guard: no plans, pricing or subscription anywhere
- [x] Dark mode persists on login/public pages
- [x] Replace Neon with one premium Indian-palette theme (Pro plan), Standard stays default
- [x] Pill-style (horizontal, rounded) tabs app-wide
- [x] Accounting Center: 4 section buttons (Income & Expense, Ledger, Maintenance & Billing, Events)
- [x] Society admin desktop: Feature Directory + all main sections reachable from sidebar
- [x] Super Admin: grouped control-center navigation (guide modules), keep all features
- [x] Super Admin: hide test/QA/demo records by default with a switch
- [x] Replace browser prompt() dialogs with in-app reason dialog
- [x] Duplicate legal footer removed; subtle scrollbars
- [x] Auto billing off by default; 5-day cycle bills only verified-paid homes, reminds due homes
- [x] Default common income/expense heads
- [x] Event money (income/expense per event) in Accounting Center
- [x] Single-bill maker (Bill one home) using the existing printable bill layout
- [ ] Signed-in visual check of each role — blocked: no authorized QA sign-in this turn
- [x] New launch labels translated in all 23 languages
- [x] Owner confirmed the 4 launch choices (recommended defaults; Mayur theme applies app-wide to every eligible account)
- [x] Native-quality review of Marathi, Sanskrit, Telugu, Urdu launch text (Gemini, key rotation)
- [x] Manipuri: full second review of all 5,404 lines by a second AI reviewer (1,436 corrected); native-speaker check still recommended
- [x] Reviewed bill-cycle safety: reminders run once per 5-day cycle; event tagging never changes amounts or categories and is audited
- [x] Bill one home rebuilt to match owner's Generate New Bill sample (month grid, extra charges, discount, final total card)
- [x] Default printable bill matching the owner's sample (Print on any bill)

## Full re-check (tester report, owner notes, Admin Panel Guide) — Oct 10
- [x] Share on bills shares or copies, never downloads
- [x] Printed bill shows Property No, UGVCL No, Share Cert No when the resident has them
- [x] Plan checkout shows base + GST (from the platform GST setting); prices say "incl. GST" when tax applies
- [x] Clear "Flat limit reached" and "already billed this month" messages
- [x] Generate bills skips homes already billed for that month; links to Bill one home and Bill from a cycle
- [x] Bill-from-cycle page carries the billing tabs
- [x] Dashboard chart counts confirmed payments by paid date (matches the Collected card)
- [x] Bill design page can no longer spin forever (15s limit, then retry)
- [x] Super Admin auto sign-out after 30 idle minutes
- [ ] Signed-in check of every role and the new bill pages — blocked: preview is signed into a real account, not the demo account
- [ ] Owner decision: big-refund second approval, platform staff roles (Operations/Finance/Marketing/Support), maintenance mode, scheduled notifications, backups page
- [ ] Owner decision: move Partner programme out of Profile
