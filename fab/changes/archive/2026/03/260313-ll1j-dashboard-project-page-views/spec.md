# Spec: Dashboard View

**Change**: 260313-ll1j-dashboard-project-page-views
**Created**: 2026-03-14
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- No new backend API endpoints — all data sourced from existing SSE `ProjectSession[]` stream
- No intermediate `/$session` route — two-tier URL model only (`/` and `/$session/$window`)
- No session management features beyond existing create/kill — Dashboard is read + navigate only

## UI: Dashboard Route

### Requirement: Dashboard renders at `/`

The `/` route SHALL render a Dashboard view in the terminal area instead of redirecting to the first session's first window. The auto-redirect logic (`hasRedirected` ref + redirect effect in `app.tsx`) SHALL be removed. `/` MUST always show the Dashboard when no `/$session/$window` params are present.

#### Scenario: Navigate to root URL with sessions

- **GIVEN** 3 tmux sessions exist with a total of 7 windows
- **WHEN** user navigates to `/`
- **THEN** the Dashboard renders in the terminal area showing a stats line "3 sessions, 7 windows"
- **AND** 3 session cards are displayed in a grid below the stats

#### Scenario: Navigate to root URL with no sessions

- **GIVEN** no tmux sessions exist
- **WHEN** user navigates to `/`
- **THEN** the Dashboard renders showing "0 sessions, 0 windows" stats
- **AND** a "New Session" button is displayed (opens existing create session dialog)

#### Scenario: Direct URL to terminal still works

- **GIVEN** session "myproject" with window 0 exists
- **WHEN** user navigates to `/myproject/0`
- **THEN** the terminal view renders as before (no Dashboard)

### Requirement: Session cards display session overview

Each session card SHALL display the session name, window count, and activity summary. Session cards MUST be rendered in a grid layout.

#### Scenario: Session card content

- **GIVEN** session "run-kit" has 3 windows (2 active, 1 idle)
- **WHEN** the Dashboard renders
- **THEN** the "run-kit" card shows the session name as primary text
- **AND** shows "3 windows"
- **AND** shows activity summary "2 active, 1 idle"

#### Scenario: Session card styling

- **GIVEN** the Dashboard renders with session cards
- **WHEN** viewing the cards
- **THEN** cards use existing design tokens (`bg-bg-card`, `border border-border`, `rounded`, `text-text-primary`/`text-text-secondary`)

### Requirement: Session cards expand to reveal window cards

Clicking a session card SHALL toggle inline expansion to reveal window cards for that session. Multiple sessions MAY be expanded simultaneously.

#### Scenario: Expand a session card

- **GIVEN** the Dashboard shows a collapsed session card for "run-kit"
- **WHEN** user clicks the session card
- **THEN** the card expands inline to reveal window cards for all windows in that session

#### Scenario: Collapse an expanded session card

- **GIVEN** the "run-kit" session card is expanded showing window cards
- **WHEN** user clicks the session card header area again
- **THEN** the window cards collapse and only the session summary is visible

### Requirement: Window cards display window details

Each window card within an expanded session SHALL display: window name, running process (`paneCommand`), activity status (active/idle with dot indicator), idle duration (when applicable), and fab info (change ID + stage badge) when present.

#### Scenario: Window card with fab info

- **GIVEN** session "run-kit" is expanded and window "alpha" has `fabChange: "260313-ll1j-dashboard"`, `fabStage: "apply"`, `activity: "active"`, `paneCommand: "claude"`
- **WHEN** viewing the window card
- **THEN** the card shows "alpha" as the window name
- **AND** shows "claude" as the running process
- **AND** shows a green activity dot with "active" label
- **AND** shows fab stage badge "apply"

#### Scenario: Window card without fab info

- **GIVEN** a window "zsh" with `activity: "idle"`, `paneCommand: "zsh"`, no fab fields, `activityTimestamp` 120 seconds ago
- **WHEN** viewing the window card
- **THEN** the card shows "zsh" as the window name
- **AND** shows "zsh" as the running process
- **AND** shows a dim activity dot with idle duration "2m"
- **AND** no fab info is displayed

### Requirement: Window card click navigates to terminal

Clicking a window card SHALL navigate to `/$session/$window` for that window.

#### Scenario: Click window card

