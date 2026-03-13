# Intake: Remove Top Bar Line 2

**Change**: 260313-zvgc-remove-top-bar-line-2
**Created**: 2026-03-13
**Status**: Draft

## Origin

> Conversational — user proposed moving the 3 buttons (`+ Session`, `Rename`, `Kill`) from the top bar line 2 into the left panel sidebar. Discussion explored scope of each action (session-level vs window-level), the existing `+ ×` per-group controls, the `(i)` popup as an action surface, and where to relocate the fixed-width toggle.

Key decisions from the discussion:
1. All session/window actions (`+ Session`, `Rename`, `Kill`, status indicator) already exist in the `(i)` popup — no new UI needed for those
2. The fixed-width toggle moves to top bar line 1, positioned between the "live" connection indicator and the `⌘K` button
3. Top bar line 2 is deleted entirely
4. Both breadcrumb dropdowns (session and window) get a `+ New` action as their first item, separated by a divider from the selection list
5. Empty sidebar state shows a `+ New Session` button so there's always a creation affordance

## Why

1. **Redundancy**: Every action on line 2 (new session, rename, kill, window status) is already available in the sidebar's `(i)` popup and per-session `+ ×` controls. Line 2 duplicates existing affordances.
2. **Vertical space**: Line 2 consumes ~40px of vertical space that could go to the terminal. On mobile it's already `hidden sm:flex`, so it provides zero value on small screens.
3. **Simplification**: Removing an entire UI row reduces visual complexity and aligns with the constitution's "Minimal Surface Area" principle (§IV).

If we don't do this, the UI continues to show two surfaces for the same actions, wasting space and creating ambiguity about which is the "real" control.

## What Changes

### 1. Remove top bar line 2 entirely

Delete the entire second row of `top-bar.tsx` (lines ~143-218), which contains:
- `+ Session` button (lines 146-151)
- `Rename` button (lines 154-159)
- `Kill` button (lines 160-166)
- Window activity status / command / duration display (lines 171-214)
- `FixedWidthToggle` invocation (line 216)

The containing `<div>` with `hidden sm:flex` wrapper is removed completely.

### 2. Relocate FixedWidthToggle to line 1

Move the `FixedWidthToggle` component (currently defined at lines 223-268 in `top-bar.tsx`) into the right-side section of line 1, between the connection status indicator and the `⌘K` button.

Current line 1 right section order:
```
[● live] [⌘K]
```

New order:
```
[● live] [⇔] [⌘K]
```

The `FixedWidthToggle` component itself needs no behavioral changes — it's a self-contained component using `useChrome()` and `useChromeDispatch()`. Only its placement in the JSX tree changes.

### 3. Add `+ New` action to breadcrumb dropdowns

Both the session and window breadcrumb dropdowns (`breadcrumb-dropdown.tsx`) get a creation action as their first item:

- **Session dropdown**: `+ New Session` → triggers new session creation (same action as the old `+ Session` button)
- **Window dropdown**: `+ New Window` → triggers new window creation in the current session (same as the per-session `+` icon)

Layout within each dropdown:
```
┌─────────────────┐
│ + New Session    │  ← action item
│─────────────────│  ← divider
│ ● fab_kit        │  ← selection list
│ ● loom           │
└─────────────────┘
```

The `+ New` item is visually distinct from selection items (e.g., different text style or icon prefix) and separated by a subtle divider line. It does not participate in the "current item" highlight logic — it's an action, not a selection.

### 4. Empty sidebar state

When no sessions exist, the sidebar shows a centered `+ New Session` button so there's always a visible creation affordance. This replaces the role that the old `+ Session` button on line 2 served for first-time or empty-state users.

### 5. Responsive behavior

- Line 1 already displays on all screen sizes — adding the toggle there makes it accessible on mobile (unlike line 2 which was `hidden sm:flex`)
- The toggle button is small (icon-only) and fits comfortably in the existing line 1 layout
- Touch target sizing: apply `coarse:min-h-[36px] coarse:min-w-[28px]` consistent with other top bar buttons

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update to reflect removal of top bar line 2 and new toggle location

## Impact

- **Frontend only**:
  - `app/frontend/src/components/top-bar.tsx` — remove line 2 JSX, relocate toggle
  - `app/frontend/src/components/breadcrumb-dropdown.tsx` — add `+ New` action item with divider
  - Sidebar component — add empty-state `+ New Session` button
- **No backend changes**: No API, SSE, or WebSocket changes
- **Mobile**: Responsive context in `fab/project/context.md` references line 2 being `hidden sm:flex` — that note becomes obsolete
- **Tests**: Any tests referencing line 2 elements or the toggle's position may need updates

## Open Questions

None — all decisions resolved during discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Line 2 is removed entirely, not just hidden | Discussed — user confirmed all line 2 content is redundant with (i) popup | S:95 R:85 A:90 D:95 |
| 2 | Certain | FixedWidthToggle moves between live indicator and ⌘K | Discussed — user explicitly chose this position after reviewing screenshot | S:95 R:90 A:90 D:95 |
| 3 | Certain | No new actions added to (i) popup | Discussed — user confirmed actions already exist there | S:90 R:90 A:85 D:90 |
| 4 | Certain | Breadcrumb dropdowns get `+ New` as first item with divider | Discussed — user proposed this as replacement for `+ Session` button | S:90 R:85 A:85 D:90 |
| 5 | Certain | Empty sidebar shows `+ New Session` button | Discussed — user identified need for creation affordance when no sessions exist | S:85 R:85 A:85 D:90 |
| 6 | Confident | FixedWidthToggle component internals unchanged | Only placement changes; component is self-contained with its own hooks | S:80 R:90 A:85 D:85 |
| 7 | Confident | `+ New` item in dropdown does not participate in current-item highlight | It's an action, not a selection — different semantic from the list items | S:70 R:90 A:80 D:80 |
| 8 | Confident | Touch target sizing follows existing coarse: pattern | Project context specifies `coarse:min-h-[36px] coarse:min-w-[28px]` for top bar buttons | S:75 R:90 A:85 D:85 |
| 9 | Confident | context.md line about line 2 being `hidden sm:flex` should be updated | The referenced behavior no longer exists after this change | S:70 R:90 A:80 D:85 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).
