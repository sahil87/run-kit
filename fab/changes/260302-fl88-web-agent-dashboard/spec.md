# Spec: Web-Based Agent Orchestration Dashboard

**Change**: 260302-fl88-web-agent-dashboard
**Created**: 2026-03-02
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Orchestration logic (dispatching agents, batch pipelines) — v1 is visibility + session CRUD only
- Light theme or theme switching — dark only for v1
- Multi-user auth or access control — single-user local tool
- Database, ORM, or persistent state store — state derived from tmux + filesystem
- Pages beyond the three-route structure (/, /p/:project, /p/:project/:window)
- Mobile-responsive layout — desktop-first, fixed-width-friendly

---

## Architecture: System Boundaries

### Requirement: Component Separation

The system SHALL consist of three independently running processes:
1. A bash process supervisor (`supervisor.sh`)
2. A Next.js 15 application (port 3000)
3. A terminal relay WebSocket server (port 3001)

The tmux server SHALL be treated as an external dependency — never started or stopped by run-kit.

#### Scenario: Server restart does not affect tmux sessions
- **GIVEN** three agent sessions running in tmux windows
- **WHEN** the Next.js server restarts (via supervisor)
- **THEN** all three tmux sessions continue running uninterrupted
- **AND** the web UI reconnects and reflects current tmux state within one SSE poll cycle

#### Scenario: Terminal relay independence
- **GIVEN** the terminal relay is running on port 3001
- **WHEN** the Next.js server on port 3000 crashes
- **THEN** existing WebSocket connections to the relay remain open
- **AND** terminal sessions in the browser continue functioning

### Requirement: Security — No Shell Injection

All subprocess invocations MUST use `execFile` with explicit argument arrays. The system MUST NOT use `exec`, `execSync`, or template-string shell commands anywhere in the codebase. User-provided input (session names, window names, paths) SHALL be validated before passing to any subprocess.

#### Scenario: Malicious session name
- **GIVEN** a user attempts to create a session named `test; rm -rf /`
- **WHEN** the name is passed to `lib/tmux.ts` functions
- **THEN** the name is passed as a single `execFile` argument (not interpolated into a shell string)
- **AND** tmux receives the literal string `test; rm -rf /` as a session name (which tmux rejects as invalid)

### Requirement: Process Execution Timeouts

All `execFile` calls MUST include a `timeout` option. Default timeouts: 5–10 seconds for tmux operations, 30 seconds for build operations. Hung tmux commands MUST NOT block the server.

#### Scenario: tmux command hangs
- **GIVEN** a tmux `list-sessions` call
- **WHEN** the tmux server is unresponsive for more than 10 seconds
- **THEN** the `execFile` call times out and throws an error
- **AND** the API route returns an appropriate error response without blocking other requests

---

## Backend: tmux Operations (`lib/tmux.ts`)

### Requirement: Session Listing

`listSessions()` SHALL return an array of session names by invoking `tmux list-sessions -F '#{session_name}'`. If the tmux server is not running, it SHALL return an empty array (not throw).

#### Scenario: tmux server running with sessions
- **GIVEN** tmux sessions `project-a` and `project-b` exist
- **WHEN** `listSessions()` is called
- **THEN** it returns `["project-a", "project-b"]`

#### Scenario: tmux server not running
- **GIVEN** no tmux server is running
- **WHEN** `listSessions()` is called
- **THEN** it returns `[]`

### Requirement: Window Listing

`listWindows(session)` SHALL return an array of `WindowInfo` objects by invoking `tmux list-windows` with the format string `#{window_index}:#{window_name}:#{pane_current_path}:#{window_activity}`. Activity status SHALL be derived by comparing `window_activity` timestamp to the current time: active if within 10 seconds, idle otherwise.

#### Scenario: Session with multiple windows
- **GIVEN** session `project-a` has windows: `0:agent-wt1:/home/user/wt1:1709000000` and `1:agent-wt2:/home/user/wt2:1709000050`
- **WHEN** `listWindows("project-a")` is called
- **THEN** it returns two `WindowInfo` objects with parsed index, name, worktreePath, and activity

#### Scenario: Non-existent session
- **GIVEN** no session named `project-z` exists
- **WHEN** `listWindows("project-z")` is called
- **THEN** it returns `[]`