- **GIVEN** session "run-kit" is expanded showing window "alpha" at index 2
- **WHEN** user clicks the "alpha" window card
- **THEN** the app navigates to `/run-kit/2`
- **AND** the terminal view renders with a WebSocket connection to that session/window

### Requirement: Dashboard provides session and window creation

The Dashboard SHALL include a "New Session" button. Expanded session cards SHALL include a "New Window" button.

#### Scenario: New Session button on Dashboard

- **GIVEN** the Dashboard is displayed
- **WHEN** user clicks "New Session"
- **THEN** the existing create session dialog opens

#### Scenario: New Window button in expanded session

- **GIVEN** session "run-kit" is expanded
- **WHEN** user clicks the "New Window" button in the expanded card
- **THEN** a new window is created in the "run-kit" session (calls existing `createWindow` API)

## UI: Chrome Adaptation

### Requirement: Top bar adapts for Dashboard

On the Dashboard route (`/`), the top bar SHALL show the logo toggle and a "Dashboard" text label. Session and window breadcrumb segments with dropdown triggers SHALL NOT render (no session/window is selected). Connection indicator, FixedWidthToggle, and command palette trigger SHOULD render as normal.

#### Scenario: Top bar on Dashboard

- **GIVEN** user is on the `/` route
- **WHEN** viewing the top bar
- **THEN** the logo toggle is visible
- **AND** "Dashboard" text appears after the logo
- **AND** no session or window breadcrumb segments are shown
- **AND** the connection indicator, FixedWidthToggle, and `⌘K`/`⋯` are visible

#### Scenario: Top bar on terminal page

- **GIVEN** user is on `/$session/$window`
- **WHEN** viewing the top bar
- **THEN** breadcrumbs show `{logo} ❯ {session} ❯ {window}` as before (unchanged)

### Requirement: Bottom bar hidden on Dashboard

The bottom bar SHALL NOT render on the Dashboard route. There is no terminal to send keys to, so the bottom bar is meaningless.

#### Scenario: Bottom bar visibility

- **GIVEN** user is on the `/` route (Dashboard)
- **WHEN** viewing the page
- **THEN** no bottom bar is visible

#### Scenario: Bottom bar on terminal page

- **GIVEN** user is on `/$session/$window`
- **WHEN** viewing the page
- **THEN** the bottom bar renders as before (unchanged)

## UI: Kill Redirect Logic

### Requirement: Kill operations redirect to Dashboard

After any kill operation (window kill, last window kill, session kill), the app SHALL navigate to `/` (Dashboard). The existing redirect logic that tries to navigate to another window or session in the same session SHALL be replaced with a simple redirect to `/`.

#### Scenario: Kill non-last window

- **GIVEN** user is viewing window 1 of session "run-kit" which has 3 windows
- **WHEN** user kills window 1
- **THEN** the app navigates to `/` (Dashboard)

#### Scenario: Kill last window in session

- **GIVEN** user is viewing the only window in session "run-kit"
- **WHEN** user kills that window
- **THEN** the app navigates to `/` (Dashboard)

#### Scenario: Kill session

- **GIVEN** user kills session "run-kit" via the sidebar kill button
- **WHEN** the kill completes
- **THEN** the app navigates to `/` (Dashboard)

#### Scenario: Stale URL after external kill

- **GIVEN** user is viewing `/run-kit/0` and the session is killed externally (via tmux)
- **WHEN** the next SSE update arrives and the session no longer exists
- **THEN** the app navigates to `/` (Dashboard)

## UI: Sidebar Interaction

### Requirement: Sidebar session name navigates to first window

Clicking a session name in the sidebar SHALL navigate to `/$session/$window` where `$window` is the first window's index (typically 0). The expand/collapse toggle is a separate chevron/triangle control.

#### Scenario: Click session name in sidebar

- **GIVEN** session "run-kit" with windows [0, 1, 2] is listed in the sidebar
- **WHEN** user clicks the session name text "run-kit"
- **THEN** the app navigates to `/run-kit/0`
- **AND** the terminal view renders

**Note**: This changes the current behavior where clicking the session name toggles expand/collapse. The chevron/triangle becomes the expand/collapse trigger.

#### Scenario: Expand/collapse via chevron

- **GIVEN** session "run-kit" is listed in the sidebar
- **WHEN** user clicks the chevron/triangle icon
- **THEN** the window list toggles expanded/collapsed (unchanged behavior, different trigger)

