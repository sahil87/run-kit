# tmux Session Enumeration

## Multi-Server Model

run-kit connects to **multiple tmux servers**. Server identity is part of the URL path: `/` shows the server list, `/$server` is the per-server shell, `/$server/$window` is the terminal route (window = stable `@N`; `$session` was dropped from the route by `260529-jad6-window-api-stability`). The user navigates between servers by changing the `$server` route parameter (via sidebar, command palette `Server: Switch to <name>`, or direct URL).

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

## Per-WebSocket Ephemeral Grouped Sessions (`rk-relay-*`)

The terminal relay (`app/backend/api/relay.go`) creates one ephemeral grouped session per WebSocket connection. tmux session groups share window membership but maintain **independent active-window state**, so this is the natural unit of isolation for clients that must navigate windows independently — particularly board panes pointing at different windows of the same real session.

**Naming convention**: `rk-relay-<8 hex>`. The prefix is exported as `tmux.RelaySessionPrefix = "rk-relay-"` and is reserved by run-kit. The 8-hex suffix is read from `crypto/rand` (constitution I — never derived from user input). 4B namespace, collision-free at any realistic scale.

**Creation**: `tmux.NewGroupedSession(ctx, server, realSession, ephemeral)` runs `tmux [-L server] new-session -d -s <ephemeral> -t <realSession>`. It first probes `has-session -t <realSession>` because tmux's `new-session -t` silently creates an empty group when the target is missing — the explicit probe ensures the caller's `defer KillSessionCtx` is the only path that creates ephemerals. The wrapper applies `context.WithTimeout(ctx, TmuxTimeout)` consistent with sibling helpers.

**Lifecycle**: bound to the WebSocket via `defer s.tmux.KillSessionCtx(context.Background(), server, ephemeral)` in the relay handler. Cleanup uses `context.Background()` rather than `r.Context()` because the request context is already cancelled at cleanup time (the trigger for the defer). The defer is placed before `pty.StartWithSize` so a PTY-start failure still reaps the ephemeral.

**Filter at the chokepoint**: `parseSessions` in `internal/tmux/tmux.go` early-skips any line whose `#{session_name}` starts with `RelaySessionPrefix`. This is the single chokepoint — every user-facing list (REST `/api/sessions`, SSE `sessions` event, board derivation in `api/boards.go`, server-aggregate `/api/servers`) flows through `ListSessions`, so a single early-skip here guarantees ephemerals never leak into the UI regardless of future consumers (multi-server SessionProvider included).

**Startup sweep**: `sweepOrphanedRelaySessions(ctx)` in `app/backend/cmd/rk/serve_sweep.go` reaps any `rk-relay-*` session left behind by a crashed prior `rk serve` instance. Wired into `serveCmd.RunE` after `tmux.EnsureConfig()` and before the goroutine that calls `server.ListenAndServe()`, with a 30s bounded context. The sweep iterates `tmux.ListServers(ctx)` and calls `tmux.ListRawSessionNames(ctx, server)` (the unfiltered variant — the user-facing filter would hide the very ephemerals being reaped). Per-server failures are logged and skipped — they MUST NOT abort the sweep or block startup. The sweep matches only the fixed `rk-relay-` prefix; user sessions and daemon sessions (`rk` on `rk-daemon`) are never touched (constitution VI).

**Why `ListRawSessionNames` exists**: the housekeeping caller (sweep) needs to *see* the ephemerals that the user-facing path *hides*. `ListRawSessionNames(ctx, server)` runs `list-sessions -F '#{session_name}'` and returns every name without applying the group-copy de-duplication or the `rk-relay-*` exclusion that `ListSessions`/`parseSessions` applies. It returns `nil` when no tmux server is running on the socket. Treat it as an internal escape hatch — no other callers should use it.