### Requirement: Session Creation

`createSession(name)` SHALL create a detached tmux session via `tmux new-session -d -s <name>`.

#### Scenario: Create new session
- **GIVEN** no session named `my-project` exists
- **WHEN** `createSession("my-project")` is called
- **THEN** a detached tmux session named `my-project` is created

### Requirement: Window Creation

`createWindow(session, name, cwd)` SHALL create a new window in the given session via `tmux new-window -t <session> -n <name> -c <cwd>`.

#### Scenario: Create window in existing session
- **GIVEN** session `project-a` exists
- **WHEN** `createWindow("project-a", "agent-wt3", "/home/user/wt3")` is called
- **THEN** a new window named `agent-wt3` is created in `project-a` with CWD `/home/user/wt3`

### Requirement: Window Termination

`killWindow(session, index)` SHALL kill a specific window via `tmux kill-window -t <session>:<index>`.

#### Scenario: Kill a window
- **GIVEN** session `project-a` has window at index 2
- **WHEN** `killWindow("project-a", 2)` is called
- **THEN** the window at index 2 is destroyed

### Requirement: Send Keys

`sendKeys(session, window, keys)` SHALL send keystrokes to a tmux window via `tmux send-keys -t <session>:<window> <keys> Enter`.

#### Scenario: Send a command to an agent window
- **GIVEN** session `project-a`, window index 1
- **WHEN** `sendKeys("project-a", 1, "npm test")` is called
- **THEN** the string `npm test` followed by Enter is sent to the target pane

### Requirement: Pane Operations for Terminal Relay

`splitPane(session, window)` SHALL create a new pane via `tmux split-window` and return the new pane ID. `killPane(paneId)` SHALL destroy a specific pane. `capturePane(paneId, lines)` SHALL capture pane content for status snapshots.

#### Scenario: Browser client connects — independent pane created
- **GIVEN** window `project-a:0` has one pane (the agent pane)
- **WHEN** `splitPane("project-a", 0)` is called
- **THEN** a new pane is created in the same window
- **AND** the original agent pane (pane 0) is not affected

#### Scenario: Browser client disconnects — pane cleaned up
- **GIVEN** a browser-created pane `%42` exists
- **WHEN** `killPane("%42")` is called
- **THEN** pane `%42` is destroyed
- **AND** the original agent pane continues running

---

## Backend: Worktree Operations (`lib/worktree.ts`)

### Requirement: Wrap Existing fab-kit Scripts

Worktree operations SHALL delegate to existing fab-kit `wt-*` scripts. The module MUST NOT reimplement worktree management logic.

- `create(name, branch?)` SHALL call `wt-create --non-interactive --worktree-name <name> [branch]`
- `list()` SHALL call `wt-list` and parse its output
- `delete(name)` SHALL call `wt-delete <name>`
- `open(name)` SHALL call `wt-open <name>`

All calls MUST use `execFile` with argument arrays.

#### Scenario: Create a worktree
- **GIVEN** fab-kit `wt-create` is on PATH
- **WHEN** `create("feature-auth", "feat/auth")` is called
- **THEN** `execFile` invokes `wt-create --non-interactive --worktree-name feature-auth feat/auth`

#### Scenario: List worktrees
- **GIVEN** two worktrees exist
- **WHEN** `list()` is called
- **THEN** it returns parsed worktree information from `wt-list` output

---

## Backend: Fab Integration (`lib/fab.ts`)

### Requirement: Fab State Reading

`getStatus(worktreePath)` SHALL read fab stage information by invoking `statusman.sh progress-line` within the given worktree path. `getCurrentChange(worktreePath)` SHALL read the `fab/current` file in the worktree. `listChanges(worktreePath)` SHALL invoke `changeman.sh list` in the worktree context.

#### Scenario: Active fab change in worktree
- **GIVEN** worktree at `/home/user/wt1` has an active change at spec stage
- **WHEN** `getStatus("/home/user/wt1")` is called
- **THEN** it returns the progress line showing the current stage

#### Scenario: No fab change in worktree
- **GIVEN** worktree at `/home/user/wt2` has no `fab/current`
- **WHEN** `getCurrentChange("/home/user/wt2")` is called
- **THEN** it returns `null`