## Deprecated Requirements

### Auto-redirect from `/` to first session window

**Reason**: Dashboard replaces the redirect — `/` is now a persistent view, not a transient redirect route.
**Migration**: Users land on Dashboard and drill down via session cards → window cards. Direct URLs (`/$session/$window`) still work for bookmarks and links.

### Fallback redirect on window kill

**Reason**: All kills now redirect to Dashboard (`/`) instead of trying to find a fallback window in the same session.
**Migration**: After killing a window, users return to Dashboard and can pick another window from there.

## Design Decisions

1. **Dashboard as a component in app.tsx, not a separate route component**: The Dashboard renders inline in the terminal area (the `{sessionName && windowIndex ? <TerminalClient/> : <Dashboard/>}` branch) rather than as a separate route with its own component tree. This reuses the existing chrome skeleton (top bar, sidebar) and avoids duplicating the app shell layout.
   - *Why*: The Dashboard shares the same chrome structure as the terminal view — only the main content area differs. Extracting it as a separate route would require duplicating the sidebar, top bar, and drawer logic or creating a shared layout component.
   - *Rejected*: Separate route with dedicated layout — would require lifting sidebar/chrome into a layout route and restructuring the route tree.

2. **Grid layout for session cards**: Session cards use CSS grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`) for responsive layout rather than a list.
   - *Why*: A grid makes better use of the wide terminal area and provides a more visual overview. The sidebar already provides a list view.
   - *Rejected*: Single-column list — would look sparse in the wide terminal area.

3. **Sidebar session name click navigates (not expands)**: The session name in the sidebar navigates to the first window, while the chevron/triangle handles expand/collapse.
   - *Why*: User explicitly decided this during discussion — the sidebar dropdown already provides `+ Session` for creation, so the name click is freed up for navigation.
   - *Rejected*: Keep current behavior (name toggles expand/collapse) — wastes the most prominent click target on a secondary action.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Two-tier URL model: `/` = Dashboard, `/$session/$window` = Terminal | Confirmed from intake #1 — user explicitly decided against `/$session` route | S:95 R:90 A:95 D:95 |
| 2 | Certain | Dashboard uses expandable session cards with inline window cards | Confirmed from intake #2 — user chose this layout during discussion | S:95 R:85 A:90 D:95 |
| 3 | Certain | Dashboard stats are simple counts (sessions, windows) | Confirmed from intake #3 — user chose simple counts | S:90 R:90 A:90 D:95 |
| 4 | Certain | Sidebar session name click → first window in session | Confirmed from intake #4 — user chose direct navigation since dropdown has `+ Session` | S:95 R:80 A:90 D:95 |
| 5 | Certain | Kill redirects: all cases → `/` (dashboard) | Confirmed from intake #5 — simplified redirect logic | S:95 R:85 A:90 D:95 |
| 6 | Certain | No new backend API endpoints — data from existing SSE stream | Confirmed from intake #6 — upgraded from Confident: `ProjectSession[]` with `WindowInfo[]` contains all card fields | S:90 R:90 A:95 D:90 |
| 7 | Certain | Bottom bar hidden on Dashboard | Confirmed from intake #7 — upgraded from Confident: no WebSocket ref means no target for key sends | S:85 R:90 A:95 D:90 |
| 8 | Confident | Card styling follows existing design tokens | Codebase patterns are clear (`bg-bg-card`, `border-border`, `text-text-primary`) but specific card layout details are new | S:70 R:95 A:85 D:90 |
| 9 | Certain | `/` always shows Dashboard — no auto-redirect to terminal | Confirmed from intake #9 — user chose "always dashboard" | S:95 R:80 A:90 D:95 |
| 10 | Confident | Dashboard component renders inline in app.tsx terminal area branch | Codebase structure strongly suggests this — no separate route layout needed | S:75 R:85 A:90 D:85 |
| 11 | Confident | Session card grid layout (1/2/3 cols responsive) | No explicit discussion, but grid is the obvious choice for a card-based overview in a wide area | S:60 R:95 A:80 D:80 |
| 12 | Confident | Activity summary uses "N active, M idle" format | Intake says "2 active, 1 idle" example — format clear but exact wording is inferred | S:75 R:95 A:85 D:85 |

12 assumptions (8 certain, 4 confident, 0 tentative, 0 unresolved).
