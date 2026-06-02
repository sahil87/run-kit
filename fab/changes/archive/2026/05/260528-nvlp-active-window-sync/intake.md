# Intake: Active Window Sync — tmux truth, URL as bookmark

**Change**: 260528-nvlp-active-window-sync
**Created**: 2026-05-28
**Status**: Draft

## Origin

> Triggered by a recurring desync between the left sidebar's highlighted window
> and tmux's actual active window — most visible immediately after running
> `rk riff`, where tmux switches to the newly created riff window but the
> sidebar remains highlighting the previously selected window (e.g., `zsh`)
> for up to a few seconds, and sometimes indefinitely if the user happened to
> click in the UI within the prior 3 seconds.

The session was conversational, beginning with a `/fab-discuss` orientation
and proceeding through:

1. **Symptom replication.** User shared a screenshot showing the sidebar
   highlighting `zsh` while the tmux status bar at the bottom showed
   `riff-flowing-capuchin` as the active window — the session this very
   conversation was running in.

2. **Root-cause analysis via codebase exploration.** Mapped the existing
   sync machinery:
   - Backend polls tmux every **2500ms** (`ssePollInterval` in
     `app/backend/api/sse.go:70`) via `tmux list-windows -F`, including
     `#{window_active}` per window — populating `WindowInfo.IsActiveWindow`
     in the SSE payload.
   - Frontend (`app/frontend/src/app.tsx`) has a reconciliation effect that
     navigates the route to match `isActiveWindow` whenever it changes, but
     suppresses that auto-navigation for **3000ms** after any user-initiated
     sidebar click (`userNavTimestampRef`).
   - Sidebar click path navigates the route AND fire-and-forget calls
     `POST /api/sessions/{session}/windows/{index}/select` — a valid
     `tmux select-window` endpoint already exists.
   - The route `/$server/$session/$window` is read on every render to decide
     which window is "selected" in the sidebar.

3. **First-principles redesign.** Diagnosed the failure as a two-master
   topology — both the URL and tmux's `window_active` claim ownership of
   "current window," with a 3-second timer as the referee. Classic
   last-writer-wins with no causality. The recurring bug is structural,
   not a tuning issue.

4. **Model selection.** User chose: **tmux is the live source of truth per
   server**; the URL is a *resumable bookmark* used on initial mount and
   reload, not consulted afterwards. All browser clients viewing the same
   tmux server converge on the same window; different rk-managed tmux
   servers stay independent. Yanking other tabs on the same server to
   follow tmux is acceptable for a single-person tool.

5. **Hook viability initially verified empirically.** Installed test
   `after-select-window` and `after-new-window` hooks on the live
   `-L kits` tmux server (`tmux 3.6a`). Measured hook fire latency at
   **~78 microseconds** from `tmux select-window` returning to the hook's
   `run-shell` body executing. Format variables `#{session_name}`,
   `#{window_index}`, `#{window_name}`, `#{window_active}` resolve
   correctly inside the hook's argument string.

6. **First wiring proposal: `rk notify` CLI + per-socket lockfile.**
   Initial design had the hook call a new `rk notify` CLI subcommand that
   would read a per-socket lockfile written by `rk serve` on startup to
   discover the running rk's port, then POST `/notify` to it.

7. **PR #197 landed during this session.** Commit `270c6fc` shipped
   "fix(daemon): port-based liveness, stale-socket reap, startup logging"
   — adding `internal/daemon/{portInUse,guardPortAvailable,probeHost}`
   and explicitly listing **"PID files, lock files, or any persistent
   liveness store"** as a Non-Goal, citing Constitution §II. This
   directly invalidated the lockfile portion of the wiring proposal
   above.

8. **Multi-rk scenario surfaced.** User pointed out a real-world case
   the lockfile design couldn't handle: multiple `rk serve` instances
   on different ports (e.g., one installed binary on `:3000`, one
   `just dev` instance on `:5000`) — both connecting to the same tmux
   servers. The hook fires inside the tmux server; both rks have UIs
   open and both need the update. This reframed the problem from
   "discovery" to "**multi-subscriber notification**" — the tmux server
   is the publisher, every live rk is a subscriber, and the set of
   subscribers changes at runtime.

