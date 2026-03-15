# Spec: Per-Region Scroll Behavior

**Change**: 260315-lnrb-dashboard-scroll-behavior
**Created**: 2026-03-15
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Viewport: Fullbleed Activation

### Requirement: Fullbleed class SHALL be applied unconditionally on mount

The `fullbleed` class MUST be added to `document.documentElement` (`<html>`) on application mount, activating the existing CSS rules in `globals.css` (`html.fullbleed` selectors). This SHALL happen inside the `useVisualViewport` hook since it already manages viewport-related CSS side effects (`--app-height`, `--app-offset-top`).

The class MUST be added during the initial sync (before any viewport events) and removed on cleanup.

#### Scenario: App mounts in browser

- **GIVEN** the application loads in a browser
- **WHEN** the `useVisualViewport` hook initializes
- **THEN** `document.documentElement.classList` contains `"fullbleed"`
- **AND** the existing CSS rules (`position: fixed`, `overflow: hidden`, `overscroll-behavior: none`) activate on `html`, `body`, and `.app-shell`

#### Scenario: App unmounts

- **GIVEN** the `useVisualViewport` hook is active
- **WHEN** the hook's cleanup runs (component unmount)
- **THEN** the `fullbleed` class is removed from `document.documentElement`

#### Scenario: Terminal view — no browser scrollbar

- **GIVEN** the app is mounted with fullbleed active
- **WHEN** the user is on a terminal page (`/:session/:window`) and xterm.js output grows beyond the viewport
- **THEN** the browser does NOT produce a page-level scrollbar
- **AND** xterm.js handles scrollback internally

### Requirement: Fullbleed activation SHALL be idempotent

Adding the `fullbleed` class MUST use `classList.add()` which is naturally idempotent. Multiple hook invocations or React strict-mode double-effects SHALL NOT produce duplicate classes or errors.

#### Scenario: React strict mode double-invoke

- **GIVEN** React strict mode double-invokes effects
- **WHEN** the `useVisualViewport` hook runs twice
- **THEN** `document.documentElement.classList` contains exactly one `"fullbleed"` entry
- **AND** cleanup from the first invocation removes the class, second invocation re-adds it

## Dashboard: Scoped Scroll Container

### Requirement: Stats line SHALL be pinned at top of Dashboard area

The Dashboard component MUST split its content into two layout regions:

1. **Stats line** — a `shrink-0` div containing the session/window count text. This stays pinned at the top of the Dashboard area regardless of scroll position.
2. **Scrollable card area** — a `flex-1 min-h-0 overflow-y-auto` div containing the session cards grid and the "+ New Session" button.

The outer Dashboard wrapper MUST use `flex-1 flex flex-col` (replacing the current `flex-1 overflow-y-auto`). The `overflow-y-auto` moves from the outer wrapper to the inner scrollable div.

#### Scenario: Few sessions (no scroll needed)

- **GIVEN** the Dashboard is visible with 1-3 sessions
- **WHEN** the card grid fits within the viewport
- **THEN** no scrollbar appears in the Dashboard area
- **AND** the stats line and cards are both visible

#### Scenario: Many sessions (scroll needed)

- **GIVEN** the Dashboard is visible with many sessions that overflow the viewport
- **WHEN** the user scrolls the card area
- **THEN** the stats line remains fixed at the top of the Dashboard area
- **AND** only the card grid scrolls
- **AND** all cards (including "+ New Session") are reachable by scrolling

#### Scenario: Dashboard within fullbleed layout

- **GIVEN** fullbleed is active (html/body `overflow: hidden`)
- **WHEN** the Dashboard renders in the terminal column area
- **THEN** the Dashboard's internal scroll container provides scrollability
- **AND** no browser-level scrollbar appears

### Requirement: Padding SHALL be distributed between stats and scrollable area

Horizontal padding (`p-4 sm:p-6`) MUST apply to both the stats line and the scrollable area consistently. The stats line gets its own padding (`px-4 sm:px-6 pt-4 sm:pt-6`). The scrollable area gets `px-4 sm:px-6 pb-4 sm:pb-6`. This preserves the existing visual appearance while splitting the layout.

#### Scenario: Visual consistency with current layout

- **GIVEN** the Dashboard renders with the new split layout
- **WHEN** compared to the previous single-container layout
- **THEN** the visual appearance (spacing, alignment) is identical when content doesn't overflow

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scoped scroll on Dashboard container, not fullbleed toggle per route | Confirmed from intake #1 — user explicitly chose option 1 | S:95 R:90 A:90 D:95 |
| 2 | Certain | Stats line pinned at top of Dashboard area | Confirmed from intake #2 — parallels fixed chrome philosophy | S:90 R:95 A:85 D:90 |
| 3 | Certain | html/body stay overflow:hidden always | Confirmed from intake #3 — no body-level scroll toggling | S:90 R:85 A:90 D:90 |
| 4 | Certain | Fullbleed class must be activated — existing CSS rules are correct but dormant | Confirmed from intake #4 — codebase inspection confirms `html.fullbleed` rules exist but class never added | S:95 R:80 A:95 D:95 |
| 5 | Certain | Terminal scroll is xterm-internal, not browser scroll | Confirmed from intake #5 — design spec + user confirmation | S:95 R:95 A:95 D:95 |
| 6 | Certain | Sidebar scroll unchanged | Confirmed from intake #6 — already has overflow-y:auto | S:95 R:95 A:95 D:95 |
| 7 | Confident | Activate fullbleed in useVisualViewport hook | Confirmed from intake #7 — hook already manages viewport CSS side effects, logical colocation | S:60 R:90 A:80 D:70 |
| 8 | Confident | Padding split: stats gets pt+px, scrollable area gets pb+px | Upgraded from intake #8 — inspected dashboard.tsx, current `p-4 sm:p-6` splits naturally into top/bottom halves | S:70 R:95 A:85 D:80 |

8 assumptions (6 certain, 2 confident, 0 tentative, 0 unresolved).
