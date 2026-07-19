---
description: "Session enumeration and group filtering; direct-attach terminal relay over the muxed `/ws/terminals` socket (pin-session-first attach, session-scoped select, direct attach); link-based board pin-sessions (`_rk-pin-*`, dual home+pin membership, last-link recovery); window `@N` addressing; exact-match `=name:` session targets; `MoveWindow` active-window preservation; name-optional folder auto-naming; SSE dead-server reap; test-socket naming + `rk reaper`; pane-targeted chat-send primitives."
type: memory
---
# tmux Session Enumeration

## Multi-Server Model

run-kit connects to **multiple tmux servers**. Server identity is part of the URL path: `/` shows the server list, `/$server` is the per-server shell, `/$server/$window` is the terminal route (there is no `$session` segment). The window identity is the stable `@N` everywhere in code/API; the page URL segment carries only its numeric part (`@N` sans `@`, e.g. `/$server/0`), parse-restored to `@N` (`260703-8mpy-numeric-window-url`). The user navigates between servers by changing the `$server` route parameter (via sidebar, command palette `Server: Switch to <name>`, or direct URL).

The backend is stateless — every API request carries the server identity (`?server={name}` query parameter for REST/SSE/WebSocket; `serverFromRequest(r)` validates and defaults to `"default"` when missing). All tmux operations use `tmuxExecServer(ctx, server, args...)` which prepends `-L {server}` for named servers. The `"default"` server uses no `-L` flag, connecting to the user's standard tmux server. The config flag `-f {path}` is applied to all named servers (not just runkit).

### Per-View Server Scope

While run-kit *as a whole* is multi-server, **any single view (terminal, dashboard, sidebar tree) is scoped to one server** — the one in the URL. Components that derive state from "current server" (sidebar tree, optimistic overlays, SSE polling) read it from the route via `useSessionContext()`. The `optimistic-context` filters ghosts/overlays by `currentServer` so cross-server in-flight mutations don't leak into the wrong view.

Features that span multiple servers (e.g., the boards view) open multiple concurrent connections — one SSE per contributing server, one WebSocket per pinned terminal — and tag each entry with its source server in API responses.

### Server Discovery

`ListServers(ctx)` discovers available tmux servers by scanning the socket directory at `/tmp/tmux-{uid}/`. Each socket file represents a running server. Returns sorted server names — only sockets whose probe succeeds (dead sockets are dropped). The frontend calls `listServers()` at mount and refreshes via SSE-driven invalidation.

The raw scan and the probe are factored into three shared helpers in `internal/tmux/tmux.go` so the `/tmp/tmux-{uid}` convention lives in exactly one place (consumed by both `ListServers` and the reaper — see § rk reaper) (`260529-fww2-rk-reaper-command`):

| Helper | Responsibility |
|--------|----------------|
| `socketDirPath() string` | The single definition of the socket-dir path: `fmt.Sprintf("/tmp/tmux-%d", os.Getuid())`. |
| `ScanSocketDir(ctx) ([]string, error)` | Raw reapable candidate names via `os.ReadDir(socketDirPath())` + `filterSocketEntries`. Does NOT probe — **dead sockets ARE included**. Returns `nil, nil` when the dir is absent/unreadable (no servers running). |
| `filterSocketEntries(entries []os.DirEntry) []string` | Keeps the full reapable candidate set: `os.ModeSocket` entries (live/dead tmux servers) **plus** `*.lock` regular files. tmux `.lock` files are **regular files, not sockets**, so they are matched by name suffix (`LockSocketSuffix = ".lock"`) — a socket-mode-only filter would silently drop them and leave the reaper's `.lock` branch dead in real runs. Directories and non-`.lock` regular files are dropped. Split out so the filter is testable against a temp dir without the hardcoded path (`TestFilterSocketEntries`, which drives a real socket + real `.lock` file). |
| `probeServerAlive(ctx, name) bool` | Liveness probe: `tmux -L <name> list-sessions` via `exec.CommandContext` with a 2s timeout; `true` iff the command succeeds. |

`ListServers` calls `ScanSocketDir`, **skips any `.lock` candidate** (those are never servers — a probe would be a doomed subprocess), then probes each remaining candidate **concurrently** (bounded 10-slot semaphore) via `probeServerAlive`, appends only the live ones, and sorts. It returns only sorted probe-success names and silently drops dead sockets.

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

## Terminal Relay — Direct Attach (no ephemeral)

The relay attaches the PTY **directly** to the session it resolves for the window — there is no per-WebSocket ephemeral grouped session (`260602-qn62-move-based-board-pin-sessions`). Under the link-based pin model a pinned window is a member of BOTH its home session and its pin-session (`260718-co9z-link-based-board-pinning`); the relay's **pin-session-first attach preference** (below) is what keeps a board pane's active-window pointer independent — attaching to the single-window pin-session (whose sole window is permanently active) means merely viewing a pinned window never moves its home session's active-window pointer.

**Transport**: all pane relay streams ride ONE muxed `/ws/terminals` socket per tab (handler `app/backend/api/terminals_ws.go`, sibling of `state_ws.go`) (`260717-803u-relay-mux`). The mux's per-stream `attachStream` does the pick-session → session-scoped select → direct attach → PTY pump. The **session pick** applies a pin-session-first preference (attach the pin-session when it exists, else resolve home — below) (`260718-co9z-link-based-board-pinning`). See `architecture.md` § Terminal Relay for the mux protocol/scheduler and `ui-patterns.md` § Terminal Relay (frontend) for `RelayMux`.

**Per-stream attach flow** (the mux's `attachStream`, per `open` op): `validate.ValidateWindowID` validates the already-JSON-decoded `windowId` (a per-stream `closed` 4004, NOT a socket close, on failure — the shared validator `decodeWindowID` wraps, so REST and mux entry points cannot drift; #205). It then picks the attach session with a **pin-session-first preference** (`260718-co9z-link-based-board-pinning`): it probes `HasSession` on the derivable `PinSessionName(windowID)` FIRST and, when the pin-session exists, attaches there; otherwise `s.tmux.ResolveWindowSession(ctx, server, windowID)` (5s timeout) resolves the window's home (non-pin) session (a missing window yields `closed` 4004). Because a pinned window is LINKED into both its home session and its single-window pin-session, attaching to the pin-session gives the stream an independent current-window pointer and leaves the home session's active-window pointer untouched — merely viewing a pinned window (board pane or direct URL) never moves the home pointer. It then **session-scopes** the select via `s.tmux.SelectWindowInSession(session, windowID, server)` (`select-window -t =<session>:@N`, exact-match session part — `260717-hikh`; NOT a bare `-t @N` — a bare target is ambiguous inside a session group and must agree with the attach; for a pin-session the select is effectively a no-op, its sole window is already active, but the code path stays uniform), then `attach-session -t <session>` via `creack/pty` (initial PTY size rides the open op's cols/rows; attach failure → `closed` 4001). There is no defer-kill — the session is durable and owned by tmux.

**Accepted behavioural tradeoffs** (`260602-qn62`): a home session has a single active-window pointer shared across attachments, so multi-client navigation of an UNPINNED window's home session mutates its active window (two tabs on different windows of one session yank each other; a viewer navigating moves the pointer). A pinned window escapes this — the relay attaches its own single-window pin-session, whose sole window is permanently active, so viewing it is a no-op on the home pointer (the pin-session-first preference above).

**Filter at the chokepoint**: `parseSessions` in `internal/tmux/tmux.go` early-skips `_rk-pin-*` sessions and the `_rk-ctl` anchor. See § Pin Sessions and § parseSessions Filter Chokepoint below.

**Active-window highlight is event-derived per group** (`260530-v6hm-active-window-event-derivation`): the sidebar/URL highlight is derived from tmux control-mode `%session-window-changed` events tracked per session group (two-tier: event-tracked `@wid` authoritative, base `#{window_active}` only as a cold-start/reconnect fallback). The `internal/tmuxctl/*` derivation subsystem is driven by the `_rk-ctl` anchor and serves the SESSIONS highlight independent of boards. The `$sid`→group resolution it relies on does NOT filter `_rk-ctl` (the anchor must resolve to its base group). Design in `architecture.md` § Active-Window Event Derivation.

## Pin Sessions (`_rk-pin-*`) — Link-Based Board Membership

A window pinned to a board is **linked** (`tmux link-window`) into a **single-window session** named `_rk-pin-<windowDigits>`, so it is a member of **BOTH** sessions at once: its home session (visible natively at its real index in the SESSIONS sidebar) AND its pin-session (rendered as a BOARDS pane) (`260718-co9z-link-based-board-pinning`). Dual membership is what keeps the sidebar honest — tmux says the window is home, so the sidebar shows it (Constitution II — derive-from-tmux truth, no ghost-row synthesis) — while the board still derives entirely from `_rk-pin-*` session options. A "board" is **not a tmux session** — it is the *set of pin-sessions sharing an `@rk_board` value*. The pin-session stays single-window (the placeholder is killed after the link) so each board pane attaches to a session whose only window is the pinned one, keeping panes' current-window pointers independent (the same rationale the move model had; the relay's pin-session-first attach is what realizes it — see § Terminal Relay).

**Reserved naming + reversible helpers** (`internal/tmux/tmux.go`): `tmux.PinSessionPrefix = "_rk-pin-"`. The name is derived deterministically from the window's `@N` id by stripping the leading `@` (tmux session names disallow `@`): `PinSessionName("@42") → ("_rk-pin-42", true)`; the inverse `WindowIDFromPinSession("_rk-pin-42") → ("@42", true)`. Both validate via `ValidWindowID`. The pure, reversible mapping means membership needs **no** name→id lookup table. `ListPinSessionNames(ctx, server)` runs `list-sessions -F '#{session_name}'` and returns every `_rk-pin-*` name (nil, no error, when no server runs) — board membership reads flow through it.

**Membership = session-scoped vars on the pin-session** (`internal/tmux/board.go`), read via `show-options -v -t <pinSession> <opt>`:

| Var (constant) | Meaning |
|----------------|---------|
| `@rk_board` (`tmux.BoardOption`) | which board this pinned window belongs to |
| `@rk_home` (`tmux.HomeOption`) | the home session to restore the window to on unpin |
| `@rk_board_order` (`tmux.BoardOrderOption`) | fractional order key within the board (`ComputeOrderKey`) |

`@rk_board` is a per-pin-session SESSION-var key; `ComputeOrderKey` and `nextAppendKey` supply ordering. (`260602-qn62`)

