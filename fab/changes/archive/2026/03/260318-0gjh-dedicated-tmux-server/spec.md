# Spec: Dedicated Tmux Server

**Change**: 260318-0gjh-dedicated-tmux-server
**Created**: 2026-03-18
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/tmux-sessions.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Removing session group filtering logic — kept for default server sessions which may still use byobu
- Making the tmux.conf configurable via the UI — iteration on status bar contents happens by editing the file directly
- Supporting more than two tmux servers (runkit + default) — no plugin architecture for arbitrary servers

## Tmux Server: Isolation via Named Socket

### Requirement: Dedicated tmux server for run-kit sessions

All tmux commands issued by run-kit for session management (create, list-windows, kill, rename, send-keys, split, select-window, capture-pane) SHALL use `-L runkit` to target a dedicated named socket. All tmux commands SHALL also pass `-f <configPath>` where `configPath` is read from the `RK_TMUX_CONF` environment variable.

#### Scenario: tmux commands target the runkit server
- **GIVEN** the run-kit backend is running with `RK_TMUX_CONF` set to `config/tmux.conf`
- **WHEN** any tmux operation is performed (create session, list windows, etc.)
- **THEN** the underlying `exec.CommandContext` call includes `-L runkit -f config/tmux.conf` before other arguments

#### Scenario: config path comes from environment variable
- **GIVEN** the `RK_TMUX_CONF` environment variable is set to a path
- **WHEN** `tmuxExec` or `tmuxExecRaw` constructs a tmux command
- **THEN** the `-f` flag uses the value from `RK_TMUX_CONF`

#### Scenario: config path not set
- **GIVEN** `RK_TMUX_CONF` is not set or empty
- **WHEN** `tmuxExec` or `tmuxExecRaw` constructs a tmux command
- **THEN** only `-L runkit` is prepended (no `-f` flag) and tmux uses its defaults

### Requirement: Relay attach targets the runkit server

The WebSocket relay handler in `relay.go` SHALL include `-L runkit` in the `tmux attach-session` command. The `-f` flag SHOULD also be included for consistency, read from the same `RK_TMUX_CONF` env var.

#### Scenario: relay attach uses dedicated server
- **GIVEN** a WebSocket connection for session relay
- **WHEN** the relay handler spawns `tmux attach-session -t <session>`
- **THEN** the command is `tmux -L runkit -f <configPath> attach-session -t <session>`

## Tmux Server: Configuration File

### Requirement: Ship a tmux.conf in the repo

A `config/tmux.conf` file SHALL be created in the repository with byobu-like aesthetics but a reduced status bar.

#### Scenario: tmux.conf provides run-kit-themed status bar
- **GIVEN** a new tmux session is created on the runkit server
- **WHEN** the session starts and loads `config/tmux.conf`
- **THEN** the status bar uses dark theme colors (`#0f1117` bg, `#e8eaf0` text, `#5b8af0` accent)
- **AND** `status-left` shows session name only
- **AND** `status-right` shows hostname and time
- **AND** no CPU/memory/network/load stats are shown

#### Scenario: tmux.conf includes byobu-style keybindings
- **GIVEN** `config/tmux.conf` is loaded
- **WHEN** the user presses F2, F3, or F4
- **THEN** F2 creates a new window, F3 selects previous window, F4 selects next window

#### Scenario: tmux.conf sets essential defaults
- **GIVEN** `config/tmux.conf` is loaded
- **WHEN** the tmux server starts
- **THEN** `default-terminal` is set to `tmux-256color`
- **AND** mouse mode is enabled

## Session Listing: Multi-Server Discovery

### Requirement: Query both runkit and default servers

`ListSessions()` SHALL query both the runkit server (`-L runkit`) and the default tmux server (no `-L` flag), merging results. Each `SessionInfo` SHALL carry a `Server` field indicating its origin.

#### Scenario: Sessions from both servers are listed
- **GIVEN** the runkit server has sessions `["alpha", "beta"]` and the default server has sessions `["gamma"]`
- **WHEN** `ListSessions()` is called
- **THEN** the result contains 3 sessions: `alpha` (Server: "runkit"), `beta` (Server: "runkit"), `gamma` (Server: "default")

#### Scenario: Default server is not running
- **GIVEN** the runkit server has sessions but the default tmux server is not running
- **WHEN** `ListSessions()` is called
- **THEN** only runkit server sessions are returned (default server query silently returns empty)

#### Scenario: Runkit server is not running
- **GIVEN** the default server has sessions but the runkit server is not running
- **WHEN** `ListSessions()` is called
- **THEN** only default server sessions are returned (runkit server query silently returns empty)

#### Scenario: Session group filtering applies to both servers
- **GIVEN** the default server has byobu session groups
- **WHEN** `ListSessions()` processes results from the default server
- **THEN** the existing session group filter (keep ungrouped OR name == group) is applied

### Requirement: Default server query bypasses tmuxExec

