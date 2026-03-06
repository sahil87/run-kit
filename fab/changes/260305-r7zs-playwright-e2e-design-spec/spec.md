# Spec: Playwright E2E Tests for UI Design Spec

**Change**: 260305-r7zs-playwright-e2e-design-spec
**Created**: 2026-03-07
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Firefox browser testing — can be added later, not needed for initial coverage
- Visual regression / screenshot diffing — tests verify structure and behavior, not pixel-perfect rendering
- Testing the terminal relay WebSocket protocol directly — E2E tests verify the user-facing result (text appears in terminal), not wire format
- CI pipeline integration — tests run locally; CI setup is a separate concern

## E2E Infrastructure: Playwright Setup

### Requirement: Playwright Configuration

The project SHALL include a `playwright.config.ts` at the repo root that configures:
- Test directory: `e2e/`
- Base URL: `http://localhost:3000`
- Two browser projects: `desktop` (Desktop Chrome) and `mobile` (iPhone 14 via WebKit)
- Web server: `pnpm dev` on port 3000 with `reuseExistingServer: true`

#### Scenario: Desktop browser project available
- **GIVEN** the Playwright config is loaded
- **WHEN** tests run with `--project=desktop`
- **THEN** tests execute in a Chromium-based browser with desktop viewport dimensions

#### Scenario: Mobile browser project available
- **GIVEN** the Playwright config is loaded
- **WHEN** tests run with `--project=mobile`
- **THEN** tests execute in WebKit with iPhone 14 viewport (390x844)

### Requirement: Test Scripts

`package.json` SHALL include `test:e2e` and `test:e2e:ui` scripts.

#### Scenario: Run E2E tests
- **GIVEN** the dev server is running (or auto-started by Playwright)
- **WHEN** `pnpm test:e2e` is executed
- **THEN** Playwright runs all tests in `e2e/` and reports results

### Requirement: Test Directory Convention

E2E tests SHALL live in `e2e/` at the repo root, separate from unit tests in `__tests__/` directories.

#### Scenario: E2E and unit tests coexist
- **GIVEN** both `e2e/` and `src/**/__tests__/` directories exist
- **WHEN** `pnpm test` (Vitest) runs
- **THEN** only unit tests in `__tests__/` execute — `e2e/` is excluded from Vitest
- **AND** `pnpm test:e2e` (Playwright) runs only tests in `e2e/`

### Requirement: Test Session Management

E2E tests that require tmux sessions SHALL create them via `POST /api/sessions` (action: `createSession`) in test setup and kill them via `POST /api/sessions` (action: `killSession`) in teardown. Tests MUST NOT assume pre-existing tmux state.

#### Scenario: Test creates and tears down a session
- **GIVEN** a test requires a tmux session named `e2e-test`
- **WHEN** the test's `beforeAll` hook runs
- **THEN** it sends `POST /api/sessions { action: "createSession", name: "e2e-test" }`
- **AND** the `afterAll` hook sends `POST /api/sessions { action: "killSession", session: "e2e-test" }`

## E2E Testing: Chrome Stability

### Requirement: Top Bar Position Invariance

The top bar's bounding box (y position and height) MUST NOT change when navigating between Dashboard, Project, and Terminal pages.

#### Scenario: Navigate across all three pages
- **GIVEN** the app is loaded on the Dashboard page
- **WHEN** the user captures the top bar's `<header>` bounding box
- **AND** navigates to a Project page
- **THEN** the top bar's y position and height are identical to the Dashboard measurement
- **AND** navigating to a Terminal page yields the same bounding box
- **AND** navigating back to Dashboard yields the same bounding box

### Requirement: Line 2 Fixed Height

Line 2 of the top bar MUST maintain a minimum height of 36px on all pages, including when its content slots are empty.

#### Scenario: Line 2 height on Dashboard vs empty state
- **GIVEN** the Dashboard page is loaded with Line 2 content (action buttons, summary)
- **WHEN** the Line 2 container's bounding box is measured
- **THEN** its height is >= 36px
- **AND** the same measurement on any page without Line 2 content yields height >= 36px

### Requirement: Consistent Max Width

All chrome zones (top bar, content, bottom bar) and page content MUST use `max-w-4xl` (896px) on desktop viewports.

#### Scenario: Max width across pages
- **GIVEN** the viewport is wider than 896px
- **WHEN** the top bar container width is measured on each page
- **THEN** the computed max-width is 896px on all three pages

## E2E Testing: Breadcrumbs

### Requirement: Page-Specific Breadcrumb Content

Breadcrumbs MUST reflect the current navigation depth with icon-driven segments.

