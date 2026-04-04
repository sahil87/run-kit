# Intake: Fix Dashboard and Dropdown Scrollability

**Change**: 260404-xmrw-fix-dashboard-dropdown-scroll
**Created**: 2026-04-04
**Status**: Draft

## Origin

> The dashboard page(s) and the session and window dropdowns from the top bar aren't scrollable - fix this

Two separate (but related) scrollability bugs were identified by reading the source code:

1. **Dashboard** (`app/frontend/src/components/dashboard.tsx`): The root div uses `flex-1 flex flex-col` but is missing `min-h-0`. In flexbox, without `min-h-0`, a flex item's minimum height defaults to `auto` (its content's natural height), so the inner `overflow-y-auto` div at line 44 can never actually constrain — it expands to fit all content instead of scrolling.

2. **BreadcrumbDropdown** (`app/frontend/src/components/breadcrumb-dropdown.tsx`): The dropdown menu container at line 104 has no `max-h` or `overflow-y` property at all. With many sessions or windows the dropdown grows beyond the viewport with no scroll capability.

## Why

**Dashboard**: When there are many sessions (e.g., 10+ with several windows each), the card grid overflows the screen without scrolling. The flexbox overflow chain requires every intermediate `flex-col` container in the ancestor chain to have `min-h-0` for `overflow-y-auto` to engage. The dashboard root div is the missing link.

**Dropdowns**: With more than ~8-10 sessions or windows, the session/window dropdowns in the top bar grow unboundedly off-screen. There is no visual affordance to scroll and no mechanism to reach items below the viewport.

If unfixed: users with many sessions/windows cannot access all their content from either the dashboard or the navigation dropdowns.

## What Changes

### 1. Dashboard root div — add `min-h-0`

**File**: `app/frontend/src/components/dashboard.tsx`, line 34

```diff
- <div className="flex-1 flex flex-col">
+ <div className="flex-1 min-h-0 flex flex-col">
```

This completes the flex overflow chain:
- Outer terminal column: `flex-1 min-w-0 flex flex-col overflow-hidden` ✓
- Inner wrapper: `flex-1 min-h-0 flex flex-col` ✓
- Dashboard root: `flex-1 flex flex-col` ← missing `min-h-0` (this fix)
- Scrollable card area: `flex-1 min-h-0 overflow-y-auto` ✓ (already present, line 44)

### 2. BreadcrumbDropdown menu — add `max-h` and `overflow-y-auto`

**File**: `app/frontend/src/components/breadcrumb-dropdown.tsx`, line 104

```diff
- className="absolute top-full left-0 mt-1 bg-bg-primary border border-border rounded-lg shadow-2xl py-1 min-w-[160px] max-w-[240px] z-50"
+ className="absolute top-full left-0 mt-1 bg-bg-primary border border-border rounded-lg shadow-2xl py-1 min-w-[160px] max-w-[240px] z-50 max-h-60 overflow-y-auto"
```

`max-h-60` (240px) accommodates ~10 items before scrolling, which is consistent with `command-palette.tsx` (`max-h-64`) and `create-session-dialog.tsx` (`max-h-48`). The whole dropdown (including the action button if present) scrolls — this is acceptable since the "New" action appears first and is visible on open.

## Affected Memory

- No memory updates required — implementation-only fix, no spec-level behavior change.

## Impact

- `app/frontend/src/components/dashboard.tsx` — one-character addition (`min-h-0`) to root div
- `app/frontend/src/components/breadcrumb-dropdown.tsx` — two Tailwind classes added to menu container

Frontend tests were added/updated to cover the dashboard and dropdown scrollability fixes.

No API or backend changes needed. Implementation changes are purely additive CSS class tweaks.

## Open Questions

None — both root causes are definitively identified from the source code.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix is CSS-only (Tailwind class additions) | Root causes identified from source; no logic changes needed | S:90 R:95 A:95 D:90 |
| 2 | Certain | Dashboard fix = add `min-h-0` to root div | Standard flexbox overflow pattern; inner `overflow-y-auto` already exists at line 44 | S:90 R:95 A:95 D:95 |
| 3 | Certain | Change type = `fix` | Restoring expected scroll behavior to existing UI | S:90 R:95 A:95 D:90 |
| 4 | Confident | `max-h-60` for BreadcrumbDropdown (240px, ~10 items) | Consistent with command-palette (max-h-64) and create-session-dialog (max-h-48); no user preference specified | S:70 R:85 A:80 D:75 |
| 5 | Confident | Action button scrolls with items (no pinning) | Simplest correct fix; action is always first so visible on open; user didn't specify pinning requirement | S:65 R:85 A:75 D:70 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).
