# Spec: Dashboard & Project Page Views

**Change**: 260313-ll1j-dashboard-project-page-views
**Created**: 2026-03-13
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- No new backend API endpoints — all data sourced from existing SSE stream (`/api/sessions/stream`)
- No mobile-specific views — Dashboard and Project page use the same card layout on all breakpoints (responsive via grid auto-fill)
- No drag-and-drop reordering of sessions or windows on the new views

## Routing: URL Hierarchy

### Requirement: Three-Tier URL Structure

The application SHALL support three URL tiers that map to content depth:
- `/` — Dashboard (global overview of all sessions)
- `/$session` — Project page (windows within a specific session)
- `/$session/$window` — Terminal (existing, unchanged)

TanStack Router SHALL have three routes: `indexRoute` (`/`), `sessionRoute` (`/$session`), and `sessionWindowRoute` (`/$session/$window`). The router SHALL distinguish them by path segment count.

#### Scenario: Root URL Shows Dashboard
- **GIVEN** the user navigates to `/`
- **WHEN** the page loads
- **THEN** the terminal area renders the Dashboard view with session cards
- **AND** no auto-redirect to a terminal window occurs

#### Scenario: Single-Segment URL Shows Project Page
- **GIVEN** a session named "run-kit" exists
- **WHEN** the user navigates to `/run-kit`
- **THEN** the terminal area renders the Project page with window cards for the "run-kit" session

#### Scenario: Two-Segment URL Shows Terminal
- **GIVEN** a session "run-kit" with window index 0 exists
- **WHEN** the user navigates to `/run-kit/0`
- **THEN** the terminal area renders the existing TerminalClient (unchanged behavior)

### Requirement: Remove Auto-Redirect on Root

The existing behavior where `/` redirects to the first session's first window on SSE data arrival SHALL be removed. The `hasRedirected` ref and redirect `useEffect` in `app.tsx` SHALL be deleted. `/` SHALL always render the Dashboard.

#### Scenario: Root With Sessions Shows Dashboard (Not Redirect)
- **GIVEN** 3 tmux sessions exist
- **WHEN** the user navigates to `/`
- **THEN** the Dashboard view renders with 3 session cards
- **AND** the URL remains `/` (no navigation occurs)

#### Scenario: Root With No Sessions Shows Empty Dashboard
- **GIVEN** no tmux sessions exist
- **WHEN** the user navigates to `/`
- **THEN** the Dashboard renders with "No sessions" text and a "New Session" button

## Dashboard: Session Card Grid

### Requirement: Dashboard Layout

The Dashboard view SHALL render in the terminal area (same container where `TerminalClient` renders). It SHALL display:
1. A stats line at the top: "{N} sessions, {M} windows" (derived from `sessions` array)
2. A grid of session cards, one per `ProjectSession`
3. A "New Session" button that opens the existing `CreateSessionDialog`

#### Scenario: Stats Line Counts
- **GIVEN** 3 sessions with 2, 3, and 2 windows respectively
- **WHEN** the Dashboard renders
- **THEN** the stats line reads "3 sessions, 7 windows"

#### Scenario: Single Session Stats
- **GIVEN** 1 session with 1 window
- **WHEN** the Dashboard renders
- **THEN** the stats line reads "1 session, 1 window" (singular)

### Requirement: Session Card Content

Each session card SHALL display:
- Session name as primary text
- Window count (e.g., "3 windows")
- Activity summary: count of active and idle windows (e.g., "2 active, 1 idle")

Activity counts SHALL be derived from each window's `activity` field in the existing `WindowInfo` type.

#### Scenario: Card Shows Activity Summary
- **GIVEN** a session "run-kit" with 2 active and 1 idle windows
- **WHEN** the Dashboard renders
- **THEN** the "run-kit" card shows "3 windows" and "2 active, 1 idle"

### Requirement: Session Card Navigation

Clicking a session card SHALL navigate to `/$session` (the Project page for that session).

#### Scenario: Click Session Card Navigates
- **GIVEN** the Dashboard shows a card for session "run-kit"
- **WHEN** the user clicks the "run-kit" card
- **THEN** the URL changes to `/run-kit`
- **AND** the Project page renders for "run-kit"