---

## Backend: Configuration (`lib/config.ts`)

### Requirement: YAML Configuration Loading

The system SHALL load configuration from `run-kit.yaml` in the repo root. The config file defines project paths and preferences. Missing or malformed config SHALL result in a clear error at startup.

```yaml
projects:
  my-app:
    path: ~/code/my-app
    fab_kit: true
```

#### Scenario: Valid config file
- **GIVEN** `run-kit.yaml` exists with two project entries
- **WHEN** the config is loaded at startup
- **THEN** both projects are available with their paths and preferences

#### Scenario: Missing config file
- **GIVEN** `run-kit.yaml` does not exist
- **WHEN** config loading is attempted
- **THEN** the system throws a descriptive error indicating the file is missing

### Requirement: Convention-Based Derivation

Project IDs SHALL be derived from directory names. tmux session names SHALL match the project key in `run-kit.yaml` exactly. Worktree paths SHALL follow fab-kit defaults.

#### Scenario: Project ID derived from config key
- **GIVEN** a project entry with key `my-app` and `path: ~/code/my-app`
- **WHEN** the config is loaded
- **THEN** the project ID is `my-app` and the expected tmux session name is `my-app`

---

## API Layer: REST Endpoints

### Requirement: Session List Endpoint

`GET /api/sessions` SHALL return a JSON array of `ProjectSession` objects representing all tmux sessions and their windows, enriched with fab state where available.

```typescript
type ProjectSession = {
  name: string              // tmux session name
  windows: WindowInfo[]
}

type WindowInfo = {
  index: number             // tmux window index
  name: string              // window name
  worktreePath: string      // from tmux pane CWD
  activity: "active" | "idle"
  fabStage?: string         // from .status.yaml if fab change active
  fabProgress?: string      // from statusman.sh progress-line
}
```

#### Scenario: Fetch all sessions
- **GIVEN** two tmux sessions with three total windows
- **WHEN** `GET /api/sessions` is called
- **THEN** it returns a JSON array with two `ProjectSession` objects containing three `WindowInfo` objects total

### Requirement: Health Check Endpoint

`GET /api/health` SHALL return HTTP 200 with `{ "status": "ok" }`. This endpoint is used by the supervisor to verify successful deployments.

#### Scenario: Server is healthy
- **GIVEN** the Next.js server is running
- **WHEN** `GET /api/health` is called
- **THEN** it returns `200 { "status": "ok" }`

---

## API Layer: SSE Endpoint

### Requirement: Live Session Updates

`GET /api/sessions/stream` SHALL establish a Server-Sent Events connection that pushes session state updates to the client. The server SHALL poll tmux state every 2–3 seconds and emit a full `ProjectSession[]` snapshot on each change. The client SHALL replace its entire state with each received event (no client-side merge logic). Events SHALL only be emitted when the snapshot differs from the previous one (diff detection server-side, full snapshot delivery).
<!-- clarified: SSE event format — full snapshot chosen over incremental diffs, matching AO's pattern for simplicity -->

#### Scenario: Window activity changes
- **GIVEN** a client is connected to the SSE stream
- **WHEN** a tmux window transitions from idle to active
- **THEN** the client receives an SSE event with the updated window state

#### Scenario: New window created
- **GIVEN** a client is connected to the SSE stream
- **WHEN** a new tmux window is created (via UI or externally)
- **THEN** the client receives an SSE event containing the new window

### Requirement: SSE Client Disconnection Handling

The SSE endpoint MUST handle client disconnection gracefully. When a client disconnects, the polling interval for that client MUST stop. No errors SHALL be thrown on disconnection.

#### Scenario: Client closes browser tab
- **GIVEN** a client is receiving SSE events
- **WHEN** the client closes the browser tab
- **THEN** the server detects the closed connection and stops polling for that client
- **AND** no unhandled errors are logged

---

## UI: Dashboard Page (`/`)

### Requirement: Project Overview

