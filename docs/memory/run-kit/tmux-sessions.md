# tmux Session Enumeration

## Multi-Server Model

run-kit connects to **multiple tmux servers**. Server identity is part of the URL path: `/` shows the server list, `/$server` is the per-server shell, `/$server/$session/$window` is the terminal route. The user navigates between servers by changing the `$server` route parameter (via sidebar, command palette `Server: Switch to <name>`, or direct URL).

The backend is stateless — every API request carries the server identity (`?server={name}` query parameter for REST/SSE/WebSocket; `serverFromRequest(r)` validates and defaults to `"default"` when missing). All tmux operations use `tmuxExecServer(ctx, server, args...)` which prepends `-L {server}` for named servers. The `"default"` server uses no `-L` flag, connecting to the user's standard tmux server. The config flag `-f {path}` is applied to all named servers (not just runkit).

### Per-View Server Scope

While run-kit *as a whole* is multi-server, **any single view (terminal, dashboard, sidebar tree) is scoped to one server** — the one in the URL. Components that derive state from "current server" (sidebar tree, optimistic overlays, SSE polling) read it from the route via `useSessionContext()`. The `optimistic-context` filters ghosts/overlays by `currentServer` so cross-server in-flight mutations don't leak into the wrong view.

Features that span multiple servers (e.g., the boards view) open multiple concurrent connections — one SSE per contributing server, one WebSocket per pinned terminal — and tag each entry with its source server in API responses.

### Server Discovery

`ListServers()` discovers available tmux servers by scanning the socket directory at `/tmp/tmux-{uid}/`. Each socket file represents a running server. Returns sorted server names. The frontend calls `listServers()` at mount and refreshes via SSE-driven invalidation.

### Server Lifecycle

- **Create**: Implicit — `CreateSession("0", $HOME, serverName)` starts a new server when the first session is created on it
- **Kill**: `KillServer(server)` runs `tmux [-L server] kill-server`, destroying all sessions
- **Switch**: navigate to `/$newServer/...` — the route change re-mounts the SessionProvider with the new `server` prop and reconnects SSE/WebSocket with the new `?server=` param

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

## Server-Scoped User Options

tmux distinguishes window-scoped (`-w`) options from server-scoped (`-s`) options. We use both: window-scoped for per-window state (`@color`, `@rk_type`, `@rk_url`) and server-scoped for state that belongs to the tmux server as a whole.

| Option | Scope | Set via | Read via | Owner |
|--------|-------|---------|----------|-------|
| `@color` | window (`-w`) | `tmux.SetWindowColor` | `ListWindows` format string field 8 | per-window |
| `@rk_type` | window (`-w`) | `CreateWindowWithOptions`, `tmux.SetWindowOption` | `ListWindows` format string field 9 | per-window (iframe) |
| `@rk_url` | window (`-w`) | `CreateWindowWithOptions`, `tmux.SetWindowOption` | `ListWindows` format string field 10 | per-window (iframe) |
| `@rk_session_order` | server (`-s`) | `tmux.SetSessionOrder(ctx, server, order)` | `tmux.GetSessionOrder(ctx, server)` | sidebar reorder |
| `@rk_board` | server (`-s`) | `tmux.Pin` / `tmux.Unpin` / `tmux.Reorder` | `tmux.ListBoardEntries(ctx, server)` | pane boards (cross-server union) |

`@rk_session_order` stores a JSON-encoded array of session names defining the user-preferred sidebar render order. Because the value is server-scoped, it is shared by every client connected to the same tmux server — laptop and phone hitting the same `tmux -L runkit` see the same order. Lifetime matches the tmux server (lost on server kill, NOT on rk-go restart per Constitution VI). Both wrapper functions wrap their context with `context.WithTimeout(ctx, TmuxTimeout)` (10s) and route through `tmuxExecRawServer` (which captures stderr in error messages so callers can pattern-match "invalid option" / "no server running" to distinguish operational empty-state from real failures).

The HTTP endpoints `GET /api/sessions/order` and `PUT /api/sessions/order` (see `architecture.md` § Endpoints) layer over these wrappers. PUT triggers a synchronous SSE broadcast (`event: session-order`) so all connected clients on that server reorder live; the SSE hub also bootstraps the cache once per server on first poll so the order survives an rk-go restart that left tmux running.

### `@rk_board` — Pane Board Membership

`@rk_board` stores the per-server portion of pane-board memberships. **Each tmux server stores memberships only for its own windows** — there is no central registry. The aggregate "boards" set is derived by reading `@rk_board` from every server discovered via `tmux.ListServers(ctx)` and unioning the entries. Boards are **derived from membership**: there is no separate `@rk_boards` registry option, and empty boards cannot exist (a board materializes on first pin and vanishes on last unpin).

**Value format**: comma-separated entries, each entry colon-separated `<window_id>:<board_name>:<order_key>`. Empty value or unset option is treated as zero entries (no error). Example:

```
runkit:  @rk_board = "@1234:main:a,@5678:main:c,@9abc:deploy:a"
default: @rk_board = "@def0:main:b"
```

