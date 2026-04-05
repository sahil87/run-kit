# tmux Session Enumeration

## Single-Active-Server Model

run-kit connects to **one tmux server at a time**. The active server is selected by the user via the sidebar server selector or command palette. The backend is stateless — the frontend sends `?server={name}` on every API request (SSE, REST, WebSocket relay). If the parameter is omitted, the backend defaults to the `default` tmux server.

All tmux operations use `tmuxExecServer(ctx, server, args...)` which prepends `-L {server}` for named servers. The `"default"` server uses no `-L` flag, connecting to the user's standard tmux server. The config flag `-f {path}` is applied to all named servers (not just runkit).

### Server Discovery

`ListServers()` discovers available tmux servers by scanning the socket directory at `/tmp/tmux-{uid}/`. Each socket file represents a running server. Returns sorted server names.

### Server Lifecycle

- **Create**: Implicit — `CreateSession("0", $HOME, serverName)` starts a new server when the first session is created on it
- **Kill**: `KillServer(server)` runs `tmux [-L server] kill-server`, destroying all sessions
- **Switch**: Frontend updates localStorage `"runkit-server"` and reconnects SSE with updated `?server=` param

## Session-Group Filtering

tmux has a **session groups** feature. When multiple clients attach to the same session (e.g., via `tmux attach`), tmux may create derived session-group copies. This means `tmux list-sessions` returns both the original and derived copies:

```
devshell     grouped=1  group=devshell    ← primary
devshell-82  grouped=1  group=devshell    ← derived copy
run-kit      grouped=0  group=            ← standalone (no group)
```

Grouped sessions share the same windows, so displaying both is incorrect — it shows duplicate projects in the dashboard.

## How We Filter

`parseSessions()` in `internal/tmux/tmux.go` parses three format variables per session:

| Variable | Meaning |
|----------|---------|
| `#{session_name}` | The session name (e.g., `devshell-82`) |
| `#{session_grouped}` | `1` if the session belongs to ANY group, `0` otherwise |
| `#{session_group}` | The group name (e.g., `devshell`) — empty if not grouped |

**Filter rule**: keep sessions where `grouped=0` OR `name === group`. Applied to the queried server's results.

- `devshell` → grouped=1, name=group → **keep** (primary)
- `devshell-82` → grouped=1, name≠group → **filter out** (derived copy)
- `run-kit` → grouped=0 → **keep** (standalone)

## Why `session_grouped` Alone Isn't Enough

`session_grouped=1` for ALL members of a group — including the primary session. You cannot simply filter out `grouped=1` sessions without also losing the primaries. The `name === group` check distinguishes primaries from copies.

## Impact on Other Operations

All tmux functions accept a `server string` parameter:

- `ListSessions(server)` — queries only the specified server
- `ListWindows(session, server)` — lists windows for a session on the specified server
- `SelectWindow(session, index, server)` — selects a window on the specified server
- `CreateSession(name, cwd, server)` — creates sessions on the specified server
- `ReloadConfig(server)` — hot-reloads config via `source-file` on the specified server
- `KillSession(session, server)` — kills the named session on the specified server
- `SendKeys(session, window, keys, server)` — targets the correct window on the specified server
- `MoveWindowToSession(srcSession, srcIndex, dstSession, server)` — moves a window from one session to another on the specified server via `tmux move-window -s {srcSession}:{srcIndex} -t {dstSession}:`. Destination index is auto-assigned by tmux

## API Server Parameter

All API endpoints accept `?server=` query parameter via `serverFromRequest(r)` helper. The helper validates the server name using `validate.ValidateName` and defaults to `"default"` on invalid/missing input. The SSE hub polls per-server — only servers with active SSE clients are polled.

Server management endpoints:
- `GET /api/servers` — lists available servers via socket directory scan
- `POST /api/servers` — creates a server (starts session "0" in $HOME)
- `POST /api/servers/kill` — kills a server via `tmux kill-server`

Window cross-session move endpoint:
- `POST /api/sessions/{session}/windows/{index}/move-to-session` — moves a window to another session. Request body: `{ "targetSession": "string" }`. Validates source session, window index, and target session name. Returns 400 if `targetSession` equals source session or fails validation. Returns `200 { "ok": true }` on success. Handler in `api/windows.go`, `MoveWindowToSession` method on `TmuxOps` interface in `router.go`.

## Related Files