The dashboard SHALL display all configured projects as sections, each showing tmux windows as compact cards. Cards SHALL display: window name, worktree path, fab stage (if active change), and activity status (active/idle). tmux sessions SHALL be mapped to configured projects by exact session name match against the project key in `run-kit.yaml`. Sessions that do not match any configured project SHALL be grouped under an "Other" section at the bottom of the dashboard.
<!-- clarified: Session-to-project mapping — exact name match, unmatched sessions shown in "Other" section -->

#### Scenario: Dashboard with multiple projects
- **GIVEN** two projects configured, project-a with 3 windows, project-b with 1 window
- **WHEN** the user navigates to `/`
- **THEN** two project sections are displayed
- **AND** project-a shows 3 session cards, project-b shows 1 session card

#### Scenario: Window card shows fab stage
- **GIVEN** a window's worktree has an active fab change at `apply` stage
- **WHEN** the card is rendered
- **THEN** the card displays the fab stage indicator (e.g., "apply 4/6")

#### Scenario: Empty dashboard
- **GIVEN** no tmux sessions are running
- **WHEN** the user navigates to `/`
- **THEN** the dashboard displays an empty state message with instructions to create a session

---

## UI: Project View (`/p/:project`)

### Requirement: Focused Project View

The project view SHALL show a single project's windows with more detail than the dashboard. It SHALL support these actions: create window, kill window, send message to agent.

#### Scenario: View project windows
- **GIVEN** project `my-app` has 4 windows
- **WHEN** the user navigates to `/p/my-app`
- **THEN** all 4 windows are displayed as cards with full detail

#### Scenario: Create new window
- **GIVEN** the user is on the project view
- **WHEN** the user presses `n` (or clicks create)
- **THEN** a dialog prompts for window name and optional worktree/branch
- **AND** on confirmation, a new tmux window is created via `lib/tmux.ts`

#### Scenario: Kill window
- **GIVEN** the user has focused a window card
- **WHEN** the user presses `x`
- **THEN** a confirmation dialog appears
- **AND** on confirmation, the tmux window is killed via `lib/tmux.ts`

#### Scenario: Send message to agent
- **GIVEN** the user has focused a window card
- **WHEN** the user presses `s`
- **THEN** a text input appears for the message
- **AND** on submit, the message is sent via `sendKeys` to the target window

---

## UI: Terminal View (`/p/:project/:window`)

### Requirement: Full-Screen Terminal

The terminal view SHALL render a full-screen xterm.js terminal connected via WebSocket to the terminal relay on port 3001. Chrome SHALL be minimal: a top bar with window name, worktree path, and a back button.

#### Scenario: Open terminal for a window
- **GIVEN** the user navigates to `/p/my-app/0`
- **WHEN** the page loads
- **THEN** an xterm.js terminal fills the viewport
- **AND** a WebSocket connection is established to `ws://localhost:3001` for session `my-app`, window `0`
- **AND** a new independent pane is created in the target tmux window

#### Scenario: Navigate back from terminal
- **GIVEN** the user is in terminal view
- **WHEN** the user presses `Esc Esc` (double-escape)
- **THEN** the browser navigates back to the project view
- **AND** the browser-created pane is killed via `killPane`

#### Scenario: Terminal resize
- **GIVEN** an active terminal connection
- **WHEN** the browser window is resized
- **THEN** the xterm.js terminal and the tmux pane resize accordingly

---

## UI: Shared — Keyboard Navigation

### Requirement: Keyboard-First Interaction

Every user-facing action MUST be reachable via keyboard. Mouse interaction is supported but secondary.

Keyboard shortcuts:
- `j` / `k` — navigate between cards (down/up)
- `Enter` — drill into terminal view for focused card
- `/` — open filter/search input
- `n` — create new window (project view)
- `c` — create new session (dashboard)
- `x` — kill focused window (with confirmation)
- `s` — send message to focused window's agent
- `Cmd+K` — open global command palette
- `Esc Esc` — back from terminal view

#### Scenario: Navigate cards with j/k
- **GIVEN** the dashboard has 5 session cards
- **WHEN** the user presses `j` three times
- **THEN** the 4th card is focused (visual highlight)

#### Scenario: Drill into terminal
- **GIVEN** a card for project `my-app`, window `0` is focused
- **WHEN** the user presses `Enter`
- **THEN** the browser navigates to `/p/my-app/0`

### Requirement: Command Palette