9. **Pattern B (tmux control mode) chosen.** Each `rk serve` opens a
   long-running `tmux -CC -L <socket>` connection per tmux server it
   relays. tmux's control mode emits structured notifications
   (`%session-window-changed`, `%window-add`, `%window-close`,
   `%window-renamed`, `%sessions-changed`, `%layout-change`) over a
   pipe to the connected rk. No hooks, no `rk notify`, no lockfile,
   no `/notify` endpoint. Multi-rk works by construction — each rk
   subscribes independently. Reconnect on tmux restart is standard
   supervisor code.

10. **Boards impact analyzed.** Boards are orthogonal: they persist in
    `@rk_board` per-server tmux options keyed by stable `window_id`
    (`@42`), and the `/board/$name` route is independent of
    `/$server/$session/$window`. Two free wins identified (instant
    board-cleanup, optional active-window badge on `BoardPane`); one
    refactor identified (move the `prevIDs` vs `currentIDs` diff out
    of the poll loop into the snapshot builder).

## Why

The recurring sidebar desync has been "solved" multiple times before and
keeps coming back. That track record is itself diagnostic — it tells us
this is not a tuning bug (longer debounce, faster poll) but a structural
one.

**The actual problem.** Today the system has two state machines that each
claim authority over "which window is current":

1. **The frontend route** (`/$server/$session/$window`) — written by user
   clicks, read by the sidebar's highlight logic and by the terminal-view
   component.
2. **tmux's `window_active` flag** — written by anything that calls
   `tmux select-window` (including `rk riff`, terminal users typing
   `prefix-n`, and rk's own `POST .../select` endpoint), surfaced to the
   frontend via the 2.5s SSE poll.

These are reconciled by a 3-second `userNavTimestamp` debounce: tmux→UI
auto-navigation is suppressed for 3s after any UI click. This is
last-writer-wins arbitrated by wall clock, which is the canonical
distributed-systems anti-pattern. Symptoms:

- **Visible 2.5s lag** when switching windows inside tmux — the UI cannot
  know until the next poll tick.
- **`rk riff` desyncs** because tmux changes outside the UI's awareness;
  if the user happened to click in the sidebar within the prior 3s, the
  resulting poll snapshot is suppressed by the debounce timer and the UI
  stays on the old window — sometimes indefinitely if subsequent polls
  also fall inside the suppression window after further clicks.
- **The URL fights its own writer.** The reconciliation effect rewrites
  the URL whenever tmux's truth differs, and that rewritten URL is then
  read back on the next render. The URL is simultaneously source and
  sink.

**Consequence of not fixing.** Every workflow that changes tmux outside
the UI's awareness (`rk riff` is the obvious one, but also manual
`tmux select-window`, future CLI tools, scripted automation) will
continue to desync. Each "fix" can only tune the debounce/poll
constants; none can remove the underlying race, because the race is in
the topology.

**Why this approach over alternatives.** Two coherent topologies dissolve
the race:

- **Tmux-as-truth**: one writer, UI is a pure projection. All clients on
  the same server converge. Multi-device users see all devices forced to
  the same window.
- **Client-as-truth**: URL owns selection per client. Tmux's
  `window_active` is incidental. Different tabs can independently view
  different windows of the same session. UI never follows tmux-side
  changes.

Pure client-as-truth was rejected because the user explicitly wants the
open browser to follow when they switch windows inside tmux — that's the
dashboard mental model. Tmux-as-truth matches that intent, removes the
two-master race entirely (there is no second writer to fight), and
produces a coherent multi-client convergence story per server. The URL
retains a single legitimate role: bookmark-on-load for deep links and
reload.

**Why control mode over hooks for the push channel.** The hook design
was initially attractive (~78µs measured latency) but broke down under
the multi-rk scenario: a hook running inside tmux has no clean way to
discover and fan-out to multiple live `rk serve` subscribers without
reintroducing the lockfile pattern that PR #197 just rejected as a
Constitution §II violation. Tmux control mode (`tmux -CC`) is the
canonical multi-subscriber channel — each subscriber opens its own
connection, tmux fans out internally, subscription = open connection,
unsubscribe = close. No discovery, no fan-out, no filesystem state,
no env-propagation concerns. It is to tmux what SSE is to the browser:
the push channel of the layer. The latency claim is preserved on first
principles (per tmux man page, control-mode notifications are
implemented as the same internal hooks I measured at 78µs, but emit
to a pipe instead of forking a `run-shell` — so faster, not slower).