**`Pin(ctx, server, windowID, board)`**: validates `windowID`/`board` (Constitution §I); idempotent — if `_rk-pin-<id>` already exists it is a no-op when the board matches (no re-link, no order-key churn), and **re-stamps `@rk_board`** when it differs (wrong-board re-pin must not silently leave the window on its old board, since the pin-session is the only authoritative place membership lives). Otherwise: resolve the home session via `ResolveWindowSession` (the window has exactly one link at this point, so home is unambiguous); compute the append order key (`nextAppendKey` over the board's existing keys, restricted to this board, computed BEFORE the link); `new-session -d -s _rk-pin-<id>` (starts with a placeholder window); capture the placeholder's `#{window_id}` via `list-windows` (robust to base-index config, not assumed index 0); **STAMP-BEFORE-LINK** the three vars `@rk_home`/`@rk_board`/`@rk_board_order` onto the still-empty pin-session; then `LinkWindowToSession` the target window in; `kill-window` the captured placeholder so the linked window is the session's sole window (a placeholder-kill failure is non-fatal — logged, cosmetic).
- **STAMP-BEFORE-LINK crash safety (load-bearing)**: stamping the vars while the pin-session is still empty (before the window is linked) means there is never a window-linked-but-unstamped state. A stamp failure strands nothing — the window has not been linked yet, so the empty placeholder-only pin-session is simply killed and the window is untouched in home. Once the link succeeds, `@rk_home` is already durably present, so the window can ALWAYS be unpinned; there is no double-fault rollback and no un-unpinnable pin-session. A LINK failure likewise strands nothing (the window stays home, link not move) — the stamped-but-windowless pin-session is killed.
- **`context.Background()` for teardown**: all rollback/teardown `KillSessionCtx` calls are rooted in `context.Background()`, NOT Pin's ctx — Pin's ctx may be at/near its deadline, and a cancelled parent would make the kill a no-op and orphan the session.

**`Unpin(ctx, server, windowID, board)`**: idempotent (missing pin-session → silent success) with the same validation + board-match guard (a wrong-board unpin is a no-op success so the handler's `board-changed` broadcast never names a board the window was not on). Reads `@rk_home`, then branches on whether the window still has a **live non-pin (home) membership** (`resolveHomeSession` — checked directly against live links rather than trusting `@rk_home`, since the window could have been re-homed):
- **Normal path** (a live home link survives): `killPinSessionIfPresent`. Because the window is LINKED into both its pin-session and its home session, and tmux destroys a window only when its LAST link dies, killing the pin-session drops just the pin link — the window survives in home at its EXISTING position (no move-back, no append, no index loss). The has-session guard tolerates an already-gone pin-session (concurrent kill).
- **Last-link recovery** (the pin link is the window's ONLY link — home died while pinned, or a legacy move-based pin that lives only in the pin-session): a plain `kill-session` would DESTROY the window, so instead recover it by the recorded `@rk_home`:
  - `@rk_home` names a session that is **still alive** (a legacy move-based pin whose home outlived the move) → `LinkWindowToSession` the window back into that live home, then kill the pin-session; the fresh home link keeps the window alive and it lands in its REAL home (not a stray `recovered<id>`). A link failure falls back to the recovered-name rename.
  - `@rk_home` names a session that is **gone** → `RenameSession` the single-window pin-session to the home name (recreating the dead home in place, no placeholder), guarded by a `has-session` precheck so it cannot collide; on a raced-into-existence collision, fall back to the recovered-name rename.
  - `@rk_home` is **empty/corrupt** (unreachable for pins created by this build — stamp-before-link guarantees it — but possible for legacy/corrupt pins) → `recoverPinToRenamedSession`.
  In every branch the three membership options are cleared and the window resurfaces in SESSIONS — a window is never left unrecoverable.

**`recoverPinToRenamedSession`** renames the pin-session to `recovered<windowDigits>`, **collision-guarded** by a bounded numeric-suffix probe (`recovered<id>`, then `-2`, `-3`, … via `has-session`, capped at 100 attempts) so a stale prior-recovery session never makes Unpin error and strand the window; then clears the membership options via `clearMembershipOptions`.

**Pinning a home's only window** does not empty the home — the window stays linked there (link, not move), so the home session keeps a member. **Pins are persistent across rk restarts** (durable user intent; tmux survives restarts per Constitution VI) → there is **NO restore-sweep**. **Legacy move-based pins** (created before `260718-co9z`) get NO auto-migration: they present as the last-link case (the window lives only in the pin-session), keep working for board rendering / relay attach / Reorder, and convert to link-based on the next unpin (last-link recovery restores them home) + re-pin.

**`Reorder(ctx, server, windowID, board, newOrderKey)`**: rewrites exactly the target pin-session's `@rk_board_order` var (via `setSessionOption`); errors if the pin-session is absent or its `@rk_board` ≠ `board`. No sibling renumber. The new key is computed server-side by `ReorderBoard` in `router.go` via `lookupNeighbourKeys` + `ComputeOrderKey`.

**Board listing** (all server-scoped — `move-window` can't cross tmux servers): `ListBoardEntries(ctx, server)` enumerates `_rk-pin-*` sessions on one server and derives `[]BoardEntry` via `pinEntry` (a session with no/invalid `@rk_board` is defensively skipped, not an error). `ListBoards(ctx)` iterates `ListServers(ctx)`, groups entries by `@rk_board`, returns an alphabetical `[]BoardSummary` with per-board pin counts. `GetBoard(ctx, name)` filters entries to one board across reachable servers, sorts by order key, with **NO stale write-back** — membership is derived live, so a killed pinned window's session simply disappears from the listing. A board exists only while ≥1 pin-session carries its name (**no empty boards, no name registry**); the last unpin makes the board vanish.

## parseSessions Filter Chokepoint

`parseSessions` in `internal/tmux/tmux.go` is the single chokepoint feeding every user-facing session list — REST `/api/sessions`, SSE `event: sessions`, board derivation, server-aggregate `/api/servers`. It early-skips two name classes:

1. **`_rk-pin-*`** (`strings.HasPrefix(name, PinSessionPrefix)`) — the **pin-session** itself is never a SESSIONS entry (it renders only as a BOARDS pane); a single early-skip here guarantees no pin-session leaks into the SESSIONS UI regardless of future consumers. Under the link-based model the pinned window is ALSO a member of its home session, so it still appears in SESSIONS via that home membership — the skip hides only the `_rk-pin-*` session name, not the window.
2. **`_rk-ctl`** (`name == ControlAnchorSessionName`) — the tmuxctl control-mode anchor.

## `_rk-ctl` Anchor Session (tmuxctl control mode)

`app/backend/internal/tmuxctl/` opens a long-running `tmux -CC` control-mode connection per tmux server (one Client per socket; see `architecture.md` § tmux Control-Mode Subscription for the package-level design). `tmux -CC` requires an attached session to emit notifications, so the Client creates a hidden anchor session named `_rk-ctl`.

The anchor is created **unconditionally on every observed server** — it is a permanent **session floor**, not a fallback: it keeps the session count above zero for the server's lifetime regardless of how many real sessions exist, so tmux's default `exit-empty on` can never reap the whole server when its last real session closes (`260602-a1wo-prevent-exit-empty-server-death`). The floor + `exit-empty off` is also what keeps an empty home session alive after its only window is pinned away — pin-session persistence relies on this backstop. **The floor is decoupled from the control-mode attach target** — see § Anchored Target Form below. (Test/e2e sockets are excluded from the control-mode candidate set entirely by `isTmuxSocketCandidate`→`IsTestServerName` in the supervisor, so no anchor is ever created on a leaked `rk-test-*` socket and the always-create path cannot resurrect them — see `architecture.md` § `IsTestServerName`.)

**Naming convention**: literal name `_rk-ctl`. The leading underscore follows the project's internal-entity convention. The single exported constant `tmux.ControlAnchorSessionName = "_rk-ctl"` lives alongside `tmux.PinSessionPrefix` in `app/backend/internal/tmux/tmux.go` (it is a literal name rather than a prefix because there is exactly one anchor per tmux server). It is the single source of truth for the literal — `tmuxctl.Client` and `parseSessions` reference the constant.

**Keepalive tag**: immediately after `new-session -d`, the Client runs `tmux set-option -t =_rk-ctl @rk_ctl_keepalive 1` (the option name is exported as `tmuxctl.AnchorKeepaliveOption = "@rk_ctl_keepalive"`). The tag is a defensive marker only — v1 has no runtime consumer, but the marker exists so future code can identify the anchor without depending on the literal name. `set-option` is idempotent and safe to re-run when another `rk serve` instance created the anchor first.

**Anchored target form**: the Client invokes `tmux [-L <socket>] -CC attach-session -t =<first-existing-real-session> -r` when at least one real user session exists, else `-t =_rk-ctl -r`. The `=` prefix forces exact-match targeting and prevents prefix-match collisions, consistent with the convention established in PR #196 (daemon detection's `=rk-daemon:=serve`). The `-r` flag puts the connection in **read-only mode** — restricts input only; notifications still emit. Defensive default — future refactors that accidentally wire commands through the control-mode connection cannot mutate tmux state.

**Floor vs. attach target are decoupled** (`260602-a1wo-prevent-exit-empty-server-death`). On every dial `resolveBootstrap` (`client.go`) does two separate things **once the server is confirmed alive** (see § Anchor is join-only below): (1) `createAnchor` + `setAnchorKeepalive` (the floor — R1), then (2) pick the attach target — the first real session if one exists, else `_rk-ctl` (R2). The attach target is the first real name surfaced by `probeAndFirstSession`, which runs `tmux [-L <socket>] list-sessions -F '#{session_name}'` and **skips `_rk-ctl`** so the always-present anchor is never picked when a real session exists (`_rk-ctl` sorts ahead of a lowercase name like `runkit`, so an unskipped listing would wrongly select it and regress the "prefer a real session" contract). Attaching control mode to `_rk-ctl` would also be correct (`%session-window-changed` is global on tmux 3.6a — see [[tmux-control-mode-event-scope]]); preferring a real session is a minimal-diff, zero-event-scope-risk choice, not a correctness requirement.

**Anchor is join-only — never resurrects a killed server** (`260602-poka-guard-anchor-no-resurrect`). `createAnchor`'s `tmux new-session -d -s _rk-ctl` has an implicit side effect: it *starts* a server when none is listening on the socket. Because `resolveBootstrap` is also the reconnect FSM's dial (`productionDial`, ~250ms→5s backoff), an unguarded `createAnchor` would let a UI-initiated `kill-server` lose a race — the server dies, the FSM re-dials ~250ms later, and `createAnchor` recreates the dead server (the new socket file also fires an fsnotify `CREATE` that re-opens a fresh Client — a self-reinforcing resurrection loop). `createAnchor` therefore **only ever joins an already-running server**: `resolveBootstrap` runs a side-effect-free `list-sessions` probe FIRST via `probeAndFirstSession` (which doubles as the first-real-session selector, so net tmux round-trips stay flat at **4**: `SetExitEmptyOff`, the unified probe+first-session, `createAnchor`, `setAnchorKeepalive`). A genuinely dead server — `list-sessions` exit 1 whose stderr matches `no server running` / `failed to connect` / `No such file or directory` (classified by `isServerDeadError` → `matchesServerDeadText`, which delegates to the shared `tmux.IsServerGone` so the three sentinels are defined in exactly one place — `260603-gs2t-reap-dead-tmux-servers-sse`; `internal/tmux`'s `ListKeys`/`KillServer` key off the same three including the socket-file variant, while `board.go`'s `isAbsentOption` keys off only the first two — `no server running` / `failed to connect`) — is declined with the `errServerDead` sentinel **before** `createAnchor` runs. `productionDial` propagates it, the reconnect FSM backs off instead of resurrecting, and the kill sticks. **Constitution VI floor is preserved**: an alive-but-zero-session server (probe exit 0, empty output) still passes and still gets its `_rk-ctl` anchor — only a truly dead server (exit 1) is declined. The probe lives locally in `tmuxctl` (mirroring `internal/tmux.probeServerAlive`'s `exec.CommandContext` + 2s-timeout pattern rather than calling cross-package) because `doc.go` documents `tmuxctl` as the sanctioned self-contained bypass of the `internal/tmux/` boundary, and `probeServerAlive` collapses the dead-vs-empty distinction this guard must surface.

**Concurrent-rk race**: when two `rk serve` instances open a Client against the same fresh tmux server, only one `new-session -d` call succeeds; the loser gets tmux's "duplicate session" error. `tmuxctl.isDuplicateSessionError` treats this as benign and the loser proceeds to attach — multi-rk is supported by construction since `tmux -CC attach` is independent per client.

**Filtering at the chokepoint**: `parseSessions` in `app/backend/internal/tmux/tmux.go` early-skips any line whose `#{session_name}` equals `ControlAnchorSessionName` — parallel to the `_rk-pin-*` pin-session skip (`260602-qn62`). Single chokepoint — every user-facing list (REST `/api/sessions`, SSE `event: sessions`, board derivation, server-aggregate `/api/servers`) flows through `ListSessions`, so the anchor never leaks into the UI.

**Startup ordering**: `cmd/rk/serve.go` orders startup as `EnsureConfig → tmuxctl.Supervisor.Start → server.ListenAndServe` (no sweep step). The `rk reaper` operator command hard-skips `_rk-ctl` (see § rk reaper).

**Lifecycle**: the anchor outlives any single `Client` invocation. `Close()` does not delete it — closing the PTY only ends the subscription; the detached session lives on. This is intentional: subsequent `rk serve` invocations re-attach to the existing anchor rather than re-creating it. The anchor only disappears when the entire tmux server is killed.

**`exit-empty off` backstop** (`260602-a1wo-prevent-exit-empty-server-death`): the anchor floor is the primary guarantee, but it is briefly absent during the close-then-reopen window of a daemon restart/reconnect (the old `-CC` client is gone before the new one runs `createAnchor`). To close that reapable zero-session sliver, run-kit sets `set-option -g exit-empty off` **server-globally** on every socket it dials — imperatively via `tmux.SetExitEmptyOff(ctx, server)` called from `tmuxctl`'s `productionDial` **BEFORE** `resolveBootstrap` runs, on the initial dial **AND** every reconnect of the Client FSM (ordering matters: setting it after the anchor is created would leave the sliver reapable). It is best-effort — a failure logs at Debug and does not abort the dial; on a dead socket the call fails non-fatally and `resolveBootstrap`'s own probe then declines the dead server (see § Anchor is join-only above). The embedded `configs/tmux/default.conf` (build copy `app/backend/build/tmux.conf`) also carries `set -g exit-empty off`, so run-kit-*created* servers get the floor at birth via `-f` before the first dial; the imperative path covers the hand-created/foreign servers the embedded conf never reaches (the exact gap that let `kit` inherit tmux's default `on`).

**Lifetime contract — explicit kill only** (`260602-a1wo-prevent-exit-empty-server-death`): a managed tmux server is torn down **only** via `kill-server` / `rk reaper` (`260529-fww2-rk-reaper-command`). Empty (anchor-only) servers persist by design — this is the deliberate tradeoff that makes accidental `exit-empty` death impossible. run-kit adds no auto-reaping of anchor-only servers and no cross-process refcounting / shared state (Constitution II forbids it — no single `rk serve` can know it is the last one that wants a given server's anchor).

**Why a hidden anchor, not an arbitrary user session**: attaching to a user session would couple the control-mode lifecycle to that session's lifetime — killing the user session would tear down the subscription. A purpose-built anchor decouples the two. `tmux -CC` cannot use `new-session -d` without attach (it requires an attached client to emit notifications), so "no anchor at all" is not an option.

## Window Addressing Identity (`@N`)

A *specific existing window* is addressed by its stable tmux **window ID** (`@N`, tmux's `#{window_id}`), not the mutable window *index* (`260529-chgz-window-id-routing`). A window ID is **server-global and a self-contained `-t` target** — `tmux kill-window -t @5` needs no session prefix — so window-targeting tmux commands pass the windowID directly (no `session:index` target string). The window **index** is retained only for *positional* operations (reorder/move), which are inherently "move to position N" and cannot be expressed by ID. **Sessions are identified by name.**

This identity is consistent across all layers — `@N` is the window identity everywhere in code/API: URL (`/$server/$window`, no `$session` segment; the page URL segment carries only `@N`'s numeric part, sans `@`, parse-restored to `@N` — `260703-8mpy-numeric-window-url`), HTTP API (`/api/windows/{windowId}/...`), the terminals-mux `open` op's `windowId` field (`260717-803u-relay-mux`), tmux targets, and the fab pane-map enrichment join. The window store and the boards feature (`@rk_board` stores `<window_id>:...`) are windowID-keyed. Path params are validated by `validate.ValidateWindowID` (`^@[0-9]+$`) — stricter than `ValidateName`, which permits `@` but not the `@N` shape (constitution §I). Window IDs are never user-typed; they originate from tmux's `#{window_id}`. See `architecture.md` § API Layer and § Terminal Relay, and `ui-patterns.md` § URL Structure.

## Exact-Match Session Targets (`=name:` / `=session:windowSpec`)

**Every `internal/tmux` command that passes a session name as a `-t` target composes it through `tmux.ExactSessionTarget(session) → "=" + session + ":"`** (exported — `internal/riff` consumes it too) (`260717-hikh-exact-tmux-session-targets`). The leading `=` disables tmux's prefix/fnmatch name matching (exact match only); the trailing `:` forces the string to parse as a **session**, never a window name. Session-qualified *window* targets (`swap-window`, `select-window`) compose through the unexported `exactWindowInSession(session, windowSpec) → "=" + session + ":" + windowSpec`, where `windowSpec` is itself unambiguous within the session — a window ID (`@N`) or a numeric index. Both live in `internal/tmux/tmux.go`.

**Why the colon is load-bearing** (the bug this fixed): tmux resolves a bare `-t <session>` **differently per command**. For `list-windows` the `-t` is a *session* target (exact session wins). But for `new-window` and `list-panes` (even under `-s`) the `-t` is a *window* target — tmux matches the bare string against the **window names of the current/attached session BEFORE** trying it as a session name. Because run-kit auto-names **both windows AND sessions** from folder basenames (`automatic-rename-format '#{b:pane_current_path}'`, § Managed Window Creation), a window named like a session is **routine, not exotic** — so a bare name silently hijacks the command. Observed live (server `ext`, 2026-07-17): the attached session `0` had a window named `planner` while a session named `planner` also existed, so `new-window -a -t planner` (a UI "+ New Window" on session `planner`) created its window **in session `0`**, and `list-panes -s -t planner` returned **session 0's panes** (smoking gun: the same pane id `%0` appearing twice in one `/api/sessions` response). `=planner:` makes both resolve to the real session `planner` unambiguously.

**Safety**: session names are validated to contain no `:`/`.` (`validate.ValidateName`) and cannot start with `=` in practice, so the composition is injection-safe; `_rk-pin-<digits>` pin-session names and the `_rk-ctl` anchor are equally safe to wrap. Empirically verified against every touched command shape including **numeric** session names (`=0:`) and pin-session names.

**Call sites using the exact forms**: `ListWindows` (both the `list-windows -t` read AND the `list-panes -s -t` read), `buildCreateWindowArgs` / `CreateWindowWithOptions` (the `new-window -a -t` misroute vector), `KillSessionCtx`, `RenameSession`, `SetSessionColor` / `UnsetSessionColor` (`@session_color`), `MoveWindow` (its `list-windows` read, the `swap-window` src/dst chain via `exactWindowInSession(session, index)`, and the active-window-restore `select-window` via `exactWindowInSession(session, @id)`), `MoveWindowToSession` (dst `=session:`), `SelectWindowInSession` (`=session:@id`), and `board.go`'s `showSessionOption` / `setSessionOption`, all five `has-session` probes (`Pin`, `Unpin`, `killPinSessionIfPresent`, `Reorder`), the pin-session placeholder `list-windows`, and the recovery-path `set-option -u` calls. **`daemon` and `tmuxctl` carry their own `=` discipline** (e.g. the anchor's `=_rk-ctl` / daemon detection's `=rk-daemon:=serve` per § `_rk-ctl` Anchor Session); `internal/tmux` and `internal/riff` are the `ExactSessionTarget` consumers.

**Rule for new code**: any new code path that passes a session name to tmux MUST use `ExactSessionTarget` (or `exactWindowInSession` for session-qualified window targets). Extending the `=` hygiene to *session*-target commands too (`kill`/`rename`/`has-session`/options — not only the two proven *window*-target offenders) is defensive: it is behavior-identical when the named session exists (the exact match already wins there) and prevents prefix/fnmatch misroutes when it does not. `TestExactSessionTarget` unit-pins the `=name:` form (numeric and pin-session names included); `TestSessionWindowNameCollision` (real-tmux integration) reproduces the session/window name collision and asserts both the create routing and pane-join isolation.

**riff alignment**: `internal/riff`'s daemon-path spawn targets go through the same exact forms — it now imports `rk/internal/tmux` (no import cycle; `tmux` imports only `validate`/stdlib). `sessionTarget(spec)` returns `tmux.ExactSessionTarget(spec.Session)` on the daemon path (the same `new-window -t` misroute vector `CreateWindow` guards against), `windowTarget(spec, name)` returns `=session:name` (the window-name part stays **non-exact** — riff uniquifies window names within the session pre-spawn, so the cross-session hazard is only the session part), and the `listWindowNames` collision probe targets `=session:`. The CLI path (empty `spec.Session`) is byte-identical to before (unscoped `""`/bare `name`). See [rk-riff](/run-kit/rk-riff.md) § Server + Session Targeting Seam.

### Pane join keyed by window id (not index)

The `ListWindows` pane join is keyed by the **stable window ID**, not the window index (`260717-hikh`). `paneFormat` field 0 emits `#{window_id}`; `parsePanes` returns `map[string][]PaneInfo` keyed by window id, with a `ValidWindowID` guard dropping malformed first fields (non-`@N` lines are silently skipped — `TestParsePanes` covers this); `ListWindows` attaches `byWindow[w.WindowID]`. The panes come from a **separate** `list-panes` call than the windows (`list-windows`) they are joined to, so an index join would silently glue the wrong session's panes onto a window whenever the two calls' targets diverge (the bare-name collision above) or a concurrent reorder shifts indices between the calls. A window-id join can only attach a pane to the window that actually owns it — so a residual divergence degrades to a **visibly-empty pane list** instead of another session's cwd/branch/agent-state (silent data corruption — the live `ext` symptom).

## Impact on Other Operations

All tmux functions accept a `server string` parameter:

- `ListSessions(server)` — queries only the specified server
- `ListWindows(session, server)` — lists windows for a session on the specified server
- `SelectWindow(windowID, server)` — selects a window on the specified server by its stable window ID via a bare `select-window -t @N` (`@N` is a self-contained `-t` target; no session:index string — `260529-chgz-window-id-routing`). Has **no production callers** (still on the `TmuxOps` interface): both the terminals mux and the REST `/select` handler use the session-scoped `SelectWindowInSession` — a bare `-t @N` is ambiguous inside session groups
- `SelectWindowInSession(session, windowID, server)` — session-scoped select (`select-window -t =<session>:@N` via `exactWindowInSession`; the session part is exact-match — `260717-hikh`, see § Exact-Match Session Targets). Two production callers: the REST `/select` handler resolves the owning (home, non-pin) session via `ResolveWindowSession` then calls this, and the terminals-mux per-stream `attachStream` scopes the select to whichever session it will attach — the pin-session when the window is pinned (a no-op in effect, its sole window is already active) else the resolved home session (`api/terminals_ws.go` — pick-session → scoped select → direct attach)
- `ResolveWindowSession(ctx, server, windowID)` — returns the window's **HOME (non-pin) session** name for a window ID. Fast path is the targeted O(1) `display-message -t <windowID> -p '#{session_name}'` lookup (`260609-enic-restore-display-message-resolve-window`); under dual membership a pinned window is a member of two sessions and `display-message` may report EITHER link (tmux's pick across links is order-unspecified), so **when the naive result carries `PinSessionPrefix` this re-resolves deterministically to the non-pin owner** via `resolveHomeSession` (a `list-windows -a -F "#{session_name}\t#{window_id}"` enumeration that picks the session for `@N` that is not a `_rk-pin-*` name) (`260718-co9z-link-based-board-pinning`). A window whose ONLY link is its pin-session (home died while pinned, or a legacy move-based pin) **legitimately resolves to the pin-session**. The relay layers its own pin-session-first attach preference ABOVE this (§ Terminal Relay); this function's job is to name the home session for callers that need it. Used by `Pin` (to remember the home — pre-link, one link, unambiguous), the REST `/select` handler, `ProjectRoot`, and the terminals-mux per-stream attach fall-through when the window is NOT pinned (on the 5s open-time budget). A tmux non-zero exit whose stderr names a missing window, or an empty result, both mean "window not found" (`window %q not found`) — the stream emits a `closed` 4004 (a per-stream event; the socket stays open); genuine operational errors (dead server, deadline) propagate unchanged so callers distinguish "window gone" from "tmux unavailable". See [[resolve-window-session-on-relay-connect]] for a prior regression this path restored
- `ListPinSessionNames(ctx, server)` — returns every `_rk-pin-*` session name via `list-sessions -F '#{session_name}'`; board-membership reads (`ListBoardEntries`) flow through it. Returns nil (no error) when no server runs. It is the only "raw session-name listing" helper, scoped to pin-sessions, not a general escape hatch
- `CreateSession(name, cwd, server)` — creates sessions on the specified server
- `CreateWindow(session, name, cwd, server)` — creates a session-scoped window; argv built by the pure `buildCreateWindowArgs(session, name, cwd)` — omits `-n` when `name == ""` (tmux auto-names to the folder basename via `automatic-rename-format`), includes `-n <name>` otherwise (pinned). No follow-up rename. See § Managed Window Creation (`260707-j66b-unnamed-windows-autoname-folder`)
- `ReloadConfig(server)` — hot-reloads config via `source-file` on the specified server
- `KillSession(session, server)` — kills the named session on the specified server (thin `context.Background()` wrapper around `KillSessionCtx`)
- `KillSessionCtx(ctx, server, session)` — ctx-accepting variant; `Pin`'s rollback/teardown passes `context.Background()` so the kill survives a near-deadline Pin ctx (an expired parent would make the kill a no-op and orphan the session)
- `SendKeys(windowID, keys, server)` — sends keys to the window identified by `windowID` on the specified server. **Window-targeted**; chat-send uses the PANE-targeted primitives below instead (a window `-t` target routes to the session's active pane, which in a split may not be the agent pane; `SendKeys` also appends an unconditional trailing `Enter` and interprets its argument as key names)
- **Pane-targeted chat-send primitives** (`260714-jdyg-chat-send`) — the injection path for `POST /api/windows/{windowId}/chat/send` (see [chat](chat.md) § Send Path + `architecture.md` chat/send endpoint row). Each targets the resolved **pane** (`%N`), not a window, and is a `*Ctx` variant bounded by the **caller's** context — the handler threads ONE shared deadline (`chatSendTotalBudget` ≈ 4s) through the whole sequence rather than granting each its own 10s timeout, so the route stays under the code-review 5s rule. All are argv slices (Constitution §I), surfaced on `api/router.go`'s `TmuxOps` (prod + mock) as `SetChatSendBuffer`/`PasteChatSendBuffer`/`SendEnterToPane` for handler testability:
  - `ChatSendBuffer = "rk-chat-send"` — the **named** tmux paste buffer (const). Named, not the anonymous top-of-stack, so loading a chat message never clobbers the user's buffer stack; the paste's `-d` deletes it afterwards.
  - `SetChatSendBufferCtx(ctx, text, server)` — `set-buffer -b rk-chat-send -- <text>`. Text is a DISCRETE argv element (no shell string, no stdin — `tmuxExecServer` has no stdin plumbing, so `set-buffer <text>` beats `load-buffer -`), stored verbatim incl. newlines / tmux key names / special chars. **The `--` option terminator is load-bearing**: without it a message that itself starts with a dash (e.g. `--force is broken`) is parsed as `set-buffer` flags and hard-fails (500); with `--`, leading-dash text stores verbatim (verified tmux 3.6a — `TestSetChatSendBuffer_LeadingDash`).
  - `PasteChatSendBufferCtx(ctx, paneID, server)` — `paste-buffer -d -p -b rk-chat-send -t <paneID>`. `-p` requests **bracketed paste** (the Claude Code TUI enables it, so a multiline / special-character message lands as one literal block with no per-line submission); `-d` deletes the buffer after pasting. The set→paste pair is the critical section serialized by a global mutex in the handler (the named buffer is a single server-wide resource; see [chat](chat.md) § Send Path).
  - `SendEnterToPaneCtx(ctx, paneID, server)` — `send-keys -t <paneID> Enter` (a single literal `Enter` to the PANE). Sent by the send handler ONLY after the novelty echo probe confirms the paste reached the live input buffer — never blindly.
  - `CapturePaneCtx(ctx, paneID, lines, server)` — the existing pane-capture helper (also surfaced on `TmuxOps` as `CapturePane`), reused by the send handler's baseline + probe captures. Not new to this change (already used by tile previews).
- `MoveWindow(windowID, dstIndex, server)` — reorders a window within its own session. Source addressed by stable `windowID`; destination remains positional. Resolves the source's current index from the ID exactly once (via `resolveWindowSessionIndex`, a bare-`@N` `display-message -t <windowID> -p '#{session_name}\t#{window_index}'` lookup), then emits the full adjacent-`swap-window` bubble sequence as a **single `\;`-chained tmux invocation** rather than one subprocess per step — so no other mutation can interleave mid-reorder (insert-before semantics) (`260529-jad6`). tmux preserves the window's ID across the swaps. **Active-window preservation** (`260714-6pe6-preserve-active-window-reorder`): tmux pins the session's active window to its *index slot* during `swap-window`, so without an explicit restore a DIFFERENT window ends up in the active slot after the shuffle (moving `w3` to index 0 in `[w0, w1*, w2, w3]` would leave `w0` active). `MoveWindow` therefore **captures the pre-shuffle active window ID** from the *same* `list-windows` call it already runs — the `-F` format is `#{window_index}\t#{window_active}\t#{window_id}`, so the active-window ID rides the existing subprocess (**no extra tmux call**) — and appends a final session-qualified `select-window -t =<session>:<activeWindowID>` (composed via `exactWindowInSession` — exact-match session part, `260717-hikh`; the `swap-window` src/dst indices in the same chain likewise compose through `exactWindowInSession(session, index)`) to the SAME `\;`-chained invocation as the swaps. The restore is atomic with the swaps (no SSE poll or concurrent mutation observes the intermediate active-window state), keeping the session's active window **invariant** across within-session reorders — sidebar drag-reorder and the palette `Window: Move Up/Down` actions all share the `moveWindow` API and must not yank the user's viewed terminal to a wrong window. The restore is appended **only on the swap-executing path** — the `srcIndex == dstIndex` and `srcPos == endPos` early returns perform no swaps and emit nothing; the active-window capture is a pure parse of the already-fetched output. Restoring by stable ID (not index) also covers the edge where the dragged window is itself the active one — `select-window -t =<session>:@N` restores it wherever it landed. The target is **session-qualified** (exact-match session part, `260717-hikh`), not a bare `@N`, because a bare window-id select is ambiguous inside a session group (see `SelectWindowInSession` above). **Scoping caveat**: the session-qualified restore scopes to *the same session as the swaps*, but that session is whichever group member the bare-`@N` `resolveWindowSessionIndex` lookup resolves to — `MoveWindow` commits BOTH its swaps and its restore to that one resolved member and has no caller-supplied session. Cross-member disambiguation (preserving a *specific* named member's active window regardless of which member the id resolves to) would require changing the shared `resolveWindowSessionIndex` helper; empirically (tmux 3.6a, isolated socket) the bare-`@N` and session-qualified restores are equivalent *within* the resolved member, so the qualification is a minimal defensive fix, not a full group-safety guarantee
- `MoveWindowToSession(windowID, dstSession, server)` — moves a window from its current session to another on the specified server via `tmux move-window -s {windowID} -t =<dstSession>:` (window-ID source, exact-match session destination via `ExactSessionTarget` — `260717-hikh`). Destination index is auto-assigned by tmux; the window's ID is preserved (tmux contract). Live caller: `POST /api/windows/{windowId}/move-to-session`. The board layer does not use it (Pin/Unpin are link-based — `260718-co9z`)
- `LinkWindowToSession(windowID, dstSession, server)` — **links** a window INTO another session via `tmux link-window -s <windowID> -t =<dstSession>:` (exact-match destination via `ExactSessionTarget`), leaving it a member of its original session(s) too (`260718-co9z-link-based-board-pinning`). Mirrors `MoveWindowToSession` (window-ID source, session destination, `withTimeout` + explicit argv, Constitution §I) but does NOT remove the window from its source — tmux destroys a window only when its LAST link dies. The window's ID is preserved (tmux contract). Two callers, both in `board.go`: `Pin` (link the target into its pin-session, keeping it home too) and `Unpin`'s last-link recovery (link a homeless window back into its still-live recorded `@rk_home` before killing the pin-session)
- `resolveHomeSession(ctx, server, windowID)` (unexported, `tmux.go`) — enumerates every session the window is linked into (`list-windows -a -F "#{session_name}\t#{window_id}"`) and returns the first non-`_rk-pin-*` session; `ok=false` when the window is linked ONLY into pin-session(s) (no live home). Read-only. Backs `ResolveWindowSession`'s pin→home re-resolve and `Unpin`'s live-home-membership branch

## API Server Parameter

All API endpoints accept `?server=` query parameter via `serverFromRequest(r)` helper. The helper validates the server name using `validate.ValidateName` and defaults to `"default"` on invalid/missing input. The SSE hub polls per-server — only servers with active SSE clients are polled.

Server management endpoints:
- `GET /api/servers` — lists available servers via socket directory scan
- `POST /api/servers` — creates a server (starts session "0" in $HOME)
- `POST /api/servers/kill` — kills a server via `tmux kill-server`

### SSE Poll-Set Lifecycle — Connect to Reap (`api/sse.go`)

A server enters the poll set exactly once — when a browser subscribes to it: a `subscribe kind:"server"` frame on the `/ws/state` **state socket** (`stateSubscribe` → `addClient`) (`260716-qf3j-state-socket`). `addClient` adds the server to `h.clients` and re-spawns the poll goroutine if it had exited (the `!h.polling` guard). The hub's per-tick work-list is the snapshot of `h.clients` keys. A server leaves the poll set via **two** paths (`260603-gs2t-reap-dead-tmux-servers-sse`):

1. **Last-client-disconnect** — `removeClient` deletes the server from `h.clients` when its final subscriber drops (an `unsubscribe` frame, or the whole state-socket connection closing → `dropStateConn`); the next tick observing zero clients lets the goroutine stop.
2. **Dead-server reap** — when `FetchSessions` returns an error matching `tmux.IsServerGone`, the server is reaped even while clients are still connected. Killing a tmux server does NOT disconnect the browser's socket, so without this reap the dead socket would linger in `h.clients` and every ~2.5s tick re-shell `tmux -L <name> list-sessions` against the gone socket, logging a `slog.Warn("SSE poll error")` drumbeat forever (the `utils`/runaway-polling incident).

**Reap mechanics**: `sseHub.poll` collects gone servers into a **loop-local `deadServers` slice** during the per-server iteration — the fetch-error branch splits on `tmux.IsServerGone(err)`: a gone error logs at **Info** (`"SSE: tmux server gone, reaping from poll set"`) and appends to `deadServers`; a non-gone error logs `slog.Warn("SSE poll error", ...)` and is **not** reaped. Both `continue`. After the per-server loop completes (before the metrics broadcast), a single `h.mu.Lock()` block emits one **`gone` frame to each dead server's currently-registered clients**, then deletes the server from **every** per-server map so no stale state leaks into a later re-registration: `h.clients`, `h.cache`, `h.previousJSON`, `h.previousRealSessions`, `h.orderBootstrapAttempts`, `h.previousOrderJSON`, plus the loop-local `perServerGen` and `eventDrivenServers` maps. **The gone signal rides the state socket in-band** (`260716-qf3j-state-socket`): the reap fans a `hubEvent{gone: true, key: server}` (rendered as `{"op":"gone","kind":"server","key":"<server>","reason":"server-exited"}`).

**Concurrency contract** (load-bearing): the work-list is snapshotted under `RLock`, dead servers are collected into the loop-local slice *during* iteration, and all deletes happen *after* iteration under one write lock — never deleting from a map mid-range over its snapshot, never holding the write lock across `FetchSessions`. **Re-registration is free**: when the last client for a server is reaped, the next tick sees zero clients and the goroutine exits; a later `addClient` (e.g. the user restarts the server and navigates back — or a state-socket `subscribe` after the frontend's `onGone` releases and re-desires it) re-adds it and re-spawns the goroutine. The frontend reaction to `gone` is in `ui-patterns.md` § Server-Gone Reap (in-band `gone` event + connection-loss fallback) and `architecture.md` § State Socket (`onGone` releases the subscription's ref-count).

**Shared dead-server sentinel** (`tmux.IsServerGone`): the dead-server detection used by the reap is the **single** exported sentinel helper `tmux.IsServerGone(err error) bool` in `internal/tmux/tmux.go`, backed by the unexported `serverGoneText` slice (`"no server running"`, `"failed to connect"`, `"No such file or directory"`) via the string-accepting inner `containsServerGoneText`. This is the one definition of the bare dead-server sentinel set, shared across the `tmux` and `tmuxctl` layers (Constitution III): `tmuxctl.matchesServerDeadText` (used by `isServerDeadError`/`resolveBootstrap` — see § Anchor is join-only) delegates to `tmux.IsServerGone(errors.New(s))`. Note the *narrower* "absent-option-OR-dead" checks elsewhere in the `tmux` package (`ListKeys`/`KillServer`, `board.go`'s `isAbsentOption`) intentionally pair these phrasings with `"invalid option"`/`"unknown option"` and are a distinct set — out of scope for `IsServerGone`.

## Server-Scoped User Options

tmux distinguishes window-scoped (`-w`) options, server-scoped (`-s`) options, **pane-scoped (`-p`) options** (`260705-dmex-generic-agent-state-tier`), and session-scoped user options (the default — `set-option -t <session>`). We use all four: window-scoped for per-window state (`@color`, `@rk_type`, `@rk_url`), server-scoped for state belonging to the tmux server as a whole (`@rk_session_order`, `@rk_server_rank`), **pane-scoped for per-pane agent lifecycle state (`@rk_agent_state`)**, and session-scoped on `_rk-pin-*` pin-sessions for board membership (`@rk_board`/`@rk_home`/`@rk_board_order`, `260602-qn62`) and on `_rk-ctl` for the control-mode keepalive marker.

| Option | Scope | Set via | Read via | Owner |
|--------|-------|---------|----------|-------|
| `@color` | window (`-w`) | `tmux.SetWindowOptions` (via `POST /options`) | `ListWindows` format string field 8 | per-window |
| `@rk_type` | window (`-w`) | `CreateWindowWithOptions`, `tmux.SetWindowOptions` (both via `appendOptionOps`) | `ListWindows` format string field 9 | per-window (iframe) |
| `@rk_url` | window (`-w`) | `CreateWindowWithOptions`, `tmux.SetWindowOptions` (both via `appendOptionOps`) | `ListWindows` format string field 10 | per-window (iframe) |
| `@rk_session_order` | server (`-s`) | `tmux.SetSessionOrder(ctx, server, order)` | `tmux.GetSessionOrder(ctx, server)` | sidebar reorder |
| `@rk_server_rank` | server (`-s`) | `tmux.SetServerRank(ctx, server, rank)` | `tmux.GetServerRank(ctx, server)` | server-tile display rank (`260705-bpnr-server-tiles-drag-reorder`) |
| `@rk_agent_state` | **pane (`-p`)** | agent-harness hooks installed by `rk agent-setup` — plain `set-option -pt "$TMUX_PANE"` at hook-fire time, NO rk/server dependency (`260705-dmex-generic-agent-state-tier`) | `paneFormat` field 6 → `parsePanes` (→ `PaneInfo.AgentState`/`AgentStateEpoch`) | generic agent-lifecycle state (`active|waiting|idle:epoch`; const `tmux.AgentStateOption`). See [agent-state](agent-state.md) |
| `@rk_board` | session-scoped on each `_rk-pin-*` (set via `set-option -t <pinSession>`) | `tmux.Pin` / `tmux.Reorder` (re-stamp on wrong-board re-pin) | `tmux.ListBoardEntries(ctx, server)` (per-pin `show-options -v`) | board membership (which board; const `tmux.BoardOption`) |
| `@rk_home` | session-scoped on each `_rk-pin-*` | `tmux.Pin` (STAMP-BEFORE-LINK at pin time) | `tmux.Unpin` (last-link recovery target only) | board pin recovery-to-home when the pin link is the window's last link (const `tmux.HomeOption`) |
| `@rk_board_order` | session-scoped on each `_rk-pin-*` | `tmux.Pin` (append key) / `tmux.Reorder` | `tmux.ListBoardEntries` / `tmux.GetBoard` (sort) | board pin fractional order (const `tmux.BoardOrderOption`; via `ComputeOrderKey`) |
| `@rk_ctl_keepalive` | session-scoped on `_rk-ctl` (set via `set-option -t =_rk-ctl`) | `tmuxctl.Client.setAnchorKeepalive` | (no runtime consumer; defensive marker) | tmuxctl control-mode anchor |

`@rk_session_order` stores a JSON-encoded array of session names defining the user-preferred sidebar render order. Because the value is server-scoped, it is shared by every client connected to the same tmux server — laptop and phone hitting the same `tmux -L runkit` see the same order. Lifetime matches the tmux server (lost on server kill, NOT on rk-go restart per Constitution VI). Both wrapper functions wrap their context with `context.WithTimeout(ctx, TmuxTimeout)` (10s) and route through `tmuxExecRawServer` (which captures stderr in error messages so callers can pattern-match "invalid option" / "no server running" to distinguish operational empty-state from real failures).

The HTTP endpoints `GET /api/sessions/order` and `POST /api/sessions/order` (POST per §IX; see `architecture.md` § Endpoints) layer over these wrappers. The mutating POST triggers a synchronous SSE broadcast (`event: session-order`) so all connected clients on that server reorder live; the SSE hub also bootstraps the cache once per server on first poll so the order survives an rk-go restart that left tmux running.

`@rk_server_rank` (const `tmux.ServerRankOption`; `260705-bpnr-server-tiles-drag-reorder`) stores this tmux server's user-defined **display rank** — a single ascending integer — among the other tmux servers. It follows the SAME server-scoped mechanism as `@rk_session_order` (`set-option -s` write / `show-option -sv` read via `tmuxExecRawServer` under `context.WithTimeout(ctx, TmuxTimeout)` (10s)) and the SAME error taxonomy: `GetServerRank(ctx, server)` returns `(nil, nil)` for the unset / dead-socket cases (stderr `invalid option`/`unknown option`, OR `tmux.IsServerGone` — the shared dead-server sentinel, covering `no server running`/`failed to connect`/`No such file or directory`), so a fresh or unranked server is a normal state, never an error; only a genuine subprocess failure OR a malformed (non-integer) stored value propagates as a wrapped `fmt.Errorf`. `SetServerRank(ctx, server, rank)` writes `strconv.Itoa(rank)`. **Rank data rides each server**, so a killed server takes only its own rank — there is no cross-server merge rule and no single "canonical" server holding the whole list (contrast `@rk_session_order`, which is one JSON array on the server it orders). The order is *written* by `POST /api/servers/order` (rank `i` → the i-th listed server, best-effort) and *read back* onto each `serverInfo.rank` in the `GET /api/servers` fan-out; display ordering is composed frontend-side (see `architecture.md` § `/api/servers` rank + order endpoint and `ui-patterns.md` § Server-tile drag reorder).

### `@rk_board` — Board Membership (pin-session SESSION var)

`@rk_board` is a **session-scoped var on each `_rk-pin-*` pin-session** holding just the board name (`260602-qn62-move-based-board-pin-sessions`). Board membership is derived entirely from the set of pin-sessions and their vars — a **board is the set of pin-sessions sharing an `@rk_board` value**. There is no `@rk_boards` registry; **empty boards cannot exist** (a board appears when its first pin is created and vanishes when its last pin is unpinned). Boards are **server-scoped** — `link-window`/`move-window` can't cross tmux servers, so a pin-session always lives on its window's server; the board *list* is summarized across reachable servers but no cross-server window union exists. The `BoardOption` constant is the `@rk_board` SESSION-var key.

**Validators**: board name `^[A-Za-z0-9_-]{1,32}$` (`ValidBoardName`), window id `^@\d+$` (`ValidWindowID`), order key `^[a-z]{1,16}$` (`ValidOrderKey`).

**The board API surface** (`internal/tmux/board.go`):

| Function | Purpose |
|----------|---------|
| `pinEntry(ctx, server, pinSession)` | derive one `BoardEntry` by reading the pin-session's `@rk_board`/`@rk_board_order` vars; a session with no/invalid `@rk_board` is defensively skipped (`ok=false`, no error) |
| `ListBoardEntries(ctx, server)` | per-server entries from `ListPinSessionNames` → `pinEntry` (no-server/absent-option ⇒ `([]BoardEntry{}, nil)`) |
| `ListBoards(ctx)` | iterate `ListServers`, group by `@rk_board`, alphabetical `[]BoardSummary` with per-board pin counts |
| `GetBoard(ctx, name)` | entries for one board across reachable servers, sorted by `OrderKey`, **no write-back** (membership is live; killed pins just disappear) |
| `Pin(ctx, server, windowID, board)` | STAMP-BEFORE-LINK 3 vars then `link-window` into `_rk-pin-<id>` (window stays in home too) + kill placeholder; idempotent (re-stamp `@rk_board` on wrong-board re-pin); rollback rooted in `context.Background()` (see § Pin Sessions) |
| `Unpin(ctx, server, windowID, board)` | board-match guard, then normal path = `kill-session` the pin-session (window survives in home via its home link); last-link recovery when the pin link is the only link (link into a live `@rk_home` / recreate a dead home via rename-session / collision-guarded `recovered<id>`); idempotent on missing pin-session (see § Pin Sessions) |
| `Reorder(ctx, server, windowID, board, newOrderKey)` | rewrite only that pin-session's `@rk_board_order`; errors if absent or `@rk_board` ≠ board |
| `ComputeOrderKey(before, after)` | fractional indexing helper (**retained**) |
| `nextAppendKey(entries)` | append key strictly greater than the max existing key, via `ComputeOrderKey` (**retained**, thin wrapper) |

Reads route through `tmuxExecRawServer` + `context.WithTimeout(ctx, TmuxTimeout)`; `isAbsentOption` treats `invalid option`/`unknown option`/`no server running`/`failed to connect` as the empty case (mirrors `GetSessionOrder`). A pin-session whose var read fails is logged via `slog.Warn` and skipped — well-formed entries still return.

**Lexicographic / fractional order keys** (`ComputeOrderKey`, pure Go): returns a string strictly between `before` and `after` lexicographically; an empty neighbour means prepend/append. Examples: `(null,"b")→"a"`, `("c",null)→"d"`, `("b","c")→"bm"`, `("b","bm")→"bg"`. `initialAppendKey = "m"` is the first key on an empty board (midpoint letter leaves prepend headroom — there is no key `< "a"`). Inserts MUST NOT renumber siblings — a reorder rewrites exactly one `@rk_board_order` var. **The key is stored per pin-session** in `@rk_board_order`.

**No eager/lazy cleanup, no bootstrap**: there is no SSE poll-tick window-kill diff and no `RemoveAllByWindowID` consumer — a killed pinned window's pin-session simply drops out of the next `ListBoardEntries` read, picked up by the frontend's refetch on the next session-list change. There is no `@rk_board` first-poll bootstrap broadcast. Membership changes surface only via the explicit pin/unpin/reorder `board-changed` SSE events (see § SSE Board Events below and `architecture.md` § Boards Feature).

**SSE event** — `event: board-changed` rides the per-server SSE stream. Payload `{"board":"main","change":"pin"|"unpin"|"reorder","server":"runkit","windowId":"@1234","orderKey":"bm"}` (`orderKey` `omitempty`). Each pin/unpin/reorder handler emits its own event. See `architecture.md` § Boards Feature.

**Window ID stability across `link-window`/`move-window`** — pins rely on tmux's documented contract that both `link-window` and `move-window` preserve `#{window_id}` (`@N`). This is load-bearing for the link-based pin model: Pin (`link-window` into the pin-session) keeps the window's `@N` stable — the same id is a member of both sessions — so the URL/selection that addresses it by ID works on either surface, and `WindowIDFromPinSession` recovers the same id from the pin-session name. Unpin's normal path kills the pin-session (no window move at all; the window keeps its `@N` in home), and its last-link recovery either `link-window`s the window back into a live home or `rename-session`s the pin-session, both `@N`-preserving. `MoveWindow` (reorder via adjacent `swap-window`) and `MoveWindowToSession` (`move-window -s <windowID> -t =<dstSession>:`, exact-match dst — `260717-hikh`) likewise preserve `@N`. This same ID-stability contract is what makes `MoveWindow`'s active-window restore correct (`260714-6pe6-preserve-active-window-reorder`): the pre-shuffle active window ID stays valid across the swaps, so the final chained `select-window -t =<session>:<activeWindowID>` re-selects the right window wherever it landed — including the edge where the active window is the one being dragged (see § Impact on Other Operations → `MoveWindow`).

## Frontend Server Routing Contract

Every API client function in `app/frontend/src/api/client.ts` that hits a server-scoped endpoint takes `server: string` as its **first positional argument** and forwards it to `withServer(url, server)` to build `?server=<server>`. There is **no module-level `_getServer` global, no `setServerGetter` export, and no ambient state** — `server` is always passed explicitly per call. This mirrors the backend `tmuxExecServer(ctx, server, args...)` shape so the routing parameter is visible in every signature on both sides of the wire.

Functions that take `server` (read + mutation):

| Category | Functions |
|----------|-----------|
| Read | `getSessions`, `getKeybindings`, `getSessionOrder` |
| Session mutation | `createSession`, `renameSession`, `killSession`, `setSessionOrder` |
| Window mutation | `createWindow` (session-scoped), `renameWindow`, `killWindow`, `moveWindow`, `moveWindowToSession`, `selectWindow`, `splitWindow`, `closePane` (all but `createWindow` take `windowId: string` as the 2nd positional arg and hit `/api/windows/{windowId}/...` — `260529-chgz-window-id-routing`) |
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

Neither muxed socket carries `?server=` in its URL — `/ws/state` names servers in-band via `subscribe` ops, and `/ws/terminals` carries the server in each `open` op (`260716-qf3j` state socket, `260717-803u` terminals mux) — so the same "server is explicit, never ambient" property holds on the in-band control frame rather than the URL query.

### Why the explicit server contract exists (closure-race fix)

An ambient module-level getter (`let _getServer = () => "runkit"` installed once via `setServerGetter(() => serverRef.current)`) would dereference the current server at fetch time, so any switch of the server between user intent (open dialog, type new name) and fetch dispatch (Enter pressed) silently retargets the mutation at the **new** server. Reproducer: open rename for `foo` on server-A → Cmd+K → switch to server-B → return → Enter — the rename runs against server-B, hitting either the wrong `foo` or an error while the optimistic overlay still draws the rename on server-A until SSE reconciles. This is why there is no ambient getter.

With `server` threaded explicitly, the captured server is fixed at the moment the React handler runs (see `ui-patterns.md` → "Optimistic UI & Mutation Feedback" → "Server Capture Convention" for the React idiom). The single source of truth for `server` is `useSessionContext()`; callers read it inside their event handler and pass it as the first arg.

### Verifying the contract

A single grep enforces the invariant — the symbols `_getServer` and `setServerGetter` MUST NOT exist anywhere under `app/frontend/src/`. The `useDialogState` regression test (`app/frontend/src/hooks/use-dialog-state.test.tsx`) flips `SessionProvider`'s `server` prop between `openRenameSessionDialog("foo")` and `handleRenameSession()` and asserts `renameSession` was called with the post-flip server (`"server-B"`) and never with the pre-flip server.

Window cross-session move endpoint:
- `POST /api/windows/{windowId}/move-to-session` — moves a window to another session. `{windowId}` validated via `validate.ValidateWindowID`. Request body: `{ "targetSession": "string" }`. Validates the window ID and target session name. Returns `200 { "ok": true }` on success. Handler in `api/windows.go`, `MoveWindowToSession(windowID, dstSession, server)` method on the `TmuxOps` interface in `router.go`. (`260529-chgz-window-id-routing`)

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

`rk riff`'s bare `new-window` carries no active-window-highlight logic of its own: when it lands on a server run-kit observes, the resulting `%session-window-changed` is what drives the sidebar/URL to follow the new window (event-derived highlight — see § Terminal Relay → Active-window highlight). The derivation path is creator-agnostic, so `rk riff`, `wt open`, and raw external `new-window` all update the highlight correctly without any creator-local change (`260530-v6hm-active-window-event-derivation`).

## Managed Window Creation — Name-Optional `CreateWindow` + Folder Auto-Naming

A managed window (the plain sidebar/palette/board `+ New Window` paths — NOT `rk riff`, NOT iframe windows) is created **without a name**, so tmux auto-names it to its folder basename and live-updates that name as the pane `cd`s (`260707-j66b-unnamed-windows-autoname-folder`). The name is derived and single-sourced **in tmux** (Constitution II) — run-kit issues no rename and stores nothing; native tmux clients and the status line show the same folder name.

**Two halves make this work:**

1. **`automatic-rename-format` in the embedded configs.** All four `configs/tmux/*.conf` (`default.conf`, `simple.conf`, `poweruser.conf`, `byobu.conf`) set:

   ```tmux
   set -g automatic-rename-format '#{b:pane_current_path}'
   ```

   `#{b:...}` is tmux's basename format modifier (verified available on the host's tmux 3.6a). `automatic-rename` itself defaults to `on`, so any window not pinned with an explicit `-n` names itself to the basename of its active pane's current path — the folder basename, rather than tmux's default `#{pane_current_command}` ("zsh"/"node"/"vim"), which is near-useless identity in a worktree-per-change workflow. `byobu.conf` keeps its explicit `set -g automatic-rename on` line above the format line. The canonical `default.conf` is re-staged to the Go-embed copy `app/backend/build/tmux.conf` (staged by `just setup`), which carries the format line at ~L24. **Windows created with an explicit `-n` stay pinned** — tmux disables `automatic-rename` on an explicit name (this is desired for the deliberate-name paths below).

2. **`CreateWindow` omits `-n` when the name is empty.** `tmux.CreateWindow(session, name, cwd, server)` builds its argv via a pure helper `buildCreateWindowArgs(session, name, cwd string) []string` (mirrors the `buildNewWindowArgs`/`buildSpawnArgvs` pure-arg-builder pattern in `riff.go`, so the `-n`-conditional branch is unit-testable without a live tmux server — `TestBuildCreateWindowArgs`):

   ```
   name == ""   →  ["new-window", "-a", "-t", session,             "-c", cwd]
   name != ""   →  ["new-window", "-a", "-t", session, "-n", name, "-c", cwd]
   ```

   Because `-c cwd` is always passed, an unnamed create names itself to the folder basename **immediately** — there is **no follow-up `rename-window` round-trip** (single tmux invocation).

**Deliberate explicit-name paths are unchanged** (they still pass `-n`, keeping their names pinned): `rk riff` panes (`buildNewWindowArgs`), iframe/service windows via `CreateWindowWithOptions` (the `rkType`-present create branch), the `port-N` service windows, and explicit renames (`RenameWindow` — renaming pins the name, which is the desired tmux behavior). The rename API path is untouched — it still **requires** a non-empty validated name.

### API contract — window name optional on CREATE only

`POST /api/sessions/{session}/windows` (`handleWindowCreate`, `api/windows.go`) makes `name` optional: `validate.ValidateName(body.Name, ...)` runs **only when `body.Name != ""`**. An omitted/empty name (with no `rkType`) is a valid request meaning "let tmux auto-name" → 201, calling `CreateWindow(session, "", cwd, server)`. A **non-empty** name that fails validation returns 400. **Guard**: when `body.RkType != ""` the handler requires a non-empty name (400 on empty/omitted) — the `rkType` path runs `CreateWindowWithOptions` with `-n <name>` and automatic-rename disabled, so an empty name there would pin the window to an empty name; the shipped UI always supplies one, and the 400 pins that API contract. The rename handler (`handleWindowRename`) requires a non-empty rename name (empty → 400). Contract documented in `docs/specs/api.md` § window create.

Existing `-n zsh`-pinned windows are NOT migrated — they have `automatic-rename` off and stay pinned. Unpinning would require a per-window `set -w automatic-rename on` sweep (not trivially cheap).

## Unified Test-Socket Naming — `rk-test-<role>-<pid>-<ns>`

**Every** test tmux-socket name — Go *and* Playwright — follows one umbrella form (`260530-cf3g-unify-test-socket-reaping`):

```
rk-test-<role>-<pid>-<ns>
```

- `<role>` identifies the test family: `unit`, `relay`, `tmuxctl`, `daemon`, `e2e`, and the hyphenated e2e secondaries `e2e-multi`, `e2e-coupling`, `e2e-msb`. **A role MAY contain hyphens.**
- `<pid>` is the real OS PID of the test binary (`os.Getpid()` in Go, `process.pid` in Playwright).
- `<ns>` is a single **hyphen-free** uniqueness token (Go: `time.Now().UnixNano()`; Playwright: a `Date.now().toString().slice(-6)` suffix). It being hyphen-free is what makes `<pid>` unambiguously the **second-to-last** hyphen field regardless of how many hyphens the role has.

**Single shared naming helper**: Go tests build the name via `testSocketName(role string) string` → `fmt.Sprintf("rk-test-%s-%d-%d", role, os.Getpid(), time.Now().UnixNano())`. Because Go `_test.go` symbols are package-private, the helper is duplicated across the test-support files of each package that needs it (`internal/tmux/main_test.go`, `api/main_test.go`, and small local equivalents in `internal/tmuxctl`/`internal/daemon`); all seven Go naming sites route through it — no inline `fmt.Sprintf("rk-test-…")` socket literal remains (the only intentional exceptions are the helper definitions and `socketsweep_test.go`, which hand-builds live-vs-dead-PID sockets for the sparing test).

**E2E (Playwright) naming**: secondary per-spec servers embed `process.pid` as the second-to-last field — `rk-test-e2e-multi-${process.pid}-${suffix}`, `rk-test-e2e-coupling-${process.pid}-${suffix}`, `rk-test-e2e-msb-${process.pid}-${suffix}` — so `parseTestSocketPID` can reason about them. The **primary** harness server is the fixed name `rk-test-e2e` — created once by `scripts/test-e2e.sh`, torn down by its trap/glob, and caught by the manual reaper's `rk-test` brute-force. A fixed-name primary cannot be PID-swept and does not need a PID; only the secondaries carry one. The `rk-test-e2e` name lives in `scripts/test-e2e.sh` (`E2E_TMUX_SERVER`), `app/frontend/tests/e2e/global-teardown.ts` (glob default), the `just pw` recipe default, and all e2e specs.

### PID parsing — second-to-last hyphen field

`parseTestSocketPID(name) (int, bool)` (duplicated in `internal/tmux/main_test.go` and `api/main_test.go`) extracts the PID from the **second-to-last** hyphen-delimited field — `strings.Split(name, "-")`, take element `len-2`, `strconv.Atoi`. It returns `ok=false` when the name lacks the `rk-test-` prefix, has fewer than 5 fields (`rk`, `test`, `<role>`, `<pid>`, `<ns>`), or the candidate field is non-numeric.

Parsing from the right (fixed `len-2` index) is what makes hyphenated roles work: `rk-test-e2e-coupling-48213-1717…` yields PID `48213` because the role (`e2e-coupling`) occupies the middle fields and never shifts the PID's position. A fixed *left* index (the field immediately after the prefix) would break the moment a role contained a hyphen.

`testPIDAlive(pid)` is unchanged: liveness via `syscall.Kill(pid, 0)` with a biased-alive interpretation — only a definitive `ESRCH` marks the PID dead; any other error (incl. `EPERM`) is treated as alive (leak-not-kill bias). A non-positive PID is treated as dead defensively.

### `IsTestServerName` — single-prefix identity check

"Is this a test artifact?" is the single exported check `tmux.IsTestServerName(name) bool` → `strings.HasPrefix(name, "rk-test-")` (`internal/tmux/tmux.go`); the `"rk-test-"` literal lives in exactly this one place.

`IsTestServerName` is **intentionally NOT applied** in `ListServers` nor in the `/api/servers` handler — internal consumers (`board.go` in particular) iterate every real tmux server, and `/api/servers` surfaces every server so the operator sees exactly what `rk reaper` will reap. Its only consumer is the **tmuxctl supervisor's resurrection guard** (`isTmuxSocketCandidate` in `internal/tmuxctl/supervisor.go`): leaked `rk-test-*` sockets (now including `rk-test-e2e-*`) are excluded from the control-mode candidate set so `resolveBootstrap`'s `new-session -s _rk-ctl` does not *resurrect* every orphan test socket on bootstrap. This is a **correctness guard, not UI noise reduction**, and stays in force regardless of the `/api/servers` change.

## Automatic Test-Socket Sweep — POST-sweep in `TestMain`

Both packages that have it (`internal/tmux/main_test.go`, `api/main_test.go`) run a **post-sweep** — `sweepDeadTestSockets()` runs *after* `m.Run()`, never before:

```go
func TestMain(m *testing.M) {
    code := m.Run()
    sweepDeadTestSockets()
    os.Exit(code)
}
```

There is no pre-sweep: the post-sweep means **each run reaps its OWN dead-PID residue** on the way out.

**PID-scoped to dead owners only — never a blanket wipe.** `sweepDeadTestSockets` enumerates `/tmp/tmux-<uid>/` and `kill-server`s a socket only when its embedded PID **parses** (`parseTestSocketPID`) **AND is dead** (`testPIDAlive` reports `ESRCH`). Live-PID sockets — which belong to a **concurrent `go test ./...` package running as a separate process** — are spared, so packages running in parallel do not kill each other. Sockets without a parseable PID (no role/pid/ns shape) are left untouched. Kills use `exec.CommandContext` + a 5s timeout and an argument slice (constitution I) — never a shell string. Best-effort: enumeration or kill failures are ignored (a leaked socket is harmless residue; never blocking tests is the priority).

`t.Cleanup(kill-server)` reaps each socket on the normal path; the post-sweep is the only automatic cleanup for **un-catchable SIGKILL / panic / OOM residue**. The manual `rk reaper` is the by-hand janitor for cruft that has already accumulated on disk across runs.

## `rk reaper` — Brute-Force-by-Prefix Operator Cleanup

`rk reaper` (introduced `260529-fww2-rk-reaper-command`, rewritten by `260530-cf3g-unify-test-socket-reaping`) is a **top-level, operator-invoked** command — a sibling of `rk serve`/`rk riff`, registered via `rootCmd.AddCommand(reaperCmd)` in `cmd/rk/root.go`. It is **NOT** wired into any startup path. The command body (`cmd/rk/reaper.go`) is thin — flag parsing + summary rendering; all scan/classify/reap logic lives in `internal/tmux/reaper.go` (constitution §III).

### No relay startup sweep

There is no relay startup sweep. Relay ephemerals do not exist (the relay attaches directly), and board pin-sessions (`_rk-pin-*`) are PERSISTENT across rk restarts (a valid state, not an orphan), so there is no in-server session class to reap at startup. The reaper is the operator-only janitor for **whole test servers and dead/stale sockets/`.lock` files** — different scope, different trigger. (`260529-fww2`, `260602-qn62-move-based-board-pin-sessions`)

### Brute-force-by-prefix — no liveness probe to match

The reaper matches **purely by name prefix** — no PID parse, no name-shape reasoning, no e2e exclusion, no `.lock`-inherits-base-server logic. It iterates **RAW** socket-dir candidates via `ScanSocketDir(ctx)` (NOT `ListServers`, which probes dead sockets away) and classifies each:

- **Bare `rk reaper`** ≡ `rk reaper --prefix rk-test` — matches every `rk-test*` socket, `.lock` file, and live server.
- **`rk reaper --prefix <p>`** applies identical behavior to `<p>*`.
- A matched **live server** → `KillServer` (`ReapActionKill`); a matched **socket** (dead) or **`.lock` file** → `os.Remove` (`ReapActionRemove`).

The only thing requiring the outside world is the live-vs-dead distinction for a matched, non-`.lock` candidate. `classifyReap(name, prefix, serverLive)` is a **pure function** (`internal/tmux/reaper.go`) — `serverLive` is supplied by the caller (`reapCandidates`, which calls `probeServerAlive` only when `probeNeeded` says the kill-vs-remove decision depends on it). `ReapAction` is the exported enum (`ReapActionSkip`/`Kill`/`Remove`); the full matrix is unit-testable via `TestClassifyReap` without spawning servers.

### Hard-skips (never reaped, even under `--prefix` + `--force`)

- **`_rk-ctl` control anchor** (`ControlAnchorSessionName`) — owned by `tmuxctl`.
- **Live `rk-daemon` production server** (named const `productionDaemonServer = "rk-daemon"`, a local literal to avoid an `internal/daemon` import edge).

Both are short-circuited before the prefix check in *both* `classifyReap` and `probeNeeded`, so a broad or mistyped `--prefix rk` can never take down production — the dry-run default alone is not sufficient protection for the daemon.

### Dry-run is the DEFAULT; `--yes`/`--force` to act

Invoking `rk reaper` (bare or `--prefix`) with no action flag **prints the match list** with each entry's classified action (`kill`/`remove`) and **touches nothing**. The action gate is `act := (reaperYes || reaperForce) && !reaperDryRun`:

- `--yes` (or `--force`) → actually reap.
- `--dry-run` is retained as an **explicit alias** for the default preview and always wins (forces preview even if `--yes`/`--force` were also passed).
- `--force` is the **ONLY** flag that bypasses the dangerous-prefix guard. `--yes` acts but does NOT bypass the guard, so an operator who only confirms is still protected from a typo'd short prefix.

**Dangerous-prefix guard** (`ReapTestServers`): an empty prefix or one of length ≤ 3 (e.g. `rk-`) matches nearly everything (`runkit`, `runWork`, production) and is **refused** unless `--force`. The guard refuses regardless of `act`, so even a dry-run with a dangerous prefix reports the refusal rather than previewing a near-everything match.

### Operating contract — do NOT run while tests are running

Because the manual reaper has **no live-run protection by design** (no name allowlist, no PID gate), the operating contract is: **do not run `rk reaper` (bare or `--prefix`) while tests are running** — it will kill their live tmux servers. The automatic post-sweep's PID-scoping protects concurrent `go test` packages; the manual tool relies on the human. This contract is stated in the command's `Long` help text and here.

### I/O routine, test seam, and partial-failure contract

`ReapTestServers(ctx, prefix, act, force) (ReapResult, error)` is the public entry point: it applies the dangerous-prefix guard, scans via `ScanSocketDir`, then delegates per-candidate work to the internal seam `reapCandidates(ctx, dir, prefix, candidates, probe, act)` — passing `socketDirPath()` and `probeServerAlive`. Tests drive `reapCandidates` directly with a temp dir + fake prober (no real tmux server spawned). `ReapResult` carries `Killed []string`, `RemovedSockets []string`, and `DryRunPlan []ReapPlanEntry` (`{Name, Action}` pairs, populated only on a dry-run).

**Partial failure**: each kill/remove failure is logged via `slog.Warn` and skipped; iteration continues; a joined aggregate error (`reaper partial failures: …`) is returned at the end (nil when all succeed). The command renders the summary *before* surfacing the aggregate error, so the operator sees what was reaped even on partial failure.

## `/api/servers` Lists Every Server — No Test-Socket Hide

There is no `/api/servers` test-socket hide filter (`260530-cf3g-unify-test-socket-reaping`). `handleServersList` (`api/servers.go`) returns the output of `tmux.ListServers` directly, so the response includes **every** tmux server discovered — including leaked `rk-test-*` orphans. The reaper is the **sole** mechanism that keeps this list clean.

**Accepted consequence**: after a crashed test run, the dev UI lists the orphans **and opens an SSE stream per orphan server** until the operator runs `rk reaper`. This is intended ("surface everything") — the user sees exactly the pile the reaper will reap. The `servers_test.go` fixture asserts that ALL servers (including `rk-test-*` / `rk-test-e2e-*`) are returned (`TestHandleServersList_ReturnsAllServersIncludingTestSockets`).

## `RK_SERVER_ALLOWLIST` — Env-Gated Test-Isolation Filter in `ListServers`

`ListServers` applies an **env-gated allowlist filter** read from `RK_SERVER_ALLOWLIST` (const `tmux.ServerAllowlistEnv`, `internal/tmux/tmux.go`) (`260531-tmnm-test-scoped-server-enumeration`). The env var is read **in-package** via `os.Getenv` — matching the `RK_TMUX_CONF`/`OriginalTMUX` precedent — **NOT** threaded through `internal/config` (`ListServers` is a `ctx`-only free function and `internal/tmux` has no `config` dependency to carry it).

- **Unset / whitespace-only (production default)**: the filter is a no-op — `ListServers` returns all live servers, byte-for-byte identical to before. The `/api/servers` "surface every server" contract (see § above) and the `IsTestServerName` design intent are preserved exactly. An empty value is treated as unset, so a blank env never means "match nothing".
- **Set (test only)**: the post-probe live-server list is narrowed to names admitted by `matchesServerAllowlist(name, allowlist)` — a pure, table-tested predicate (`TestMatchesServerAllowlist`, no live tmux server needed). The allowlist is a **comma-separated list of prefixes**; each token is trimmed, empty tokens skipped, and a name matches when it `strings.HasPrefix` ANY token (exact match = prefix-of-itself).

**Why prefix, not exact**: multi-server e2e specs create secondaries in `beforeAll` named `rk-test-e2e-<role>-<pid>-<epoch>` (e.g. `rk-test-e2e-multi-*`, `rk-test-e2e-coupling-*`, `rk-test-e2e-msb-*`). Exact match on `rk-test-e2e` would wrongly exclude them and break those specs; prefix admits the primary plus this-run secondaries (cross-worktree-safe via the embedded `process.pid`). The allowlist targets `rk-test-e2e*` specifically — a `rk-test-relay-*` Go-test server under the broader `rk-test-` umbrella is NOT admitted.

**Why the filter lives in `ListServers`, not the `/api/servers` handler**: the board route attaches servers from **two** distinct `ListServers`-rooted paths — (1) `GET /api/servers` (`api/servers.go`) populating `useSessionContext().servers`, and (2) the internal `board.go` board-entry enumeration (`ListBoards` / `GetBoard`, which iterate `ListServers` per-server — `260602-qn62`). Filtering only the HTTP handler would leave path (2) unscoped, so the SSE inflation persists. Placing it in `ListServers` means **all** enumeration consumers inherit the scope when the env is set: `/api/servers` and `board.go`. This is the intended outcome in the test environment (the only environment that sets the var).

**Why it matters**: on the board route the frontend attaches **all** known servers (boards are cross-server by design). All N per-server subscriptions ride ONE state-socket WebSocket that holds no HTTP/1.1 pool slot (`260716-qf3j-state-socket`), so scoping the backend READ path to `rk-test-e2e*` no longer relieves connection-pool pressure — but the allowlist still usefully **bounds which servers a test backend enumerates**, one subscription per test server rather than one per live `kit`/`runWork`/orphan server on a busy operator box. (Historically, before the state socket, each server opened its own SSE `EventSource`, and N of the browser's 6 HTTP/1.1 slots were consumed before any relay WebSocket or xterm chunk fetch — the load-dependent connection-pool starvation that made board e2e specs flaky only on busy sessions, the environmental third vector of `e2e-flakiness-board-route-dynamic-import-hang`.)

### Allowlist (new) vs `IsTestServerName` denylist (existing) — opposite directions

These two mechanisms point in **opposite directions** and coexist without conflict (this change touches only the allowlist):

| Mechanism | Question | Hides | Used by |
|-----------|----------|-------|---------|
| `RK_SERVER_ALLOWLIST` (new, forward allowlist) | "Is this a server THIS test run may see?" | **normal** servers from tests | `ListServers` (env-gated) |
| `IsTestServerName` (`HasPrefix "rk-test-"`, denylist) | "Is this a test server?" | **test** servers from normal operation | tmuxctl supervisor resurrection guard only |

The `tmuxctl` supervisor is **unaffected**: it does NOT call `ListServers` — it enumerates the socket dir via `os.ReadDir` + `isTmuxSocketCandidate` (`supervisor.go`), so its resurrection guard is identical to before regardless of the allowlist.

### Harness wiring — backend READ path vs WRITE socket

`scripts/test-e2e.sh` exports `RK_SERVER_ALLOWLIST` (set to the `E2E_TMUX_SERVER` value, `rk-test-e2e`) into the **dev backend** process — the `setsid bash -c "… exec just dev"` launch — so the backend's `ListServers` read path is scoped for the run. This is distinct from `E2E_TMUX_SERVER`, which scopes the **socket the tests WRITE to** (a shell/TS-only variable Go never reads). A dedicated `RK_*` name is honest about allowlist intent and matches the env-var convention rather than repurposing the socket-naming variable for Go config.

## Related Files

- `app/backend/internal/tmux/tmux.go` — `serverArgs()`, `tmuxExecServer()`, `ListSessions()`, `ListServers()` (delegates the raw socket-dir scan to `ScanSocketDir` and the probe to `probeServerAlive`; applies the env-gated `RK_SERVER_ALLOWLIST` filter post-probe), `ServerAllowlistEnv` const + `matchesServerAllowlist(name, allowlist)` pure prefix-match predicate (test-isolation filter; see § `RK_SERVER_ALLOWLIST`), `ScanSocketDir(ctx)`, `socketDirPath()`, `filterSocketEntries()`, `probeServerAlive(ctx, name)`, `IsTestServerName()` (single `HasPrefix("rk-test-")`; consumed only by the tmuxctl supervisor resurrection guard), `LockSocketSuffix`, `ListKeys()`, `KillServer()`, `CreateSession()`, `CreateWindow(session, name, cwd, server)` + the pure `buildCreateWindowArgs(session, name, cwd)` (omits `-n` for an empty name; `260707-j66b`), `SelectWindow(windowID, server)`, `SelectWindowInSession()`, `ResolveWindowSession()` (resolves the home non-pin session under dual membership; pin-session only when it is the sole link) + the unexported `resolveHomeSession()` it delegates the pin→home re-resolve to, `LinkWindowToSession(windowID, dstSession, server)` (`link-window`, dual membership; `260718-co9z`), `HasSession(ctx, server, session)` (exact-match existence probe, consumed by the relay's pin-session-first attach and `Unpin`'s recovery), `resolveWindowSessionIndex()`, `MoveWindow(windowID, dstIndex, server)`, `MoveWindowToSession(windowID, dstSession, server)`, `ReloadConfig()`, `EnsureConfig()`, `ConfigPath()`, plus the pin-session helpers `PinSessionPrefix`/`PinSessionName(windowID)`/`WindowIDFromPinSession(name)`/`ListPinSessionNames(ctx, server)` (`260602-qn62`)
- `app/backend/internal/tmux/reaper.go` — brute-force-by-prefix reaper logic: pure `classifyReap(name, prefix, serverLive) ReapAction` (enum `ReapActionSkip`/`ReapActionKill`/`ReapActionRemove`), `probeNeeded(name, prefix)` (gates the kill-vs-remove subprocess probe), the consts `productionDaemonServer = "rk-daemon"` + `minSafePrefixLen = 3`, `ReapResult`/`ReapPlanEntry`, the public `ReapTestServers(ctx, prefix, act, force)` (applies the dangerous-prefix guard), and the test seam `reapCandidates(ctx, dir, prefix, candidates, probe, act)` (log-and-skip per entry via `slog`, aggregate error at end). Tested in `reaper_test.go`
- `app/backend/cmd/rk/reaper.go` — thin `reaperCmd` (top-level; `--prefix` default `rk-test`, `--yes`/`--force` action gate, `--dry-run` explicit-alias for the default preview); `act := (yes||force) && !dryRun`; calls `tmux.ReapTestServers(ctx, prefix, act, force)` and renders summary/dry-run (`renderReapSummary`/`renderDryRun`); `Long` help states the brute-force/no-liveness-protection/operating contract; no scan/probe/remove/kill in `cmd/rk`
- `app/backend/internal/sessions/sessions.go` — `FetchSessions(server)` builds the dashboard view, `ProjectSession` has `Name` and `Windows` (no `Server` field); pane-map enrichment re-keys from `session:index` to windowID before joining; `ProjectRoot(ctx, windowID, server)` resolves by window ID
- `app/backend/api/router.go` — `serverFromRequest()` helper, `TmuxOps` interface with server params, route registration
- `app/backend/api/windows.go` — window action handlers keyed by `/api/windows/{windowId}` (kill, move, move-to-session, rename, color, url/type PUT, keys, select, split, close-pane); `parseWindowID(r) (string, bool)` helper validates the path param; `handleWindowCreate` stays session-scoped and makes `name` **optional** (validated only when non-empty; empty ⇒ tmux auto-names), except the `rkType`-present branch which requires a non-empty name (400 otherwise) (`260707-j66b`). The rename handler requires a non-empty validated name
- `app/backend/api/servers.go` — server list/create/kill handlers
- `app/backend/api/keybindings.go` — `GET /api/keybindings` handler (runs `list-keys`, filters via whitelist, returns JSON)
- `app/backend/api/sse.go` — per-server SSE polling hub
- `app/backend/api/terminals_ws.go` — muxed `/ws/terminals` WebSocket handler; per-stream `attachStream` picks the attach session (pin-session-first, else `tmux.ResolveWindowSession` home), session-scopes the select via `tmux.SelectWindowInSession`, and `attach-session -t <session>` via `creack/pty`. No ephemeral, no defer-kill (`260717-803u-relay-mux`)
- `app/backend/internal/tmux/board.go` — link-based board layer: `Pin` (STAMP-BEFORE-LINK + `LinkWindowToSession`) / `Unpin` (kill-session normal path + last-link recovery) / `Reorder`, `pinEntry`, `ListBoardEntries`/`ListBoards`/`GetBoard` (derived from `_rk-pin-*` session vars), the recovery helpers `resolveHomeSession`/`recoverPinToRenamedSession` (collision-guarded `recovered<id>` rename)/`clearMembershipOptions`/`killPinSessionIfPresent`, `ComputeOrderKey`/`nextAppendKey`/`initialAppendKey`, validators (`ValidBoardName`/`ValidWindowID`/`ValidOrderKey`), and the `BoardOption`/`HomeOption`/`BoardOrderOption` session-var key constants
- `app/backend/internal/tmuxctl/` — control-mode subscription package; `Client` opens `tmux -CC ... -t =<bootstrap> -r` per socket, **always** creates the `_rk-ctl` anchor floor (`260602-a1wo-prevent-exit-empty-server-death`) and tags it with `@rk_ctl_keepalive 1`, and sets `exit-empty off` via `tmux.SetExitEmptyOff` in `productionDial` before the anchor on every dial/reconnect. See `architecture.md` § tmux Control-Mode Subscription
- `app/backend/internal/tmux/tmux.conf` — canonical tmux configuration (Go-embedded, written to `~/.run-kit/tmux.conf` on first run)
- `app/backend/cmd/rk/riff.go` — `rk riff` subcommand: N-pane `tmux new-window` + `split-window` + `select-layout` + `select-pane` sequence per window on the user's current tmux server (via `tmux.OriginalTMUX` restore in child env), with parallel fan-out + rollback on failure
- `app/backend/cmd/rk/pane_spec.go` — `paneFlag` pflag.Value + `rewritePaneSpaceForm` argv pre-processor supporting bare/space/equals forms for repeatable `--skill`/`--cmd`
- `app/backend/cmd/rk/layout.go` — `layoutAliases` table + `resolveLayout` + `autoLayout` helpers
- `app/backend/cmd/rk/layout_help.go` — `renderLayoutMocks` Unicode box-drawing mocks rendered inline in `rk riff -h`
- `app/backend/internal/fabconfig/fabconfig.go` — `ReadPresets`/`ReadPresetsOrdered` read the riff presets from `fab/project/config.yaml` (best-effort `yaml.v3`; return empty on any failure). Presets only — the launcher is resolved by `rk riff` via `fab agent --print`, not read here (`260703-w884`)
- `app/backend/internal/tmux/main_test.go`, `app/backend/api/main_test.go` — per-package `TestMain` dead-PID **POST-sweep** (`code := m.Run(); sweepDeadTestSockets(); os.Exit(code)`; `260530-cf3g`): after tests, scans `/tmp/tmux-<uid>/` and `kill-server`s any `rk-test-*` socket whose embedded PID (the **second-to-last** hyphen field of `rk-test-<role>-<pid>-<ns>`, parsed by `parseTestSocketPID`) is dead per `testPIDAlive` — self-healing un-catchable SIGKILL/panic/OOM residue. PID-scoped (never a blanket wipe): live-PID sockets (a concurrent `go test` process) and names without a parseable PID are spared. Also host the shared `testSocketName(role)` helper and the `testSocketPrefix = "rk-test-"` const. Logic is duplicated across the two packages (Go `_test.go` symbols are package-private); kills use `exec.CommandContext` + 5s timeout (constitution I)
- `app/backend/internal/tmux/socketsweep_test.go` — `TestSweepDeadTestSockets_sparesLivePIDReapsDead` proves the post-sweep spares a live-PID `rk-test-*` socket while reaping a dead-PID orphan (hand-builds both names via `os.Getpid()` + a known-dead PID — the only sanctioned non-helper `rk-test-` literals); plus `TestParseTestSocketPID` / `TestTestPIDAlive`. `app/backend/api/socketsweep_test.go` carries the parse/liveness unit tests for the `api` copy
- `scripts/test-e2e.sh` (`cleanup`/`trap cleanup EXIT`), `app/frontend/tests/e2e/global-teardown.ts` — e2e teardown globs **all** `rk-test-e2e*` sockets in `/tmp/tmux-<uid>/`, best-effort, so PID-named secondaries (`rk-test-e2e-multi-*`, `rk-test-e2e-coupling-*`, `rk-test-e2e-msb-*`) don't leak on crash/Ctrl-C. **Process-group teardown** (`260530-cf3g`): the dev server is launched via `setsid bash -c "… exec just dev" &` into its OWN process group (`DEV_PGID=$!`), and `cleanup` kills only `kill -- "-$DEV_PGID"` — never `kill 0`. A non-detached `kill 0` would signal the *caller's* process group, SIGTERMing live tmux servers / `-CC` control clients sharing it when the e2e run executes inline in an interactive/agent session (root cause of `kit`/`abbb`/`runWork` dying mid-session — a 16-server death burst with zero `audit=kill-server` lines; constitution VI). **Backend READ-path scoping** (`260531-tmnm`): the `setsid … just dev` backend launch exports `RK_SERVER_ALLOWLIST=$E2E_TMUX_SERVER` (`rk-test-e2e`), scoping the backend's `ListServers` to test servers for the run — distinct from `E2E_TMUX_SERVER`, which scopes the WRITE socket (see § `RK_SERVER_ALLOWLIST`)

## Design Decisions

Reusable patterns future changes should follow:

1. **Never `kill 0` from a non-detached shell script.** A script that runs inline (sourced into an interactive shell or spawned by an agent) shares the **caller's** process group, so `kill 0` / `kill -- -$$` SIGTERMs the caller's unrelated processes — including live tmux servers and `-CC` control clients. The safe pattern for "tear down the subtree I launched" is to launch the subtree into its **own** process group via `setsid bash -c "… exec <cmd>" &`, capture `PGID=$!` (setsid makes `$!` equal the new group's PGID), and kill **only** that group by negative PGID: `kill -- "-$PGID"`. Guard with `[ -n "$PGID" ]` so a trap firing before launch is a no-op. (Root cause of a 16-server death burst with zero `audit=kill-server` lines; constitution VI.) *Introduced by*: `260530-cf3g-unify-test-socket-reaping`

2. **Embedded-PID naming: PID = second-to-last hyphen field.** When a name encodes `<prefix>-<role>-<pid>-<ns>` and `<role>` may itself contain hyphens (e.g. `e2e-multi`), parse the PID from the **right** (`strings.Split(name, "-")`, element `len-2`) rather than a fixed left index, and keep `<ns>` a single hyphen-free token. This decouples PID extraction from the role's segment count — a left-index parse breaks the moment a role gains a hyphen. *Introduced by*: `260530-cf3g-unify-test-socket-reaping`

3. **Manual cleanup tools default to dry-run; only `--force` bypasses safety guards.** A brute-force-by-prefix janitor (`rk reaper`) is intentionally not PID-gated — the operator asserts nothing live needs the matched artifacts. The safety budget is: dry-run-default preview, unconditional hard-skips for production-critical names (`_rk-ctl`, `rk-daemon`), a dangerous-prefix guard (empty/≤3 chars), and a documented operating contract ("don't run while tests run"). Crucially `--yes` (confirm) and `--force` (bypass guard) are **separate** — confirming an action does not waive typo protection. *Introduced by*: `260530-cf3g-unify-test-socket-reaping`

4. **Test isolation via an env-gated allowlist at the enumeration root, not the HTTP handler.** When a behavior fans out to multiple backend paths (here: the board route reaches `ListServers` via both `/api/servers` and internal `board.go` enumeration), scope it at the shared **root function** (`ListServers`), not at one consumer (`handleServersList`). A handler-only filter leaves sibling paths unscoped. Gate the filter behind an env var read **in-package** (matching the package's existing `os.Getenv` precedent — no new cross-package import for one scoping value) so production (env UNSET) is a byte-for-byte no-op and only the test harness narrows the list. Extract the match logic as a pure predicate (`matchesServerAllowlist`) so it is table-testable without live tmux servers. *Introduced by*: `260531-tmnm-test-scoped-server-enumeration`

5. **A forward allowlist and a reverse denylist can coexist — keep them distinct.** Hiding *normal* servers *from tests* (`RK_SERVER_ALLOWLIST`) is the opposite direction from hiding *test* servers *from normal operation* (the `IsTestServerName` resurrection guard). They are not interchangeable: `rk-test-e2e` is matched by `IsTestServerName`, so a `!IsTestServerName` denylist would hide the very server the tests need. When you need the opposite-direction scoping, add a new mechanism rather than flipping the existing one. *Introduced by*: `260531-tmnm-test-scoped-server-enumeration`

6. **Prefer `link-window` over `move-window` when a window must appear on two surfaces.** A window that needs dual residence (here: home session in SESSIONS + pin-session on a board) is `link-window`'d into the second session rather than moved — tmux keeps it a member of both and destroys the window only when its LAST link is removed. This keeps both surfaces tmux-derived truth (Constitution II — no frontend ghost-row synthesis, no lost original index) and simplifies teardown: dropping the extra membership is a plain `kill-session` on the single-window session, and the window survives via its surviving link. *Introduced by*: `260718-co9z-link-based-board-pinning`

7. **STAMP-BEFORE-LINK (write derivation metadata before the entity crosses the boundary).** When a mutation both creates a session and stamps the metadata that makes it derivable, stamp on the still-empty session BEFORE linking the payload window in. This removes the window-present-but-unstamped failure window entirely: a stamp failure strands nothing (the window has not moved), and a post-link failure can't exist because the metadata (`@rk_home`) is already durable — so the entity is always recoverable, with no double-fault rollback and no un-recoverable state. *Introduced by*: `260718-co9z-link-based-board-pinning`

8. **A last-link/recovery path must be collision-guarded and never strand.** Any recovery that renames a session to a reconstructed name (`recovered<id>`, or a recreated `@rk_home`) probes with `has-session` first and, on collision, falls back (a bounded numeric-suffix probe for `recovered<id>`; the recovered-name rename for a raced-in `@rk_home`). The contract "a window is never left unrecoverable" outranks landing at the ideal name — a stale prior-recovery session must not make the operation error and leave the window invisible in a `_rk-pin-*` name. *Introduced by*: `260718-co9z-link-based-board-pinning`

9. **Retain and repurpose derivation metadata in place rather than re-encode it.** When a data model changes shape (here: `@rk_board` from a bespoke server-option comma/colon encoding to a per-pin-session SESSION-var), keep the option-key constant (`BoardOption`) and the ordering helpers (`ComputeOrderKey`, `nextAppendKey`) and repurpose them — only the bespoke *encoding* helpers are dropped — so callers and validators stay stable. *Introduced by*: `260602-qn62-move-based-board-pin-sessions`

10. **An unconditional session floor beats a conditional one for `exit-empty` safety.** Create the `_rk-ctl` anchor on *every* observed server, not only servers that start with zero sessions — a conditional floor leaves a server that had real sessions at attach time unprotected, so tmux's default `exit-empty on` reaps the whole server when its last real session later closes (a recurring Constitution VI violation, ≥3×). *Introduced by*: `260602-a1wo-prevent-exit-empty-server-death`