`Cmd+K` SHALL open a global command palette (Raycast/Linear style). The palette SHALL list all available actions contextually and support fuzzy search. New keyboard shortcuts for actions MUST be registered in the command palette.

#### Scenario: Open command palette
- **GIVEN** the user is on any page
- **WHEN** the user presses `Cmd+K`
- **THEN** a modal command palette appears with a text input
- **AND** available actions are listed (filtered as the user types)

---

## UI: Shared — Visual Design

### Requirement: Dark Theme Only

The UI SHALL use a minimal, opinionated dark theme (Linear/Raycast aesthetic). Monospace font everywhere. No light mode.

Color scheme:
- Background: `#111` (primary), `#1a1a1a` (secondary/cards)
- Text: white (`#fff`) for primary, `#888` for secondary
- Borders: `#333`
- Accent: subtle blue or green for active states

#### Scenario: Visual consistency
- **GIVEN** the user opens the dashboard
- **WHEN** the page renders
- **THEN** all elements use the dark color scheme with monospace typography
- **AND** no light-themed elements are visible

### Requirement: No Loading Spinners

The UI SHALL use SSE to keep data fresh. Optimistic UI for user actions. No loading spinners or skeleton screens for initial data load — the page renders immediately with whatever data is available.

#### Scenario: Optimistic window creation
- **GIVEN** the user creates a new window
- **WHEN** the create action is submitted
- **THEN** the window card appears immediately (optimistic)
- **AND** the SSE stream confirms the actual state within the next poll cycle

---

## Terminal Relay

### Requirement: WebSocket-to-tmux Bridge

The terminal relay SHALL run as a standalone Node.js process on port 3001. It SHALL accept WebSocket connections and bridge them to tmux panes. Each browser connection SHALL create an independent pane via `tmux split-window` — the original agent pane (pane 0) SHALL NOT be affected.

Clients SHALL connect via URL path: `ws://localhost:3001/:session/:window` (e.g., `ws://localhost:3001/project-a/0`). The relay SHALL parse the session and window from the URL path. Invalid or missing path segments SHALL result in an immediate WebSocket close with an error code.
<!-- clarified: WebSocket handshake protocol — URL path chosen over query params and initial-message approaches -->

#### Scenario: Single browser client connects
- **GIVEN** the relay is running and window `project-a:0` exists
- **WHEN** a WebSocket connection is established to `ws://localhost:3001/project-a/0`
- **THEN** the relay parses session=`project-a`, window=`0` from the URL path
- **AND** a new pane is created via `splitPane("project-a", 0)`
- **AND** the WebSocket relays I/O between xterm.js and the new pane

#### Scenario: Multiple browser clients connect to same window
- **GIVEN** two browser tabs open terminal view for `project-a:0`
- **WHEN** both establish WebSocket connections
- **THEN** two independent panes are created (each client gets their own)
- **AND** the original agent pane (pane 0) remains untouched

### Requirement: Cleanup on Disconnect

When a WebSocket connection closes (browser tab closed, network drop), the relay MUST kill the associated pane via `killPane`. No orphaned panes SHALL remain.

#### Scenario: Browser tab closed
- **GIVEN** a browser client is connected with pane `%42`
- **WHEN** the browser tab is closed
- **THEN** the WebSocket `close` event fires
- **AND** pane `%42` is killed via `killPane`

#### Scenario: Network interruption
- **GIVEN** a browser client is connected with pane `%43`
- **WHEN** the network connection drops
- **THEN** the WebSocket detects the disconnect (via ping/pong timeout)
- **AND** pane `%43` is cleaned up

### Requirement: Graceful Error Handling

The relay MUST handle connection drops without throwing unhandled errors. WebSocket errors, tmux command failures, and unexpected disconnects SHALL be caught and logged.

#### Scenario: tmux pane already killed externally
- **GIVEN** a browser client's pane was killed externally (e.g., user ran `tmux kill-pane`)
- **WHEN** the relay attempts to write to the pane
- **THEN** the write error is caught
- **AND** the WebSocket connection is closed with an appropriate close code

---

## Supervisor (`supervisor.sh`)

### Requirement: Signal-Based Restart

