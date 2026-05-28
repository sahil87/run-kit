# Intake: Active Window Sync — tmux truth, URL as bookmark

**Change**: 260528-nvlp-active-window-sync
**Created**: 2026-05-28
**Status**: Draft

## Origin

> Triggered by a recurring desync between the left sidebar's highlighted window
> and tmux's actual active window — most visible immediately after running
> `rk riff`, where tmux switches to the newly created riff window but the sidebar
> remains highlighting the previously selected window (e.g., `zsh`) for up to a
> few seconds, and sometimes indefinitely if the user happened to click in the UI
> within the prior 3 seconds.

The session was conversational, beginning with a `/fab-discuss` orientation and
proceeding through:

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
   last-writer-wins with no causality. The recurring bug is structural, not a
   tuning issue.

4. **Model selection.** User chose: **tmux is the live source of truth per
   server**; the URL is a *resumable bookmark* used on initial mount and
   reload, not consulted afterwards. All browser clients viewing the same
   tmux server converge on the same window; different rk-managed tmux servers
   stay independent. Yanking other tabs on the same server to follow tmux is
   acceptable for a single-person tool.

5. **Hook viability verified empirically.** Installed test
   `after-select-window` and `after-new-window` hooks on the live
   `-L kits` tmux server (`tmux 3.6a`). Measured hook fire latency at
   **~78 microseconds** from `tmux select-window` returning to the hook's
   `run-shell` body executing. Format variables `#{session_name}`,
   `#{window_index}`, `#{window_name}`, `#{window_active}` resolve correctly
   inside the hook's argument string.

6. **Multi-rk wiring decided.** Hook calls a new `rk notify` CLI subcommand
   that reads a per-socket lockfile (written by `rk serve` on startup),
   then POSTs to the running server. Discovery happens inside `rk`, not in
   the tmux config — survives port changes, scales to multiple rk instances
   if needed.

7. **Boards impact analyzed.** Boards are orthogonal: they persist in
   `@rk_board` per-server tmux options keyed by stable `window_id` (`@42`),
   and the `/board/$name` route is independent of
   `/$server/$session/$window`. Two free wins identified (instant
   board-cleanup, optional active-window badge on `BoardPane`); one
   refactor identified (move the `prevIDs` vs `currentIDs` diff out of the
   poll loop into the snapshot builder).

## Why

The recurring sidebar desync has been "solved" multiple times before and keeps
coming back. That track record is itself diagnostic — it tells us this is not
a tuning bug (longer debounce, faster poll) but a structural one.

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
- **`rk riff` desyncs** because tmux changes outside the UI's awareness; if
  the user happened to click in the sidebar within the prior 3s, the
  resulting poll snapshot is suppressed by the debounce timer and the UI
  stays on the old window — sometimes indefinitely if subsequent polls
  also fall inside the suppression window after further clicks.
- **The URL fights its own writer.** The reconciliation effect rewrites the
  URL whenever tmux's truth differs, and that rewritten URL is then read
  back on the next render. The URL is simultaneously source and sink.