### Requirement: Card Styling

Session cards and window cards SHALL use existing design tokens: `bg-bg-card` background, `border border-border` border, `hover:border-text-secondary` hover state, `rounded` corners. Text uses `text-text-primary` for primary content and `text-text-secondary` for metadata. Cards SHALL have `p-4` padding and the grid SHALL use `gap-3`.
<!-- clarified: Card padding (p-4) and gap (gap-3) values — consistent with existing Tailwind spacing patterns in the codebase (auto-resolved) -->

The card grid SHALL use CSS Grid with `grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))` for responsive layout without breakpoint-specific rules.
<!-- clarified: 240px minimum card width — fits 3-4 cards in the terminal column across typical viewport widths (auto-resolved) -->

#### Scenario: Cards Render With Design Tokens
- **GIVEN** sessions exist
- **WHEN** the Dashboard renders
- **THEN** each card uses `bg-bg-card border border-border rounded` styling
- **AND** cards are arranged in a responsive grid

## Project Page: Window Card Grid

### Requirement: Project Page Layout

The Project page SHALL render in the terminal area when the route matches `/$session`. It SHALL display:
1. A grid of window cards, one per `WindowInfo` in the matching session
2. A "New Window" button that calls the existing `createWindow` API

The matching session SHALL be found by comparing the `$session` URL param against `sessions[].name`. If no session matches, the Project page SHALL show "Session not found" with a link back to `/`.

#### Scenario: Valid Session Shows Window Cards
- **GIVEN** session "run-kit" has 3 windows
- **WHEN** the user navigates to `/run-kit`
- **THEN** 3 window cards render in the terminal area

#### Scenario: Unknown Session Shows Not Found
- **GIVEN** no session named "ghost" exists
- **WHEN** the user navigates to `/ghost`
- **THEN** "Session not found" text renders with a link to `/`

### Requirement: Window Card Content

Each window card SHALL display:
- Window name (primary text)
- Running process (`paneCommand`) if present
- Activity status: colored dot (green = active, dim = idle) + label ("active" / "idle")
- Duration: idle duration via `getWindowDuration()` from `lib/format.ts`
- Fab info: stage badge + change ID if `fabStage` is present, using existing `text-accent px-1.5 py-0.5 rounded bg-accent/10` badge styling

#### Scenario: Window Card With Fab Info
- **GIVEN** a window with `fabStage: "apply"` and `fabChange: "ll1j · dashboard-project-page-views"`
- **WHEN** the Project page renders
- **THEN** the card shows a fab stage badge "apply" and the change ID

#### Scenario: Window Card With Idle Duration
- **GIVEN** a window with `activity: "idle"` and `activityTimestamp` 120 seconds ago
- **WHEN** the Project page renders
- **THEN** the card shows "idle" with a "2m" duration

### Requirement: Window Card Navigation

Clicking a window card SHALL navigate to `/$session/$window`.

#### Scenario: Click Window Card Navigates
- **GIVEN** the Project page for "run-kit" shows a card for window index 2
- **WHEN** the user clicks the card
- **THEN** the URL changes to `/run-kit/2`
- **AND** the terminal connects and renders

## Chrome: View-Dependent Adaptation

### Requirement: Top Bar Breadcrumbs Per View

The top bar breadcrumb content SHALL adapt based on the active route:
- **Dashboard** (`/`): Logo only (no session or window segments)
- **Project page** (`/$session`): Logo + `❯ {session}` (session dropdown, no window segment)
- **Terminal** (`/$session/$window`): Logo + `❯ {session}` + `❯ {window}` (unchanged)

#### Scenario: Dashboard Breadcrumb
- **GIVEN** the user is on `/`
- **WHEN** the top bar renders
- **THEN** only the logo is shown in the breadcrumb area (no ❯ separators)

#### Scenario: Project Page Breadcrumb
- **GIVEN** the user is on `/run-kit`
- **WHEN** the top bar renders
- **THEN** the breadcrumb shows `{logo} ❯ run-kit`
- **AND** the ❯ triggers the session dropdown

### Requirement: Line 2 Actions Per View

