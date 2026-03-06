# Intake: Navbar Breadcrumb Dropdowns

**Change**: 260307-uzsa-navbar-breadcrumb-dropdowns
**Created**: 2026-03-07
**Status**: Draft

## Origin

> Clicking on tab name in the navbar should show a dropdown of tabs in the project. And when we are in the project page, clicking on the project in the navbar should show a dropdown of projects.

Conversational refinement. Initial request for breadcrumb dropdowns, then discussed preserving back-navigation on the terminal page's project link. Settled on a split click-target: name clicks retain existing behavior, a chevron icon next to the name opens the dropdown. Chevron applied to both project and window segments for consistency.

## Why

The breadcrumb currently shows context (project name, window name) but doesn't let users switch between siblings without navigating back. Clicking the project name on a project page does nothing (it's the current page). Clicking the window name on a terminal page also does nothing (it's the last breadcrumb, rendered as static text).

Adding dropdowns to these segments turns the breadcrumb into a fast navigation switcher — users can jump between projects or between windows within a project without leaving their current context. This is a standard pattern in tools like Linear and VS Code. The split click-target (name = navigate, chevron = dropdown) preserves existing back-navigation while adding the new switching capability.

## What Changes

### Split Click-Target Pattern

Each breadcrumb segment that has a dropdown gets a small chevron icon (e.g., `▾`) next to the label. The two click zones behave differently:

- **Click the name/label** — existing behavior: navigates (e.g., project name on terminal page links back to `/p/:project`). On the current page's segment (e.g., project name on project page, window name on terminal page), clicking the name does nothing (already there).
- **Click the chevron** — opens the dropdown menu below the segment.

This preserves back-navigation on the terminal page while adding dropdown switching.

### Breadcrumb Project Dropdown

A chevron appears next to the project name on both the **project page** and the **terminal page**. Clicking the chevron opens a dropdown listing all projects (tmux sessions). Selecting a project navigates to `/p/:selected`. The current project is visually marked.

### Breadcrumb Window Dropdown

A chevron appears next to the window name on the **terminal page**. Clicking the chevron opens a dropdown listing all windows in the current project. Selecting a window navigates to `/p/:project/:window?name=:name`. The current window is visually marked.

### Data Requirements

- **Projects list**: Already available from `useSessions()` — the `sessions` array contains all `ProjectSession` objects with their names.
- **Windows list**: Already available from `useSessions()` — each `ProjectSession` has a `windows` array with `{ index, name, activity }`.
- No new API endpoints needed.

### Interaction

- Click chevron → dropdown opens below/aligned to the segment
- Click name/label → navigates (existing behavior) or no-op if current page
- Click outside or press Escape → dropdown closes
- Click item → navigate + close
- Keyboard: arrow keys to navigate items, Enter to select, Escape to close

### Visual Design

- Same dark theme dropdown style as the Fn key dropdown in the bottom bar (dark background, border, shadow)
- Items show name, current item has accent highlight or checkmark
- Dropdown opens downward from the breadcrumb segment

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document breadcrumb dropdown behavior and keyboard shortcuts
- `run-kit/architecture`: (modify) Note ChromeProvider changes if breadcrumb type is extended

## Impact

- **`src/components/top-bar-chrome.tsx`** — Breadcrumb rendering changes from links/text to dropdown triggers
- **`src/contexts/chrome-context.tsx`** — `Breadcrumb` type may need extension (e.g., `items` array for dropdown content, or an `onDropdown` callback)
- **Page client components** — Need to pass dropdown data (sessions list, windows list) when setting breadcrumbs
- **New component** — A `BreadcrumbDropdown` or reusable `Popover` component for the dropdown UI

## Open Questions

- None — the scope is clear from context.

## Clarifications

### Session 2026-03-07 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 5 | Confirmed | — |
| 6 | Confirmed | — |
| 7 | Confirmed | — |
| 8 | Confirmed | — |
| 9 | Confirmed | — |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use existing `useSessions()` data for dropdown items | Sessions and windows are already available in the session context — no new API needed | S:90 R:95 A:95 D:95 |
| 2 | Certain | Follow existing dropdown pattern from bottom bar Fn keys | Codebase has an established custom dropdown pattern with outside-click, Escape, ARIA roles — reuse it | S:85 R:90 A:95 D:90 |
| 3 | Certain | Split click-target: name navigates, chevron opens dropdown | Discussed — user chose chevron approach to preserve back-navigation on terminal page project link | S:95 R:90 A:95 D:95 |
| 4 | Certain | Chevron on both project and window segments for consistency | Discussed — user explicitly requested consistency across both segments | S:95 R:90 A:95 D:95 |
| 5 | Certain | Extend `Breadcrumb` type to support dropdown data | Clarified — user confirmed | S:95 R:85 A:80 D:75 |
| 6 | Certain | Project dropdown available on both project and terminal pages | Clarified — user confirmed | S:95 R:90 A:80 D:80 |
| 7 | Certain | Window dropdown only on terminal page | Clarified — user confirmed | S:95 R:95 A:90 D:95 |
| 8 | Certain | Dropdown opens downward from breadcrumb segment | Clarified — user confirmed | S:95 R:90 A:85 D:80 |
| 9 | Certain | Current item highlighted in dropdown | Clarified — user confirmed | S:95 R:95 A:85 D:90 |
| 10 | Tentative | Dashboard page: no dropdown (no project breadcrumb to click) | Dashboard has empty breadcrumbs — no segment to attach a dropdown to. User didn't mention dashboard. | S:60 R:85 A:70 D:60 |
<!-- assumed: No dashboard dropdown — dashboard has no project breadcrumb segment, and user request scoped to project/terminal pages -->

10 assumptions (9 certain, 0 confident, 1 tentative, 0 unresolved).