**Consequence of not fixing.** Every workflow that changes tmux outside the
UI's awareness (`rk riff` is the obvious one, but also manual `tmux
select-window`, future CLI tools, scripted automation) will continue to
desync. Each "fix" can only tune the debounce/poll constants; none can
remove the underlying race, because the race is in the topology.

**Why this approach over alternatives.** Two coherent topologies dissolve
the race:

- **Tmux-as-truth**: one writer, UI is a pure projection. All clients on the
  same server converge. Multi-device users see all devices forced to the
  same window.
- **Client-as-truth**: URL owns selection per client. Tmux's `window_active`
  is incidental. Different tabs can independently view different windows of
  the same session. UI never follows tmux-side changes.

Pure client-as-truth was rejected because the user explicitly wants the open
browser to follow when they switch windows inside tmux — that's the
dashboard mental model. Tmux-as-truth matches that intent, removes the
two-master race entirely (there is no second writer to fight), and produces
a coherent multi-client convergence story per server. The URL retains a
single legitimate role: bookmark-on-load for deep links and reload.

The hook-driven push (replacing the 2.5s poll) is independent of the truth
model — it's a latency fix that makes the chosen model snappy enough to feel
right. Both wins are needed; only their composition delivers a system that
stops desyncing.

## What Changes

### A. Tmux hooks installed in canonical config

Add hooks to `~/.rk/tmux.conf` (the canonical config — see
`app/backend/build/tmux.conf`, copied at build time, embedded in the
binary, written to `~/.rk/tmux.conf` on first run by `rk serve`). Hooks
apply automatically to every rk-managed tmux server (`-L kits`, `-L t2`,
`-L t3`, etc.) since they all share this config.

```
# Active-window edge events — pushed to rk for immediate snapshot refresh.
# Hook latency measured at ~78µs. Format vars resolve at run-shell
# expansion time. Failures inside rk notify are silently absorbed.
set-hook -g after-select-window 'run-shell -b "rk notify window-active sess=#{session_name} idx=#{window_index} 2>/dev/null"'
set-hook -g after-new-window    'run-shell -b "rk notify topology       sess=#{session_name} idx=#{window_index} 2>/dev/null"'
set-hook -g after-kill-window   'run-shell -b "rk notify topology       sess=#{session_name} 2>/dev/null"'
set-hook -g after-rename-window 'run-shell -b "rk notify topology       sess=#{session_name} idx=#{window_index} 2>/dev/null"'
```

Existing rk-managed tmux servers must have these hooks installed
retroactively — `rk serve` SHOULD detect missing hooks at startup and
install them via `tmux -L <socket> set-hook -g ...` on every server it
manages. The hook installation MUST be idempotent.

### B. `rk notify` CLI subcommand

New subcommand: `rk notify <kind> [k=v...]`. Reads a per-socket lockfile,
POSTs the event to the running server, exits silently on any failure.

```
rk notify window-active sess=<session> idx=<window-index>
rk notify topology      sess=<session> [idx=<window-index>]
```

Implementation outline:

1. Determine the relevant tmux socket name (from `$TMUX` env, parsed to
   extract `-L <socket>` equivalent — tmux exposes this as the third
   colon-field of `$TMUX`).
2. Read `~/.run-kit/run/<socket>.json` (lockfile written by `rk serve`
   on startup; contains `{port, pid, started_at}`). If missing or PID
   no longer running, exit 0 silently.
3. POST `http://127.0.0.1:<port>/notify` with a small JSON body:
   `{kind, server, session, windowIndex}`.
4. Hard cap on total time (e.g. 500ms) — hooks must not back up tmux's
   event loop. Use a tight `context.WithTimeout` on the HTTP call.
