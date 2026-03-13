# Spec: Remove Top Bar Line 2

**Change**: 260313-zvgc-remove-top-bar-line-2
**Created**: 2026-03-13
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Top Bar: Line 2 Removal

### Requirement: Remove Line 2 Entirely

The top bar component (`app/frontend/src/components/top-bar.tsx`) SHALL remove the entire Line 2 `<div>` (lines 143–218), including all action buttons (`+ Session`, `Rename`, `Kill`), the window status display, and the `FixedWidthToggle` invocation.

The Line 2 wrapper `<div className="hidden sm:flex ...">` and all its children SHALL be deleted. No remnant markup, data attributes, or conditional renders for Line 2 SHALL remain.

#### Scenario: Line 2 No Longer Renders

- **GIVEN** the top bar component is rendered
- **WHEN** the viewport is any width (mobile or desktop)
- **THEN** no Line 2 row is present in the DOM
- **AND** the top bar consists solely of Line 1

#### Scenario: Vertical Space Reclaimed

- **GIVEN** the top bar previously rendered Line 2 with `min-h-[36px]` and `py-2`
- **WHEN** Line 2 is removed
- **THEN** the header element contains only the Line 1 `<div>`
- **AND** the terminal area gains the vertical space previously consumed by Line 2

### Requirement: Remove Line 2 Props from TopBar

The `TopBarProps` type SHALL remove the `onRename`, `onKill`, and `onCreateSession` callback props that were exclusively used by Line 2 buttons. The `currentWindow` and `currentSession` props SHALL be retained only if still referenced by Line 1 logic; otherwise they SHALL also be removed.

#### Scenario: Unused Props Removed

- **GIVEN** `onRename`, `onKill`, and `onCreateSession` are only used in Line 2 JSX
- **WHEN** Line 2 is deleted
- **THEN** these props are removed from `TopBarProps`
- **AND** their call sites in the parent component no longer pass them

## Top Bar: FixedWidthToggle Relocation

### Requirement: Move FixedWidthToggle to Line 1

The `FixedWidthToggle` component SHALL be rendered in Line 1's right-side section, positioned between the connection status indicator (`live`/`disconnected` label) and the `⌘K` kbd element.

The new rendering order in the right-side `<div>` SHALL be:
1. Connection dot + label
2. `<FixedWidthToggle />`
3. `⌘K` kbd (desktop) / `⋯` button (mobile)

#### Scenario: Toggle Visible on Desktop

- **GIVEN** viewport width >= 640px (sm breakpoint)
- **WHEN** the top bar renders
- **THEN** the FixedWidthToggle appears between "live" and "⌘K"

#### Scenario: Toggle Visible on Mobile