#### Scenario: Dashboard breadcrumbs
- **GIVEN** the Dashboard page is loaded
- **WHEN** the breadcrumb nav is inspected
- **THEN** only the logo image is visible — no text breadcrumb segments

#### Scenario: Project page breadcrumbs
- **GIVEN** a Project page is loaded for session `e2e-test`
- **WHEN** the breadcrumb nav is inspected
- **THEN** the breadcrumbs show: logo > separator > `e2e-test`
- **AND** the `e2e-test` segment has no preceding `project:` text prefix

#### Scenario: Terminal page breadcrumbs
- **GIVEN** a Terminal page is loaded for session `e2e-test`, window `main`
- **WHEN** the breadcrumb nav is inspected
- **THEN** the breadcrumbs show: logo > separator > `e2e-test` > separator > `main`
- **AND** no `project:` or `window:` text prefixes appear

### Requirement: Breadcrumb Segment Links

Each breadcrumb segment except the final one (current page) MUST be a clickable link.

#### Scenario: Non-final segments are links
- **GIVEN** the Terminal page breadcrumbs show: logo > `e2e-test` > `main`
- **WHEN** the `e2e-test` segment is inspected
- **THEN** it is an `<a>` element with an `href` pointing to the project page
- **AND** the logo is an `<a>` element with `href="/"` pointing to the dashboard

## E2E Testing: Bottom Bar

### Requirement: Bottom Bar Page Scope

The bottom bar MUST be visible only on the Terminal page. It MUST NOT render on Dashboard or Project pages.

#### Scenario: Bottom bar visible on terminal
- **GIVEN** a Terminal page is loaded
- **WHEN** the bottom bar toolbar is queried
- **THEN** a `[role="toolbar"]` element with label "Terminal keys" is visible

#### Scenario: Bottom bar hidden on dashboard
- **GIVEN** the Dashboard page is loaded
- **WHEN** the bottom bar toolbar is queried
- **THEN** no `[role="toolbar"]` element is present in the DOM

#### Scenario: Bottom bar hidden on project page
- **GIVEN** a Project page is loaded
- **WHEN** the bottom bar toolbar is queried
- **THEN** no `[role="toolbar"]` element is present in the DOM

### Requirement: Modifier Key Armed State

Clicking a modifier button (Ctrl, Alt, Cmd) SHALL toggle its armed visual state. The armed modifier auto-clears after the next key action.

#### Scenario: Arm and observe Ctrl
- **GIVEN** the Terminal page is loaded with the bottom bar visible
- **WHEN** the user clicks the Control button
- **THEN** the button's `aria-pressed` attribute becomes `"true"`
- **AND** the button visually shows the armed state (accent color styling)

### Requirement: Function Key Dropdown

The Fn dropdown SHALL open a grid of F1-F12 keys. Selecting a key SHALL close the dropdown.

#### Scenario: Open Fn dropdown and select F1
- **GIVEN** the Terminal page is loaded
- **WHEN** the user clicks the "Function keys" button
- **THEN** a menu with `role="menu"` appears containing F1 through F12 buttons
- **AND** clicking F1 closes the dropdown menu

### Requirement: Special Keys

Esc and Tab buttons MUST be present and functional.

#### Scenario: Esc and Tab buttons exist
- **GIVEN** the Terminal page bottom bar is visible
- **WHEN** the toolbar buttons are inspected
- **THEN** buttons with `aria-label="Escape"` and `aria-label="Tab"` are visible

## E2E Testing: Compose Buffer

### Requirement: Compose Buffer Open/Close

Clicking the compose button SHALL open a textarea overlay, and Escape SHALL dismiss it.

#### Scenario: Open compose buffer
- **GIVEN** the Terminal page is loaded
- **WHEN** the user clicks the "Compose text" button in the bottom bar
- **THEN** a textarea with `aria-label="Compose text to send to terminal"` appears
- **AND** the terminal container has reduced opacity (`opacity-50` class)

#### Scenario: Dismiss compose via Escape
- **GIVEN** the compose buffer textarea is open
- **WHEN** the user presses Escape
- **THEN** the textarea disappears
- **AND** the terminal opacity returns to normal

### Requirement: Compose Send Button

The Send button SHALL be visible when the compose buffer is open.

#### Scenario: Send button presence
- **GIVEN** the compose buffer is open
- **WHEN** the compose area is inspected
- **THEN** a "Send" button is visible

### Requirement: Compose Multiline

The compose buffer textarea MUST accept multiline input.

#### Scenario: Type multiline text
- **GIVEN** the compose buffer is open
- **WHEN** the user types multiline text (using Shift+Enter or paste)
- **THEN** the textarea value contains newline characters