5. Exit 0 on success or any failure (silent — consistent with
   `_preamble.md` §"All rk usage MUST fail silently if rk is not
   installed").

### C. `rk serve` writes a per-socket lockfile

On startup, after binding the listener:

1. Determine the tmux socket name `rk serve` is configured to relay against
   (read from existing config — `rk serve` already knows this).
2. Create `~/.run-kit/run/` if absent.
3. Write `~/.run-kit/run/<socket>.json` atomically (write to
   `<socket>.json.tmp`, then rename) containing:
   ```json
   {"port": 3000, "pid": 296756, "started_at": "2026-05-28T08:46:58Z", "socket": "kits"}
   ```
4. On shutdown (signal handler / defer), remove the lockfile.
5. On startup, if a lockfile already exists for this socket and the
   referenced PID is still alive, refuse to start with a clear error
   (this is a desirable side-effect — prevents accidental double-serve
   on the same socket).

### D. Backend `/notify` endpoint and generation-bumped SSE loop

New endpoint: `POST /notify` (loopback-only — bind check
`r.RemoteAddr` starts with `127.` or `::1`, otherwise 403). Body:
`{kind: "window-active" | "topology", server, session, windowIndex?}`.
Handler bumps an in-memory generation counter (atomic `int64`) for the
relevant server.

The SSE loop in `app/backend/api/sse.go` is refactored:

- **Before**: `time.Sleep(2500ms)` between snapshot builds.
- **After**: `select` over (a) a `chan struct{}` fed when the generation
  counter bumps, and (b) a `time.NewTicker(safetyPollInterval)` for the
  backstop. `safetyPollInterval = 12 * time.Second` (chosen between 10–15s
  per discussion). On any signal, invalidate the relevant server's
  snapshot cache, build the next snapshot, broadcast.

The existing `prevIDs` vs `currentIDs` diff used for board stale-entry
cleanup (lines 428–455 in `sse.go`) is currently inside the poll loop. It
must move into the snapshot builder so it runs on every hook-driven
snapshot — otherwise board cleanup latency stays at the safety-net poll
cadence. This is a small refactor: extract `detectKilledWindowIDs(prev,
current)` and call it from the snapshot-build entry point.

### E. Frontend: URL becomes write-only after mount

`app/frontend/src/app.tsx`:

1. **Delete** `userNavTimestampRef` and all references to it.
2. **Delete** the `elapsed < 3000` guard in the reconciliation effect.
3. **Delete** the local-state navigation in `navigateToWindow` — clicking
   a sidebar window calls `selectWindow(server, session, windowIdx)`
   only. No `navigate(...)` from the click handler; the route updates
   when the SSE-driven `isActiveWindow` change arrives.
4. **Add** a one-shot mount-time reconciler: on the first
   `currentSession` value after mount, if the URL's `$window` exists in
   the snapshot AND `currentSession.windows.find(w => w.isActiveWindow)?.index !== Number(urlWindow)`,
   fire one `selectWindow(server, session, Number(urlWindow))` to align
   tmux with the URL. This honors the resumable-bookmark semantics on
   reload/deep-link. Mark this with a `hasAlignedToUrlRef` boolean
   guard so it runs exactly once per mount.
5. **Keep** the derived-URL reconciler effect, but simplify it: when
   `currentSession.windows.find(w => w.isActiveWindow).index !==
   Number(urlWindow)`, call `navigate({to, params, replace: true})`.
   No debounce, no conditional suppression. Truth wins, always.

### F. Optimistic pending state on sidebar click (polish)

After E, sidebar clicks have a perceived gap between click and snapshot
arrival. To bridge it, the sidebar maintains a transient `pendingWindow:
{server, session, index} | null` cleared by the next snapshot whose
active window matches it (confirmation) or differs from it (overridden
— truth wins). The pending row renders with the existing selected
styling. This is purely visual; the route still tracks server truth.

### G. Boards: cleanup migration + optional active badge

Boards refactor item — extract the diff used by board cleanup so it
operates on the snapshot-build event (hook-driven or safety-net), not
the timer:

```go
// Before: inline in poll loop
// After: called by snapshot builder
func (s *Server) reconcileBoardEntries(server string, prev, current map[string]struct{}) {
    killed := windowIDsRemoved(prev, current)
    for id := range killed {
        s.tmux.RemoveAllByWindowID(server, id)
        s.broadcastBoardChanged(server, boardChangedPayload{Change: "cleanup", WindowID: id})
    }
}
```

Optional UX win (low priority — can ship in a follow-up): add a small
"tmux-active" visual indicator (subtle ring/dot) to `BoardPane` when its
underlying window matches `currentSession.windows.find(w =>
w.isActiveWindow)?.windowId`. Required data already flows through
`BoardEntry` after a tiny backend addition (include `isActiveWindow` in
`BoardEntry`).

### H. Multi-client convergence semantics (spec-level)

Spec must record:

- All clients viewing the same server's `/$server/$session/$window`
  route converge on the same window (the "yank" behavior).
- Clients viewing `/board/$name` routes ignore active-window changes —
  they don't yank, because the route they're on isn't a session/window
  route. The SSE stream still arrives; only the
  session-route-rendering layer reacts to `isActiveWindow`.
- Clients viewing different rk-managed tmux servers do not affect each
  other — each server has its own snapshot stream and its own truth.

## Affected Memory

- `run-kit/architecture`: (modify) document the tmux-hook → `rk notify`
  → SSE-push pipeline; the demoted safety-net poll; the per-socket
  lockfile under `~/.run-kit/run/`; multi-client convergence semantics.
- `run-kit/tmux-sessions`: (modify) record the canonical hooks added to
  `~/.rk/tmux.conf`, their format-variable usage, and the idempotent
  install-on-startup behavior of `rk serve`.
- `run-kit/ui-patterns`: (modify) URL is a resumable bookmark, not a
  source of truth; sidebar clicks are pure mutations; the pending-state
  pattern.

## Impact

**Backend (Go)**

- `app/backend/api/sse.go`: poll loop refactored to generation-counter +
  safety ticker; board-cleanup diff extracted from poll loop into
  snapshot builder. `ssePollInterval` removed; `safetyPollInterval`
  introduced.
- `app/backend/api/router.go`: register `POST /notify` (loopback-only).
- `app/backend/api/notify.go` (new): handler + generation counter
  manager.
- `app/backend/cmd/rk/notify.go` (new): `rk notify` subcommand.
- `app/backend/cmd/rk/serve.go`: write/remove the per-socket lockfile;
  install hooks idempotently on managed tmux servers at startup.
- `app/backend/internal/tmux/` (or a new `internal/hooks/` package):
  hook installation helper used by `serve`.
- `app/backend/build/tmux.conf`: add the four `set-hook` lines.

**Frontend (TypeScript)**

- `app/frontend/src/app.tsx`: remove `userNavTimestampRef` and the
  debounce; add one-shot mount-time reconciler; simplify the
  reconciliation effect; clean up `navigateToWindow`.
- `app/frontend/src/components/sidebar/index.tsx` and
  `window-row.tsx`: add pending-state visual (optional polish).

**Tests**

- Backend: unit tests for `rk notify` lockfile discovery and failure
  modes; integration test simulating a hook→notify→SSE-push roundtrip;
  test that loopback-only enforcement rejects non-loopback requests.
- Frontend: Vitest tests for the simplified reconciler (URL follows
  `isActiveWindow`, no debounce); test the mount-time URL alignment
  fires exactly once.
- E2E: Playwright test — start session, run a backend mutation
  equivalent to `rk riff` (or invoke the API), assert the sidebar
  highlight moves within a bounded latency (e.g., 500ms).

**Dependencies**

- No new external dependencies. `rk notify` uses the standard library's
  `net/http` for the localhost POST.

**Migration / rollout**

- Hooks must be installed retroactively on any rk-managed tmux server
  already running when the new `rk serve` starts. This is automatic
  (idempotent install on startup); no user action required.
- Frontend behavior change is observable but non-breaking — clicks
  still navigate, just via the snapshot path instead of local state.

**Constitution alignment**

- Principle I (Security First): `exec.CommandContext` with timeouts —
  applies to the `set-hook` install calls; the loopback-only `/notify`
  endpoint avoids exposing the bump primitive externally.
- Principle II (No Database): the lockfile is a small JSON file under
  `~/.run-kit/run/`, written atomically; no DB. The generation
  counter is in-memory (rebuilt on `rk serve` restart, snapshot poll
  catches up via the safety-net).
- Principle III (Wrap, Don't Reinvent): hooks are pure tmux primitives
  — declarative config, no reimplementation.
- Principle IV (Minimal Surface Area): one new endpoint (`/notify`,
  loopback-only), one new CLI subcommand (`rk notify`). No new routes.
- Principle VI (Tmux Sessions Survive Server Restarts): preserved —
  hooks live in tmux config, persist independently of `rk serve`.

## Open Questions

- **Unmanaged tmux servers.** What's the intended behavior for tmux
  servers that `rk serve` doesn't manage (started by hand, no
  `~/.rk/tmux.conf` loaded)? Today these would have no hooks; they
  fall back to the 12s safety-net poll. Is that acceptable, or should
  there be a UI affordance making the "this server is slow because no
  hooks installed" state legible? (Initial position: acceptable for v1
  — the safety-net poll keeps things eventually consistent, and the
  primary `rk riff` workflow always uses an rk-managed tmux server.
  But worth confirming explicitly.)