This reconstructs board `main` as `[@1234@runkit:a, @def0@default:b, @5678@runkit:c]` (sorted by `order_key`).

**Field separators are reserved**: `,` and `:` MUST NOT appear in board names. The board-name regex `^[A-Za-z0-9_-]{1,32}$` enforces this at validation time. `window_id` matches tmux's `#{window_id}` form (`^@\d+$`). `order_key` is `^[a-z]{1,16}$` (lowercase ASCII only).

**Read pattern** — parallel `show-options -s -v @rk_board` across `ListServers()`, then union and tag each entry with its source server. The tmux pkg exposes:

| Function | Purpose |
|----------|---------|
| `tmux.ListBoardEntries(ctx, server)` | per-server entries (unset/no-server/invalid-option ⇒ `([]BoardEntry{}, nil)`) |
| `tmux.ListAllBoardEntries(ctx)` | aggregate across `ListServers()` |
| `tmux.ListBoards(ctx)` | distinct board names + pin counts (alphabetical) |
| `tmux.GetBoard(ctx, name)` | entries for one board, sorted by `OrderKey`, with lazy stale cleanup |
| `tmux.Pin(ctx, server, windowID, board)` | append-or-noop (idempotent re-pin) |
| `tmux.Unpin(ctx, server, windowID, board)` | remove `(windowID, board)` only; tolerant of missing entries |
| `tmux.Reorder(ctx, server, windowID, board, newKey)` | rewrite the matching entry's `orderKey` |
| `tmux.RemoveAllByWindowID(ctx, server, windowID)` | drop every entry for a window-id; returns the affected board names (used by the SSE hub for window-kill cleanup) |
| `tmux.ComputeOrderKey(before, after)` | fractional indexing helper |

All wrappers route through `tmuxExecRawServer` and wrap their context with `context.WithTimeout(ctx, TmuxTimeout)` (10s). Reads treat `invalid option`, `unknown option`, `no server running`, and `failed to connect` as the empty-entries case (mirrors `GetSessionOrder`). Malformed entries inside a well-formed value are silently skipped with `slog.Warn` — the well-formed entries are still returned.

**Lexicographic / fractional order keys**: cross-server ordering is achieved without renumbering via Figma/Linear-style fractional indexing. `ComputeOrderKey(before, after)` returns a string strictly greater than `before` and strictly less than `after` in lexicographic order:

- `(null, "b")` → `"a"` (prepend)
- `("c", null)` → `"d"` (append)
- `("b", "c")` → `"bm"` (insert)
- `("b", "bm")` → `"bg"` (insert between adjacent suffixes)

The algorithm is pure Go (no external deps). Inserts MUST NOT renumber existing entries.

**Lazy stale-entry cleanup at read time** — `GetBoard(ctx, name)` runs `liveWindowIDs(server)` per source server and intersects with the parsed entries. Entries whose `window_id` no longer exists on its source server are omitted from the response and removed from `@rk_board` via a best-effort write-back (`setBoardValue`). Write-back failure does NOT fail the read — the response is still returned with stale entries dropped, and the failure is logged.

**Eager cleanup via SSE poll-tick** — `sseHub.poll()` (`api/sse.go`) compares the per-server window-id set across consecutive ticks. For each killed `window_id`, the hub calls `tmux.RemoveAllByWindowID(ctx, server, windowID)` and broadcasts one `event: board-changed` per affected board with `change: "cleanup"`. This closes the gap when a board has not been read recently.

**SSE event** — `event: board-changed` rides the existing per-server SSE stream (`GET /api/sessions/stream?server=<name>`). Payload shape: `{"board":"main","change":"pin"|"unpin"|"reorder"|"cleanup","server":"runkit","windowId":"@1234","orderKey":"bm"}`. `orderKey` is omitted (`omitempty`) for `unpin` / `cleanup`. Frontend clients viewing a board open one SSE connection per server contributing entries — boards span servers, so cross-server fan-out is required (see `architecture.md` § Boards Feature).

**Bootstrap parity with `@rk_session_order`** — The hub reads `@rk_board` once per server on first poll and broadcasts a synthetic `board-changed` event with `change: "bootstrap"` and payload `{"server":"<name>","change":"bootstrap","entries":[...]}`. This survives an rk-go restart that left tmux running (Constitution VI). The cached payload is sent to new SSE clients on connect (positioned between `session-order` and `metrics`).

**Window ID stability across `move-window`** — pins follow tmux's documented contract that `move-window` preserves `window_id` (`@N`) and only changes `window_index` (`:N`). A pinned window moved between sessions on the same server remains pinned without manual intervention.

## Frontend Server Routing Contract

Every API client function in `app/frontend/src/api/client.ts` that hits a server-scoped endpoint takes `server: string` as its **first positional argument** and forwards it to `withServer(url, server)` to build `?server=<server>`. There is **no module-level `_getServer` global, no `setServerGetter` export, and no ambient state** — `server` is always passed explicitly per call. This mirrors the backend `tmuxExecServer(ctx, server, args...)` shape so the routing parameter is visible in every signature on both sides of the wire.

Functions that take `server` (read + mutation):

