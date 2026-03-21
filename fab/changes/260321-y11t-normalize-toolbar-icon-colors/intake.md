# Intake: Normalize Toolbar Icon Colors

**Change**: 260321-y11t-normalize-toolbar-icon-colors
**Created**: 2026-03-21
**Status**: Draft

## Origin

> User noticed via visual inspection (screenshots) that the foreground color of toolbar icons was inconsistent across the top bar and bottom bar. Some buttons used `text-text-primary` (bright white in dark mode) while neighboring buttons used `text-text-secondary` (muted gray). The user requested all toolbar buttons be normalized to `text-text-secondary` for visual consistency.

One-shot fix — the user identified the issue, confirmed the desired state via screenshots at each step (top bar, bottom bar, arrow pad).

## Why

The toolbar icons across the top bar and bottom bar use an inconsistent mix of `text-text-primary` and `text-text-secondary` Tailwind classes for their default (inactive) foreground color. This creates a visual hierarchy where some buttons appear brighter/more prominent than others despite having equal importance. The inconsistency is noticeable in dark mode where the contrast between primary and secondary text colors is more pronounced.

If left unfixed, the UI chrome looks unpolished — some icons draw the eye while others recede, with no intentional design rationale behind the difference.

## What Changes

### Top Bar — `app/frontend/src/components/top-bar.tsx`

The compose button (`>_`) uses `text-text-primary hover:text-text-primary`. Changed to `text-text-secondary hover:border-text-secondary` to match the ThemeToggle and FixedWidthToggle inactive styles.

```tsx
// Before
className="text-text-primary hover:text-text-primary ..."

// After
className="text-text-secondary hover:border-text-secondary ..."
```

### Bottom Bar — `app/frontend/src/components/bottom-bar.tsx`

Four button groups used `text-text-primary` in their default state:

1. **Esc button** — `text-text-primary` → `text-text-secondary`
2. **Tab button** — `text-text-primary` → `text-text-secondary`
3. **Ctrl/Alt modifier buttons** (inactive state) — `text-text-primary` → `text-text-secondary` (active state remains `text-accent`)
4. **Fn popup trigger** — `text-text-primary` → `text-text-secondary`

The `⌘K` command palette button already used `text-text-secondary` — no change needed.

### Arrow Pad — `app/frontend/src/components/arrow-pad.tsx`

The arrow pad trigger button used `text-text-primary`. Changed to `text-text-secondary`.

### What stays the same

- Active toggle states (`text-accent` with `bg-accent/10` or `bg-accent/20`) are unchanged — these correctly use accent color to indicate active state (Ctrl/Alt modifiers, FixedWidthToggle)
- Hover/active/focus-visible states in `KBD_CLASS` are unchanged
- Function key popup items and extended key items already used `text-text-secondary`

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the toolbar color convention — all toolbar buttons use `text-text-secondary` default, `text-accent` for active toggles

## Impact

- **3 files changed**: `top-bar.tsx`, `bottom-bar.tsx`, `arrow-pad.tsx`
- Visual-only change — no behavior, API, or accessibility changes
- Affects both light and dark themes (the token resolves to different values per theme)

## Open Questions

None — the change is fully implemented and verified via screenshots.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | All toolbar buttons use `text-text-secondary` as default foreground | Discussed — user explicitly requested this normalization and confirmed via screenshots | S:95 R:90 A:95 D:95 |
| 2 | Certain | Active toggle states keep `text-accent` styling | Discussed — user only flagged inactive state inconsistency, active states were already correct | S:90 R:90 A:90 D:95 |
| 3 | Certain | Hover states use `hover:border-text-secondary` (border highlight, not text change) | Matches existing pattern used by ThemeToggle and FixedWidthToggle | S:85 R:90 A:90 D:90 |

3 assumptions (3 certain, 0 confident, 0 tentative, 0 unresolved).