The default server query MUST NOT use `tmuxExec` (which prepends `-L runkit`). It SHALL use a separate exec call: `exec.CommandContext(ctx, "tmux", "list-sessions", "-F", format)` without any `-L` flag.

#### Scenario: Default server queried without -L flag
- **GIVEN** `ListSessions()` queries the default tmux server
- **WHEN** the tmux command is constructed
- **THEN** no `-L` flag is present in the command arguments

## Types: Replace Byobu Bool with Server String

### Requirement: SessionInfo uses Server field

`SessionInfo` in `internal/tmux/tmux.go` SHALL replace `Byobu bool` with `Server string`. Valid values: `"runkit"`, `"default"`.

#### Scenario: SessionInfo carries server origin
- **GIVEN** a session is parsed from tmux list-sessions output
- **WHEN** the `SessionInfo` is constructed
- **THEN** `Server` is `"runkit"` for sessions from the runkit server, `"default"` for sessions from the default server

### Requirement: ProjectSession uses Server field

`ProjectSession` in `internal/sessions/sessions.go` SHALL replace `Byobu bool` with `Server string`.

#### Scenario: API response uses server field
- **GIVEN** the frontend calls `GET /api/sessions`
- **WHEN** the response JSON is serialized
- **THEN** each session has `"server": "runkit"` or `"server": "default"` instead of `"byobu": true/false`

### Requirement: Frontend types updated

`ProjectSession` in `app/frontend/src/types.ts` SHALL replace `byobu: boolean` with `server: "runkit" | "default"`.

#### Scenario: Frontend type reflects server field
- **GIVEN** the frontend receives session data
- **WHEN** TypeScript processes the `ProjectSession` type
- **THEN** `session.server` is typed as `"runkit" | "default"`

## UI: Sidebar Session Markers

### Requirement: Remove byobu "b" marker

The sidebar SHALL NOT display the green "b" marker for byobu sessions.

#### Scenario: No byobu marker on any session
- **GIVEN** sessions are rendered in the sidebar
- **WHEN** the session row is displayed
- **THEN** no "b" marker element is present regardless of session type

### Requirement: External session arrow marker

Sessions from the default server SHALL display a dimmed `↗` arrow icon. Sessions from the runkit server SHALL display no marker.

#### Scenario: External session shows arrow
- **GIVEN** a session with `server === "default"` is rendered in the sidebar
- **WHEN** the session row is displayed
- **THEN** a `↗` character is shown with `text-text-tertiary` styling and `aria-label="external session"`

#### Scenario: Runkit session shows no marker
- **GIVEN** a session with `server === "runkit"` is rendered in the sidebar
- **WHEN** the session row is displayed
- **THEN** no marker icon is shown next to the session name

## Backend: Remove Byobu Dependency

### Requirement: CreateSession always uses tmux

`CreateSession()` SHALL always use `tmux new-session` (routed through the runkit server via `tmuxExec`). The `hasByobu` `sync.OnceValue` variable and `exec.LookPath("byobu")` check SHALL be removed.

#### Scenario: Session creation without byobu
- **GIVEN** `CreateSession("myproject", "/path/to/dir")` is called
- **WHEN** the tmux command is constructed
- **THEN** the command is `tmux -L runkit -f <configPath> new-session -d -s myproject -c /path/to/dir`
- **AND** no reference to `byobu` exists in the command

### Requirement: ListWindows targets correct server

`ListWindows()` SHALL accept a server parameter or default to the runkit server. When listing windows for a default-server session, it MUST query without `-L runkit`.

#### Scenario: List windows for runkit session
- **GIVEN** a session exists on the runkit server
- **WHEN** `ListWindows(session)` is called for a runkit session
- **THEN** the tmux command includes `-L runkit`

#### Scenario: List windows for default session
- **GIVEN** a session exists on the default tmux server
- **WHEN** `ListWindows(session)` is called for a default session
- **THEN** the tmux command does NOT include `-L runkit`

## Backend: Window Operations Target Correct Server

### Requirement: Operations route to correct server

All window/session operations (KillSession, KillWindow, RenameSession, RenameWindow, SendKeys, SelectWindow, CreateWindow, SplitWindow, KillPane, CapturePane) SHALL route to the correct tmux server based on which server the session belongs to. By default they target the runkit server via `tmuxExec`.

#### Scenario: Kill a session on the runkit server
- **GIVEN** a session exists on the runkit server
- **WHEN** `KillSession(session)` is called
- **THEN** the command includes `-L runkit`

## Environment: RK_TMUX_CONF

### Requirement: Config path via environment variable

The tmux config path SHALL be read from the `RK_TMUX_CONF` environment variable. This follows the existing `RK_PORT`/`RK_HOST` pattern where scripts translate user-facing env vars.

#### Scenario: .env defines RK_TMUX_CONF
- **GIVEN** `.env` contains `RK_TMUX_CONF=config/tmux.conf`
- **WHEN** the Go backend starts
- **THEN** all tmux commands include `-f config/tmux.conf`

## Tests

### Requirement: Backend tests updated

Tests SHALL be updated to verify the `Server` field instead of the `Byobu` field.