## What Changes

### A. rk subscribes to tmux control mode per server

Each `rk serve` opens a long-running control-mode connection
(`tmux -CC -L <socket> attach-session -t <bootstrap-session>`) to every
tmux server discovered on the machine. The discovery mechanism watches
`$TMUX_TMPDIR` (falling back to `/tmp/tmux-$UID/` if unset) via
`fsnotify`: every socket file present at startup, and every new socket
created at runtime, triggers a `Client` open; every removed socket
triggers a `Client` close. This is magical-by-design — a single-person
tool benefits from "every tmux on the box just appears in the UI" over
explicit per-server config (Constitution §VII, Convention over
Configuration).

The connection requires a PTY (tmux control mode fails with
"tcgetattr failed" on a plain pipe), so the Go code uses `creack/pty`
(already a project dependency per `context.md` — `gorilla/websocket —
terminal relay to tmux panes via creack/pty`) to allocate a PTY and
run `tmux -CC` against it.

A new package `app/backend/internal/tmuxctl/` owns this concern:

```
internal/tmuxctl/
  client.go        // Client per (socket); manages pty + reconnect
  client_test.go   // Unit tests for parser + reconnect FSM
  parser.go        // Line-oriented %notification parser
  parser_test.go   // Golden-file fixtures of real tmux notification streams
  supervisor.go    // Watches $TMUX_TMPDIR via fsnotify; opens/closes
                   //   Clients in response to socket-file lifecycle.
                   //   Owns map[socket]*Client and the merged
                   //   generation channel.
  supervisor_test.go
```

The relevant tmux notifications and how they map to the existing data
model:

| Control-mode notification | Maps to | Triggers |
|---|---|---|
| `%session-window-changed session-id window-id` | per-session `window_active` change | snapshot refresh (sessions event) |
| `%window-add window-id` | new window created | snapshot refresh + board bootstrap re-eval |
| `%window-close window-id` | window killed | snapshot refresh + board cleanup |
| `%window-renamed window-id name` | window name change | snapshot refresh |
| `%sessions-changed` | session created/destroyed | session-order event |
| `%layout-change window-id ...` | pane layout change | snapshot refresh (sufficient — pane positions are part of WindowInfo) |
| `%unlinked-window-*` | window not currently in session — out of scope for v1; ignored | — |

The Client maintains a generation counter per server (an `atomic.Int64`).
Each handled notification increments the counter and signals an
`atomic.Pointer[chan struct{}]` waiter slot, replacing it with a fresh
chan via compare-and-swap to coalesce bursts. The SSE goroutine (see §B)
selects on the waiter.

**Connection lifecycle.** The Client implements an FSM:

```
disconnected → dialing → connected → disconnected (on read err / EOF)
```

with exponential backoff on reconnect (250ms, 500ms, 1s, 2s, capped at
5s, reset on a successful read). A reconnect that succeeds during the
gap means at most ~5s of lost events; the safety-net poll (§B) heals
the missed window.

**Bootstrap session attachment.** `tmux -CC` requires attaching to *a*
session to start emitting events for the server. The Client picks any
existing session (`tmux -L <socket> list-sessions -F '#{session_name}'`,
first result) or creates a hidden `_rk-ctl` session if none exist
(detached, kept alive via `set-option @rk_ctl_keepalive 1`). The
attached session is a *subscription anchor*, not a UI element — the
existing SSE code that lists/renders sessions filters out
`_rk-ctl` from results.

**Read-only attachment.** `tmux -CC attach -r` for read-only mode so
this subscriber cannot accidentally affect tmux state — input from rk
is limited to control commands needed for the subscription itself
(none for v1).

### B. SSE loop is event-driven; poll becomes safety-net

`app/backend/api/sse.go` is refactored:

- **Before**: `time.Sleep(2500ms)` between snapshot builds (poll-as-primary).
- **After**: `select` over (a) the per-server generation-waiter chan
  fed by `internal/tmuxctl/`, and (b) a `time.NewTicker(safetyPollInterval)`
  backstop. `safetyPollInterval = 12 * time.Second`. On any signal,
  invalidate the relevant server's snapshot cache, build the next
  snapshot, broadcast.