- `app/backend/internal/tmux/tmux.go` — `serverArgs()`, `tmuxExecServer()`, `ListSessions()`, `ListServers()`, `ListKeys()`, `KillServer()`, `CreateSession()`, `SelectWindow()`, `ReloadConfig()`, `EnsureConfig()`, `ConfigPath()`, `MoveWindowToSession()`
- `app/backend/internal/sessions/sessions.go` — `FetchSessions(server)` builds the dashboard view, `ProjectSession` has `Name` and `Windows` (no `Server` field)
- `app/backend/api/router.go` — `serverFromRequest()` helper, `TmuxOps` interface with server params, route registration
- `app/backend/api/windows.go` — window action handlers including move-to-session
- `app/backend/api/servers.go` — server list/create/kill handlers
- `app/backend/api/keybindings.go` — `GET /api/keybindings` handler (runs `list-keys`, filters via whitelist, returns JSON)
- `app/backend/api/sse.go` — per-server SSE polling hub
- `app/backend/api/relay.go` — WebSocket relay reads `?server=` query param to attach to the correct tmux server
- `app/backend/internal/tmux/tmux.conf` — canonical tmux configuration (Go-embedded, written to `~/.run-kit/tmux.conf` on first run)

## Changelog

| Date | Change | Reference |
|------|--------|-----------|
| 2026-03-18 | Rewrote for multi-server architecture — dedicated `runkit` tmux server replaces byobu integration. `ListSessions()` queries both runkit and default servers. `parseSessions()` extracted as testable function with server tagging. `CreateSession()` uses plain `tmux new-session` (byobu dependency removed). `ListWindows()` accepts server parameter. | `260318-0gjh-dedicated-tmux-server` |
| 2026-03-20 | Multi-server operations — `SelectWindowOnServer()` routes select-window to correct server. `ReloadConfig(server)` hot-reloads config on specified server. Relay and select-window endpoints accept `?server=` query param. `RK_TMUX_CONF` resolved to absolute path at init. Stderr captured in tmux exec errors. | `260318-0gjh-dedicated-tmux-server` |
| 2026-03-20 | Single-active-server model — replaced dual-server merge with `?server=` on every request. All tmux functions accept `server` param. Unified `tmuxExec`/`tmuxExecDefault` into `tmuxExecServer`. Added `ListServers()` (socket scan), `KillServer()`. SSE hub polls per-server. Removed `SessionInfo.Server` and `ProjectSession.Server` fields. New endpoints: `GET/POST /api/servers`, `POST /api/servers/kill`. `serverFromRequest()` validates input. | `260320-1335-tmux-server-switcher` |
| 2026-03-20 | tmux config and keybindings — `EnsureConfig()` auto-creates `~/.run-kit/tmux.conf` on serve startup. `-f` config flag scoped to `CreateSession`/`ReloadConfig` via `configArgs()`. Enhanced `internal/tmux/tmux.conf` with agent-optimized defaults and power-user keybindings. `ListKeys(server)` runs `tmux list-keys`, returns raw output (nil on "no server"). New `GET /api/keybindings` endpoint filters `list-keys` via whitelist map. `KillServer()` handles socket teardown gracefully (returns nil on "No such file or directory"). | `260320-9ldy-ui-polish-tmux-config-embed` |
| 2026-04-04 | Cross-session window move — `MoveWindowToSession(srcSession, srcIndex, dstSession, server)` wraps `tmux move-window -s {src}:{idx} -t {dst}:` with `tmuxExecServer` and `withTimeout()`. New `POST /api/sessions/{session}/windows/{index}/move-to-session` endpoint with `{ "targetSession" }` body. `TmuxOps` interface extended with `MoveWindowToSession`. Validates source/target differ (400 if same). | `260404-dq70-move-window-between-sessions` |
| 2026-04-06 | Pane CWD tracking — `ListWindows` now calls `list-panes -s -t <session>` after `list-windows` to populate `Panes []PaneInfo` on each `WindowInfo`; failure is non-fatal. `parsePanes(lines []string) map[int][]PaneInfo` parses 6-field tab-delimited output (field 0 = `#{window_index}` for grouping, fields 1–5 = pane data). Package-level `paneFormat` var: `#{window_index}\t#{pane_id}\t#{pane_index}\t#{pane_current_path}\t#{pane_current_command}\t#{pane_active}`. `WorktreePath` unchanged — still sourced from `list-windows #{pane_current_path}`. | `260405-rx38-pane-cwd-tracking` |
