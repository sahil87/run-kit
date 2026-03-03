# Spec: Unified Top Bar

**Change**: 260303-vag8-unified-top-bar
**Created**: 2026-03-03
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- Sub-panels or sub-screens within any page — explicitly out of scope per discussion
- Collapsible top bar on the terminal page — user chose always-visible
- Dashboard grouping changes — session groups remain visually as they are today

## UI: Top Bar — Shared Breadcrumb Component

### Requirement: Unified Breadcrumb Navigation

All three pages (`/`, `/p/:project`, `/p/:project/:window`) SHALL render a shared `TopBar` component as the first element. The component SHALL contain two lines:

- **Line 1**: Breadcrumb navigation (left) + connection indicator + `⌘K` hint (right)
- **Line 2**: Contextual action bar (content varies per page, passed as children or via props)

The `TopBar` component MUST be a Client Component (it depends on `isConnected` from `useSessions` and renders interactive elements).

#### Scenario: Dashboard breadcrumb

- **GIVEN** the user is on the dashboard (`/`)
- **WHEN** the page renders
- **THEN** Line 1 shows `Dashboard` as the only breadcrumb segment (non-clickable since it's the current page)
- **AND** the right side shows the connection dot and `⌘K` hint

#### Scenario: Project breadcrumb

- **GIVEN** the user is on the project page (`/p/run-kit`)
- **WHEN** the page renders
- **THEN** Line 1 shows `Dashboard › project: run-kit`
- **AND** "Dashboard" is a clickable link navigating to `/`
- **AND** "project: run-kit" is non-clickable (current page)

#### Scenario: Terminal breadcrumb

- **GIVEN** the user is on the terminal page (`/p/run-kit/0?name=agent-main`)
- **WHEN** the page renders
- **THEN** Line 1 shows `Dashboard › project: run-kit › window: agent-main`
- **AND** "Dashboard" navigates to `/`, "project: run-kit" navigates to `/p/run-kit`
- **AND** "window: agent-main" is non-clickable (current page)

#### Scenario: Window name fallback

- **GIVEN** the user navigates to the terminal page without a `name` query parameter
- **WHEN** the page renders
- **THEN** the breadcrumb shows `window: {windowIndex}` as a fallback (the numeric index from the URL)

### Requirement: Breadcrumb Segment Separator

Breadcrumb segments SHALL be separated by `›` (right angle quotation mark, U+203A).

#### Scenario: Separator rendering

- **GIVEN** the user is on the project page
- **WHEN** the breadcrumb renders
- **THEN** the separator `›` appears between "Dashboard" and "project: run-kit" with appropriate spacing

### Requirement: Global Connection Indicator

The connection indicator SHALL appear on Line 1 of the top bar on all three pages. It SHALL show a green dot (`bg-accent-green`) with the label "live" when connected, and a gray dot (`bg-text-secondary`) with the label "disconnected" when not connected.

The `isConnected` state SHALL come from the `useSessions` hook. On the terminal page, which currently does not use `useSessions`, the hook SHALL be added to provide connection status.

#### Scenario: Connected state

- **GIVEN** the SSE connection is active
- **WHEN** the top bar renders on any page
- **THEN** a green dot and "live" label appear on the right side of Line 1

#### Scenario: Disconnected state

- **GIVEN** the SSE connection is down
- **WHEN** the top bar renders on any page
- **THEN** a gray dot and "disconnected" label appear on the right side of Line 1

### Requirement: Command Palette Hint Badge

A `⌘K` hint badge SHALL appear next to the connection indicator on all pages, matching the existing dashboard styling: `<kbd>` element with border.

#### Scenario: Hint badge on terminal page

- **GIVEN** the user is on the terminal page (which currently has no `⌘K` badge)
- **WHEN** the top bar renders
- **THEN** the `⌘K` badge is visible on the right side of Line 1

## UI: Dashboard Action Bar

### Requirement: Dashboard Action Bar Content

On the dashboard, Line 2 of the top bar SHALL contain:

1. A **"+ New Session"** button (left) — opens the existing create-session dialog
2. An **always-visible search input** (center-left) — replaces the current `/`-to-toggle filter
3. A **summary label** (right) — `{N} sessions, {M} windows`

#### Scenario: Create session via button

- **GIVEN** the dashboard is displayed
- **WHEN** the user clicks "+ New Session"
- **THEN** the create-session dialog opens (same dialog as the current `c` shortcut)

#### Scenario: Filter via always-visible search

- **GIVEN** the dashboard is displayed with multiple sessions
- **WHEN** the user types "agent" into the search input
- **THEN** the session cards are filtered to show only windows matching "agent" by name, project name, or worktree path
- **AND** the filter logic is identical to the current `filterQuery` implementation

#### Scenario: Search input focus via keyboard

- **GIVEN** the dashboard is displayed
- **WHEN** the user presses `/`
- **THEN** the search input receives focus (replacing the previous show/hide toggle)

#### Scenario: Summary counts

- **GIVEN** 3 sessions with a total of 7 windows
- **WHEN** the dashboard renders
- **THEN** the right side of Line 2 shows "3 sessions, 7 windows"

### Requirement: Remove Toggle Filter

The `showFilter` state and the `/`-to-toggle behavior SHALL be removed. The search input is always visible in Line 2. The `/` shortcut SHALL focus the search input instead.

#### Scenario: Filter always visible

- **GIVEN** the dashboard has loaded
- **WHEN** the user has not pressed any keys
- **THEN** the search input is visible in the action bar (no toggle needed)

## UI: Project Action Bar

### Requirement: Project Action Bar Content

On the project page, Line 2 of the top bar SHALL contain:

1. A **"+ New Window"** button (left) — opens the existing create-window dialog
2. A **"Send Message"** button (left, after New Window) — opens the existing send-message dialog for the focused window. SHOULD be disabled when no window is focused.
3. A **window count** label (right) — `{N} windows`

#### Scenario: Create window via button

- **GIVEN** the project page is displayed
- **WHEN** the user clicks "+ New Window"
- **THEN** the create-window dialog opens (same as the current `n` shortcut)

#### Scenario: Send message via button

- **GIVEN** the project page is displayed with a focused window
- **WHEN** the user clicks "Send Message"
- **THEN** the send-message dialog opens targeting the focused window (same as the current `s` shortcut)

#### Scenario: Send message when no focus

- **GIVEN** the project page is displayed but no window is focused
- **WHEN** the user sees the "Send Message" button
- **THEN** the button appears disabled (visually dimmed, not clickable)

### Requirement: Remove Shortcut Hint Badges from Header

The project page currently shows `n`/`x`/`s` keyboard hint badges in the header. These SHALL be removed. The action buttons and the command palette provide sufficient affordance.

#### Scenario: Clean project header

- **GIVEN** the project page is displayed
- **WHEN** the header renders
- **THEN** no keyboard shortcut hint badges (`n`, `x`, `s`) appear in the header area

## UI: Terminal Action Bar

### Requirement: Terminal Action Bar Content

On the terminal page, Line 2 of the top bar SHALL contain:

1. A **"Kill Window"** button (left) — kills the current window after confirmation
2. A **status display** (right) — activity indicator + optional fab stage badge

#### Scenario: Kill window via button

- **GIVEN** the terminal page is displaying window "agent-main"
- **WHEN** the user clicks "Kill Window"
- **THEN** a confirmation dialog appears: "Kill window **agent-main**?"
- **AND** confirming kills the window via `POST /api/sessions { action: "killWindow", session, index }`
- **AND** after kill, the user is navigated back to the project page

#### Scenario: Activity status display

- **GIVEN** the terminal page is displaying a window
- **WHEN** the top bar renders
- **THEN** the right side of Line 2 shows an activity dot (green for active, gray for idle)

#### Scenario: Fab stage badge

- **GIVEN** the terminal page is displaying a window that has a `fabProgress` value
- **WHEN** the top bar renders
- **THEN** the right side of Line 2 shows a fab badge (e.g., "fab: apply") after the activity indicator
<!-- assumed: fab stage for the current window obtained from useSessions data or passed as prop — exact mechanism depends on whether terminal page fetches session data -->

### Requirement: Terminal Uses useSessions Hook

The terminal page SHALL use the `useSessions` hook to access `isConnected` for the top bar connection indicator and to look up the current window's activity status and fab stage.

#### Scenario: Terminal page loads session data

- **GIVEN** the terminal page mounts
- **WHEN** the SSE connection establishes
- **THEN** the `useSessions` hook provides session data including the current window's activity and fabProgress

## UI: Inline Kill Controls

### Requirement: Window Card Kill Button

Every `SessionCard` component (rendered on both dashboard and project pages) SHALL include a `✕` button on the right side of the card.

- The button MUST be visually subtle by default (`text-text-secondary` or lower opacity)
- The button SHOULD become visible/prominent on card hover
- Clicking the button MUST open a confirmation dialog: "Kill window **{name}**?"
- The click event MUST call `stopPropagation()` so it does not trigger the card's `onClick` navigation

#### Scenario: Kill window from card

- **GIVEN** the dashboard is showing session cards
- **WHEN** the user hovers a card and clicks `✕`
- **THEN** a confirmation dialog shows "Kill window **{windowName}**?"
- **AND** confirming calls `POST /api/sessions { action: "killWindow", session, index }`

#### Scenario: Click does not navigate

- **GIVEN** the user clicks the `✕` button on a card
- **WHEN** the click event fires
- **THEN** the card's `onClick` handler is NOT triggered (navigation does not occur)

### Requirement: Session Group Kill Button

On the dashboard, each session group header SHALL include a `✕` button. This button kills the entire tmux session.

- The button MUST be visually distinct from the window `✕`: slightly larger or showing a red tint on hover
- Clicking MUST open a confirmation dialog: "Kill session **{name}** and all {N} windows?"
- Confirming calls `POST /api/sessions { action: "killSession", session }`

#### Scenario: Kill session from dashboard

- **GIVEN** the dashboard shows session "run-kit" with 3 windows
- **WHEN** the user clicks the `✕` on the session group header
- **THEN** a confirmation dialog shows "Kill session **run-kit** and all 3 windows?"
- **AND** confirming calls `POST /api/sessions { action: "killSession", session: "run-kit" }`
- **AND** SSE updates remove the session from the dashboard

## API: Kill Session

### Requirement: killSession API Action

The `POST /api/sessions` endpoint SHALL accept a new action `killSession` with the payload `{ action: "killSession", session: string }`.

- The `session` parameter MUST be validated via `validateName()` before reaching any subprocess
- Implementation MUST use `execFile("tmux", ["kill-session", "-t", session])` via a new `killSession` function in `src/lib/tmux.ts`
- The tmux call MUST include a timeout (default `TMUX_TIMEOUT` = 10 seconds)

#### Scenario: Kill session success

- **GIVEN** a tmux session "run-kit" exists
- **WHEN** `POST /api/sessions { action: "killSession", session: "run-kit" }` is received
- **THEN** tmux `kill-session -t run-kit` is executed
- **AND** the response is `{ ok: true }`

#### Scenario: Kill session with invalid name

- **GIVEN** the session name contains forbidden characters (e.g., `foo;bar`)
- **WHEN** the request is received
- **THEN** the response is `400 { error: "Session name contains forbidden characters" }`
- **AND** no tmux command is executed

#### Scenario: Kill non-existent session

- **GIVEN** no tmux session named "ghost" exists
- **WHEN** `POST /api/sessions { action: "killSession", session: "ghost" }` is received
- **THEN** the tmux command fails
- **AND** the response is `500 { error: "..." }` with the tmux error message

## UI: Terminal Command Palette

### Requirement: Command Palette on Terminal Page

The terminal page SHALL include the `CommandPalette` component with at minimum these actions:

- "Kill this window" — opens the kill window confirmation dialog
- "Back to project" — navigates to `/p/{project}`
- "Back to dashboard" — navigates to `/`

The existing `⌘K` keyboard shortcut SHALL activate the palette (handled by the `CommandPalette` component's internal `useEffect`).

#### Scenario: Open palette on terminal page

- **GIVEN** the user is on the terminal page
- **WHEN** the user presses `⌘K`
- **THEN** the command palette opens with the terminal-specific actions

#### Scenario: Kill via palette

- **GIVEN** the command palette is open on the terminal page
- **WHEN** the user selects "Kill this window"
- **THEN** the kill window confirmation dialog appears

## UI: Window Name Resolution

### Requirement: Pass Window Name via Query Parameter

When navigating to the terminal page, the caller MUST append the window name as a `name` query parameter: `/p/{project}/{windowIndex}?name={windowName}`.

The terminal page SHALL read this parameter and display it in the breadcrumb.

#### Scenario: Navigation from dashboard card

- **GIVEN** the user is on the dashboard looking at window "agent-main" (index 0) in session "run-kit"
- **WHEN** the user clicks the card
- **THEN** the browser navigates to `/p/run-kit/0?name=agent-main`
- **AND** the terminal breadcrumb shows "window: agent-main"

#### Scenario: Navigation from project card

- **GIVEN** the user is on the project page looking at window "agent-main" (index 0)
- **WHEN** the user clicks the card
- **THEN** the browser navigates to `/p/run-kit/0?name=agent-main`
- **AND** the terminal breadcrumb shows "window: agent-main"

#### Scenario: Direct URL access without name

- **GIVEN** a user navigates directly to `/p/run-kit/0` (no `name` param)
- **WHEN** the terminal page renders
- **THEN** the breadcrumb falls back to "window: 0"

### Requirement: Update All Navigation Paths

All code paths that navigate to the terminal page SHALL be updated to include the `name` query parameter:

- `DashboardClient.navigateToWindow()` — currently pushes `/p/{project}/{index}`
- `ProjectClient.navigateToTerminal()` — currently pushes `/p/{project}/{index}`
- `CommandPalette` actions that open terminals
- Any `router.push` calls targeting terminal URLs

#### Scenario: Command palette terminal navigation includes name

- **GIVEN** the dashboard command palette includes a "Terminal: run-kit/agent-main" action
- **WHEN** the user selects it
- **THEN** the browser navigates to `/p/run-kit/0?name=agent-main`

## Deprecated Requirements

### Back Arrow Navigation (Project and Terminal Pages)

**Reason**: Replaced by clickable breadcrumb segments in the shared top bar. The `←` button on project and terminal headers is superseded.
**Migration**: Breadcrumb "Dashboard" segment replaces back-to-dashboard; "project: {name}" segment replaces back-to-project.

### Toggle Filter (Dashboard)

**Reason**: Replaced by always-visible search input in the dashboard action bar. The `showFilter` state toggle and `/`-to-show behavior are removed.
**Migration**: `/` shortcut now focuses the always-visible search input.

### Keyboard Hint Badges in Project Header

**Reason**: Replaced by visible action buttons in the project action bar. The `n`/`x`/`s` kbd badges in the header are removed.
**Migration**: Buttons provide visible affordance; shortcuts still work via `useKeyboardNav`.

## Design Decisions

1. **TopBar as a shared Client Component (not per-page duplication)**
   - *Why*: Reduces duplication of breadcrumb + connection indicator logic; consistent styling enforced in one place. The component takes `breadcrumbs` (segments array) and `children` (action bar content) as props.
   - *Rejected*: Duplicating breadcrumb markup in each page — violates DRY, makes consistency harder.

2. **Window name via query parameter (not API fetch)**
   - *Why*: Simpler implementation — session data already available at navigation time. No additional API call on terminal mount. Graceful fallback to numeric index if param missing.
   - *Rejected*: Fetching window name from `/api/sessions` on terminal mount — adds latency, requires loading state for breadcrumb, and the data is already known at navigation time.

3. **useSessions hook on terminal page (not a separate connection-only hook)**
   - *Why*: The existing hook provides both `isConnected` and session data (for window activity/fab status). Creating a minimal "connection-only" hook would duplicate SSE subscription logic.
   - *Rejected*: Lightweight connection-only hook — would avoid fetching full session data on terminal page, but the data is small (<100 sessions) and useful for status display.

4. **Kill confirmation as inline dialog (not reusing command palette)**
   - *Why*: Kill is a destructive action requiring explicit confirmation with context ("Kill window **X**?" / "Kill session **X** and all N windows?"). Command palette selections should be instant-action.
   - *Rejected*: Kill directly from command palette without confirmation — too easy to accidentally destroy sessions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Two-line top bar: breadcrumb + action bar | Confirmed from intake #1 — user designed and confirmed | S:95 R:80 A:90 D:95 |
| 2 | Certain | Breadcrumb format: "Dashboard › project: {name} › window: {name}" | Confirmed from intake #2 — user specified labeled segments | S:95 R:85 A:90 D:95 |
| 3 | Certain | Each breadcrumb segment clickable for navigation | Confirmed from intake #3 — user confirmed, last segment non-clickable | S:90 R:90 A:90 D:95 |
| 4 | Certain | Connection status global on all pages | Confirmed from intake #4 — user confirmed | S:90 R:90 A:85 D:95 |
| 5 | Certain | ⌘K command palette on terminal page | Confirmed from intake #5 — terminal needs palette support | S:85 R:90 A:85 D:90 |
| 6 | Certain | Dashboard: always-visible search input (not toggle) | Confirmed from intake #6 — user chose this over button | S:95 R:85 A:85 D:95 |
| 7 | Certain | Project action bar: New Window + Send Message (Kill moved to inline) | Confirmed from intake #7 — kill moved to inline ✕ on cards | S:90 R:80 A:85 D:90 |
| 8 | Certain | Terminal action bar: Kill Window + activity status + fab stage | Confirmed from intake #8 — user confirmed | S:90 R:80 A:85 D:90 |
| 9 | Certain | Inline ✕ on cards: subtle for windows, visually heavier for session groups | Confirmed from intake #9 — user designed both treatments | S:95 R:80 A:90 D:95 |
| 10 | Certain | Kill session is new capability via session group ✕ + killSession API | Confirmed from intake #10 — user explicitly requested | S:95 R:70 A:90 D:95 |
| 11 | Certain | Confirmation copy differentiates window vs session kill | Confirmed from intake #11 — both confirmation patterns specified | S:90 R:75 A:90 D:95 |
| 12 | Certain | Sub-panels / sub-screens out of scope | Confirmed from intake #12 — user said "ignore for now" | S:95 R:95 A:95 D:95 |
| 13 | Certain | Always-visible top bar on terminal (not collapsible) | Confirmed from intake #13 — user chose this | S:90 R:85 A:85 D:90 |
| 14 | Certain | Window name passed via query param to terminal page | Upgraded from intake Confident #14 — codebase confirms: navigateToWindow/navigateToTerminal already have window data; simple string append | S:80 R:90 A:90 D:85 |
| 15 | Certain | Shared top bar as a reusable component (not duplicated per page) | Upgraded from intake Confident #15 — component takes breadcrumb segments + children, consistent with codebase patterns | S:80 R:90 A:90 D:85 |
| 16 | Certain | killSession API uses tmux kill-session command | Upgraded from intake Confident #16 — reviewed lib/tmux.ts; pattern identical to killWindow: tmuxExec(["kill-session", "-t", session]) | S:80 R:85 A:90 D:90 |
| 17 | Certain | TopBar is a Client Component | Required by isConnected dependency and interactive breadcrumb links | S:85 R:90 A:90 D:90 |
| 18 | Certain | useSessions hook added to terminal page | Provides isConnected + window activity/fab data; small payload overhead | S:85 R:85 A:90 D:85 |
| 19 | Certain | Existing keyboard shortcuts preserved (c, /, n, x, s, j/k, Enter, Esc Esc) | Buttons are additive — existing shortcuts remain via useKeyboardNav | S:90 R:95 A:90 D:95 |
| 20 | Confident | Kill window navigates back to project page after success | Natural UX — window no longer exists, SSE will update. Not explicitly discussed but standard pattern | S:55 R:85 A:80 D:75 |
| 21 | Confident | Session group kill button visible by default (not hover-only) | Session kill is rarer and more destructive — always-visible ✕ with red hover provides appropriate warning. Window ✕ is hover-reveal for less visual noise | S:55 R:80 A:75 D:70 |

21 assumptions (19 certain, 2 confident, 0 tentative, 0 unresolved).