The existing `prevIDs` vs `currentIDs` diff used for board stale-entry
cleanup (lines 428–455 in `sse.go`) is currently inside the poll loop.
It moves into the snapshot builder so it runs on every event-driven
snapshot — otherwise board cleanup latency stays at the safety-net poll
cadence. Small refactor: extract `detectKilledWindowIDs(prev, current)`
and call it from the snapshot-build entry point.

### C. Per-rk subscription, multi-rk safe by construction

There is no global state, no lockfile, no shared registry. Each
`rk serve` instance:

1. Owns its own `internal/tmuxctl/Client` per tmux server.
2. Increments its own generation counter on each notification.
3. Pushes its own SSE stream to its own connected browsers.

Two `rk serve` instances on different ports (`:3000` and `:5000`) both
relaying against `-L kits`: each opens its own `tmux -CC` connection,
tmux fans out internally, both rks see all notifications, both push
their respective SSE streams. The browsers connected to `:3000` and
`:5000` each see their own UI update independently. **No coordination
between rks needed, ever.**

### D. Frontend: URL becomes write-only after mount

`app/frontend/src/app.tsx`:

1. **Delete** `userNavTimestampRef` and all references to it.
2. **Delete** the `elapsed < 3000` guard in the reconciliation effect.
3. **Delete** the local-state navigation in `navigateToWindow` — clicking
   a sidebar window calls `selectWindow(server, session, windowIdx)`
   only. No `navigate(...)` from the click handler; the route updates
   when the SSE-driven `isActiveWindow` change arrives.
4. **Add** a one-shot mount-time reconciler: on the first
   `currentSession` value after mount, if the URL's `$window` exists in
   the snapshot AND
   `currentSession.windows.find(w => w.isActiveWindow)?.index !== Number(urlWindow)`,
   fire one `selectWindow(server, session, Number(urlWindow))` to align
   tmux with the URL. This honors the resumable-bookmark semantics on
   reload/deep-link. Mark this with a `hasAlignedToUrlRef` boolean
   guard so it runs exactly once per mount.
5. **Keep** the derived-URL reconciler effect, but simplify it: when
   `currentSession.windows.find(w => w.isActiveWindow).index !==
   Number(urlWindow)`, call `navigate({to, params, replace: true})`.
   No debounce, no conditional suppression. Truth wins, always.

### E. Optimistic pending state on sidebar click (polish)

After D, sidebar clicks have a perceived gap between click and SSE
arrival. Tmux control-mode latency is sub-ms but cross-process pipe
read + Go scheduling + SSE flush still has some end-to-end cost. To
bridge it, the sidebar maintains a transient
`pendingWindow: {server, session, index} | null` cleared by the next
snapshot whose active window matches it (confirmation) or differs
from it (overridden — truth wins). The pending row renders with the
existing selected styling. Purely visual; the route still tracks
server truth.

### F. Boards: cleanup migration + optional active badge

Boards refactor item — extract the diff used by board cleanup so it
operates on the snapshot-build event (control-mode-driven or
safety-net), not the timer:

```go
// Before: inline in poll loop
// After: called by snapshot builder on every snapshot bump
func (s *Server) reconcileBoardEntries(server string, prev, current map[string]struct{}) {
    killed := windowIDsRemoved(prev, current)
    for id := range killed {
        s.tmux.RemoveAllByWindowID(server, id)
        s.broadcastBoardChanged(server, boardChangedPayload{
            Change:   "cleanup",
            WindowID: id,
        })
    }
}
```

Optional UX win (low priority — can ship in a follow-up): add a small
"tmux-active" visual indicator (subtle ring/dot) to `BoardPane` when
its underlying window matches
`currentSession.windows.find(w => w.isActiveWindow)?.windowId`.
Required data already flows through `BoardEntry` after a tiny backend
addition (include `isActiveWindow` in `BoardEntry`).

### G. Multi-client convergence semantics (spec-level)

Spec must record:

- All clients viewing the same server's `/$server/$session/$window`
  route converge on the same window (the "yank" behavior).
- Clients viewing `/board/$name` routes ignore active-window changes —
  they don't yank, because the route they're on isn't a session/window
  route. The SSE stream still arrives; only the
  session-route-rendering layer reacts to `isActiveWindow`.
- Clients viewing different rk-managed tmux servers do not affect each
  other — each server has its own snapshot stream and its own truth.