- **Exact `safetyPollInterval` value.** Discussed range 10–15s; intake
  proposes 12s. Spec stage should confirm.
- **Lockfile location.** `~/.run-kit/run/<socket>.json` proposed —
  parallel to `~/.run-kit/tmux.conf` which already exists. Confirm at
  spec stage.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Tmux is the sole source of truth for "current window" per server; URL is a resumable bookmark used only on initial mount | Discussed at length — user explicitly chose tmux-as-truth over client-as-truth after both were laid out with tradeoffs | S:95 R:90 A:90 D:95 |
| 2 | Certain | All clients viewing the same server converge on the same window ("yank" behavior); clients on different servers stay independent | Discussed — user confirmed yanking is OK for a single-person tool; per-server isolation falls out of the multi-tmux-server topology run-kit already has | S:95 R:85 A:90 D:95 |
| 3 | Certain | Hooks installed in `~/.rk/tmux.conf` (canonical config, shared by every rk-managed tmux server) — no per-server install needed beyond startup-time enforcement | Verified empirically: `~/.rk/tmux.conf` is already used by `-L kits`, `-L t2`, `-L t3` per the running ps output | S:95 R:90 A:95 D:95 |
| 4 | Certain | `rk notify` is a new CLI subcommand that reads a per-socket lockfile written by `rk serve` on startup — discovery happens inside `rk`, not in tmux config | Discussed — chosen over Unix sockets and tmux-config-side curl/jq for cleanest fit with existing rk patterns (e.g., `rk shell-init`, `rk context`) | S:90 R:80 A:90 D:90 |
| 5 | Certain | The 3-second `userNavTimestamp` debounce is deleted entirely (not tuned) — it exists only to arbitrate a race that the new topology removes | Discussed — root-cause analysis identified this as the structural problem; tuning it has been tried and failed multiple times | S:95 R:85 A:95 D:95 |
| 6 | Certain | On initial mount, fire one `select-window` to align tmux with the URL — this is what makes reload/deep-link work | Discussed — user confirmed "the one I was looking at" is the desired reload behavior | S:95 R:90 A:90 D:95 |
| 7 | Confident | The four hook events are `after-select-window`, `after-new-window`, `after-kill-window`, `after-rename-window` | After-select-window covers riff and manual switches; after-new-window covers window creation by any caller; after-kill-window drives the board cleanup; after-rename-window catches name edits visible in sidebar. Other hooks (e.g., session-window-changed) overlap with these and are omitted to keep the surface minimal | S:80 R:75 A:80 D:75 |
| 8 | Confident | `safetyPollInterval = 12 * time.Second` (demoted from the current 2500ms primary cadence) | Discussed range 10–15s; 12s is the midpoint and gives unmanaged tmux servers eventual consistency without burning CPU on managed servers where hooks make polling redundant | S:70 R:80 A:75 D:65 |
| 9 | Confident | Tmux hook latency is ~78µs end-to-end — the hook approach will deliver sub-100ms perceived UI updates | Measured empirically on tmux 3.6a running on this machine before authoring this intake | S:95 R:90 A:95 D:85 |
| 10 | Confident | `POST /notify` is loopback-only (rejects non-127./::1 RemoteAddr with 403) | Defensive default — the notify endpoint only needs to be reachable from `rk notify` running on the same host. No reason to expose it on the LAN | S:85 R:80 A:90 D:85 |
| 11 | Confident | Boards are orthogonal — board route `/board/$name` ignores `isActiveWindow` changes (no yank), but board cleanup gets faster as a free win | Analyzed via Explore agent — board state is per-server in `@rk_board`, keyed by stable window_id, route is independent of session/window route | S:85 R:85 A:90 D:85 |
| 12 | Confident | The board-cleanup `prevIDs` vs `currentIDs` diff moves out of the poll loop into the snapshot builder | Required by the architecture: snapshots are now event-driven, so any logic that depends on snapshot transitions must live where snapshots are built, not where they used to be triggered | S:90 R:75 A:90 D:90 |
| 13 | Confident | `rk serve` installs hooks idempotently on managed tmux servers at startup, in addition to the static `~/.rk/tmux.conf` entries | Belt-and-suspenders: handles the case where a tmux server was started before the new `rk serve` version (or where `~/.rk/tmux.conf` is overridden) | S:80 R:80 A:80 D:80 |
| 14 | Confident | The lockfile path is `~/.run-kit/run/<socket>.json` — parallel to the existing `~/.run-kit/tmux.conf` | Follows existing convention; `~/.run-kit/` is already the rk state directory | S:80 R:80 A:85 D:80 |
| 15 | Confident | Optimistic pending state on sidebar click is a polish item, not blocking — base architecture is correct without it | Discussed as a separate "free win"; the snapshot turnaround is fast enough (<100ms) that the perceptual gap may not need a pending indicator at all | S:75 R:85 A:80 D:75 |
| 16 | Confident | "Tmux-active" badge on `BoardPane` is optional / follow-up — not required for the core fix | Discussed as a free win; nice-to-have, doesn't affect the desync resolution | S:80 R:90 A:85 D:80 |
| 17 | Tentative | The hook body is `run-shell -b "rk notify ... 2>/dev/null"` (background, silent on failure) | `-b` runs the command in the background so it doesn't block tmux; `2>/dev/null` suppresses stderr if `rk` isn't on PATH or the lockfile is stale. Worth a spec-stage confirmation that `-b` is the right tmux flag (vs. omitting and trusting the rk-side timeout) | S:60 R:70 A:65 D:60 |
| 18 | Tentative | Unit test strategy: lockfile-discovery happy/sad paths, loopback enforcement, hook-install idempotency. Integration test: trigger via API and assert SSE push latency. E2E: bounded-latency assertion in Playwright | Test scope is reasonable but exact assertions (latency bound, retry budget) need spec-stage refinement | S:65 R:75 A:65 D:60 |
| 19 | Unresolved | Behavior on unmanaged tmux servers (started outside `rk serve`, no `~/.rk/tmux.conf`) — accept fallback to 12s safety-net poll, or surface a UI affordance? | Deferred — user flagged the question, initial position is "acceptable for v1" but should be confirmed at spec stage. Low blast radius (worst case is users connecting to hand-started tmux see slower updates), but a UI hint may be worth the modest cost | S:55 R:75 A:55 D:50 |

19 assumptions (6 certain, 10 confident, 2 tentative, 1 unresolved). Run /fab-clarify to review.