The supervisor SHALL monitor for a `.restart-requested` file (polling loop). On detection, it SHALL: run `pnpm build` (which builds both Next.js and the terminal relay), kill both the Next.js process and the terminal relay, start both fresh, and verify health via `GET /api/health` (200 within 10 seconds). The restart mechanism MUST be signal-based — never automatic on file change. The Next.js app and terminal relay SHALL be managed as a single deployment unit — built together, restarted together, rolled back together.
<!-- clarified: Supervisor manages Next.js and terminal relay as a single build/restart/rollback unit -->

#### Scenario: Successful restart
- **GIVEN** the Next.js server is running
- **WHEN** `.restart-requested` file is created
- **THEN** the supervisor runs `pnpm build`
- **AND** kills the old Next.js process
- **AND** starts a new Next.js process
- **AND** waits for `GET /api/health` to return 200
- **AND** removes `.restart-requested`

### Requirement: Automatic Rollback

If the build fails or the health check does not return 200 within 10 seconds, the supervisor SHALL execute `git revert HEAD`, rebuild, and restart the prior version. Rollback MUST be atomic.

#### Scenario: Build failure triggers rollback
- **GIVEN** an agent committed broken code
- **WHEN** `.restart-requested` triggers a build
- **AND** `pnpm build` exits non-zero
- **THEN** the supervisor runs `git revert HEAD`
- **AND** rebuilds and restarts the prior version
- **AND** the system returns to a working state

#### Scenario: Health check failure triggers rollback
- **GIVEN** the build succeeds but the new server fails to start
- **WHEN** `GET /api/health` does not return 200 within 10 seconds
- **THEN** the supervisor kills the failed process
- **AND** runs `git revert HEAD`, rebuilds, and restarts

### Requirement: Tmux Session Independence

The supervisor MUST manage only the Next.js server process and the terminal relay. It MUST NOT start, stop, or modify tmux sessions. Tmux sessions SHALL survive any number of server restarts.

#### Scenario: Multiple restarts
- **GIVEN** 5 agent sessions running in tmux
- **WHEN** the supervisor performs 3 consecutive restarts
- **THEN** all 5 agent sessions continue running without interruption

---

## Design Decisions

1. **Independent panes per browser client (not shared tmux attach)**
   - *Why*: Shared attach causes cursor fights and unexpected scrollback. Independent panes give each browser client a clean shell in the same window context without interfering with the agent's pane.
   - *Rejected*: Shared `tmux attach` (cursor conflicts), read-only followers (limited interaction capability).

2. **SSE polling over WebSocket for session state**
   - *Why*: SSE is simpler (HTTP, no upgrade negotiation), server-push only (client never pushes session state), and naturally resilient to reconnection. tmux state is inherently poll-based (no push API from tmux), so polling at 2–3s intervals with diff-based emission is the right fit.
   - *Rejected*: WebSocket for state (more complex, bidirectional not needed for read-only state stream).

3. **Monolith Next.js with clean lib/ extraction**
   - *Why*: Single deployment unit, unified routing, Server Components for data-heavy pages. The `lib/` extraction keeps tmux/worktree/fab logic testable and reusable without the overhead of a separate API server.
   - *Rejected*: Separate API server (extra deployment, CORS complexity), bash-wrapper approach (limited UI capabilities).

4. **No database — tmux + filesystem as source of truth**
   - *Why*: tmux already knows what's running. The filesystem already has fab state. Adding a DB creates sync problems (stale data, migration overhead, startup dependencies). Deriving state at request time ensures accuracy.
   - *Rejected*: SQLite for caching (sync complexity outweighs query speed for <100 sessions).

