# Plan — Bill Studio, Property Templates, AI defaults

Scope: do everything in this plan before touching Firebase/OTP.

---

## 1. Bill Studio (Society Admin)

New page: `/society/bill-studio` — replaces the old "click Generate every month" flow.

Admin sets ONCE per society:
- **Maintenance amount** (₹ per flat / per sqft / per BHK — pick mode)
- **Billing cycle**: Weekly · Monthly · Quarterly
- **Cycle anchor**: start day (e.g. 1st of month), due-after (e.g. 10 days)
- **Auto-generate**: ON/OFF toggle
- **Late fee**: flat ₹ or % per day after due
- **Pro-rate** new residents joining mid-cycle: ON/OFF

System then auto-creates bills for every flat/unit on schedule. Admin sees:
- Next run date
- Last run summary (X bills generated, ₹Y total)
- "Run now" button for manual trigger
- Per-unit override (one flat pays different amount → edit)

Tech:
- New table `billing_schedules` (society_id, mode, amount, cycle, anchor_day, due_offset_days, late_fee_type, late_fee_value, prorate, enabled, last_run_at, next_run_at)
- New table `unit_billing_overrides` (flat_id, amount, reason)
- pg_cron job hits `/api/public/hooks/run-billing` daily; route reads schedules where `next_run_at <= now()`, generates bills, advances `next_run_at`
- Existing `bills` page becomes read-only ledger; "Generate" button moves into Bill Studio

---

## 2. Property Templates — Blocks, Bungalows, Mixed

Add `property_type` to `societies`: `apartment` | `bungalow` | `mixed`.
Add `unit_type` to `flats`: `flat` | `bungalow` | `villa` | `shop` (rename table eventually — keep `flats` for now).

New page: `/society/blocks` gets:
- **Block Template Builder** — admin defines Block A once: floors, flats-per-floor, naming pattern (e.g. `A-101, A-102`), default BHK/sqft
- **Duplicate block** — one click → creates Block B with same structure, just renames prefix. Repeat for C, D, …
- **Edit per block** — after duplication, admin can add/remove individual units in any block independently
- For **bungalows**: skip floors, just "how many bungalows + naming pattern (B-1…B-50)"
- For **mixed**: admin adds blocks AND a bungalow group in the same society

AI assist button: "Describe your society" → free text ("3 towers 10 floors 4 flats each + 20 bungalows") → AI proposes the full structure → admin reviews → one-click create. Uses Lovable AI gateway (Gemini flash, no key needed).

---

## 3. Other gaps from master prompt (Executive Dark / Material 3 / mobile-first)

Quick audit & fixes:
- Confirm all new screens use `rounded-2xl`, dark theme tokens, mobile-first
- Bill Studio + Block Builder must work cleanly at 320px width
- Add empty-state illustrations consistently

---

## 4. Technical sections

### DB migration (single migration)
```sql
ALTER TABLE societies ADD COLUMN property_type text DEFAULT 'apartment'
  CHECK (property_type IN ('apartment','bungalow','mixed'));
ALTER TABLE flats ADD COLUMN unit_type text DEFAULT 'flat';

CREATE TABLE billing_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  society_id uuid NOT NULL REFERENCES societies(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'flat',  -- flat | per_sqft | per_bhk
  amount numeric NOT NULL,
  cycle text NOT NULL DEFAULT 'monthly', -- weekly | monthly | quarterly
  anchor_day int NOT NULL DEFAULT 1,
  due_offset_days int NOT NULL DEFAULT 10,
  late_fee_type text DEFAULT 'none', -- none | flat | percent
  late_fee_value numeric DEFAULT 0,
  prorate boolean DEFAULT true,
  enabled boolean DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(society_id)
);
-- + GRANT + RLS (society_admin only) + service_role for cron

CREATE TABLE unit_billing_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flat_id uuid NOT NULL REFERENCES flats(id) ON DELETE CASCADE,
  amount numeric NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now()
);
-- + GRANT + RLS
```

### Server route for cron
`src/routes/api/public/hooks/run-billing.ts` — iterates due schedules, generates bills via service role.

### pg_cron
Daily at 02:00 UTC → POST to `/api/public/hooks/run-billing`.

### Files to create
- `src/routes/_society/society.bill-studio.tsx`
- `src/routes/api/public/hooks/run-billing.ts`
- `src/lib/billing.functions.ts` (run-now serverFn for admin)
- `src/lib/blocks-ai.functions.ts` (AI parse "describe your society")

### Files to edit
- `src/routes/_society/society.blocks.tsx` — duplicate-block UI, AI assist
- `src/routes/_society/society.billing.tsx` — link to Bill Studio, remove manual Generate dialog (or keep as "one-off")
- `src/components/shared/AppSidebar.tsx` — add Bill Studio menu item

---

## What I will NOT do in this round
- Firebase FCM / Phone OTP (next round per your message)
- Camera / microphone / location permissions (next round)

Reply ✅ to ship this, or tell me what to drop/add.