Line 2 SHALL adapt its left-side action buttons based on the active route:
- **Dashboard** (`/`): `[+ Session]` only
- **Project page** (`/$session`): `[+ Session]` + `[+ Window]`
- **Terminal** (`/$session/$window`): `[+ Session]` + `[Rename]` + `[Kill]` (unchanged)

Line 2 right-side status (activity dot, paneCommand, duration, fab info) SHALL only render on the Terminal view. Line 2 fixed-width toggle SHALL only render on the Terminal view.

#### Scenario: Project Page Line 2 Shows New Window Button
- **GIVEN** the user is on `/run-kit`
- **WHEN** the top bar renders
- **THEN** Line 2 shows `[+ Session]` and `[+ Window]` buttons
- **AND** `[Rename]` and `[Kill]` are not shown
- **AND** no status info renders on the right side

### Requirement: Bottom Bar Hidden on Non-Terminal Views

The bottom bar SHALL only render when the Terminal view is active (`/$session/$window`). On Dashboard and Project page, the bottom bar SHALL not render. This prevents meaningless key buttons when no terminal WebSocket exists.

#### Scenario: Dashboard Hides Bottom Bar
- **GIVEN** the user is on `/`
- **WHEN** the page renders
- **THEN** no bottom bar is visible

#### Scenario: Terminal Shows Bottom Bar
- **GIVEN** the user is on `/run-kit/0`
- **WHEN** the page renders
- **THEN** the bottom bar renders with modifier keys and arrow pad

## Redirect: Kill Recovery Navigation

### Requirement: Kill Redirects

After a kill operation succeeds, the frontend SHALL navigate to the appropriate parent view:
1. **Kill non-last window** → `/$session` (project page for the session)
2. **Kill last window in session** → `/$session` (project page shows empty state + "New Window" button)
3. **Kill session** → `/` (dashboard)

Redirect SHALL happen immediately after the kill API call succeeds, before SSE removes the stale data. The current behavior of leaving a stale URL SHALL be replaced.

#### Scenario: Kill Non-Last Window Redirects to Project Page
- **GIVEN** session "run-kit" has 3 windows and the user is viewing window 1
- **WHEN** the user kills window 1
- **THEN** the URL changes to `/run-kit`
- **AND** the Project page renders showing the remaining 2 windows

#### Scenario: Kill Last Window Redirects to Project Page
- **GIVEN** session "run-kit" has 1 window
- **WHEN** the user kills that window
- **THEN** the URL changes to `/run-kit`
- **AND** the Project page shows an empty state with "New Window" button

#### Scenario: Kill Session Redirects to Dashboard
- **GIVEN** the user is on `/run-kit/0`
- **WHEN** the user kills the "run-kit" session
- **THEN** the URL changes to `/`
- **AND** the Dashboard renders

### Requirement: Redirect After Kill From Sidebar

Kill operations triggered from the sidebar (session ✕ button) SHALL follow the same redirect rules. The sidebar's `handleKillSession` SHALL navigate to `/` after the kill API call succeeds.

#### Scenario: Sidebar Kill Session Redirects to Dashboard
- **GIVEN** the user clicks the ✕ button on session "run-kit" in the sidebar
- **WHEN** the kill succeeds
- **THEN** the URL changes to `/`

## Sidebar: Session Name Navigation

### Requirement: Split Session Row Interaction

The sidebar session row SHALL split its interaction targets:
- **Session name** (text label): Click navigates to `/$session` (project page)
- **Chevron/triangle** (expand/collapse icon): Click toggles the window list visibility

The current behavior where clicking the session name toggles expand/collapse SHALL be replaced. The session name becomes a navigation link.

#### Scenario: Click Session Name Navigates
- **GIVEN** the sidebar shows session "run-kit"
- **WHEN** the user clicks the "run-kit" text
- **THEN** the URL changes to `/run-kit`
- **AND** the Project page renders

#### Scenario: Click Chevron Toggles Windows
- **GIVEN** the sidebar shows session "run-kit" with windows expanded
- **WHEN** the user clicks the chevron/triangle icon
- **THEN** the window list collapses
- **AND** no navigation occurs

### Requirement: Active Session Highlight in Sidebar

When viewing a Project page (`/$session`), the session name in the sidebar SHALL be visually highlighted (e.g., `text-text-primary font-medium`) to indicate the active context, even when no specific window is selected.

