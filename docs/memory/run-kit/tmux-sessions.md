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

## Frontend Server Routing Contract

Every API client function in `app/frontend/src/api/client.ts` that hits a server-scoped endpoint takes `server: string` as its **first positional argument** and forwards it to `withServer(url, server)` to build `?server=<server>`. There is **no module-level `_getServer` global, no `setServerGetter` export, and no ambient state** — `server` is always passed explicitly per call. This mirrors the backend `tmuxExecServer(ctx, server, args...)` shape so the routing parameter is visible in every signature on both sides of the wire.

Functions that take `server` (read + mutation):

| Category | Functions |
|----------|-----------|
| Read | `getSessions`, `getKeybindings` |
| Session mutation | `createSession`, `renameSession`, `killSession` |
| Window mutation | `createWindow`, `renameWindow`, `killWindow`, `moveWindow`, `moveWindowToSession`, `selectWindow`, `splitWindow`, `closePane`, `sendKeys` |
| Window options | `updateWindowUrl`, `updateWindowType` |
| Color | `setWindowColor`, `setSessionColor` |
| Server-scoped | `reloadTmuxConfig` |
| Session-scoped | `uploadFile` |

Signature shape:

```ts
function withServer(url: string, server: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}server=${encodeURIComponent(server)}`;
}