---

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Hybrid interaction model — push default with live attach | Confirmed from intake #1 — user explicitly chose this | S:95 R:85 A:90 D:90 |
| 2 | Certain | Card + terminal drill-in UI pattern | Confirmed from intake #2 — user chose over alternatives | S:95 R:80 A:85 D:90 |
| 3 | Certain | v1 is web UI + session CRUD, orchestration later | Confirmed from intake #3 — explicit scope decision | S:95 R:90 A:85 D:90 |
| 4 | Certain | Next.js 15 + TypeScript tech stack | Confirmed from intake #4 — user chose over Hono+htmx and Go+React | S:95 R:70 A:90 D:90 |
| 5 | Certain | Target tmux directly, not byobu | Confirmed from intake #5 | S:90 R:90 A:90 D:95 |
| 6 | Certain | One tmux session per project, windows per agent | Confirmed from intake #6 — user chose over per-agent sessions | S:95 R:75 A:85 D:85 |
| 7 | Certain | Monolith Next.js with clean lib/ extraction | Confirmed from intake #7 | S:90 R:80 A:85 D:85 |
| 8 | Certain | Three routes: /, /p/:project, /p/:project/:window | Confirmed from intake #8 | S:95 R:90 A:90 D:95 |
| 9 | Certain | No database — tmux + filesystem derived state | Confirmed from intake #9 | S:95 R:85 A:90 D:95 |
| 10 | Certain | Process supervisor for self-improvement loop | Confirmed from intake #10 | S:90 R:75 A:80 D:85 |
| 11 | Certain | Independent panes per browser client | Confirmed from intake #11 | S:90 R:70 A:75 D:80 |
| 12 | Certain | Minimal + opinionated UI (Linear/Raycast vibe) | Confirmed from intake #12 | S:95 R:85 A:85 D:90 |
| 13 | Confident | shadcn/ui as component library | Confirmed from intake #13 — strong signal, easily swappable | S:80 R:85 A:80 D:75 |
| 14 | Confident | Dark theme only, monospace aesthetic | Confirmed from intake #14 | S:80 R:90 A:80 D:80 |
| 15 | Confident | Keyboard-first with Cmd+K command palette | Confirmed from intake #15 — specific shortcuts may evolve | S:80 R:90 A:80 D:75 |
| 16 | Confident | SSE polling tmux every 2–3 seconds | Confirmed from intake #16 — interval is tunable | S:75 R:90 A:80 D:80 |
| 17 | Confident | WebSocket terminal relay on port 3001 | Confirmed from intake #17 — port is convention | S:75 R:90 A:85 D:80 |
| 18 | Confident | Activity detection: 10-second window_activity threshold | New — derived from tmux `window_activity` behavior; 10s is standard for terminal idle detection, easily adjustable | S:70 R:95 A:75 D:75 |
| 19 | Certain | Drop session_prefix — use exact session name matching only | Clarified — field was orphaned after Q3 resolved mapping as exact name match; dropped per constitution "convention over configuration" | S:95 R:95 A:90 D:95 |
| 20 | Certain | WebSocket relay uses URL path for session/window targeting | Clarified — user chose URL path over query params and initial-message | S:95 R:90 A:90 D:95 |
| 21 | Certain | SSE sends full state snapshots (not diffs) | Clarified — user chose full snapshot matching AO's pattern | S:95 R:90 A:90 D:95 |
| 22 | Certain | Session-to-project mapping by exact name match, "Other" for unmatched | Clarified — user chose exact match over prefix matching and config-only | S:95 R:85 A:90 D:90 |
| 23 | Certain | WindowInfo activity is active/idle only, no "exited" state | Clarified — user chose to drop exited; tmux windows are active or idle | S:95 R:95 A:90 D:95 |
| 24 | Certain | Supervisor manages Next.js + relay as single build/restart/rollback unit | Clarified — user chose joint management over independent relay lifecycle | S:95 R:80 A:85 D:90 |

24 assumptions (18 certain, 6 confident, 0 tentative, 0 unresolved).

## Clarifications

### Session 2026-03-02

1. **WebSocket relay handshake protocol**: URL path (`ws://localhost:3001/:session/:window`) chosen over query params and initial-message approaches. Simpler, RESTful-ish.
2. **SSE event data format**: Full `ProjectSession[]` snapshot per event, matching AO's pattern. Client replaces state entirely — no merge logic.
3. **Session-to-project mapping**: Exact session name match against project key in `run-kit.yaml`. Unmatched sessions grouped under "Other" on dashboard.
4. **WindowInfo activity states**: Dropped `"exited"` — tmux windows are either `"active"` or `"idle"`. No dead-pane detection in v1.
5. **Dropped `session_prefix`**: Removed from config schema — orphaned after exact name matching was chosen for session-to-project mapping. Convention over configuration.