**Relay resolves the owning session from the window ID** (since `260529-chgz-window-id-routing`): the WebSocket URL is now `/relay/{windowId}?server={server}` (was `/relay/{session}/{window}`). Because the grouped ephemeral keys off the *real session name*, the relay calls `ResolveWindowSession(ctx, server, windowID)` (a targeted `display-message -t <windowId> -p '#{session_name}'`, 5s timeout) before `NewGroupedSession`. A malformed window ID is rejected with `400` before the WS upgrade; an unknown ID closes the socket with `4004`. The `select-window` on the ephemeral now targets the window ID directly (`@N` is shared across grouped sessions). Ephemeral names remain purely backend-internal — the frontend never sees an `rk-relay-*` name in URLs, request bodies, response payloads, or SSE frames.

## `_rk-ctl` Anchor Session (tmuxctl control mode)

`app/backend/internal/tmuxctl/` opens a long-running `tmux -CC` control-mode connection per tmux server (one Client per socket; see `architecture.md` § tmux Control-Mode Subscription for the package-level design). `tmux -CC` requires an attached session to emit notifications, so on tmux servers with zero pre-existing sessions the Client creates a hidden anchor session named `_rk-ctl`.

**Naming convention**: literal name `_rk-ctl`. The leading underscore follows the project's internal-entity convention. The single exported constant `tmux.ControlAnchorSessionName = "_rk-ctl"` lives alongside `tmux.RelaySessionPrefix` in `app/backend/internal/tmux/tmux.go` (it is a literal name rather than a prefix because there is exactly one anchor per tmux server). It is the single source of truth for the literal — `tmuxctl.Client`, `parseSessions`, and `sweepOrphanedRelaySessions` all reference the constant.

**Keepalive tag**: immediately after `new-session -d`, the Client runs `tmux set-option -t =_rk-ctl @rk_ctl_keepalive 1` (the option name is exported as `tmuxctl.AnchorKeepaliveOption = "@rk_ctl_keepalive"`). The tag is a defensive marker only — v1 has no runtime consumer, but the marker exists so future code can identify the anchor without depending on the literal name. `set-option` is idempotent and safe to re-run when another `rk serve` instance created the anchor first.

**Anchored target form**: the Client invokes `tmux [-L <socket>] -CC attach-session -t =_rk-ctl -r` (or `-t =<first-existing-session>` when at least one user session exists). The `=` prefix forces exact-match targeting and prevents prefix-match collisions, consistent with the convention established in PR #196 (daemon detection's `=rk-daemon:=serve`). The `-r` flag puts the connection in **read-only mode** — restricts input only; notifications still emit. Defensive default — future refactors that accidentally wire commands through the control-mode connection cannot mutate tmux state. The bootstrap target is the first session returned by `tmux [-L <socket>] list-sessions -F '#{session_name}'`; when that returns empty, the Client falls back to creating `_rk-ctl`.

**Concurrent-rk race**: when two `rk serve` instances open a Client against the same fresh tmux server, only one `new-session -d` call succeeds; the loser gets tmux's "duplicate session" error. `tmuxctl.isDuplicateSessionError` treats this as benign and the loser proceeds to attach — multi-rk is supported by construction since `tmux -CC attach` is independent per client.

**Filtering at the chokepoint**: `parseSessions` in `app/backend/internal/tmux/tmux.go` early-skips any line whose `#{session_name}` equals `ControlAnchorSessionName` — parallel to the existing `RelaySessionPrefix` skip. Single chokepoint — every user-facing list (REST `/api/sessions`, SSE `event: sessions`, board derivation, server-aggregate `/api/servers`) flows through `ListSessions`, so the anchor never leaks into the UI.

**Sweep exclusion**: `sweepOrphanedRelaySessions(ctx)` in `app/backend/cmd/rk/serve_sweep.go` matches only the `rk-relay-` prefix, so the anchor is excluded by construction. A defense-in-depth `name == tmux.ControlAnchorSessionName` guard is in place anyway — the anchor is owned by `tmuxctl`, not the relay, and must never be reaped by the relay sweep. `cmd/rk/serve.go` orders startup as `EnsureConfig → sweepOrphanedRelaySessions → tmuxctl.Supervisor.Start → server.ListenAndServe`, so the sweep runs before any anchor has been created — but the explicit guard protects against future re-orderings.

