# UI Design System V2

Central visual contract for SociyoHub V2. Every new screen created under
the V2 roadmap must reuse these tokens. Existing tokens in `src/styles.css`
that already match this contract are preserved — this document does not
force renames.

## Core color tokens

```
--brand-primary:        #00A896
--brand-primary-strong: #007E70
--brand-primary-dark:   #005F54
--brand-accent:         #06B6A4
--brand-foreground:     #0B2545
--page-background:      #F6F8F7
--surface-solid:        #FFFFFF
--surface-muted:        #F2F7F6
--border-default:       #DDE9E6
--divider:              #E9EFED
--text-secondary:       #667085
--text-tertiary:        #98A2B3
```

## Semantic tokens

```
--success:      #12B76A   --success-soft: #EAFBF3
--warning:      #F79009   --warning-soft: #FFF6E8
--danger:       #F04438   --danger-soft:  #FFF0F1
--info:         #2E90FA   --info-soft:    #EEF8FF
--purple:       #7A5AF8   --purple-soft:  #F5F1FF
```

Status must never rely on color alone. Always pair with icon + label.

## Gradients

Primary:
```
linear-gradient(135deg, #007E70 0%, #00A896 55%, #06B6A4 100%)
```

Dark financial hero:
```
linear-gradient(135deg, #004F47 0%, #007E70 52%, #00A896 100%)
```

## Borders, focus, shadow

- Default border: `1px solid #DDE9E6`
- Selected border: `1.5px solid #00A896`
- Error border: `1px solid #F04438`
- Focus ring: `0 0 0 3px rgba(6, 182, 164, 0.18)`
- Card shadow: `0 8px 30px rgba(11, 37, 69, 0.07)`
- Elevated shadow: `0 14px 40px rgba(11, 37, 69, 0.11)`

## Glass (used sparingly)

Only for: sticky header, bottom navigation, modal/dialog, floating action
container, and selected premium hero overlays.

```
background:        rgba(255, 255, 255, 0.84);
backdrop-filter:   blur(18px);
border:            1px solid rgba(255, 255, 255, 0.72);
box-shadow:        0 10px 34px rgba(11, 37, 69, 0.09);
```

## Radii

| Element | Radius |
|---|---|
| Major hero | 24px |
| Standard card | 18px |
| Compact list card | 16px |
| Input / select | 14px |
| Icon tile | 14px |
| Button | 14px |
| Chip / pill | 999px |

## Spacing

- Mobile horizontal page padding: 16px
- Desktop horizontal padding: 24–32px
- Section gap: 20px • Card gap: 12px
- Card internal padding: 16px • Dense list padding: 14px
- Form field vertical gap: 14px
- Touch target minimum: 44 × 44 px

## Typography

Existing high-quality sans-serif UI font. Brand wordmark uses
`SociyoHubLogo` / `SociyoHubMark`.

| Role | Size / Line / Weight |
|---|---|
| Page title | 28 / 34 / 700 |
| Section title | 18 / 24 / 700 |
| Card value | 24 / 30 / 700 |
| Row title | 15 / 21 / 600 |
| Body | 14 / 20 / 400 |
| Helper | 12 / 17 / 400 |

Money uses tabular numerals and Indian number formatting; the `₹` glyph is
never clipped.

## Icon tiles

44 px square, 14 px radius, semantic pastel background, 20–22 px icon in
one strong semantic color.

## Motion

- 160–220 ms, ease-out.
- Respect `prefers-reduced-motion`.
- No page-level animation blocking forms or financial actions.

## Composition rules

1. Clean white / off-white background.
2. Navy page titles (`--brand-foreground`).
3. Emerald primary actions (`--brand-primary`).
4. Soft pastel icon tiles.
5. Summary rows: 4-across on desktop, 2×2 on mobile.
6. Segmented tabs in a subtle rounded container.
7. Large financial values with clear labels.
8. Compact list rows: title • meta • status • chevron.
9. Sticky glass bottom actions when a mobile form is long.
10. Bottom nav respects safe-area insets.
11. Desktop layouts expand — never stretch mobile cards.
12. Explicit empty, loading, and error states.
13. No decorative element hides financial data.

## References vs code

The provided design PDFs are **visual references**, not sources of truth.
Take layout hierarchy, spacing, card proportions, tab shapes, and status
chip language from them. Ignore any "SocioHub" spelling, sample names,
fake amounts, outdated pricing, unsupported payment options, or unshipped
features they contain. Latest code + product decisions always win.
