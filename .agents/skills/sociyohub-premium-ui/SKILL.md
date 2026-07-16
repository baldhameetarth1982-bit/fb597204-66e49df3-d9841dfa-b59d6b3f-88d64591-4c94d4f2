---
name: sociyohub-premium-ui
description: Use when building or refining a SociyoHub UI surface (screen, dialog, form, list, empty state) with premium restraint, correct tokens, accessibility, responsive coverage and considered motion. Do not use for pure server function work, migrations, RLS, or documentation.
---

# SociyoHub Premium UI

SociyoHub UI is calm, restrained, and accessible. It reuses existing components, honours design tokens, and treats motion as meaning, not decoration.

## Existing component search first

Before creating any UI:

1. Search `src/components/**` and `src/features/**` for an existing component that already fits.
2. Check shadcn/ui primitives already installed under `src/components/ui/**`.
3. Check Radix primitives used elsewhere for dialogs, menus, popovers.

Only if no existing component fits, create a new one — and place it under the correct feature or the shared components tree.

## shadcn and Radix reuse

- Prefer composing shadcn/ui components over rewriting them.
- Prefer Radix primitives for behaviour (focus management, keyboard support, ARIA roles) instead of hand-rolling.
- If a shadcn component is close but not identical, extend via composition, not by forking upstream source.

## Internal comparison for missing components

When a genuinely new component is required, compare up to three internal patterns already used in SociyoHub:

- How similar lists render (spacing, dividers, empty states).
- How similar dialogs behave (close-on-outside-click, keyboard trap, animation).
- How similar forms validate (inline errors, focus on first invalid).

Choose the closest pattern and extend it. Do not import an external component library.

## 44×44 touch targets

- All interactive controls have a minimum hit area of 44×44 CSS pixels on touch devices.
- Icon-only buttons include an accessible name (`aria-label` or visually hidden text).
- Adjacent controls have enough spacing to avoid mis-taps on 360–414 wide viewports.

## Keyboard support

- Every interaction reachable by mouse or touch must be reachable by keyboard.
- Focus order follows visual order.
- `Escape` closes dialogs and popovers.
- `Enter` submits forms unless the form intentionally requires an explicit primary button.

## Focus visibility

- Never remove focus outlines without providing a clearly visible replacement.
- Focus indicators must meet WCAG contrast requirements against the surrounding surface, in both light and dark themes.

## Screen-reader labels

- Buttons, inputs, and form fields have explicit labels.
- Decorative icons are `aria-hidden`.
- Status messages that convey state changes (saved, failed, plan updated) use `role="status"` or `aria-live="polite"` where appropriate.

## Reduced motion

- Respect `prefers-reduced-motion`.
- When reduced motion is requested, replace non-essential transitions with instant state changes; keep essential feedback (focus, error appearance) intact.

## Responsive widths

Every screen is verified at:

- 360, 390, 414 (typical Indian resident mobile viewports).
- 768 (tablet).
- 1280 (desktop / society admin dashboard).

Content must not overflow, truncate primary CTAs, or hide critical status.

## Apple-quality restraint

- Prefer a small number of type sizes, weights and colours.
- Avoid heavy gradients, glassmorphism, and neon glows unless a specific token or established pattern already sanctions them for that surface.
- Whitespace is a design element, not a bug.

## Meaningful motion (160–220ms)

Motion has purpose:

- Confirm state change (a payment status transition).
- Guide attention (a new toast entering).
- Signal hierarchy (a dialog rising above the surface).

Duration is typically 160–220ms with a natural easing curve. Avoid animations that block interaction or repeat idly.

## Premium hierarchy, typography and spacing

- Clear primary, secondary, tertiary type roles.
- Consistent line-height and letter-spacing.
- Spacing scales derived from the design tokens; never magic numbers.
- One primary action per screen; secondary actions visually subordinated.

## No excessive gradients, glass or animation

- Backgrounds are quiet.
- Cards have subtle borders and shadows appropriate to elevation, not competing effects.
- Motion is applied deliberately, not to every element that could animate.

## No fake states

Loading, empty, error and success states are real:

- Loading: skeletons approximate final layout; no spinners for 10ms.
- Empty: honest empty message with a clear next step (create, invite, add).
- Error: a plain explanation, a retry action, and a route to support where relevant.
- Success: confirms what actually happened, using data from the server response.

Never fake progress or fake success. Never show a spinner that spins forever.

## SociyoHub design tokens

- Use tokens from `src/styles.css` and `docs/UI_DESIGN_SYSTEM_V2.md` for colours, gradients, radii, shadows, spacing, and typography.
- Never hardcode colour utility classes (`bg-white`, `text-black`, `bg-[#abcdef]`) in components.
- Dark theme must render every screen without contrast failures or invisible text.

## Handoff

After finishing a UI surface, hand off to `sociyohub-testing-e2e` for role- and viewport-based tests, and to `sociyohub-verification-gate` for evidence.