| Category | Functions |
|----------|-----------|
| Read | `getSessions`, `getKeybindings`, `getSessionOrder` |
| Session mutation | `createSession`, `renameSession`, `killSession`, `setSessionOrder` |
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
  1. `tmux new-window -P -F '#{pane_id}' -n <resolvedName> -c <worktree-path> <pane-0-shell>` creates the window and prints the new pane's id (e.g. `%87`), captured by the orchestrator for the focus step below.
  2. `tmux split-window -t <resolvedName> -c <worktree-path> <pane-i-shell>` appends each additional pane (panes 1..N-1). The initial split direction is `-h` by default; the final arrangement is set by `select-layout`.
  3. `tmux select-layout -t <resolvedName> <canonical>` applies the resolved layout (skipped when pane count is 1 and layout is `auto`, or when `--layout` produces an empty canonical for the pane count).
  4. `tmux select-pane -t <captured-pane-id>` focuses the first pane. Targeting by pane id (rather than a hardcoded `<window>.0` index) is portable across tmux servers configured with `pane-base-index 1` — the previous index-based form errored with `can't find pane: 0` on those servers.
- **Pane shell strings** — skill panes wrap `<launcher> '<escaped-skill>'` (or bare `<launcher>` when skill is empty) inside `${SHELL:-/bin/sh} -i -c '...'` then `shellWrap` (`; exec "${SHELL:-/bin/sh}"`). Cmd panes use the user's command directly + `shellWrap` (no interactive `sh -i -c` wrap — would alter argv semantics of user commands). Empty `--cmd` yields the bare `exec "${SHELL:-/bin/sh}"` form (drops to `$SHELL`). All handled by pure helpers `buildSkillShellString`, `buildCmdShellString`, `paneShellString`, and the argv builder `buildSpawnArgvs`.
- **Window naming** — `riff-<basename>` where `<basename>` is `filepath.Base(worktreePath)`. For `--count N` (N ≥ 2), each worktree gets its own name (assigned by `wt create`'s random adjective-noun generator; rk does NOT impose a `-1..-N` suffix scheme), so windows end up named `riff-swift-fox`, `riff-clever-crab`, etc. Collision resolution applies per-window via `resolveWindowName` (auto-suffix `-2`, `-3`, …).
- **`--count` orchestration** — `runCount` spawns N goroutines sharing one `context.Context`. Each goroutine runs `runWtCreate` + `spawnRiffReturningName`; first failure cancels the context (killing sibling subprocesses via `exec.CommandContext`) and triggers rollback. The pure `planFanOutRollback(results, failureIdx)` computes which worktrees + windows to clean up — excludes the failing goroutine's own artifacts — and `rollbackFanOut` invokes `wt delete --non-interactive <basename>` (positional arg, not the deprecated `--worktree-name`; `--non-interactive` so the prompt does not block on EOF) then `tmux kill-window -t <name>`. Rollback uses a fresh (non-cancelled) context so it runs to completion; rollback errors are logged but do not mask the primary error.
- **Child env** — `tmuxChildEnv()` restores `TMUX=<OriginalTMUX>` in every spawned tmux process so tmux targets the user's server. Mirrors `cmd/rk/context.go`.
- **Timeouts** — `exec.CommandContext` with 30s for `wt create` / `wt delete`, 10s per tmux call.
- **Signals** — SIGINT/SIGTERM once, at the top of `runRiff` via `signal.NotifyContext`; propagates to all goroutines and their subprocess calls.

The new windows never appear on the managed `runkit`/`default` servers unless the user's current `$TMUX` happens to point there. See `rk-riff.md` for flag surface (`--skill`, `--cmd`, `--layout`, `--count`/`-N`, `--preset`, `--list-presets`), exit codes, and preset schema.

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
| 2026-05-07 | `@rk_board` server-scoped option for pane boards. New `internal/tmux/board.go` exposes `ListBoardEntries`, `ListAllBoardEntries`, `ListBoards`, `GetBoard`, `Pin`, `Unpin`, `Reorder`, `RemoveAllByWindowID`, and `ComputeOrderKey`. Distributed storage: each tmux server stores entries only for its own windows; aggregate views read from every server returned by `ListServers()` and union/tag entries with their source server. Value format: comma-separated `<window_id>:<board>:<order_key>` entries (`,` and `:` reserved separators excluded by the board-name regex `^[A-Za-z0-9_-]{1,32}$`). Order keys use lowercase-`a..z` fractional indexing — inserts never renumber. Lazy stale-entry cleanup at read time intersects with `liveWindowIDs(server)` and best-effort writes back the cleaned slice (read still returns success on write-back failure). Eager cleanup via the SSE poll-tick: window-kill detection scans per-server entries and calls `RemoveAllByWindowID`, then broadcasts one `event: board-changed { change: "cleanup" }` per affected board. SSE hub bootstraps `@rk_board` once per server on first poll and emits a synthetic `board-changed { change: "bootstrap", entries: [...] }` so an rk-go restart with tmux still running rehydrates the boards UI (parity with `@rk_session_order`). All wrappers route through `tmuxExecRawServer` with `context.WithTimeout(ctx, TmuxTimeout)`. | `260507-4vuv-pane-boards` |