#### Scenario: Project Page Highlights Session
- **GIVEN** the user is on `/run-kit`
- **WHEN** the sidebar renders
- **THEN** the "run-kit" session name uses highlighted styling

## Design Decisions

1. **Dashboard and Project page render in the terminal area slot (not as separate pages)**
   - *Why*: Keeps the existing app shell layout (top bar + sidebar + main area) intact. The new views replace only the terminal content, not the chrome. This is an extension of the single-view model, not a replacement.
   - *Rejected*: Separate full-page routes that replace the entire layout — would require duplicating chrome and sidebar, breaking the unified shell.

2. **Route detection via `useMatches()` (not separate component trees per route)**
   - *Why*: TanStack Router's `useMatches()` is already used in `app.tsx` to extract params. Branching on route match in the terminal area keeps all view logic co-located in the app shell, consistent with the current pattern.
   - *Rejected*: Route-level `component` props in router.tsx — would scatter the rendering logic across files and complicate state sharing (sessions, wsRef, dialogs).

3. **Cards as `<button>` or `<a>` elements (not clickable `<div>`)**
   - *Why*: Semantic HTML for keyboard accessibility and screen reader support. Cards that navigate should be links or buttons, not `onClick` divs.
   - *Rejected*: Clickable divs — worse accessibility, requires manual `role="button"` and `tabIndex`.

## Deprecated Requirements

### Auto-Redirect on Root Load

**Reason**: Replaced by Dashboard view. The `/` route now always renders the Dashboard instead of redirecting to the first session's first window.
**Migration**: Remove the `hasRedirected` ref, the redirect `useEffect`, and the "Select a window from the sidebar" placeholder from `app.tsx`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | URL hierarchy: `/` = Dashboard, `/$session` = Project, `/$session/$window` = Terminal | Confirmed from intake #1 — user explicitly chose hierarchical URL model | S:95 R:90 A:95 D:95 |
| 2 | Certain | Both views use card layouts in CSS Grid | Confirmed from intake #2 — user chose cards for both Dashboard and Project page | S:90 R:85 A:90 D:95 |
| 3 | Certain | Dashboard stats are simple counts (sessions, windows) | Confirmed from intake #3 — user chose simple counts | S:90 R:90 A:90 D:95 |
| 4 | Certain | Session card click → `/$session` (project page, not directly to terminal) | Confirmed from intake #4 — user chose drill-down | S:95 R:85 A:90 D:95 |
| 5 | Certain | Kill redirects: non-last/last window → `/$session`, kill session → `/` | Confirmed from intake #5 — all three redirect behaviors agreed | S:95 R:80 A:90 D:95 |
| 6 | Confident | No new backend API endpoints — card data from existing SSE stream | Confirmed from intake #6 — `ProjectSession[]` with `WindowInfo[]` has all needed fields | S:75 R:90 A:85 D:90 |
| 7 | Confident | Bottom bar hidden on Dashboard and Project page | Confirmed from intake #7 — bottom bar sends keys to terminal WebSocket, meaningless without terminal | S:70 R:90 A:85 D:90 |
| 8 | Confident | Card styling uses existing design tokens (bg-bg-card, border-border, etc.) | Confirmed from intake #8 — constitution + existing design patterns | S:70 R:95 A:85 D:90 |
| 9 | Certain | `/` always shows Dashboard — no auto-redirect to terminal | Confirmed from intake #9 — user chose "always dashboard" | S:95 R:80 A:90 D:95 |
| 10 | Certain | Sidebar session click navigates to `/$session`, chevron toggles expand/collapse | Confirmed from intake #10 — split interaction targets | S:95 R:75 A:85 D:95 |
| 11 | Confident | Card grid uses `auto-fill, minmax(240px, 1fr)` for responsive layout | Codebase uses Tailwind for layout; auto-fill grid avoids breakpoint-specific rules | S:60 R:95 A:80 D:85 |
| 12 | Confident | Route detection via `useMatches()` in app.tsx for view branching | Pattern already established — app.tsx extracts params via `useMatches()` | S:65 R:90 A:85 D:85 |

12 assumptions (7 certain, 5 confident, 0 tentative, 0 unresolved).