#### Scenario: parseSessions test verifies Server field
- **GIVEN** the `parseSessions` test in `tmux_test.go`
- **WHEN** sessions are parsed
- **THEN** assertions check `Server: "runkit"` or `Server: "default"` instead of `Byobu: true/false`

### Requirement: Frontend tests updated

Sidebar tests SHALL be updated to remove byobu marker tests and add external session marker tests. MSW handlers SHALL use the `server` field.

#### Scenario: Sidebar test for external marker
- **GIVEN** a session with `server: "default"` in the test data
- **WHEN** the sidebar is rendered
- **THEN** the `↗` marker is present with `aria-label="external session"`

## Deprecated Requirements

### Byobu Session Creation

**Reason**: Replaced by dedicated tmux server with custom tmux.conf. No more byobu dependency.
**Migration**: `CreateSession()` always uses `tmux new-session` via the runkit server.

### Byobu "b" Marker in Sidebar

**Reason**: Replaced by `↗` arrow marker for external (default-server) sessions. Runkit sessions are the "home" sessions and need no marker.
**Migration**: `session.byobu` boolean → `session.server` string. UI checks `server === "default"` for the `↗` marker.

## Design Decisions

1. **Named socket (`-L runkit`) over separate tmux binary**: Named sockets use the system tmux binary — no compilation, no version mismatch. The socket file lives in tmux's default socket directory (`/tmp/tmux-$UID/`).
   - *Why*: Simplest isolation mechanism. tmux natively supports multiple servers via `-L`.
   - *Rejected*: Separate tmux installation or wrapper — unnecessary complexity for namespace isolation.

2. **Config path via env var (`RK_TMUX_CONF`) over embedded/compiled path**: Consistent with `RK_PORT`/`RK_HOST` pattern. Scripts set it, binary reads it.
   - *Why*: No compile-time path assumptions. Works in dev (`just dev`), prod (`supervisor.sh`), and ad-hoc use.
   - *Rejected*: Hardcoded path relative to binary — breaks when binary is moved or run from different CWD.

3. **Two-server merge in ListSessions over single-server only**: Default server visibility lets run-kit show the user's existing tmux sessions alongside managed ones.
   - *Why*: User wants visibility into all sessions, not just run-kit-managed ones.
   - *Rejected*: Single-server (runkit only) — user loses visibility into their personal tmux sessions.

4. **Server field as string over enum/const**: `"runkit"` and `"default"` are the only values. A string is simpler than an enum for JSON serialization and TypeScript union types.
   - *Why*: Two values, no validation needed, maps directly to JSON.
   - *Rejected*: Integer enum — harder to read in API responses, no benefit for two values.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `-L runkit` named socket for server isolation | Confirmed from intake #1 — user explicitly chose option B | S:95 R:80 A:95 D:95 |
| 2 | Certain | Remove byobu "b" marker from sidebar | Confirmed from intake #2 — user explicitly confirmed | S:95 R:90 A:95 D:95 |
| 3 | Certain | Use ↗ arrow icon for external sessions, no marker for runkit | Confirmed from intake #3 — user explicitly chose arrow icon | S:95 R:90 A:95 D:95 |
| 4 | Certain | Drop byobu dependency from CreateSession | Confirmed from intake #4 — always use tmux with -L runkit | S:90 R:70 A:90 D:90 |
| 5 | Certain | Config path via env var RK_TMUX_CONF | Confirmed from intake #9 — user clarified env var pattern | S:95 R:85 A:90 D:95 |
| 6 | Confident | Config file at `config/tmux.conf` relative to repo root | Confirmed from intake #5 — repo convention for config files | S:60 R:85 A:75 D:70 |
| 7 | Confident | Include F2/F3/F4 byobu-style keybindings in tmux.conf | Confirmed from intake #6 — user wants byobu-like behavior | S:70 R:90 A:70 D:75 |
| 8 | Confident | Keep session group filtering for default server sessions | Confirmed from intake #7 — defensive, default server may have byobu groups | S:60 R:85 A:80 D:80 |
| 9 | Confident | Status bar colors match run-kit dark theme tokens | Confirmed from intake #8 — consistent with visual design | S:65 R:90 A:80 D:75 |
| 10 | Certain | ListWindows needs server awareness for default-server sessions | Codebase signal — tmuxExec will prepend -L runkit, so default-server windows need a bypass | S:85 R:70 A:90 D:85 |
| 11 | Confident | Relay handler only attaches to runkit server sessions | The relay spawns a PTY with tmux attach — only runkit-server sessions are fully managed. Default sessions are view-only in the sidebar (navigating to one would need a separate code path). For now, keep relay targeting runkit only | S:60 R:75 A:70 D:65 |
| 12 | Certain | Window operations (kill, rename, send-keys, etc.) default to runkit server | All operations go through tmuxExec which prepends -L runkit. Default-server sessions are discovery-only for now | S:80 R:75 A:85 D:85 |

12 assumptions (7 certain, 5 confident, 0 tentative, 0 unresolved).
