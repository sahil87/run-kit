# Spec: tmux Server Switcher

**Change**: 260320-1335-tmux-server-switcher
**Created**: 2026-03-20
**Affected memory**: `docs/memory/run-kit/tmux-sessions.md`, `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- Multi-server simultaneous view — this change deliberately moves to single-server-at-a-time
- Backend server state persistence — backend remains stateless per constitution
- Custom tmux config per server — all servers use the same `RK_TMUX_CONF` config file

## Backend: Server-Parameterized tmux Layer

### Requirement: All tmux operations accept a server parameter

The tmux layer in `internal/tmux/tmux.go` SHALL accept a `server string` parameter on all public functions instead of hardcoding `"runkit"` or using separate `tmuxExec`/`tmuxExecDefault` paths. The `runkitPrefix()` function SHALL be replaced with `serverArgs(server string)` that returns `[]string{"-L", server}` for any server name. When `server` is `"default"`, the function SHALL return an empty slice (no `-L` flag), preserving the behavior of connecting to the user's default tmux server.

The `tmuxExec()` and `tmuxExecDefault()` functions SHALL be unified into a single `tmuxExecServer(server string, args ...string)` function.

#### Scenario: Named server command execution
- **GIVEN** a tmux operation targeting server `"runkit"`
- **WHEN** the operation is executed
- **THEN** the tmux command includes `-L runkit` in the argument prefix
- **AND** the config file flag `-f {path}` is included if `RK_TMUX_CONF` is set

#### Scenario: Default server command execution
- **GIVEN** a tmux operation targeting server `"default"`
- **WHEN** the operation is executed
- **THEN** the tmux command has no `-L` flag (connects to the user's default server)
- **AND** no `-f` flag is included (default server uses its own config)

#### Scenario: Arbitrary named server
- **GIVEN** a tmux operation targeting server `"myproject"`
- **WHEN** the operation is executed
- **THEN** the tmux command includes `-L myproject`
- **AND** the config file flag `-f {path}` is included if `RK_TMUX_CONF` is set

### Requirement: ListSessions accepts server parameter

`ListSessions(server string)` SHALL query only the specified server. The current dual-query logic (querying both runkit and default, merging results) SHALL be removed. The `SessionInfo.Server` field SHALL be removed — all returned sessions belong to the requested server.

#### Scenario: Single server session listing
- **GIVEN** the runkit server has sessions `["alpha", "bravo"]` and the default server has `["personal"]`
- **WHEN** `ListSessions("runkit")` is called
- **THEN** only `["alpha", "bravo"]` are returned
- **AND** no `Server` field is present on the results

### Requirement: ListWindows, SelectWindow, and other window operations accept server parameter

All window-level functions (`ListWindows`, `SelectWindowOnServer`, `CreateSession`, `KillSession`, `RenameSession`, `CreateWindow`, `KillWindow`, `RenameWindow`, `SendKeys`) SHALL accept a `server string` parameter and route the command to the specified server.

`SelectWindowOnServer` SHALL be renamed to `SelectWindow` since the "OnServer" suffix is redundant when all functions take a server parameter.

#### Scenario: Window listing on a named server
- **GIVEN** session `"alpha"` exists on server `"runkit"` with windows `[0: "main", 1: "tests"]`
- **WHEN** `ListWindows("alpha", "runkit")` is called
- **THEN** windows `[0: "main", 1: "tests"]` are returned

### Requirement: Server discovery via socket directory scan

A new function `ListServers() []string` SHALL discover available tmux servers by scanning the tmux socket directory at `/tmp/tmux-{uid}/` (where `{uid}` is the current user's UID). Each socket file in that directory represents a running tmux server. The function SHALL return server names derived from the socket file names. The `"default"` server socket is named `"default"` in the directory.

#### Scenario: Multiple servers running
- **GIVEN** socket files `/tmp/tmux-1000/default`, `/tmp/tmux-1000/runkit`, `/tmp/tmux-1000/myproject` exist
- **WHEN** `ListServers()` is called
- **THEN** `["default", "myproject", "runkit"]` is returned (alphabetically sorted)

#### Scenario: No servers running
- **GIVEN** the tmux socket directory is empty or doesn't exist
- **WHEN** `ListServers()` is called
- **THEN** an empty slice is returned

### Requirement: Kill server

A new function `KillServer(server string) error` SHALL kill a tmux server by running `tmux -L {server} kill-server`. For the `"default"` server, it SHALL run `tmux kill-server` (no `-L` flag).

#### Scenario: Kill named server
- **GIVEN** server `"runkit"` is running with sessions
- **WHEN** `KillServer("runkit")` is called
- **THEN** `tmux -L runkit kill-server` is executed
- **AND** all sessions on that server are destroyed

### Requirement: Create server (via session creation)

Server creation is implicit — `CreateSession(name, cwd, server)` on a non-existent server causes tmux to start that server automatically. No separate `CreateServer` function is needed.

When creating a server via the "Create tmux server" palette action, `CreateSession("0", "$HOME", server)` SHALL be called — the session is named `"0"` (tmux default) and starts in the user's home directory.

#### Scenario: Create session on new server
- **GIVEN** no server named `"myproject"` exists
- **WHEN** `CreateSession("0", "/home/user", "myproject")` is called
- **THEN** `tmux -L myproject new-session -d -s 0 -c /home/user` is executed
- **AND** the server `"myproject"` comes into existence

## Backend: API Endpoints

### Requirement: All endpoints accept `?server=` query parameter

Every session/window API endpoint SHALL read the `server` query parameter from the request URL. If the parameter is absent, the server SHALL default to `"default"`. This replaces the current hardcoded `"runkit"` default — the frontend always sends the parameter from localStorage state.

The following endpoints are affected:
- `GET /api/sessions` → `handleSessionsList`
- `POST /api/sessions` → `handleSessionCreate`
- `POST /api/sessions/{session}/kill` → `handleSessionKill`
- `POST /api/sessions/{session}/rename` → `handleSessionRename`
- `POST /api/sessions/{session}/windows` → `handleWindowCreate`
- `POST /api/sessions/{session}/windows/{index}/kill` → `handleWindowKill`
- `POST /api/sessions/{session}/windows/{index}/rename` → `handleWindowRename`
- `POST /api/sessions/{session}/windows/{index}/keys` → `handleWindowKeys`
- `POST /api/sessions/{session}/windows/{index}/select` → `handleWindowSelect`
- `GET /api/sessions/stream` → `handleSSE`
- `GET /relay/{session}/{window}` → `handleRelay` (already has `?server=`)
- `POST /api/tmux/reload-config` → `handleTmuxReloadConfig`
- `POST /api/sessions/{session}/upload` → `handleUpload`

A helper function `serverFromRequest(r *http.Request) string` SHALL extract the server parameter, defaulting to `"default"`.

#### Scenario: Explicit server parameter
- **GIVEN** a request to `GET /api/sessions?server=runkit`
- **WHEN** the handler processes the request
- **THEN** sessions are fetched from the `runkit` server only

#### Scenario: Missing server parameter
- **GIVEN** a request to `GET /api/sessions` (no `?server=`)
- **WHEN** the handler processes the request
- **THEN** sessions are fetched from the `default` server

### Requirement: New GET /api/servers endpoint

A new endpoint `GET /api/servers` SHALL return the list of available tmux servers as a JSON array of strings.

#### Scenario: List servers
- **GIVEN** servers `["default", "runkit"]` are running
- **WHEN** `GET /api/servers` is called
- **THEN** response is `["default", "runkit"]` with status 200

### Requirement: New POST /api/servers endpoint (create)

A new endpoint `POST /api/servers` SHALL create a tmux server by starting an initial session. Request body: `{ "name": "myproject" }`. The endpoint SHALL call `CreateSession("0", os.UserHomeDir(), server)` — session named `"0"`, cwd is `$HOME`.

#### Scenario: Create new server
- **GIVEN** no server `"myproject"` exists
- **WHEN** `POST /api/servers` with body `{ "name": "myproject" }` is called
- **THEN** a tmux session `"0"` is created on server `"myproject"` with cwd `$HOME`
- **AND** response is `{ "ok": true }` with status 200

#### Scenario: Server name validation
- **GIVEN** a request with `{ "name": "" }` or `{ "name": "has spaces" }`
- **WHEN** `POST /api/servers` is called
- **THEN** response is 400 with error message

### Requirement: New POST /api/servers/kill endpoint

A new endpoint `POST /api/servers/kill` SHALL kill a tmux server. Request body: `{ "name": "runkit" }`. Calls `KillServer(name)`.

#### Scenario: Kill existing server
- **GIVEN** server `"runkit"` is running
- **WHEN** `POST /api/servers/kill` with body `{ "name": "runkit" }` is called
- **THEN** the server is killed and response is `{ "ok": true }`

### Requirement: SSE endpoint accepts server parameter

The SSE endpoint (`GET /api/sessions/stream`) SHALL read the `?server=` query parameter and poll only that server. The `sseHub` SHALL be updated to support per-server polling — when a client connects with `?server=runkit`, it receives session data from the runkit server only.

Since multiple browser tabs might connect to different servers, the SSE hub SHALL support multiple concurrent server subscriptions. Implementation: the hub polls all servers that have active clients, and routes session data to the appropriate clients.

#### Scenario: SSE with server filter
- **GIVEN** a client connects to `/api/sessions/stream?server=runkit`
- **WHEN** sessions change on the runkit server
- **THEN** the client receives updated session data for runkit only
- **AND** sessions from other servers are not included

#### Scenario: SSE reconnect on server switch
- **GIVEN** a client was connected to `/api/sessions/stream?server=runkit`
- **WHEN** the user switches to server `"default"` in the UI
- **THEN** the frontend closes the old EventSource and opens a new one to `/api/sessions/stream?server=default`

## Backend: Cleanup

### Requirement: Remove dual-server merge

The following SHALL be removed:
- `tmuxExecDefault()` function in `tmux.go`
- The dual-query logic in `ListSessions()` that queries both servers and merges
- `SessionInfo.Server` field
- The `"runkit"` default fallback in `relay.go` — replaced by `serverFromRequest()` defaulting to `"default"`

### Requirement: Remove server field from ProjectSession

`ProjectSession.Server` field in `internal/sessions/sessions.go` SHALL be removed. The API response no longer includes a server field per session — all sessions in a response belong to the server specified in the request.

#### Scenario: API response without server field
- **GIVEN** sessions fetched from server `"runkit"`
- **WHEN** the response JSON is serialized
- **THEN** each session object has `name` and `windows` fields but no `server` field

## Frontend: Server State Management

### Requirement: Active server stored in localStorage

The active server name SHALL be stored in `localStorage` key `"runkit-server"`. Default value on first launch: `"runkit"`. The `SessionProvider` context SHALL manage this state and expose it to consumers.

#### Scenario: First launch
- **GIVEN** no `"runkit-server"` key in localStorage
- **WHEN** the app loads
- **THEN** the active server defaults to `"runkit"`
- **AND** `"runkit"` is written to localStorage

#### Scenario: Server switch persists
- **GIVEN** the user switches to server `"default"`
- **WHEN** the page is refreshed
- **THEN** the app loads with server `"default"` active

### Requirement: SessionProvider manages server state

The `SessionProvider` SHALL expose:
- `server: string` — the currently active server name
- `setServer: (name: string) => void` — switches the active server, updates localStorage, and reconnects SSE
- `servers: string[]` — list of available servers (fetched from `GET /api/servers`)
- `refreshServers: () => void` — re-fetches the server list

The SSE EventSource URL SHALL include `?server={activeServer}`. When `setServer` is called, the provider SHALL close the current EventSource and open a new one with the updated server parameter.

#### Scenario: Server switch triggers SSE reconnect
- **GIVEN** the active server is `"runkit"` and SSE is connected
- **WHEN** `setServer("default")` is called
- **THEN** the current EventSource is closed
- **AND** a new EventSource opens to `/api/sessions/stream?server=default`
- **AND** sessions update to show only default server sessions

### Requirement: All API calls include server parameter

The `api/client.ts` functions SHALL accept an optional `server` parameter (or read it from a module-level getter). All fetch calls SHALL append `?server={activeServer}` to the URL. The `selectWindow` function's existing `server` parameter SHALL be replaced by this global mechanism.

#### Scenario: Session creation with server
- **GIVEN** the active server is `"myproject"`
- **WHEN** `createSession("alpha", "/home/user")` is called
- **THEN** the request is `POST /api/sessions?server=myproject` with body `{ "name": "alpha", "cwd": "/home/user" }`

## Frontend: Remove Server from ProjectSession

### Requirement: Remove server field from types

The `server` field SHALL be removed from the `ProjectSession` type in `types.ts`. All code referencing `session.server` SHALL be updated or removed.

#### Scenario: Type definition
- **GIVEN** the updated `ProjectSession` type
- **WHEN** TypeScript compiles
- **THEN** only `name: string` and `windows: WindowInfo[]` fields exist

## Frontend: Sidebar Server Selector

### Requirement: Server dropdown at sidebar bottom

The sidebar SHALL render a server selector at the very bottom, below the session/window tree. The selector is always visible (not scrollable with the session list).

Layout: `Server: {dropdown}` — "Server:" is a static label, followed by a dropdown trigger showing the current server name.

The dropdown SHALL list all available servers (from `servers` in SessionProvider). The current server is highlighted with `text-accent`. Selecting a different server calls `setServer(name)`.

Styling:
- Container: `border-t border-border px-3 sm:px-6 py-2` — separated from the session tree by a top border
- Label: `text-xs text-text-secondary`
- Server name trigger: `text-xs text-text-primary font-medium`
- Touch target: `coarse:min-h-[44px]` on the trigger
- The session tree area above SHALL be scrollable (`flex-1 min-h-0 overflow-y-auto`) while the server selector remains pinned at the bottom

#### Scenario: Server selector display
- **GIVEN** the active server is `"runkit"` and servers `["default", "runkit"]` are available
- **WHEN** the sidebar renders
- **THEN** the bottom shows `Server: runkit` with a dropdown trigger
- **AND** clicking the trigger opens a dropdown with `["default", "runkit"]`

#### Scenario: Switch server via sidebar
- **GIVEN** the active server is `"runkit"`
- **WHEN** the user selects `"default"` from the server dropdown
- **THEN** `setServer("default")` is called
- **AND** the session list updates to show default server sessions
- **AND** the URL navigates to `/` (dashboard) since the current session/window may not exist on the new server

### Requirement: Remove server label from session rows

The `↗` marker for `session.server === "default"` sessions SHALL be removed from sidebar session rows. All sessions are displayed identically regardless of which server they came from (since there's only one server active at a time).

#### Scenario: Session row without server marker
- **GIVEN** any session from any server
- **WHEN** the sidebar renders the session row
- **THEN** no `↗` marker or server indicator is displayed

## Frontend: Command Palette Actions

### Requirement: "Create tmux server" command

A new command palette action `"Create tmux server"` SHALL open a dialog where the user enters a server name. On submit:
1. Call `POST /api/servers` with the name
2. Call `refreshServers()` to update the server list
3. Call `setServer(name)` to switch to the new server

The dialog SHALL validate the name: non-empty, no spaces, no special characters beyond hyphens and underscores.

#### Scenario: Create server via palette
- **GIVEN** the command palette is open
- **WHEN** the user selects "Create tmux server" and enters "myproject"
- **THEN** a dialog appears with a name input
- **AND** on submit, the server is created and the UI switches to it

### Requirement: "Kill tmux server" command

A new command palette action `"Kill tmux server"` SHALL show a confirmation dialog: `Kill server "{name}" and all its sessions?`. On confirm:
1. Call `POST /api/servers/kill` with the current server name
2. Call `refreshServers()` to update the server list
3. Switch to the first available server, or show empty state if none remain

#### Scenario: Kill current server
- **GIVEN** the active server is `"runkit"` and `"default"` is also available
- **WHEN** the user confirms "Kill tmux server"
- **THEN** the runkit server is killed
- **AND** the UI switches to `"default"`

#### Scenario: Kill last server
- **GIVEN** the active server is `"runkit"` and no other servers exist
- **WHEN** the user confirms "Kill tmux server"
- **THEN** the server is killed
- **AND** the sidebar shows empty state (no sessions)

### Requirement: "Switch tmux server" command

A new command palette action `"Switch tmux server"` SHALL display available servers as sub-actions in the palette (replacing the action list with server names). The current server is marked with `(current)`. Selecting a server calls `setServer(name)`.

#### Scenario: Switch via palette
- **GIVEN** the active server is `"runkit"` and servers `["default", "runkit"]` are available
- **WHEN** the user selects "Switch tmux server"
- **THEN** the palette shows `"default"` and `"runkit (current)"`
- **AND** selecting `"default"` switches to it

## Deprecated Requirements

### Multi-server merge in ListSessions
**Reason**: Replaced by single-server-at-a-time model. `ListSessions()` now takes a server parameter.
**Migration**: All callers pass the server parameter explicitly.

### ProjectSession.Server field
**Reason**: Redundant — all sessions in a response belong to the queried server.
**Migration**: Remove from Go struct and TypeScript type. Remove `↗` sidebar marker.

### tmuxExecDefault function
**Reason**: Unified into `tmuxExecServer(server, args...)` which handles both named and default servers.
**Migration**: All callers use `tmuxExecServer` with explicit server parameter.

## Design Decisions

1. **Stateless backend with `?server=` query param**: The backend does not track which server is active. The frontend sends `?server=` on every request. This aligns with the constitution ("state derived from tmux and filesystem at request time") and avoids multi-tab state conflicts.
   - *Why*: Keeps the backend stateless; each request is self-contained.
   - *Rejected*: Backend in-memory state — would require synchronization across tabs and resets on server restart.

2. **Default to `"default"` when `?server=` is absent**: If no server parameter is provided, the backend uses the user's default tmux server. This makes the API usable without run-kit-specific client configuration.
   - *Why*: Safe fallback; `"default"` is the standard tmux server.
   - *Rejected*: Defaulting to `"runkit"` — would break clients that don't send the parameter and expect standard tmux behavior.

3. **Server creation via initial session with `$HOME` cwd**: "Create tmux server" creates a session named `"0"` in `$HOME` rather than starting an empty server (tmux servers can't exist without sessions).
   - *Why*: Stateless — no intermediate "server exists but has no sessions" state. `$HOME` is a safe universal starting directory.
   - *Rejected*: Prompting for a directory — adds friction; user can navigate from `$HOME`.

4. **SSE hub supports per-server polling**: Rather than having one global poll, the hub tracks which servers have active clients and polls only those.
   - *Why*: Avoids polling servers nobody is watching; supports multi-tab with different servers.
   - *Rejected*: Polling all discovered servers — wasteful; could poll dead servers.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Server selector at sidebar bottom | Confirmed from intake #1 — user specified | S:95 R:90 A:95 D:95 |
| 2 | Certain | Three palette commands: Create, Kill, Switch | Confirmed from intake #2 — user specified | S:95 R:90 A:95 D:95 |
| 3 | Certain | Single-server-at-a-time replaces dual-server merge | Confirmed from intake #3 — user specified | S:95 R:85 A:90 D:95 |
| 4 | Certain | Remove ↗ server label from sessions | Confirmed from intake #4 — user specified | S:95 R:90 A:95 D:95 |
| 5 | Certain | Default active server is "runkit" (localStorage) | Confirmed from intake #5 — user confirmed | S:95 R:85 A:80 D:95 |
| 6 | Certain | Active server in localStorage key "runkit-server" | Confirmed from intake #6 — user confirmed | S:95 R:80 A:75 D:95 |
| 7 | Certain | Server discovery via socket dir scan /tmp/tmux-{uid}/ | Confirmed from intake #7 — user confirmed | S:95 R:75 A:70 D:95 |
| 8 | Certain | Create server = create session "0" with cwd=$HOME | Confirmed from intake #8 — user chose stateless + $HOME | S:95 R:80 A:80 D:95 |
| 9 | Certain | Kill server via tmux kill-server | Confirmed from intake #9 — user confirmed | S:95 R:70 A:85 D:95 |
| 10 | Certain | Backend stateless — ?server= on every request, default "default" | Confirmed from intake #10 — user chose option A | S:95 R:85 A:90 D:95 |
| 11 | Certain | Config flag (-f) applied to all named servers, not just runkit | Follows from unifying tmuxExec — config is server-agnostic | S:85 R:80 A:85 D:90 |
| 12 | Confident | SSE hub polls per-server (only servers with active clients) | Multi-tab scenario requires per-server routing; avoids wasteful polling | S:70 R:75 A:75 D:70 |
| 13 | Confident | Navigate to "/" on server switch | Current session/window likely doesn't exist on the new server; safest UX | S:65 R:85 A:70 D:65 |
| 14 | Confident | Server name validation: alphanumeric + hyphens + underscores | Matches tmux socket naming constraints; prevents shell injection | S:70 R:80 A:80 D:75 |
| 15 | Confident | Initial session name "0" for server creation | tmux default session name; minimal footprint | S:60 R:85 A:70 D:65 |

15 assumptions (11 certain, 4 confident, 0 tentative, 0 unresolved).