**Lifecycle**: the anchor outlives any single `Client` invocation. `Close()` does not delete it — closing the PTY only ends the subscription; the detached session lives on. This is intentional: subsequent `rk serve` invocations re-attach to the existing anchor rather than re-creating it. The anchor only disappears when the entire tmux server is killed.

**Why a hidden anchor, not an arbitrary user session**: attaching to a user session would couple the control-mode lifecycle to that session's lifetime — killing the user session would tear down the subscription. A purpose-built anchor decouples the two. `tmux -CC` cannot use `new-session -d` without attach (it requires an attached client to emit notifications), so "no anchor at all" is not an option.

## Window Addressing Identity (`@N`)

Since `260529-chgz-window-id-routing`, a *specific existing window* is addressed by its stable tmux **window ID** (`@N`, tmux's `#{window_id}`) rather than the mutable window *index*. A window ID is **server-global and a self-contained `-t` target** — `tmux kill-window -t @5` needs no session prefix — so window-targeting tmux commands pass the windowID directly and the `session:index` target string is gone. The window **index** is retained only for *positional* operations (reorder/move), which are inherently "move to position N" and cannot be expressed by ID. **Sessions are still identified by name** — only window addressing changed.

This identity is consistent across all layers: URL (`/$server/$window` — `$session` was dropped from the route shape by `260529-jad6-window-api-stability`, leaving `@N` as the only window identity in the URL), HTTP API (`/api/windows/{windowId}/...`), WS relay (`/relay/{windowId}`), tmux targets, and the fab pane-map enrichment join. The window store and the boards feature (`@rk_board` stores `<window_id>:...`) were already windowID-keyed. New path params are validated by `validate.ValidateWindowID` (`^@[0-9]+$`) — stricter than `ValidateName`, which permits `@` but not the `@N` shape (constitution §I). Window IDs are never user-typed; they originate from tmux's `#{window_id}`. See `architecture.md` § API Layer and § Terminal Relay, and `ui-patterns.md` § URL Structure.

## Impact on Other Operations

All tmux functions accept a `server string` parameter:

- `ListSessions(server)` — queries only the specified server
- `ListWindows(session, server)` — lists windows for a session on the specified server
- `SelectWindow(windowID, server)` — selects a window on the specified server by its stable window ID via a bare `select-window -t @N` (`@N` is a self-contained `-t` target; no session:index string — since `260529-chgz-window-id-routing`). **Caveat (since `260529-jad6`)**: a bare target is ambiguous inside a tmux session group (members share window membership but keep independent active-window state), so both the REST `/select` handler and the relay now use the session-scoped `SelectWindowInSession(session, windowID, server)` (`select-window -t <session>:@N`) instead — `SelectWindow` has no production callers left
- `SelectWindowInSession(session, windowID, server)` — session-scoped select (`select-window -t <session>:@N`). REST `/select` resolves the owning session via `ResolveWindowSession` then calls this; the relay scopes the select to its per-WebSocket ephemeral. The scoped target is what disambiguates which group member gets the active window
- `ResolveWindowSession(ctx, server, windowID)` — returns the owning session name for a window ID via a targeted `display-message -t <windowID> -p '#{session_name}'` (O(1)); used by the relay (to build the grouped ephemeral), the REST `/select` handler (session-scoped select), and `ProjectRoot`. Errors (or empty result) mean "window not found"
- `CreateSession(name, cwd, server)` — creates sessions on the specified server
- `ReloadConfig(server)` — hot-reloads config via `source-file` on the specified server
- `KillSession(session, server)` — kills the named session on the specified server (thin `context.Background()` wrapper around `KillSessionCtx`)
- `KillSessionCtx(ctx, server, session)` — ctx-accepting variant; relay handler cleanup passes `context.Background()` so the kill survives request-context cancellation (the trigger for the defer)
- `NewGroupedSession(ctx, server, realSession, ephemeral)` — creates `rk-relay-*` ephemeral via `new-session -d -s <ephemeral> -t <realSession>`; probes `has-session -t <realSession>` first to avoid leaking an empty-group session when the target is missing
- `ListRawSessionNames(ctx, server)` — unfiltered `list-sessions -F '#{session_name}'`; bypasses `parseSessions`'s group-copy and `rk-relay-*` filters. Reserved for housekeeping callers (the startup sweep). Returns nil when no server is running
- `SendKeys(windowID, keys, server)` — sends keys to the window identified by `windowID` on the specified server
- `MoveWindow(windowID, dstIndex, server)` — reorders a window within its own session. Source addressed by stable `windowID`; destination remains positional. Resolves the source's current index from the ID exactly once (via `resolveWindowSessionIndex`, a `display-message -p '#{session_name}\t#{window_index}'` lookup), then (since `260529-jad6`) emits the full adjacent-`swap-window` bubble sequence as a **single `\;`-chained tmux invocation** rather than one subprocess per step — so no other mutation can interleave mid-reorder (insert-before semantics). tmux preserves the window's ID across the swaps
- `MoveWindowToSession(windowID, dstSession, server)` — moves a window from its current session to another on the specified server via `tmux move-window -s {windowID} -t {dstSession}:` (window-ID source, session destination). Destination index is auto-assigned by tmux; the window's ID is preserved (tmux contract)

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
| `@color` | window (`-w`) | `tmux.SetWindowOptions` (via `POST /options`; since `260529-jad6`) | `ListWindows` format string field 8 | per-window |
| `@rk_type` | window (`-w`) | `CreateWindowWithOptions`, `tmux.SetWindowOptions` (both via `appendOptionOps`; since `260529-jad6`) | `ListWindows` format string field 9 | per-window (iframe) |
| `@rk_url` | window (`-w`) | `CreateWindowWithOptions`, `tmux.SetWindowOptions` (both via `appendOptionOps`; since `260529-jad6`) | `ListWindows` format string field 10 | per-window (iframe) |
| `@rk_session_order` | server (`-s`) | `tmux.SetSessionOrder(ctx, server, order)` | `tmux.GetSessionOrder(ctx, server)` | sidebar reorder |
| `@rk_board` | server (`-s`) | `tmux.Pin` / `tmux.Unpin` / `tmux.Reorder` | `tmux.ListBoardEntries(ctx, server)` | pane boards (cross-server union) |
| `@rk_ctl_keepalive` | session-scoped on `_rk-ctl` (set via `set-option -t =_rk-ctl`) | `tmuxctl.Client.setAnchorKeepalive` | (no runtime consumer; defensive marker) | tmuxctl control-mode anchor |

`@rk_session_order` stores a JSON-encoded array of session names defining the user-preferred sidebar render order. Because the value is server-scoped, it is shared by every client connected to the same tmux server — laptop and phone hitting the same `tmux -L runkit` see the same order. Lifetime matches the tmux server (lost on server kill, NOT on rk-go restart per Constitution VI). Both wrapper functions wrap their context with `context.WithTimeout(ctx, TmuxTimeout)` (10s) and route through `tmuxExecRawServer` (which captures stderr in error messages so callers can pattern-match "invalid option" / "no server running" to distinguish operational empty-state from real failures).

The HTTP endpoints `GET /api/sessions/order` and `POST /api/sessions/order` (migrated PUT→POST by `260529-jad6` per §IX; see `architecture.md` § Endpoints) layer over these wrappers. The mutating POST triggers a synchronous SSE broadcast (`event: session-order`) so all connected clients on that server reorder live; the SSE hub also bootstraps the cache once per server on first poll so the order survives an rk-go restart that left tmux running.

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

**Window ID stability across `move-window`** — pins follow tmux's documented contract that `move-window` (and `swap-window`) preserves `window_id` (`@N`) and only changes `window_index` (`:N`). A pinned window moved between sessions on the same server remains pinned without manual intervention. As of `260529-chgz-window-id-routing`, the window-ID routing migration relies on this same contract: `MoveWindow` (reorder via adjacent `swap-window`) and `MoveWindowToSession` (`move-window -s <windowID> -t <dstSession>:`) keep the window's `@N` stable, so the URL/selection that addresses it by ID survives the move and the post-move navigation targets the unchanged `windowId`.

## Frontend Server Routing Contract

Every API client function in `app/frontend/src/api/client.ts` that hits a server-scoped endpoint takes `server: string` as its **first positional argument** and forwards it to `withServer(url, server)` to build `?server=<server>`. There is **no module-level `_getServer` global, no `setServerGetter` export, and no ambient state** — `server` is always passed explicitly per call. This mirrors the backend `tmuxExecServer(ctx, server, args...)` shape so the routing parameter is visible in every signature on both sides of the wire.

Functions that take `server` (read + mutation):

| Category | Functions |
|----------|-----------|
| Read | `getSessions`, `getKeybindings`, `getSessionOrder` |
| Session mutation | `createSession`, `renameSession`, `killSession`, `setSessionOrder` |
| Window mutation | `createWindow` (session-scoped), `renameWindow`, `killWindow`, `moveWindow`, `moveWindowToSession`, `selectWindow`, `splitWindow`, `closePane`, `sendKeys` (all but `createWindow` take `windowId: string` as the 2nd positional arg since `260529-chgz-window-id-routing` and hit `/api/windows/{windowId}/...`) |
| Window options | `updateWindowUrl`, `updateWindowType` (both `(server, windowId, …)`) |
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
- `POST /api/windows/{windowId}/move-to-session` — moves a window to another session. `{windowId}` validated via `validate.ValidateWindowID`. Request body: `{ "targetSession": "string" }`. Validates the window ID and target session name. Returns `200 { "ok": true }` on success. Handler in `api/windows.go`, `MoveWindowToSession(windowID, dstSession, server)` method on the `TmuxOps` interface in `router.go`. (Route moved from the session-scoped `/api/sessions/{session}/windows/{index}/move-to-session` in `260529-chgz-window-id-routing`.)

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

- `app/backend/internal/tmux/tmux.go` — `serverArgs()`, `tmuxExecServer()`, `ListSessions()`, `ListServers()`, `ListKeys()`, `KillServer()`, `CreateSession()`, `SelectWindow(windowID, server)`, `ResolveWindowSession()`, `resolveWindowSessionIndex()`, `MoveWindow(windowID, dstIndex, server)`, `MoveWindowToSession(windowID, dstSession, server)`, `ReloadConfig()`, `EnsureConfig()`, `ConfigPath()`
- `app/backend/internal/sessions/sessions.go` — `FetchSessions(server)` builds the dashboard view, `ProjectSession` has `Name` and `Windows` (no `Server` field); pane-map enrichment re-keys from `session:index` to windowID before joining; `ProjectRoot(ctx, windowID, server)` resolves by window ID
- `app/backend/api/router.go` — `serverFromRequest()` helper, `TmuxOps` interface with server params, route registration
- `app/backend/api/windows.go` — window action handlers keyed by `/api/windows/{windowId}` (kill, move, move-to-session, rename, color, url/type PUT, keys, select, split, close-pane); `parseWindowID(r) (string, bool)` helper validates the path param; `handleWindowCreate` stays session-scoped
- `app/backend/api/servers.go` — server list/create/kill handlers
- `app/backend/api/keybindings.go` — `GET /api/keybindings` handler (runs `list-keys`, filters via whitelist, returns JSON)
- `app/backend/api/sse.go` — per-server SSE polling hub
- `app/backend/api/relay.go` — WebSocket relay at `/relay/{windowId}` reads `?server=` query param, validates the window ID, resolves the owning session via `tmux.ResolveWindowSession`, allocates a per-WebSocket ephemeral via `tmux.NewGroupedSession`, selects the window by ID on the ephemeral, attaches to the ephemeral (not the real session), and reaps it on disconnect via deferred `KillSessionCtx`
- `app/backend/cmd/rk/serve_sweep.go` — `sweepOrphanedRelaySessions(ctx)` reaps orphan `rk-relay-*` ephemerals across every server returned by `tmux.ListServers(ctx)` before HTTP bind; explicit `name == tmux.ControlAnchorSessionName` guard skips the `_rk-ctl` anchor (defense-in-depth)
- `app/backend/internal/tmuxctl/` — control-mode subscription package; `Client` opens `tmux -CC ... -t =<bootstrap> -r` per socket, creates the `_rk-ctl` anchor when needed and tags it with `@rk_ctl_keepalive 1`. See `architecture.md` § tmux Control-Mode Subscription
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
| 2026-05-09 | Per-WebSocket ephemeral grouped sessions for the relay. New `tmux.NewGroupedSession(ctx, server, realSession, ephemeral)` wraps `tmux new-session -d -s <ephemeral> -t <realSession>` (with a `has-session` probe to avoid leaking empty-group sessions when the target is missing), `tmux.KillSessionCtx(ctx, server, session)` exposes a ctx-accepting kill so relay cleanup can pass `context.Background()` (existing `KillSession` becomes a thin wrapper), and `tmux.RelaySessionPrefix = "rk-relay-"` reserves the name space. `parseSessions` early-skips any `rk-relay-*` line — single chokepoint for all user-facing session lists (REST, SSE, board derivation, server-aggregate). New `tmux.ListRawSessionNames(ctx, server)` returns the unfiltered list for housekeeping callers (the startup sweep, which would otherwise be unable to see the very ephemerals it needs to reap). Relay handler (`api/relay.go`) generates the ephemeral name via `crypto/rand` (constitution I), creates the grouped session, defers `KillSessionCtx(context.Background(), …)` (request context is cancelled at cleanup time), then `select-window` and `attach-session` against the ephemeral — never against the real session. Fixes the central bug where N board panes targeting different windows of one tmux session showed identical content (tmux's per-session active-window state); fixes a latent two-tabs-same-session focus-stealing bug as a side effect. Startup sweep `sweepOrphanedRelaySessions(ctx)` in `cmd/rk/serve_sweep.go` reaps orphans across all `tmux.ListServers(ctx)` before HTTP bind (synchronous, 30s bounded; per-server failures logged and skipped). `TmuxOps` interface gains `NewGroupedSession` and `KillSessionCtx`; `mockTmuxOps` updated. WebSocket URL contract unchanged. | `260508-hdjr-relay-grouped-sessions-board-panes` |
| 2026-05-07 | `@rk_board` server-scoped option for pane boards. New `internal/tmux/board.go` exposes `ListBoardEntries`, `ListAllBoardEntries`, `ListBoards`, `GetBoard`, `Pin`, `Unpin`, `Reorder`, `RemoveAllByWindowID`, and `ComputeOrderKey`. Distributed storage: each tmux server stores entries only for its own windows; aggregate views read from every server returned by `ListServers()` and union/tag entries with their source server. Value format: comma-separated `<window_id>:<board>:<order_key>` entries (`,` and `:` reserved separators excluded by the board-name regex `^[A-Za-z0-9_-]{1,32}$`). Order keys use lowercase-`a..z` fractional indexing — inserts never renumber. Lazy stale-entry cleanup at read time intersects with `liveWindowIDs(server)` and best-effort writes back the cleaned slice (read still returns success on write-back failure). Eager cleanup via the SSE poll-tick: window-kill detection scans per-server entries and calls `RemoveAllByWindowID`, then broadcasts one `event: board-changed { change: "cleanup" }` per affected board. SSE hub bootstraps `@rk_board` once per server on first poll and emits a synthetic `board-changed { change: "bootstrap", entries: [...] }` so an rk-go restart with tmux still running rehydrates the boards UI (parity with `@rk_session_order`). All wrappers route through `tmuxExecRawServer` with `context.WithTimeout(ctx, TmuxTimeout)`. | `260507-4vuv-pane-boards` |
| 2026-05-28 | `_rk-ctl` hidden anchor session for tmuxctl control mode. New exported `tmux.ControlAnchorSessionName = "_rk-ctl"` constant (alongside `RelaySessionPrefix` in `internal/tmux/tmux.go`); `parseSessions` early-skips any line whose `#{session_name}` equals it — single chokepoint mirroring the existing `rk-relay-*` skip, so every consumer (REST `/api/sessions`, SSE `event: sessions`, board derivation, server-aggregate `/api/servers`) automatically excludes the anchor. `app/backend/internal/tmuxctl/Client` creates the anchor via `tmux [-L <socket>] new-session -d -s _rk-ctl` when the target tmux server has zero pre-existing sessions (`tmux -CC` requires an attached session to emit notifications), then tags it with the server-scoped user-option `@rk_ctl_keepalive 1` via `set-option -t =_rk-ctl @rk_ctl_keepalive 1` (exported as `tmuxctl.AnchorKeepaliveOption`; defensive marker only, no v1 runtime consumer). Concurrent-rk "duplicate session" error treated as benign by `isDuplicateSessionError`. The Client invokes `tmux -CC attach-session -t =<bootstrap> -r` with the anchored `=` target form (PR #196 convention) and the `-r` read-only flag (restricts input, notifications still emit). `sweepOrphanedRelaySessions` is excluded by construction (matches only the `rk-relay-` prefix), with an explicit `name == ControlAnchorSessionName` guard added for defense-in-depth. Anchor outlives any single Client lifetime; only `tmux kill-server` removes it. | `260528-nvlp-active-window-sync` |
| 2026-05-29 | Window addressing migrated from mutable index to stable window ID (`@N`). New § Window Addressing Identity documents the cross-layer contract: window-targeting tmux commands pass the windowID directly as `-t` (no `session:index` string); the index is retained only for positional reorder/move; sessions are still name-identified. `internal/tmux` window methods take `windowID string` — `SelectWindow`/`RenameWindow`/`SendKeys`/`KillWindow`/`SplitWindow`/`KillActivePane`/`SetWindowColor`/`SetWindowOption` etc. New `ResolveWindowSession(ctx, server, windowID)` (`display-message -p '#{session_name}'`) and `resolveWindowSessionIndex` (adds `#{window_index}` for positional ops). `MoveWindow(windowID, dstIndex, server)` resolves source index then bubble-swaps via adjacent `swap-window`; `MoveWindowToSession(windowID, dstSession, server)` runs `move-window -s <windowID> -t <dstSession>:` — both preserve the window's `@N` (tmux contract, same as the boards pin-stability invariant). WS relay route `/relay/{windowId}` resolves the owning session from the ID before building the grouped ephemeral (malformed → 400 pre-upgrade; unknown → close 4004); grouped-session mechanism otherwise unchanged. HTTP window-targeting routes moved to `/api/windows/{windowId}/...` (create stays session-scoped); new `validate.ValidateWindowID` (`^@[0-9]+$`). `internal/sessions` pane-map enrichment + `ProjectRoot` re-keyed to windowID. Frontend `api/client.ts` window-targeting fns take `windowId` as the 2nd positional arg (server first) per the routing contract. | `260529-chgz-window-id-routing` |
| 2026-05-30 | Window-addressing follow-ons from the API-stability remediation. **Select scoping**: the REST `/select` handler now resolves the owning session via `ResolveWindowSession` and issues a session-scoped `SelectWindowInSession` (`select-window -t <session>:@N`) instead of the group-ambiguous bare `SelectWindow(@N)`; the relay was already scoped to its ephemeral. `SelectWindow` (bare target) retains no production callers. **Route shape**: `$session` dropped from the URL (`/$server/$session/$window` → `/$server/$window`) — `@N` is the only window identity in the URL; the owning session is derived from the SSE snapshot. **`MoveWindow` atomic**: the adjacent-`swap-window` bubble sequence now executes as one `\;`-chained invocation (source index resolved once) so no concurrent mutation can interleave mid-reorder. **Option setters**: `@color`/`@rk_type`/`@rk_url` are now set through the batched `tmux.SetWindowOptions` / `appendOptionOps` chained primitive (one atomic invocation) behind the unified `POST /api/windows/{windowId}/options`; `@rk_session_order` / theme / server-color HTTP routes migrated PUT→POST (§IX). | `260529-jad6-window-api-stability` |