export async function renameSession(server: string, session: string, name: string): Promise<{ ok: boolean }> {
  const res = await fetch(
    withServer(`/api/sessions/${encodeURIComponent(session)}/rename`, server),
    { method: "POST", headers: {...}, body: JSON.stringify({ name }) },
  );
  ...
}
```

**Functions that intentionally do NOT take `server`** (operate on the server itself or are global): `listServers`, `createServer`, `killServer`, theme settings (`getThemePreference`, `setThemePreference`), and server-color settings. `killServer` targets the server via request body (`{"name":"runkit"}`) rather than `?server=` query.

SSE and the WebSocket relay both interpolate `?server=` directly when constructing their connection URLs (not via `withServer`) and re-open on server change, so they are unaffected by the closure-race class of bugs that motivated this contract.

### Why the explicit server contract exists (closure-race fix)

Pre-fix, the client kept a module-level getter (`let _getServer = () => "runkit"`) that `SessionProvider` installed once via `setServerGetter(() => serverRef.current)`. `withServer` dereferenced the getter at fetch time, so any switch of `serverRef.current` between user intent (open dialog, type new name) and fetch dispatch (Enter pressed) silently retargeted the mutation at the **new** server. A typical reproducer: open rename for `foo` on server-A → Cmd+K → switch to server-B → return → Enter — the rename then ran against server-B, hitting either the wrong `foo` or returning an error while the optimistic overlay still drew the rename on server-A until SSE reconciled.

The fix retired the global entirely. With `server` threaded explicitly, the captured server is fixed at the moment the React handler runs (see `ui-patterns.md` → "Optimistic UI & Mutation Feedback" → "Server Capture Convention" for the React idiom). The single source of truth for `server` is `useSessionContext()`; callers read it inside their event handler and pass it as the first arg.

### Verifying the contract

A single grep enforces the invariant — the symbols `_getServer` and `setServerGetter` MUST NOT exist anywhere under `app/frontend/src/`. The `useDialogState` regression test (`app/frontend/src/hooks/use-dialog-state.test.tsx`) flips `SessionProvider`'s `server` prop between `openRenameSessionDialog("foo")` and `handleRenameSession()` and asserts `renameSession` was called with the post-flip server (`"server-B"`) and never with the pre-flip server.

Window cross-session move endpoint:
- `POST /api/sessions/{session}/windows/{index}/move-to-session` — moves a window to another session. Request body: `{ "targetSession": "string" }`. Validates source session, window index, and target session name. Returns 400 if `targetSession` equals source session or fails validation. Returns `200 { "ok": true }` on success. Handler in `api/windows.go`, `MoveWindowToSession` method on `TmuxOps` interface in `router.go`.

## `rk riff` Window Creation

`rk riff` creates N parallel worktree/window pairs (N defaults to 1) in the **user's current tmux server** (not the managed `runkit`/`default` server that `internal/tmux` targets). Each window may contain multiple panes — composed from argv-ordered `--skill`/`--cmd` occurrences or a preset's `panes:` list. The command lives at `app/backend/cmd/rk/riff.go` and bypasses `internal/tmux`'s execution helpers — it invokes `tmux` directly via `exec.CommandContext` so windows land where the user is attached.

Mechanics:

- **Preconditions** — `$TMUX` must be set (read via `tmux.OriginalTMUX`, captured before `internal/tmux` init() strips `$TMUX` from the process env) and `wt` must be on PATH. Fast-fail, exit 2. `--list-presets` short-circuits before preconditions.
- **Per-window pane sequence** — each window is built via:
  1. `tmux new-window -n <resolvedName> -c <worktree-path> <pane-0-shell>` creates the window with pane 0.
  2. `tmux split-window -t <resolvedName> -c <worktree-path> <pane-i-shell>` appends each additional pane (panes 1..N-1). The initial split direction is `-h` by default; the final arrangement is set by `select-layout`.
  3. `tmux select-layout -t <resolvedName> <canonical>` applies the resolved layout (skipped when pane count is 1 and layout is `auto`, or when `--layout` produces an empty canonical for the pane count).
  4. `tmux select-pane -t <resolvedName>.0` focuses pane 0.
- **Pane shell strings** — skill panes wrap `<launcher> '<escaped-skill>'` (or bare `<launcher>` when skill is empty) inside `${SHELL:-/bin/sh} -i -c '...'` then `shellWrap` (`; exec "${SHELL:-/bin/sh}"`). Cmd panes use the user's command directly + `shellWrap` (no interactive `sh -i -c` wrap — would alter argv semantics of user commands). Empty `--cmd` yields the bare `exec "${SHELL:-/bin/sh}"` form (drops to `$SHELL`). All handled by pure helpers `buildSkillShellString`, `buildCmdShellString`, `paneShellString`, and the argv builder `buildSpawnArgvs`.
- **Window naming** — `riff-<basename>` where `<basename>` is `filepath.Base(worktreePath)`. For fan-out (N ≥ 2), each worktree gets its own name (assigned by `wt create`'s random adjective-noun generator; rk does NOT impose a `-1..-N` suffix scheme), so windows end up named `riff-swift-fox`, `riff-clever-crab`, etc. Collision resolution applies per-window via `resolveWindowName` (auto-suffix `-2`, `-3`, …).
- **Fan-out orchestration** — `runFanOut` spawns N goroutines sharing one `context.Context`. Each goroutine runs `runWtCreate` + `spawnRiffReturningName`; first failure cancels the context (killing sibling subprocesses via `exec.CommandContext`) and triggers rollback. The pure `planFanOutRollback(results, failureIdx)` computes which worktrees + windows to clean up — excludes the failing goroutine's own artifacts — and `rollbackFanOut` invokes `wt delete --worktree-name <basename>` then `tmux kill-window -t <name>`. Rollback uses a fresh (non-cancelled) context so it runs to completion; rollback errors are logged but do not mask the primary error.
- **Child env** — `tmuxChildEnv()` restores `TMUX=<OriginalTMUX>` in every spawned tmux process so tmux targets the user's server. Mirrors `cmd/rk/context.go`.
- **Timeouts** — `exec.CommandContext` with 30s for `wt create` / `wt delete`, 10s per tmux call.
- **Signals** — SIGINT/SIGTERM once, at the top of `runRiff` via `signal.NotifyContext`; propagates to all goroutines and their subprocess calls.

The new windows never appear on the managed `runkit`/`default` servers unless the user's current `$TMUX` happens to point there. See `rk-riff.md` for flag surface (`--skill`, `--cmd`, `--layout`, `--fan-out`, `--preset`, `--list-presets`), exit codes, and preset schema.

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
- `app/backend/cmd/rk/riff.go` — `rk riff` subcommand: N-pane `tmux new-window` + `split-window` + `select-layout` + `select-pane` sequence per window on the user's current tmux server (via `tmux.OriginalTMUX` restore in child env), with parallel fan-out + rollback on failure
- `app/backend/cmd/rk/pane_spec.go` — `paneFlag` pflag.Value + `rewritePaneSpaceForm` argv pre-processor supporting bare/space/equals forms for repeatable `--skill`/`--cmd`
- `app/backend/cmd/rk/layout.go` — `layoutAliases` table + `resolveLayout` + `autoLayout` helpers
- `app/backend/cmd/rk/layout_help.go` — `renderLayoutMocks` Unicode box-drawing mocks rendered inline in `rk riff -h`
- `app/backend/internal/fabconfig/fabconfig.go` — `ReadSpawnCommand(repoRoot)` reads `agent.spawn_command` from `fab/project/config.yaml` (best-effort `yaml.v3`; returns `""` on any failure)

## Changelog

| Date | Change | Reference |
|------|--------|-----------|
| 2026-03-18 | Rewrote for multi-server architecture — dedicated `runkit` tmux server replaces byobu integration. `ListSessions()` queries both runkit and default servers. `parseSessions()` extracted as testable function with server tagging. `CreateSession()` uses plain `tmux new-session` (byobu dependency removed). `ListWindows()` accepts server parameter. | `260318-0gjh-dedicated-tmux-server` |
| 2026-03-20 | Multi-server operations — `SelectWindowOnServer()` routes select-window to correct server. `ReloadConfig(server)` hot-reloads config on specified server. Relay and select-window endpoints accept `?server=` query param. `RK_TMUX_CONF` resolved to absolute path at init. Stderr captured in tmux exec errors. | `260318-0gjh-dedicated-tmux-server` |
| 2026-03-20 | Single-active-server model — replaced dual-server merge with `?server=` on every request. All tmux functions accept `server` param. Unified `tmuxExec`/`tmuxExecDefault` into `tmuxExecServer`. Added `ListServers()` (socket scan), `KillServer()`. SSE hub polls per-server. Removed `SessionInfo.Server` and `ProjectSession.Server` fields. New endpoints: `GET/POST /api/servers`, `POST /api/servers/kill`. `serverFromRequest()` validates input. | `260320-1335-tmux-server-switcher` |
| 2026-03-20 | tmux config and keybindings — `EnsureConfig()` auto-creates `~/.run-kit/tmux.conf` on serve startup. `-f` config flag scoped to `CreateSession`/`ReloadConfig` via `configArgs()`. Enhanced `internal/tmux/tmux.conf` with agent-optimized defaults and power-user keybindings. `ListKeys(server)` runs `tmux list-keys`, returns raw output (nil on "no server"). New `GET /api/keybindings` endpoint filters `list-keys` via whitelist map. `KillServer()` handles socket teardown gracefully (returns nil on "No such file or directory"). | `260320-9ldy-ui-polish-tmux-config-embed` |
| 2026-04-04 | Cross-session window move — `MoveWindowToSession(srcSession, srcIndex, dstSession, server)` wraps `tmux move-window -s {src}:{idx} -t {dst}:` with `tmuxExecServer` and `withTimeout()`. New `POST /api/sessions/{session}/windows/{index}/move-to-session` endpoint with `{ "targetSession" }` body. `TmuxOps` interface extended with `MoveWindowToSession`. Validates source/target differ (400 if same). | `260404-dq70-move-window-between-sessions` |
| 2026-04-06 | Pane CWD tracking — `ListWindows` now calls `list-panes -s -t <session>` after `list-windows` to populate `Panes []PaneInfo` on each `WindowInfo`; failure is non-fatal. `parsePanes(lines []string) map[int][]PaneInfo` parses 6-field tab-delimited output (field 0 = `#{window_index}` for grouping, fields 1–5 = pane data). Package-level `paneFormat` var: `#{window_index}\t#{pane_id}\t#{pane_index}\t#{pane_current_path}\t#{pane_current_command}\t#{pane_active}`. `WorktreePath` unchanged — still sourced from `list-windows #{pane_current_path}`. | `260405-rx38-pane-cwd-tracking` |
| 2026-04-17 | `rk riff` window creation — new subcommand creates `tmux new-window -c <path> "<launcher> '<cmd>'"` on the user's current tmux server (not the managed `runkit`/`default` servers). `$TMUX` recovered via `tmux.OriginalTMUX` and restored in child env (mirrors `context.go`). Optional `--split` appends `tmux split-window -h -c <path> "<setup>; exec \"${SHELL:-/bin/sh}\""` via the shared `shellWrap` helper. Bypasses `internal/tmux` because that package targets specific named servers via `-L <server>`. | `260416-r1j6-add-riff-command` |
| 2026-04-18 | Frontend server-routing contract — `server: string` now threaded as the first positional argument through every `api/client.ts` function that hits a server-scoped endpoint (`getSessions`, `createSession`, `renameSession`, `killSession`, `createWindow`, `renameWindow`, `killWindow`, `moveWindow`, `moveWindowToSession`, `selectWindow`, `splitWindow`, `closePane`, `sendKeys`, `updateWindowUrl`, `updateWindowType`, `setWindowColor`, `setSessionColor`, `reloadTmuxConfig`, `uploadFile`, `getKeybindings`). `withServer(url, server)` is pure — the module-level `_getServer` global and `setServerGetter` export are removed; `SessionProvider` no longer wires a getter. Server-management endpoints (`listServers`, `createServer`, `killServer`) and theme/server-color settings remain server-parameter-free by design. Eliminates a closure-race where mid-action server switches retargeted in-flight rename/kill/create calls at the wrong tmux server. Mirrors the backend `tmuxExecServer(ctx, server, …)` shape. | `260418-yadg-fix-mutation-server-race` |
| 2026-04-23 | `rk riff` window creation now multi-pane + fan-out. Each window is built by a `tmux new-window` + N-1 `tmux split-window` sequence, followed by `tmux select-layout <canonical>` and `tmux select-pane -t <window>.0` (focus pane 0 per the argv-order rule). Skill panes preserve the three-layer `<launcher> '<escaped-skill>'` → `sh -i -c` → `shellWrap` composition from earlier changes; cmd panes skip the interactive wrap (would alter user-command argv). Fan-out with N ≥ 2 spawns N goroutines sharing one context; failure triggers rollback via the pure `planFanOutRollback(results, failureIdx)` builder + `wt delete` / `tmux kill-window` calls against a fresh (non-cancelled) context so rollback runs to completion. Worktree names come from `wt`'s generator (no rk-side `-1..-N` scheme); windows named `riff-<wt-basename>` with `resolveWindowName` suffix fallback on collision. `--setup-pane`/`--split` removed entirely — `--cmd` (repeatable) subsumes the single-split use case. | `260423-jmwu-rk-riff-workflow-features` |