- Two `rk serve` instances are fully independent — each one's UIs
  converge with each other within that instance; the two instances do
  not (and cannot) interact.

## Affected Memory

- `run-kit/architecture`: (modify) document the tmux control-mode
  subscription model in `internal/tmuxctl/`; the demoted safety-net
  poll; the per-server generation counter; multi-client convergence
  semantics; how the model interacts with the PR #197 daemon-lifecycle
  pattern (port-probe liveness, no lockfile).
- `run-kit/tmux-sessions`: (modify) record the bootstrap-session
  attachment pattern, the `_rk-ctl` hidden session if needed, and the
  read-only attachment policy (`tmux -CC attach -r`).
- `run-kit/ui-patterns`: (modify) URL is a resumable bookmark, not a
  source of truth; sidebar clicks are pure mutations; the
  pending-state pattern.

## Impact

**Backend (Go)**

- `app/backend/internal/tmuxctl/` (new package): control-mode client,
  parser, reconnect FSM, generation counter management. Also owns the
  `$TMUX_TMPDIR` watcher that drives auto-discovery — a `Supervisor`
  struct holds `map[socket]*Client`, opens/closes Clients in response
  to fsnotify events, and exposes the merged generation-bumped channel
  to the SSE layer.
- `app/backend/api/sse.go`: poll loop refactored to generation-counter +
  safety ticker; board-cleanup diff extracted from poll loop into
  snapshot builder. `ssePollInterval` removed; `safetyPollInterval`
  introduced.
- `app/backend/cmd/rk/serve.go`: spin up `tmuxctl.Client` per configured
  tmux server at startup; tear down on shutdown.
- `app/backend/internal/sessions/`: filter `_rk-ctl` session out of
  `FetchSessions` results (if the bootstrap-session-creation path
  is taken).
- `go.mod` / `go.sum`: add `github.com/fsnotify/fsnotify` (for the
  `$TMUX_TMPDIR` watcher). `creack/pty` already present.

**Frontend (TypeScript)**

- `app/frontend/src/app.tsx`: remove `userNavTimestampRef` and the
  debounce; add one-shot mount-time reconciler; simplify the
  reconciliation effect; clean up `navigateToWindow`.
- `app/frontend/src/components/sidebar/index.tsx` and
  `window-row.tsx`: add pending-state visual (optional polish).

**Removed from the original wiring proposal**

- No `rk notify` CLI subcommand (deleted from intake).
- No per-socket lockfile under `~/.run-kit/run/` (deleted; Constitution
  §II compliance).
- No `POST /notify` endpoint (deleted; not needed without `rk notify`).
- No `~/.rk/tmux.conf` hooks for active-window sync (deleted; control
  mode replaces them).

**Tests**

- Backend: unit tests for `tmuxctl.Client` parser (golden-file
  fixtures of real `tmux -CC` notification streams);
  reconnect-FSM tests (simulated EOF, simulated dial error,
  backoff capping); integration test that spins up a temporary
  tmux server (`-L rk-tmuxctl-test`), opens a `Client`, triggers
  `select-window`, and asserts the generation counter increments
  within a bounded latency (target: 50ms in CI).
- Frontend: Vitest tests for the simplified reconciler (URL follows
  `isActiveWindow`, no debounce); test the mount-time URL alignment
  fires exactly once.
- E2E: Playwright test — start session via the API, trigger a backend
  mutation equivalent to `rk riff` (or invoke
  `POST .../select` directly), assert the sidebar highlight moves
  within a bounded latency (e.g., 500ms).

**Dependencies**

- One new external dependency: `github.com/fsnotify/fsnotify`
  (cross-platform filesystem watcher — `inotify` on Linux, `kqueue` on
  macOS) for the `$TMUX_TMPDIR` watch driving auto-discovery. Widely
  used (Kubernetes, Docker, etc.), stable, single small module.
  Alternative considered: hand-rolling Linux-only `inotify` via
  `golang.org/x/sys/unix` — rejected because the project supports both
  Linux and macOS dev (per existing tooling), and cross-platform
  hand-rolling doubles the surface for negligible benefit.
- `creack/pty` already present (used for the WebSocket terminal
  relay) — no change.

**Migration / rollout**

- Existing `rk serve` instances do not need any config changes — the
  control-mode subscriber is purely additive on the backend side.
- The frontend behavior change is observable but non-breaking — clicks
  still navigate, just via the SSE path instead of local state.
