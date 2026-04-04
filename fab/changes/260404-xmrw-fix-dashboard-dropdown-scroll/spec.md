# Spec: Fix Dashboard and Dropdown Scrollability

**Change**: 260404-xmrw-fix-dashboard-dropdown-scroll
**Created**: 2026-04-04
**Affected memory**: none — implementation-only fix

## Non-Goals

- Pinning the action button ("+ New Session" / "+ New Window") above the scrollable item list — the whole dropdown scrolls, action first
- Changing dropdown width, position, or keyboard navigation behavior
- Adding custom scrollbar styling

## Frontend / Layout: Dashboard Scrollability

### Requirement: Dashboard Root Must Enable Flex Overflow

The `Dashboard` component's root element SHALL include `min-h-0` in its flex layout classes so that the inner `overflow-y-auto` container can constrain height and scroll.

#### Scenario: Many sessions overflow the card grid

- **GIVEN** the user has enough sessions and windows that the card grid exceeds the viewport height
- **WHEN** the Dashboard component renders
- **THEN** the card area scrolls vertically instead of overflowing the page
- **AND** the stats line ("N sessions, N windows") remains pinned at the top

#### Scenario: Root element has correct flex classes

- **GIVEN** the Dashboard component renders
- **WHEN** the root element's className is inspected
- **THEN** it contains `flex-1`, `min-h-0`, and `flex flex-col`

## Frontend / Navigation: BreadcrumbDropdown Scrollability

### Requirement: Dropdown Menu Must Have a Height Cap and Scroll

The BreadcrumbDropdown menu container SHALL include `max-h-60` and `overflow-y-auto` so that when there are more items than fit in 240px, the list scrolls rather than growing off-screen.

#### Scenario: Many sessions in dropdown

- **GIVEN** the session dropdown contains more items than fit in the dropdown viewport (~10+)
- **WHEN** the user opens the dropdown
- **THEN** the dropdown does not exceed `max-h-60` (240px)
- **AND** the user can scroll to see all items

#### Scenario: Dropdown menu has scroll classes

- **GIVEN** a `BreadcrumbDropdown` with any number of items
- **WHEN** the dropdown is opened
- **THEN** the menu container's className includes `overflow-y-auto` and `max-h-60`

#### Scenario: Fewer items than max height

- **GIVEN** the session dropdown contains 3 items (fewer than visible limit)
- **WHEN** the user opens the dropdown
- **THEN** all items are visible without scrolling (natural height < max-h-60)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix is CSS-only (Tailwind class additions) | Root causes confirmed in source; `min-h-0` missing from dashboard.tsx:34, no overflow on breadcrumb-dropdown.tsx:104 | S:90 R:95 A:95 D:90 |
| 2 | Certain | Dashboard fix = add `min-h-0` to root div (`dashboard.tsx:34`) | Confirmed from spec — inner `overflow-y-auto` already at line 44; parent chain has `min-h-0` except this element | S:90 R:95 A:95 D:95 |
| 3 | Certain | Change type = `fix` | Restoring expected scroll behavior | S:90 R:95 A:95 D:90 |
| 4 | Certain | `max-h-60` for BreadcrumbDropdown (240px ≈ 10 items) | Consistent with `command-palette.tsx` (max-h-64) and `create-session-dialog.tsx` (max-h-48); no user preference specified <!-- clarified: resolved from codebase precedent — max-h-60 is the appropriate mid-value between existing usages --> | S:95 R:85 A:80 D:75 |
| 5 | Certain | Whole dropdown scrolls (action button not pinned) | Simplest correct fix; action always first so visible on open; explicitly stated in Non-Goals section <!-- clarified: resolved from spec Non-Goals — pinning is explicitly out of scope --> | S:95 R:85 A:75 D:70 |
| 6 | Certain | Tests verify className contains scroll classes | Existing test suite uses className assertions (e.g., `text-accent`, `text-text-secondary`); consistent pattern; required by code-quality.md <!-- clarified: resolved from project conventions — className assertions are the established test pattern and code-quality.md mandates tests for changed behavior --> | S:95 R:85 A:80 D:80 |

6 assumptions (6 certain, 0 confident, 0 tentative, 0 unresolved).

## Clarifications

### Session 2026-04-04 (auto-mode)

| # | Action | Detail |
|---|--------|--------|
| 4 | Resolved | `max-h-60` confirmed from codebase precedent — mid-value between `max-h-48` and `max-h-64` in existing components |
| 5 | Resolved | Whole-dropdown scroll confirmed — Non-Goals section explicitly excludes pinning |
| 6 | Resolved | className test assertions confirmed from existing test patterns and code-quality.md mandate |
