---
name: Dynamic Resident Profile Fields
description: Per-society custom profile fields with order, required, and visibility
type: feature
---
Per-society custom resident profile fields. Types: text, number, dropdown, date, checkbox, file, image.
Per-field attributes: `sort_order`, `required` (bool), `visibility` (resident_editable | admin_only | hidden), `options` (jsonb for dropdown).
Admin can reorder fields (sort_order). Residents get a notification when a required field is added.
Tables (Phase 3): `custom_fields` (society_id, key, label, type, sort_order, required, visibility, options), `custom_field_values` (field_id, user_id, value jsonb, file_path).