- The PR #196 `=`-anchored tmux targets (mentioned in
  `docs/memory/run-kit/architecture.md`) apply to the control-mode
  `attach-session -t` target as well — use `=<session>` for exact-match
  to avoid prefix collisions.

**Constitution alignment**

- **§I Security First**: `exec.CommandContext` with timeout for the
  `tmux -CC` invocation; no shell-string construction; the control-mode
  connection is local-only (no network surface added).
- **§II No Database**: zero persistent state. No lockfile. Subscription
  state lives in process memory and in the live tmux connection.
- **§III Wrap, Don't Reinvent**: tmux control mode is a pure tmux
  primitive — no reimplementation. `internal/tmuxctl/` is a wrapper
  around it.
- **§IV Minimal Surface Area**: zero new HTTP endpoints, zero new CLI
  subcommands, one new internal package. Frontend gets simpler (debounce
  + reconciliation logic shrinks).
- **§VI Tmux Sessions Survive Server Restarts**: preserved — the
  control-mode subscription is opened by `rk serve`, but tmux sessions
  remain independent. If rk dies, the connection closes; tmux is
  unaffected.

## Open Questions

- **Bootstrap session.** `tmux -CC` requires an attached session.
  Options: (a) attach to whatever session exists first, (b) create a
  hidden `_rk-ctl` session and filter it from UI results. Spec stage
  should choose. Initial position: (b) — cleaner separation and
  doesn't depend on user sessions existing.
- **Exact `safetyPollInterval` value.** Discussed range 10–15s;
  intake proposes 12s. Spec stage should confirm.
- **Multiple tmux servers configuration.** Today's rk discovers tmux
  servers via `RK_HOST`/`RK_PORT` + config. With control mode, rk needs
  to open a connection *per* tmux server. How is the list of servers
  to subscribe to determined? **Resolved** (see #19, #23 below): rk
  watches `$TMUX_TMPDIR` (or `/tmp/tmux-$UID/` fallback) for socket
  files and auto-subscribes to every one it sees — both the existing
  set at startup and any newly-created sockets at runtime.
- **Empty server case.** If a configured tmux server has zero sessions,
  the bootstrap-session creation path needs to run. Confirm this path
  doesn't accidentally surface `_rk-ctl` in the UI as the "only
  session." (Initial position: the sessions filter at the API layer
  handles this; empty UI is the expected state.)
- **`tmuxctl.Client` PTY in headless contexts.** `creack/pty` requires
  a kernel PTY device. In environments without `/dev/ptmx` (some
  containers/CI), the client must degrade to the safety-net poll.
  Initial position: detect at startup, log once at `slog.Warn`,
  proceed with poll-only. Confirm at spec stage.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Tmux is the sole source of truth for "current window" per server; URL is a resumable bookmark used only on initial mount | Discussed at length — user explicitly chose tmux-as-truth over client-as-truth after both were laid out with tradeoffs | S:95 R:90 A:90 D:95 |
