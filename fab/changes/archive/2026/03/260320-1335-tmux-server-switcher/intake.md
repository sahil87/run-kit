# Intake: tmux Server Switcher

**Change**: 260320-1335-tmux-server-switcher
**Created**: 2026-03-20
**Status**: Draft

## Origin

> At the bottom of the left panel, add 'Server: <dropdown>' which shows you the current tmux server you are connected to and allows you to change it. Add these to Command Palette: 'Create tmux server' (should show a dialog where you can select a tmux server name), 'Kill tmux server', 'Switch tmux server'. Change run-kit behaviour to connect only to one server at a time. We no longer need the server label in the session entries.

One-shot description. User wants to shift from the current dual-server merge model to a single-active-server model with explicit UI for switching between servers.

## Why

run-kit currently queries both the `runkit` and `default` tmux servers simultaneously, merging all sessions into a single list with a small `↗` marker to distinguish external sessions. This creates several problems:

1. **Cognitive overhead** — Users see sessions from both servers interleaved, with no clear grouping or control over which server they're interacting with.
2. **No server management** — There's no way to create a new tmux server, kill an existing one, or explicitly choose which server to work with.
3. **Scaling concern** — As users create more tmux servers (e.g., per-project servers), the merged view becomes unwieldy. A single-server-at-a-time model keeps the UI focused.

The change introduces a deliberate "connect to one server" model where the user explicitly picks which tmux server to view and manage, with full lifecycle controls (create, kill, switch) accessible from the sidebar and command palette.

## What Changes

### Sidebar Server Selector (Bottom of Left Panel)

Add a server selector at the very bottom of the sidebar, below the session/window tree:

- **Format**: `Server: <dropdown>` — static label "Server:" followed by a dropdown showing the current server name
- **Dropdown contents**: List of available tmux servers (discovered from the system), with the active one highlighted
- **Selection**: Clicking a different server switches the active server — the session list updates to show only sessions from that server
- **Styling**: Matches sidebar conventions — `px-3 sm:px-6` padding, `text-xs text-text-secondary` for the label, server name in `text-text-primary`

### Command Palette Actions

Three new commands in the command palette:

1. **"Create tmux server"** — Opens a dialog where the user enters a server name. On submit, creates the server by starting an initial session with `cwd: $HOME` (tmux servers don't exist without sessions — this is the stateless approach). The active server switches to the new one immediately.
2. **"Kill tmux server"** — Kills the currently active tmux server (all sessions destroyed). Shows a confirmation dialog: "Kill server **{name}** and all its sessions?" After killing, switches to another available server (or shows empty state).
3. **"Switch tmux server"** — Opens the same server selection as the sidebar dropdown, but via the command palette. Lists available servers with the current one marked.

### Single-Server-at-a-Time Backend

Replace the current dual-server merge in `ListSessions()`. The backend is fully stateless — it does not track which server is active. The frontend sends the active server as a `?server=` query parameter on every request (SSE, API calls). If the parameter is omitted, the backend defaults to the `default` tmux server.

- **Session listing**: `FetchSessions()` accepts a server parameter and queries only that server. The `Server` field on `ProjectSession` becomes unnecessary since all returned sessions are from the requested server.
- **SSE stream**: The EventSource URL includes `?server={name}`. The `sessions` event sends only sessions from the specified server. When the user switches servers, the frontend closes the old EventSource and opens a new one with the updated param.
- **Session creation**: `CreateSession()` accepts a server parameter (not hardcoded to `runkit`).
- **Window operations**: All window select, rename, kill operations accept the server as a parameter.

### API Changes

- **`GET /api/servers`** — Returns list of available tmux servers discovered via socket directory scan. Each entry includes the server name.
- **`POST /api/servers/create`** — Creates a new tmux server by starting a session with `cwd: $HOME`. Body: `{ "server": "name" }`. Returns the created session.
- **`POST /api/servers/kill`** — Kills a tmux server via `tmux -L {name} kill-server`. Body: `{ "server": "name" }`.
- All existing session/window endpoints accept `?server=` query param (already present on some endpoints). If omitted, defaults to `default` tmux server. The frontend always sends it from localStorage state.

### Remove Server Label from Session Entries

- Remove the `↗` marker from sidebar session rows (the `session.server === "default"` check)
- Remove `server` field from `ProjectSession` type — no longer needed
- Remove `server` parameter from `ListWindows()`, `SelectWindowOnServer()`, etc. — all operations target the active server
- Remove `tmuxExecDefault()` and the dual-query logic in `ListSessions()`

### Server Discovery

tmux servers are identified by their socket files. Available servers can be discovered by:
- Checking known server names (at minimum: `runkit` and `default`)
- Scanning the tmux socket directory (`/tmp/tmux-{uid}/`) for active server sockets
- A running server responds to `tmux -L {name} list-sessions` without error

## Affected Memory

- `run-kit/architecture`: (modify) Update backend structure to reflect single-server model, new API endpoints
- `run-kit/tmux-sessions`: (modify) Rewrite multi-server section to single-active-server model, document server discovery and switching
- `run-kit/ui-patterns`: (modify) Add sidebar server selector, new command palette actions, remove server label from sessions

## Impact

- **Backend**: `internal/tmux/tmux.go` (server switching, remove dual-query), `internal/sessions/sessions.go` (single-server fetch), `api/` (new server endpoints, remove `?server=` params), `api/sse.go` (filter to active server)
- **Frontend**: `components/sidebar.tsx` (server selector footer), `app.tsx` (command palette commands, create server dialog), `types.ts` (remove `server` from `ProjectSession`), `api/client.ts` (new server API calls), `contexts/session-context.tsx` (active server state)
- **Tests**: Backend tmux tests need updating for single-server model, frontend tests for new UI components

## Open Questions

(None — all resolved during discussion.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Server selector goes at the bottom of the sidebar | User explicitly specified "bottom of the left panel" | S:95 R:90 A:95 D:95 |
| 2 | Certain | Three command palette actions: Create, Kill, Switch | User explicitly listed these | S:95 R:90 A:95 D:95 |
| 3 | Certain | Single-server-at-a-time model replaces dual-server merge | User explicitly requested "connect only to one server at a time" | S:95 R:85 A:90 D:95 |
| 4 | Certain | Remove server label (↗) from session entries | User explicitly stated "we no longer need the server label" | S:95 R:90 A:95 D:95 |
| 5 | Certain | Default active server is "runkit" on first launch | Clarified — user confirmed | S:95 R:85 A:80 D:95 |
| 6 | Certain | Active server persisted in localStorage (frontend) | Clarified — user confirmed. Follows theme/sidebar-width pattern | S:95 R:80 A:75 D:95 |
| 7 | Certain | Server discovery via tmux socket directory scan | Clarified — user confirmed socket scan approach | S:95 R:75 A:70 D:95 |
| 8 | Certain | "Create tmux server" creates first session with cwd=$HOME | Clarified — user chose stateless approach with $HOME as starting directory. Server comes into existence via `tmux -L {name} new-session -c $HOME` | S:95 R:80 A:80 D:95 |
| 9 | Certain | Kill server uses `tmux -L {name} kill-server` | Clarified — user confirmed | S:95 R:70 A:85 D:95 |
| 10 | Certain | Backend is stateless — frontend sends `?server=` on every request, defaults to `default` if omitted | Clarified — user chose option A (query param). Aligns with constitution: "state derived from tmux and filesystem at request time" | S:95 R:85 A:90 D:95 |

10 assumptions (10 certain, 0 confident, 0 tentative, 0 unresolved).
