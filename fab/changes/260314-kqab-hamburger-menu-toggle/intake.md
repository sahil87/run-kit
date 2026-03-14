# Intake: Hamburger Menu Toggle

**Change**: 260314-kqab-hamburger-menu-toggle
**Created**: 2026-03-14
**Status**: Draft

## Origin

> I want to replace the top left logo with a hamburger icon that controls the left bar / menu

One-shot request. User confirmed this is a visual swap — the toggle mechanism already exists.

## Why

The current top-left button renders the project logo SVG (`/logo.svg`) as the sidebar/drawer toggle. A hamburger icon (☰) is a universally recognized navigation toggle affordance — users immediately understand it opens/closes a menu. The logo, while functional, doesn't signal "toggle navigation" to new users. Replacing it improves discoverability of the sidebar toggle without changing any behavior.

## What Changes

### Replace logo image with hamburger icon in top bar

In `app/frontend/src/components/top-bar.tsx`, the logo button (lines ~69-81) currently renders:

```tsx
<img src="/logo.svg" alt="RunKit" width={20} height={20} />
```

Replace with a hamburger icon — either:
- Unicode `☰` (U+2630) rendered as text, or
- An inline SVG (three horizontal lines)

The button's `onClick` handler, `aria-label`, className, and touch target sizing (`coarse:min-w-[36px] coarse:min-h-[36px]`) remain unchanged. Only the visual content inside the button changes.

### Breadcrumb separator

The breadcrumb currently reads `{logo} ❯ {session} ❯ {window}`. After this change it becomes `{☰} ❯ {session} ❯ {window}`. No structural change to the `BreadcrumbDropdown` components or their behavior.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update Chrome section — logo toggle description changes to hamburger icon

## Impact

- **Files**: `app/frontend/src/components/top-bar.tsx` (1 file, ~2 lines changed)
- **Tests**: Existing tests reference the toggle button by `aria-label="Toggle navigation"`, not by the logo image — no test changes expected
- **Visual**: The top-left corner changes from a hexagonal logo to a ☰ icon on all viewports

## Open Questions

None — scope is clear.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Toggle behavior unchanged | User confirmed visual swap only — onClick, aria-label, touch targets stay the same | S:95 R:95 A:95 D:95 |
| 2 | Confident | Use inline SVG hamburger (three lines) over Unicode ☰ | SVG gives precise control over size, stroke width, and color consistency with the design system. Unicode rendering varies across browsers/OS | S:70 R:90 A:80 D:70 |
| 3 | Certain | No logo.svg deletion | Other parts of the app may reference it (favicon, PWA manifest). Only removing it from the toggle button | S:80 R:90 A:85 D:90 |

3 assumptions (2 certain, 1 confident, 0 tentative, 0 unresolved).