| 2 | Certain | All clients viewing the same server converge on the same window ("yank" behavior); clients on different servers stay independent | Discussed — user confirmed yanking is OK for a single-person tool; per-server isolation falls out of the multi-tmux-server topology run-kit already has | S:95 R:85 A:90 D:95 |
| 3 | Certain | The push channel from tmux to rk is **tmux control mode** (`tmux -CC`) opened by each `rk serve`, NOT shell hooks calling a `rk notify` CLI | Multi-rk scenario surfaced after initial hook design was specced; control mode dissolves all five concerns hooks introduced (discovery, fan-out, lockfile-vs-§II, env-propagation, install-on-every-server) | S:95 R:80 A:90 D:95 |
| 4 | Certain | NO lockfile, NO `rk notify` CLI subcommand, NO `/notify` endpoint, NO `~/.rk/tmux.conf` hooks for active-window sync | Constitution §II compliance enforced by PR #197 (which landed during this session) — and the lockfile pattern was the only piece of the initial proposal motivating those endpoints/CLI | S:95 R:80 A:95 D:95 |
| 5 | Certain | The 3-second `userNavTimestamp` debounce is deleted entirely (not tuned) — it exists only to arbitrate a race that the new topology removes | Discussed — root-cause analysis identified this as the structural problem; tuning it has been tried and failed multiple times | S:95 R:85 A:95 D:95 |
| 6 | Certain | On initial mount, fire one `select-window` to align tmux with the URL — this is what makes reload/deep-link work | Discussed — user confirmed "the one I was looking at" is the desired reload behavior | S:95 R:90 A:90 D:95 |
| 7 | Certain | Multi-rk is supported by construction — each `rk serve` opens its own control-mode connection per tmux server; tmux fans out internally; no coordination between rks | Falls out of how `tmux -CC` works (per the man page) — each `attach-session` is an independent client | S:95 R:85 A:95 D:95 |
| 8 | Certain | A new package `app/backend/internal/tmuxctl/` owns the control-mode client, parser, and reconnect FSM | Aligns with existing `internal/tmux/` boundary (single responsibility, mirror naming); keeps the SSE handler clean and testable | S:90 R:85 A:90 D:85 |
| 9 | Certain | `creack/pty` (already a project dependency) is used to allocate a PTY for `tmux -CC` — control mode fails on plain pipes with "tcgetattr failed" | Verified empirically in this session (tmux 3.6a on this machine); creack/pty is already used for the WebSocket terminal relay per context.md | S:90 R:90 A:90 D:90 |
| 10 | Certain | Relevant control-mode notifications: `%session-window-changed`, `%window-add`, `%window-close`, `%window-renamed`, `%sessions-changed`, `%layout-change` | Direct mapping from the tmux 3.6a man page CONTROL MODE section — these are the exact analogs of the hook events the initial design proposed | S:95 R:90 A:95 D:95 |
| 11 | Certain | `safetyPollInterval = 12 * time.Second` (demoted from the current 2500ms primary cadence) | Clarified — user confirmed. Discussed range 10–15s; 12s is the midpoint; the safety-net's job is to heal missed events during reconnect gaps, not be the primary latency story | S:95 R:80 A:75 D:65 |
| 12 | Certain | Reconnect FSM: exponential backoff (250ms → 500ms → 1s → 2s → cap 5s), reset on successful read | Clarified — user confirmed. Standard supervisor pattern; bounded ~5s worst-case gap is comfortably below the safety-net interval so events lost during reconnect are healed by the next poll | S:95 R:80 A:80 D:75 |
| 13 | Certain | Control-mode notification latency is sub-millisecond once connected — faster than the ~78µs hook measurement because there is no fork+exec of `run-shell` | Clarified — user confirmed. Per tmux man page: control-mode notifications are implemented as the same internal hooks but emit to a stdout pipe instead of forking. Pipe write + Go reader scheduling is single-digit µs to low-tens-of-µs typical | S:95 R:90 A:85 D:80 |
| 14 | Certain | The bootstrap session for `tmux -CC` is a hidden `_rk-ctl` session created by rk if none exist; the existing sessions filter at the API layer excludes it from UI results | Clarified — user confirmed. Cleaner separation than attaching to an arbitrary user session (which couples control-mode lifecycle to that session's lifetime); naming follows the `_`-prefix internal convention | S:95 R:80 A:85 D:75 |
| 15 | Certain | Boards are orthogonal — board route `/board/$name` ignores `isActiveWindow` changes (no yank), but board cleanup gets faster as a free win | Clarified — user confirmed. Analyzed via Explore agent — board state is per-server in `@rk_board`, keyed by stable window_id, route is independent of session/window route | S:95 R:85 A:90 D:85 |
| 16 | Certain | The board-cleanup `prevIDs` vs `currentIDs` diff moves out of the poll loop into the snapshot builder | Clarified — user confirmed. Required by the architecture: snapshots are now event-driven, so any logic that depends on snapshot transitions must live where snapshots are built, not where they used to be triggered | S:95 R:75 A:90 D:90 |
| 17 | Certain | Optimistic pending state on sidebar click is a polish item, not blocking — base architecture is correct without it | Clarified — user confirmed. Control-mode turnaround is fast enough that the perceptual gap may not need a pending indicator; defer to follow-up if needed | S:95 R:85 A:80 D:75 |
| 18 | Certain | "Tmux-active" badge on `BoardPane` is optional / follow-up — not required for the core fix | Clarified — user confirmed. Discussed as a free win; nice-to-have, doesn't affect the desync resolution | S:95 R:90 A:85 D:80 |
| 19 | Certain | rk auto-discovers tmux servers by watching `$TMUX_TMPDIR` (or `/tmp/tmux-$UID/` fallback) for socket files — both at startup and at runtime via filesystem watch (`inotify` on Linux, `kqueue` on macOS via `fsnotify`); opens a control-mode connection to every socket it sees | Clarified — user chose auto-discover-and-subscribe over explicit config or prefix opt-in. Magical "just works" semantics for a single-person tool. Matches the spirit of "convention over configuration" (Constitution §VII) | S:95 R:75 A:80 D:75 |
| 20 | Certain | `tmux -CC` is invoked with `attach -r` (read-only mode) so the subscriber cannot accidentally affect tmux state — `-r` restricts input only; all notifications still emit to the client regardless | Clarified — user confirmed after explanation. Re-checked tmux man page: `-r` is an input-restriction flag, not an output filter, so read-only doesn't degrade subscription coverage. Defensive default with zero downside | S:95 R:80 A:65 D:60 |
| 21 | Certain | If `/dev/ptmx` is unavailable (some containers/CI), each affected `Client` logs once at `slog.Warn`, falls back to safety-net poll only — no error, no startup abort | Clarified — user confirmed. Matches the graceful-degradation pattern PR #197 established for daemon log open failures (single `slog.Warn`, never block startup) | S:95 R:80 A:65 D:55 |
| 22 | Certain | Test strategy: (1) parser golden-file fixtures covering six notifications + framing markers, captured from real tmux 3.6a output; (2) pure-unit reconnect FSM tests with stubbed I/O asserting the 250ms→500ms→1s→2s→5s backoff sequence and reset-on-read; (3) integration test against a temporary `-L rk-tmuxctl-test` tmux server with a 200ms latency bound on generation-counter increment; (4) Vitest tests for the simplified reconciler + one-shot mount alignment; (5) Playwright e2e asserting sidebar highlight moves within 500ms of `POST .../select` | Clarified — user confirmed. Specific assertions (200ms integration bound, 500ms e2e bound, fixture set scoped to the six notifications mapped in §A) committed at intake; spec stage can refine numbers if CI flakes but the shape is locked | S:95 R:75 A:65 D:60 |
| 23 | Certain | Auto-discovery of new tmux sockets uses a filesystem watch on `$TMUX_TMPDIR`, with idempotent connection management (deduplicate on socket path; existing connections survive across snapshot rebuilds; closed connections trigger removal from the active subscriber map) | Clarified — user chose auto-discover. The implementation detail (idempotent + dedup) is the obvious follow-on so transient socket events (close → reopen on the same name) don't leak connections or miss notifications | S:95 R:75 A:80 D:75 |

23 assumptions (23 certain, 0 confident, 0 tentative, 0 unresolved).

## Clarifications

### Session 2026-05-28

| # | Action | Detail |
|---|--------|--------|
| 19 | Upgraded | Confident → Certain. Decision: rk auto-discovers tmux servers via filesystem watch on `$TMUX_TMPDIR`, no explicit config — user chose auto-discover-and-subscribe over explicit-config or prefix opt-in |
| 23 | Resolved | Unresolved → Certain. The mechanism is `fsnotify` (or stdlib equivalent) on `$TMUX_TMPDIR`; idempotent connection management; closed-socket events remove from active subscriber map |
| 20 | Confirmed | Tentative → Certain. `tmux -CC attach -r`: read-only flag restricts input only; notifications still emit to the client regardless. Defensive default with zero downside |
| 21 | Confirmed | Tentative → Certain. PTY-unavailable fallback: per-Client `slog.Warn`, fall back to safety-net poll, never block startup — matches PR #197's graceful-degradation pattern for daemon log open failures |
| 22 | Confirmed | Tentative → Certain. Test strategy locked: parser golden-file fixtures + pure-unit reconnect FSM tests + integration test with 200ms generation-counter latency bound + Vitest reconciler tests + Playwright 500ms e2e bound |
| 11-18 | Confirmed (bulk) | All 8 remaining Confident → Certain. `safetyPollInterval=12s`, reconnect-FSM backoff sequence, sub-ms control-mode latency claim, `_rk-ctl` bootstrap session, boards orthogonality, board-cleanup diff relocation, optimistic-pending polish status, and `BoardPane` active-badge follow-up. User vetted all together via "All agreed" |