## E2E Testing: Mobile Viewport

### Requirement: Touch Target Minimum Size

All interactive elements in the bottom bar MUST have a minimum tap height of 30px (the `min-h-[30px]` from `KBD_CLASS`).

#### Scenario: Bottom bar button sizes on mobile
- **GIVEN** the Terminal page is loaded in the mobile project (iPhone 14 viewport)
- **WHEN** each button in the bottom bar toolbar is measured
- **THEN** every button has a bounding box height >= 30px

### Requirement: Command Key Badge Hidden on Mobile

The `⌘K` keyboard badge in Line 1 SHOULD be hidden on narrow mobile viewports where a physical keyboard is not expected.

#### Scenario: Command-K badge on mobile
- **GIVEN** the Dashboard page is loaded in the mobile viewport
- **WHEN** the `<kbd>` element containing `⌘K` is queried
- **THEN** it is either not visible or has `display: none` / zero dimensions

<!-- assumed: ⌘K hiding on mobile — the design spec says ⌘K hint should be hidden on mobile and replaced by ⋯, but the current TopBarChrome always renders it. Test may need to verify current behavior vs intended behavior. -->

### Requirement: Bottom Bar Renders on Mobile

The bottom bar MUST render on the Terminal page in the mobile viewport, providing the only way to send modifier keys without a physical keyboard.

#### Scenario: Bottom bar on mobile terminal
- **GIVEN** the Terminal page is loaded in the mobile project viewport
- **WHEN** the bottom bar toolbar is queried
- **THEN** a `[role="toolbar"]` element is visible with modifier and special key buttons

## E2E Testing: Kill Button Visibility

### Requirement: Always-Visible Kill Button

The kill button (✕) on session cards and session headers MUST be visible without hover — it SHALL NOT be hidden behind a hover-reveal interaction.

#### Scenario: Kill button on session card
- **GIVEN** the Dashboard page is loaded with at least one session
- **WHEN** a window card is inspected (without hovering)
- **THEN** a button with `aria-label` matching "Kill window *" is visible

#### Scenario: Kill button on session header
- **GIVEN** the Dashboard page is loaded with at least one session
- **WHEN** the session header is inspected (without hovering)
- **THEN** a button with `aria-label` matching "Kill session *" is visible

### Requirement: Kill Confirmation Dialog

Clicking the kill button MUST open a confirmation dialog before performing the destructive action.

#### Scenario: Click kill opens confirmation
- **GIVEN** the Dashboard page is loaded with a session
- **WHEN** the user clicks the kill button (✕) on a session header
- **THEN** a dialog appears with title "Kill session?" and Cancel/Kill buttons

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Playwright as E2E framework | Confirmed from intake #1 — user specified Playwright | S:90 R:90 A:90 D:95 |
| 2 | Certain | Tests depend on all 3 UI design changes being complete | Confirmed from intake #2 — tests verify integrated result | S:90 R:85 A:90 D:90 |
| 3 | Certain | E2E tests in `e2e/` directory | Confirmed from intake #3 — different runner, different convention | S:80 R:95 A:85 D:85 |
| 4 | Certain | Chromium + WebKit browsers only | Confirmed from intake #4 — desktop Chrome, mobile WebKit | S:80 R:90 A:85 D:85 |
| 5 | Confident | iPhone 14 as mobile viewport | Confirmed from intake #5 — common reference device, easily changeable | S:55 R:95 A:80 D:75 |
| 6 | Confident | Tests self-manage tmux sessions via API | Confirmed from intake #7 — tests create/teardown via POST /api/sessions | S:55 R:85 A:80 D:75 |
| 7 | Confident | Bottom bar button min-height 30px (not 44px) | Codebase inspection: `KBD_CLASS` uses `min-h-[30px]`. The intake mentions 44px from Apple HIG, but actual implementation uses 30px. Test verifies actual implementation. | S:85 R:90 A:90 D:70 |
| 8 | Confident | Chrome stability tested via bounding box comparison | Confirmed from intake #6 — Playwright `boundingBox()` API for position comparison | S:60 R:90 A:85 D:80 |
| 9 | Confident | No WebSocket data verification in E2E tests | E2E tests verify UI state changes (armed state, compose open/close, menu open/close), not raw WebSocket messages. Terminal I/O verification requires a live tmux session which adds fragility. | S:65 R:90 A:80 D:70 |
| 10 | Certain | Test scripts added to package.json | Confirmed from intake — `test:e2e` and `test:e2e:ui` scripts | S:90 R:95 A:90 D:90 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).