- **GIVEN** viewport width < 640px
- **WHEN** the top bar renders
- **THEN** the FixedWidthToggle is visible (unlike before, when it was hidden with Line 2's `hidden sm:flex`)
- **AND** the `⋯` palette trigger button appears after the toggle

### Requirement: FixedWidthToggle Component Unchanged

The `FixedWidthToggle` component's internal implementation (hooks, SVG icon, aria attributes, styling) SHALL NOT be modified. Only its position in the JSX tree changes.

#### Scenario: Toggle Behavior Preserved

- **GIVEN** the FixedWidthToggle is rendered in Line 1
- **WHEN** the user clicks the toggle
- **THEN** it toggles between fixed and full width as before
- **AND** the visual states (border-accent active, border-border inactive) are preserved

### Requirement: FixedWidthToggle Touch Target

The FixedWidthToggle in Line 1 SHALL have touch-appropriate sizing consistent with other Line 1 buttons: `coarse:min-h-[36px] coarse:min-w-[28px]`.

#### Scenario: Touch Target Sizing

- **GIVEN** a touch device (pointer: coarse)
- **WHEN** the top bar renders
- **THEN** the FixedWidthToggle has minimum height 36px and minimum width 28px

## Breadcrumb Dropdowns: New Action Items

### Requirement: Session Dropdown Has New Session Action

The session `BreadcrumbDropdown` SHALL render a `+ New Session` action as the first item, separated from the session list by a visual divider (`border-t border-border`).

Clicking `+ New Session` SHALL trigger the same session creation flow as the old `+ Session` button (calling `onCreateSession`).

The `+ New Session` item SHALL NOT participate in current-item highlight logic (no `text-accent` styling when any session is selected). It is an action, not a selection.

#### Scenario: New Session Action in Dropdown

- **GIVEN** the session breadcrumb dropdown is open
- **WHEN** the user views the dropdown
- **THEN** `+ New Session` is the first item
- **AND** a divider separates it from the session list below
- **AND** it is styled distinctly from selection items

#### Scenario: New Session Action Triggers Creation

- **GIVEN** the session breadcrumb dropdown is open
- **WHEN** the user clicks `+ New Session`
- **THEN** the session creation dialog opens
- **AND** the dropdown closes

### Requirement: Window Dropdown Has New Window Action

The window `BreadcrumbDropdown` SHALL render a `+ New Window` action as the first item, separated from the window list by a visual divider.

Clicking `+ New Window` SHALL trigger new window creation in the current session (same action as the per-session `+` icon in the sidebar).

The `+ New Window` item SHALL NOT participate in current-item highlight logic.

#### Scenario: New Window Action in Dropdown

- **GIVEN** the window breadcrumb dropdown is open
- **WHEN** the user views the dropdown
- **THEN** `+ New Window` is the first item
- **AND** a divider separates it from the window list below

#### Scenario: New Window Action Triggers Creation

- **GIVEN** the window breadcrumb dropdown is open
- **WHEN** the user clicks `+ New Window`
- **THEN** a new window is created in the current session
- **AND** the dropdown closes

### Requirement: BreadcrumbDropdown Action Item Support

The `BreadcrumbDropdown` component SHALL accept an optional `action` prop of type `{ label: string; onAction: () => void }`. When provided, the action item renders before the selection list, separated by a divider. The action item:
- Uses `text-text-primary` styling (not `text-accent` for current)
- Has a `+` prefix or similar visual distinction
- Does NOT receive focus-index tracking from ArrowUp/ArrowDown keyboard navigation among selection items
- Closes the dropdown on click

#### Scenario: Keyboard Navigation Skips Action Item

- **GIVEN** the dropdown is open with an action item and selection items
- **WHEN** the user presses ArrowDown
- **THEN** focus moves among selection items only
- **AND** the action item is not part of the keyboard navigation cycle

## Sidebar: Empty State

### Requirement: Empty State Shows New Session Button

When no sessions exist (`sessions.length === 0`), the sidebar SHALL display a centered `+ New Session` button instead of the current "No sessions" text-only message.

The button SHALL trigger the same session creation flow as the breadcrumb dropdown's `+ New Session` action.

#### Scenario: Empty State with Creation Affordance

- **GIVEN** no tmux sessions exist
- **WHEN** the sidebar renders
- **THEN** a `+ New Session` button is displayed
- **AND** clicking it opens the session creation dialog

#### Scenario: Button Replaces Text-Only Empty State

- **GIVEN** the sidebar currently shows "No sessions" as plain text
- **WHEN** this change is applied
- **THEN** the empty state includes a clickable `+ New Session` button
- **AND** the "No sessions" label MAY be retained as secondary text above or below the button

## Deprecated Requirements

### Line 2 Action Bar

**Reason**: All Line 2 actions (`+ Session`, `Rename`, `Kill`, window status) are accessible through the sidebar's `(i)` popup, per-session `+ ✕` controls, and now the breadcrumb dropdown `+ New` actions. Line 2 is redundant.

**Migration**: `+ Session` → breadcrumb session dropdown `+ New Session`. `Rename`/`Kill` → sidebar `(i)` popup and command palette. Window status display → sidebar window rows (activity, duration, fab stage). `FixedWidthToggle` → Line 1 right section.

### Line 2 Mobile Collapse (`⋯` Pattern)

**Reason**: The `hidden sm:flex` collapse of Line 2 with `⋯` command palette trigger on mobile is no longer needed — Line 2 doesn't exist. The `⋯` button remains in Line 1 for mobile command palette access.

**Migration**: N/A — the `⋯` button in Line 1 already serves this purpose.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Line 2 is removed entirely, not just hidden | Confirmed from intake #1 — user explicitly discussed and confirmed | S:95 R:85 A:90 D:95 |
| 2 | Certain | FixedWidthToggle moves between live indicator and ⌘K in Line 1 | Confirmed from intake #2 — user explicitly chose this position | S:95 R:90 A:90 D:95 |
| 3 | Certain | No new actions added to (i) popup | Confirmed from intake #3 — actions already exist there | S:90 R:90 A:85 D:90 |
| 4 | Certain | Breadcrumb dropdowns get `+ New` as first item with divider | Confirmed from intake #4 — user proposed this as replacement | S:90 R:85 A:85 D:90 |
| 5 | Certain | Empty sidebar shows `+ New Session` button | Confirmed from intake #5 — user identified need for creation affordance | S:85 R:85 A:85 D:90 |
| 6 | Certain | FixedWidthToggle component internals unchanged | Upgraded from intake Confident #6 — code review confirms component is self-contained with useChrome/useChromeDispatch | S:90 R:90 A:90 D:90 |
| 7 | Confident | `+ New` action item excluded from ArrowUp/ArrowDown keyboard navigation cycle | Action semantically different from selection items; simplifies implementation while keeping it clickable | S:70 R:90 A:80 D:75 |
| 8 | Confident | Touch target sizing follows existing coarse: pattern for top bar buttons | Confirmed from intake #8 — project context specifies `coarse:min-h-[36px] coarse:min-w-[28px]` | S:75 R:90 A:85 D:85 |
| 9 | Confident | BreadcrumbDropdown accepts an `action` prop rather than mixing action items into the `items` array | Cleaner separation of concerns — action is semantically different from selection. Reversible if needed | S:65 R:90 A:75 D:70 |
| 10 | Confident | `onRename`, `onKill`, `onCreateSession` props removed from TopBar | These callbacks are only used by Line 2 buttons — confirmed by reading top-bar.tsx | S:80 R:85 A:90 D:85 |
| 11 | Confident | Sidebar empty state keeps "No sessions" text alongside the button | Belt-and-suspenders UX — label explains context, button provides action | S:60 R:95 A:70 D:70 |

11 assumptions (6 certain, 5 confident, 0 tentative, 0 unresolved).
