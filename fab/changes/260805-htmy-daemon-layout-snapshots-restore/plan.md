# Plan: Daemon Layout Snapshots + Restore

**Change**: 260805-htmy-daemon-layout-snapshots-restore
**Intake**: `intake.md`

## Requirements

### Snapshot Capture: tmux layout reads (`internal/tmux`)

#### R1: Layout read helpers
`internal/tmux` MUST expose read-only layout query helpers that derive a server's full recreate-able layout, all routed through the existing `Run`/`RunOutput` core (`exec.CommandContext` argument slices, `TmuxTimeout` — Constitution §I):

- Sessions: name, creation time (`#{session_created}`), raw `@session_color` value.
- Windows (all sessions, `list-windows -a`): owning session, window id (`@N`), index, name, active flag, layout string (`#{window_layout}`), raw `@color` / `@rk_type` / `@rk_url` / `@rk_marker` values.
- Panes (all sessions, `list-panes -a`): owning window id, pane id (`%N`), index, current working directory, current command, active flag.

Board pin-sessions (`PinSessionPrefix`) and the control anchor (`ControlAnchorSessionName`) SHALL be excluded from the session set, and windows/panes whose only surfaced row is under a pin-session link are keyed to their non-pin session (dedup by window id).

A dead/unreachable server MUST surface as an **error** from these helpers (classified via `IsServerGone`), NOT as an empty result — a capture racing server death must never look like "server is empty".

- **GIVEN** a live tmux server with two sessions, one board-pinned window, and a split window
- **WHEN** the layout helpers run against it
- **THEN** every user-facing session/window/pane is returned with ids, indexes, names, cwds, commands, layout strings, and rk option values, with the pin-session and `_rk-ctl` rows absent and each window appearing exactly once
- **AND** running the same helpers against a dead socket returns a non-nil error

### Snapshot Core: schema + capture (`internal/snapshot`)

#### R2: Snapshot schema and capture assembly
A new `internal/snapshot` package SHALL define the JSON snapshot schema and a `CaptureServer(ctx, server)` assembler:

- Top level: `server`, `takenAt`, `serverRank` (nullable, from `@rk_server_rank`), `sessionOrder` (from `@rk_session_order`), `sessions[]`, plus tombstone-only fields `diedAt` / `auditedKill` (see R5).
- Session: `name`, `createdAt` (unix seconds), `color` (raw `@session_color`), `windows[]`.
- Window: `index`, `id`, `name`, `active`, `layout`, `color`, `rkType`, `rkUrl`, `marker`, `panes[]`.
- Pane: `id`, `index`, `cwd`, `command` (informational only — restore never relaunches it), `active`.

Explicitly NOT captured: scrollback contents, environment variables, running processes. A capture against a dead/racing server MUST return an error (propagated from R1), never an empty snapshot.

- **GIVEN** stubbed layout reads describing a server
- **WHEN** `CaptureServer` runs
- **THEN** it returns a `Snapshot` carrying exactly the capture set above
- **AND** a dead-server read error propagates as a capture error

#### R3: Storage layout, retention, dedup
Snapshots SHALL be stored under `$XDG_STATE_HOME/rk/snapshots` (default `~/.local/state/rk/snapshots` when the env var is unset) — state dir, not cache, because recovery artifacts must not be droppable:

- Latest per server: `{server}.json`, written atomically (temp file + rename, mirroring `internal/push.writeFileAtomic`).
- Rolling history: `{server}/{unix-ts}.json`, retained to the **last 10** entries (older pruned on write).
- Write dedup: a write whose content equals the current latest **ignoring `takenAt`** SHALL be skipped entirely (no latest rewrite, no history entry) so safety-interval passes on quiet servers do not churn history.

- **GIVEN** a store with an existing latest snapshot for `kit`
- **WHEN** an identical-content snapshot (different `takenAt`) is written
- **THEN** neither the latest file nor the history changes
- **AND** a changed-content write replaces the latest atomically, appends a history entry, and prunes history beyond 10

### Daemon Writer: periodic + event-debounced snapshots

#### R4: Snapshotter wired into `rk serve`
A `snapshot.Snapshotter` SHALL run inside the serve process (started in `cmd/rk/serve.go` after the tmuxctl Supervisor starts, stopped with the serve context):

- **Scope**: snapshots exactly the covered servers — the Supervisor's live client set (which already excludes `rk-test-*` and `.lock` candidates via `isTmuxSocketCandidate`). No new enumeration/filter logic.
- **Event debounce**: on a short check tick (2s), compare each covered server's control-mode generation counter to the last-written generation; write after the counter has been **stable for one full tick** (churn coalesces; no write mid-burst).
- **Safety interval**: every ≥60s per server, capture and write-if-changed regardless of events (covers missed notifications and layout-invisible drift), mirroring the existing safety-poll backstop pattern at a coarser cadence.
- **Resilience**: capture/store failures are logged (`slog.Warn`/`Debug`) and never crash or block serving; the Snapshotter failing to start is non-fatal (mirrors the Supervisor's own degradation stance).

- **GIVEN** a running snapshotter with a fake server source and temp store
- **WHEN** a server's generation advances and then goes quiet
- **THEN** exactly one snapshot write lands after the debounce
- **AND** with no generation movement, a safety-interval pass captures and dedups (no history churn when content is unchanged)

#### R5: Tombstone on server death
When a covered server's socket is removed (the Supervisor's existing `closeSocket` seam — "socket removed (tmux server exited)"), the server's latest snapshot SHALL be tombstoned, not deleted:

- `{server}.json` is rewritten+renamed to `{server}.died-{unix-ts}.json` with `diedAt` set inside the JSON.
- `auditedKill: true` is recorded when the death was preceded (within a 30s window) by a kill through run-kit's audited kill path — the POST `/api/servers/kill` handler notifies the snapshotter (`NoteAuditedKill`) before invoking `tmux.KillServer`.
- Tombstones are pruned to the last 10 per server (same retention posture as history). History directories are left intact.
- The Supervisor SHALL expose the removal seam as an optional callback (set before `Start`) plus `Sockets()` / `Generation(name)` accessors for R4's scope/debounce reads; all are no-ops when unwired so existing callers/tests are untouched.

- **GIVEN** a latest snapshot for `kit` and a snapshotter wired to the removal seam
- **WHEN** the socket-removed callback fires for `kit`
- **THEN** `kit.json` no longer exists and a `kit.died-{ts}.json` tombstone exists with `diedAt` set
- **AND** when `NoteAuditedKill("kit")` was called ≤30s earlier, the tombstone carries `auditedKill: true`

### Restore: `rk snapshot` CLI (`cmd/rk`)

#### R6: `rk snapshot list` / `show` read surfaces
A new `rk snapshot` subcommand family SHALL provide read-only inspection:

- `rk snapshot list [<server>]` — one row per available snapshot (latest live-server snapshots AND died tombstones), showing server, state (`live` / `died <age>`), snapshot age, session/window counts, and history depth. The optional `<server>` arg filters to one server. Rendered lists cap at 10 rows with a stated truncation notice and `--all` to lift it (Toolkit Principle 9, mirroring `rk reaper`).
- `rk snapshot show <server> [--at <unix-ts>]` — prints the stored layout (sessions → windows → pane cwds + former commands) without touching tmux. `--at` selects a history/tombstone entry by its unix timestamp; omitted selects the latest (live latest first, else newest tombstone).
- Both are data output on stdout (`cmd.OutOrStdout()`), unaffected by `--quiet`.

- **GIVEN** a store containing a live latest for `kit` and a tombstone for `fabKit1`
- **WHEN** `rk snapshot list` runs
- **THEN** both appear with correct state labels and counts, and `rk snapshot show fabKit1` prints its sessions, windows, cwds, and former commands

#### R7: `rk snapshot restore` semantics
`rk snapshot restore <server> [--at <unix-ts>]` SHALL recreate a dead server's layout from its snapshot (mirroring the manual fabKit1 restore):

- **Refusal**: if the target server is alive with ≥1 user-facing session (post-filter, per `ListSessions`), restore refuses with a clear error. No `--force` in v1 — restore is for dead servers.
- **Recreation** (every tmux invocation through `internal/tmux`, explicit server socket): sessions recreated oldest-first with original names; each session's windows recreated at their original indexes (created in index order, `RenumberWindow` fixups when the born base-index differs from the stored index); each pane's cwd recreated via `split-window -c` fresh shells; multi-pane windows get `select-layout` with the stored layout string, best-effort — a layout the pane set no longer supports is reported as skipped, never fatal.
- **Server birth hygiene**: the first `new-session` births the server with the same pins as `CreateSession` (config `-f`, `CleanEnvForServer`, `ServerBirthDir`).
- **Options reapply**: `@rk_server_rank`, `@rk_session_order`, session color, and per-window `@color` / `@rk_type` / `@rk_url` / `@rk_marker` are reapplied from the snapshot; each session's stored active window is re-selected.
- **No process relaunch**: panes come back as fresh shells at the recorded cwd. The stored former command is DISPLAYED in the restore report only.
- **Report**: prints what was recreated (sessions/windows/panes), what was skipped (missing cwds fall back with a note, failed layout applies), and the per-window former command so the user can decide what to resume.
- A missing cwd (deleted worktree) SHALL NOT fail the restore: the pane is created without `-c` (server default dir) and noted in the report.

- **GIVEN** a tombstoned snapshot of a dead server with 2 sessions, ordered windows, a split window, and rk options
- **WHEN** `rk snapshot restore <server>` runs
- **THEN** the server exists with matching session/window names and indexes, pane cwds, reapplied options, fresh shells (no relaunched processes), and a report listing former commands
- **AND** running it against a live server with sessions exits non-zero with a refusal message and touches nothing

### Boundaries

#### R8: Constitution II / VI boundary
Snapshots are write-only disaster-recovery backups, not a state store: no HTTP handler or request-time read path SHALL read snapshot files to answer queries — live state continues to be derived from tmux/filesystem exactly as today. The only snapshot reader is the user-initiated `rk snapshot` CLI. The daemon SHALL NOT restore automatically (Constitution VI: restore is explicitly user-initiated).

- **GIVEN** the completed change
- **WHEN** grepping `api/` for `internal/snapshot` consumers
- **THEN** the only api-side touchpoint is the fire-and-forget `NoteAuditedKill` notifier (a write-path annotation), and no handler reads snapshot data

#### R9: Input validation
The CLI's `<server>` argument SHALL be validated with `validate.ValidateServerName` before any filesystem or tmux use, and `--at` parses as a positive integer timestamp. All subprocess work stays inside `internal/tmux` (no shell strings, no inline tmux construction).

- **GIVEN** `rk snapshot restore "bad/../name"`
- **WHEN** the command runs
- **THEN** it exits with a validation error before touching disk or tmux

### Non-Goals

- Board pin-session / board-membership restore — pinned windows come back via their home sessions; board pins are re-derivable UI state, deliberately out of v1.
- Scrollback, environment, or process restore — explicitly excluded by the intake.
- POST endpoint / web-UI restore surfacing — v1 is CLI-only (intake assumption #7).
- Snapshotting uncovered servers (`rk-test-*`, PTY-unavailable hosts) — scope is the covered set only.

### Design Decisions

#### Snapshotter home: `internal/snapshot`, wired in `cmd/rk/serve.go`
**Decision**: The writer lives in a new `internal/snapshot` package and is wired in `serve.go` next to the Supervisor, not in `internal/daemon`.
**Why**: The intake's "daemon" is the long-running serve process; the `internal/daemon` package is the tmux-session daemonizer (start/stop lifecycle) and holds no observation machinery. The Supervisor + serve wiring is where covered-server observation already lives.
**Rejected**: Extending `internal/daemon` (wrong layer — it never sees sockets/events); hooking the SSE hub's poll loop (only runs while clients are connected; snapshots must run unconditionally).
*Introduced by*: 260805-htmy-daemon-layout-snapshots-restore

#### Event debounce via generation-counter ticks, not a new EventSink
**Decision**: The snapshotter polls the Supervisor's in-memory per-server generation counters on a 2s tick and writes after one stable tick, instead of registering a new control-mode EventSink.
**Why**: Generation counters already increment on every layout-changing notification, the read is an in-memory int (zero subprocess cost), and tick-compare gives debounce for free without touching the Client read-loop contract (callbacks must not block).
**Rejected**: A dedicated EventSink chained into `NewHubSinkFactory` (couples snapshotting into the SSE sink path and needs its own debounce timer plumbing anyway); reusing the SSE hub's Wait fan-in (hub only polls servers with connected clients).
*Introduced by*: 260805-htmy-daemon-layout-snapshots-restore

#### Tombstone rewrites JSON (diedAt/auditedKill), not rename-only
**Decision**: Tombstoning loads the latest snapshot, stamps `diedAt` (+ `auditedKill` when noted), atomically writes `{server}.died-{ts}.json`, and removes `{server}.json`.
**Why**: A bare rename cannot carry the audited-kill annotation the intake requires; stamping inside the JSON keeps one machine-readable artifact.
**Rejected**: Sidecar metadata files (two files to keep consistent); encoding "audited" in the filename (unparseable growth of filename grammar).
*Introduced by*: 260805-htmy-daemon-layout-snapshots-restore

## Tasks

### Phase 1: Capture & restore primitives (`internal/tmux`)

- [x] T001 Add `app/backend/internal/tmux/layout.go` + `layout_test.go`: `LayoutSession`/`LayoutWindow`/`LayoutPane` structs, `ListLayoutSessions`/`ListLayoutWindows`/`ListLayoutPanes` (tab-delimited formats via `tmuxExecServer`), pure parse helpers with table-driven tests (pin/anchor filtering, window-id dedup across pin links, malformed-line skips, dead-server error propagation via `IsServerGone`) <!-- R1 -->
- [x] T002 [P] Add restore mutators to `app/backend/internal/tmux/layout.go`: `CreateSessionForRestore(name, windowName, cwd, server) (windowID, error)` (new-session `-d -P -F '#{window_id}'` with configArgs + `CleanEnvForServer` + `ServerBirthDir` server-birth pins), `CreateWindowAtIndex(session, index, name, cwd, server) (windowID, error)` (new-window `-d -P` at explicit `=session:index` target), `SelectLayout(windowID, layout, server) error`; pure arg-builder unit tests <!-- R7 -->

### Phase 2: Snapshot core (`internal/snapshot`)

- [x] T003 Create `app/backend/internal/snapshot/snapshot.go` + `snapshot_test.go`: `Snapshot`/`Session`/`Window`/`Pane` types (JSON schema per R2) and `CaptureServer(ctx, server)` assembling from `internal/tmux` layout reads + `GetSessionOrder`/`GetServerRank`, with injectable function seams for tests; dead-server error propagation test <!-- R2 -->
- [x] T004 Create `app/backend/internal/snapshot/store.go` + `store_test.go`: `Store` with `DefaultDir()` (`$XDG_STATE_HOME` → `~/.local/state/rk/snapshots`), atomic `Write` (latest + history + prune-to-10 + content-dedup ignoring `takenAt`), `List`/`LoadLatest`/`LoadAt` readers (latest + tombstones + history), `Tombstone(server, diedAt, audited)` (stamp + rename + prune tombstones to 10) <!-- R3, R5 --> <!-- rework DONE: zero-session write guard in Store.Write (skip + slog.Debug, TestWriteZeroSessionSnapshotSkipped); writeFileAtomic extracted to shared internal/fsatomic.WriteFile (push + snapshot copies deleted, remote.Save converted); same-second history collision bumps ts forward to the next free second (TestWriteSameSecondHistoryCollisionBumpsForward); Store.Dir and Store.HistoryCount dropped (tests use in-package historyTimestamps) -->
- [x] T005 Create `app/backend/internal/snapshot/snapshotter.go` + `snapshotter_test.go`: `ServerSource` interface (`Sockets()`, `Generation(name)`), tick loop (2s check / 60s safety, test-overridable), one-stable-tick debounce, write-if-changed, `OnServerRemoved(name)` → tombstone, `NoteAuditedKill(name)` 30s window; tests with fake source + temp store + short intervals <!-- R4, R5 --> <!-- rework DONE: snapshot() now returns success and tick advances writtenGen/lastPass/dirtySince only after it (failed capture retries on the very next tick — TestSnapshotterFailedCaptureRetriesNextTick); per-server removedEpoch bumped in OnServerRemoved before a writeMu-serialized Tombstone, snapshot() re-checks the epoch under writeMu before writing so a post-removal write drops (TestSnapshotterRemovalMidCaptureDropsWrite) -->

### Phase 3: Daemon wiring

- [x] T006 Extend `app/backend/internal/tmuxctl/supervisor.go` + `supervisor_test.go`: `Sockets() []string`, `Generation(name) int64` accessors and an `OnSocketRemoved func(string)` callback field (invoked from `closeSocket` outside the mutex, nil-safe); tests for accessor contents and callback firing on socket removal <!-- R4, R5 -->
- [x] T007 Wire the snapshotter: in `app/backend/cmd/rk/serve.go` construct `snapshot.NewStore(snapshot.DefaultDir())` + `snapshot.NewSnapshotter(supervisor, store)` after `supervisor.Start`, set `supervisor.OnSocketRemoved`, start with serve ctx (failure = `slog.Warn`, non-fatal); add `api.Server.SetServerKillNotifier(func(server string))` in `app/backend/api/tmuxctl_bridge.go` and invoke it from `handleServerKill` (`app/backend/api/servers.go`) before `KillServer`; test the notifier call in `servers_test.go` <!-- R4, R5, R8 -->

### Phase 4: CLI

- [x] T008 Create `app/backend/cmd/rk/snapshot.go` + `snapshot_test.go`: `snapshot` parent command, `list [<server>]` (rows: server, live/died state, age, session/window counts, history depth; 10-row cap + `--all` + truncation notice) and `show <server> [--at]` (layout tree + former commands); `validate.ValidateServerName` on args; data via `cmd.OutOrStdout()` <!-- R6, R9 -->
- [x] T009 Create `app/backend/internal/snapshot/restore.go` + `restore_test.go`: `Restore(ctx, server, snap)` engine with injectable tmux seams — alive-with-sessions refusal, oldest-first session recreation, index-ordered windows + `RenumberWindow` fixups, pane splits with missing-cwd fallback, best-effort `SelectLayout`, active-window select, options reapply (`SetServerRank`/`SetSessionOrder`/`SetSessionColor`/`SetWindowOptions`), `Report` struct (created/skipped/former commands); add the `restore <server> [--at]` subcommand to `app/backend/cmd/rk/snapshot.go` rendering the report <!-- R7, R9 --> <!-- rework DONE: Restore now takes the CLI-validated server name, uses it as the operative target, and rejects a snapshot whose Server field disagrees (TestRestoreRejectsServerMismatch); Pane.Active wired — new tmux.SelectPane helper (Run core argv) re-selects a stored active pane beyond position 0 after layout apply via split-returned pane ids (splits are -d, so position 0 needs no call; TestRestoreRecreatesFullLayout asserts the select-pane call, failed-split case asserts none); SelectLayout gained the `--` guard (mirrors set-buffer, verified by the live round-trip test) and the split-order fidelity limit is documented at the pane-recreation loop -->
- [x] T010 Register `snapshotCmd` in `app/backend/cmd/rk/root.go`; run `cd app/backend && gofmt -l . && go test ./...` and fix failures <!-- R6 -->

## Execution Order

- T001 blocks T003; T002 blocks T009
- T004 blocks T005, T008, T009; T005 + T006 block T007
- T008 and T009 can proceed once Phase 2 lands; T010 is last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `internal/tmux` layout helpers return sessions/windows/panes with ids, indexes, names, cwds, commands, layout strings, and rk option values; pin-sessions and `_rk-ctl` are filtered; dead servers error (unit-tested at the parser + error-classification level)
- [x] A-002 R2: `snapshot.CaptureServer` assembles the full R2 capture set and nothing more (no scrollback/env/process fields exist in the schema)
- [x] A-003 R3: Store writes latest atomically, keeps `{server}/{ts}.json` history pruned to 10, and dedups identical content ignoring `takenAt`
- [x] A-004 R4: `rk serve` starts the snapshotter with the Supervisor as its server source; covered servers snapshot on debounced events and the ≥60s safety pass; failures degrade with a log line, never a crash
- [x] A-005 R5: Socket removal tombstones the latest snapshot to `{server}.died-{ts}.json` with `diedAt`, `auditedKill` set when `/api/servers/kill` preceded it within the window, tombstones pruned to 10
- [x] A-006 R6: `rk snapshot list`/`show` render stored layouts read-only with the documented columns/tree, 10-row cap + `--all`, and `--at` selection
- [x] A-007 R7: `rk snapshot restore` recreates sessions/windows/panes/options per R7, refuses live-with-sessions targets, and prints the report with former commands

### Behavioral Correctness

- [x] A-008 R7: Restore relaunches NO processes — every recreated pane is a fresh shell; the stored command appears only in the report output
- [x] A-009 R4: A quiet covered server produces no history churn (safety passes dedup); a churning server coalesces to a single post-quiescence write

### Scenario Coverage

- [x] A-010 R5: Tombstone + audited-kill scenarios covered by snapshotter/store unit tests (removal after `NoteAuditedKill` vs. bare removal)
- [x] A-011 R7: Refusal, missing-cwd fallback, and failed-layout skip paths covered by restore engine tests via injected seams

### Edge Cases & Error Handling

- [x] A-012 R1: A capture racing server death never overwrites a good latest with an empty snapshot — both paths covered: dead-server reads error (write never reached), and the ALIVE-with-zero-user-sessions floor case (`_rk-ctl` anchor holding the socket up, `internal/tmuxctl/client.go:405`) is guarded in `Store.Write` — `len(snap.Sessions)==0` skips the write with a `slog.Debug` line (`TestWriteZeroSessionSnapshotSkipped` proves the good latest and history survive). The removal-race hardening also landed: an in-flight capture that races `OnServerRemoved` drops under the removedEpoch/writeMu guard instead of resurrecting a latest after the tombstone (`TestSnapshotterRemovalMidCaptureDropsWrite`).
- [x] A-013 R9: Invalid server names and malformed `--at` values are rejected before any tmux/filesystem side effect

### Code Quality

- [x] A-014 Pattern consistency: new code follows surrounding conventions (tab-delimited tmux formats + pure parse helpers, `slog` logging, cobra command shape mirroring `reaper.go`, atomic-write idiom)
- [x] A-015 No unnecessary duplication: existing `internal/tmux` helpers (`SplitWindow`, `SelectWindowInSession`, `SetSessionOrder`, `SetServerRank`, `SetSessionColor`, `SetWindowOptions`, `GetSessionOrder`, `GetServerRank`, `IsServerGone`, `ListSessions`) are reused, not reimplemented (verified), and the atomic-write duplication is resolved: the byte-identical `writeFileAtomic` copies in `internal/push/store.go` and `internal/snapshot/store.go` are deleted in favor of ONE shared `internal/fsatomic.WriteFile` (with its own tests), and `internal/remote/store.go`'s looser tmp+rename variant in `Save` now uses it too — one implementation, three consumers.
- [x] A-016 All subprocess calls use `exec.CommandContext` argument slices with timeouts via the `internal/tmux` Run core; no shell strings, no inline tmux construction outside `internal/tmux`
- [x] A-017 New behavior ships with tests alongside (Go `_test.go` in-package per test strategy); `cd app/backend && go test ./...` passes
- [x] A-018 No database/state-store creep: snapshots are files, no request-time reads (Constitution II boundary upheld per R8) — verified: `api/` has zero `internal/snapshot` imports; the only readers are `cmd/rk/snapshot.go` (user-initiated CLI) and the package internals

### Security

- [x] A-019 R9: CLI `<server>` input is validated with `validate.ValidateServerName` before reaching subprocess or path construction; snapshot filenames derive only from validated names — and the former residual gap is closed: `Restore` now takes the validated CLI argument as its operative target and rejects a snapshot whose JSON-embedded `Server` field disagrees (`TestRestoreRejectsServerMismatch`), so no JSON-sourced value ever reaches a tmux target

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- ~~`writeFileAtomic` triplication~~ — **RESOLVED (rework)**: the byte-identical copies in `internal/push/store.go` and `internal/snapshot/store.go` are deleted; all three consumers (push, snapshot, and `internal/remote/store.go`'s looser `Save` variant) now share `internal/fsatomic.WriteFile`.
- ~~`Pane.Active` unconsumed~~ — **RESOLVED (rework)**: wired to an active-pane re-select on restore via the new `tmux.SelectPane` helper (splits are detached, so only a stored active pane beyond position 0 needs the call).
- ~~`Store.HistoryCount`~~ — **RESOLVED (rework)**: dropped; tests use the in-package `historyTimestamps` directly (the `Entry.HistoryCount` list-row field is unrelated and stays).
- ~~`Store.Dir`~~ — **RESOLVED (rework)**: dropped (had no call sites).
- Otherwise: this change adds new functionality without making existing code redundant. No existing files, functions, branches, or config became unused — the supervisor accessors/callback are additive and nil-safe, and no prior snapshot/restore mechanism existed to supersede.
- Re-review (2026-08-06) confirmed all four resolutions above are real: no `writeFileAtomic` copies remain anywhere in `app/backend`, `Store.Dir`/`Store.HistoryCount` are gone, and `Pane.Active` is consumed via `tmux.SelectPane`. Every new exported symbol has a live call site (the five `internal/tmux` restore mutators route through `productionRestoreOps`) — no zero-call-site additions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Snapshotter lives in `internal/snapshot` wired from `serve.go`, not `internal/daemon` (which is the daemonizer, not the observer) | Intake's "daemon" = the serve process; Supervisor wiring already lives in serve.go | S:70 R:85 A:85 D:80 |
| 2 | Confident | Debounce via generation-counter tick-compare (2s check, one stable tick) instead of a new EventSink | Counters already increment per layout event; in-memory reads cost nothing; avoids read-loop coupling | S:60 R:85 A:85 D:75 |
| 3 | Confident | Audited-kill marking via `NoteAuditedKill` notifier called from POST /api/servers/kill within a 30s window | Only rk-audited whole-server kill path in the serve process; window tolerates kill→socket-removal latency | S:55 R:80 A:75 D:70 |
| 4 | Tentative | Storage dir honors `$XDG_STATE_HOME`, default `~/.local/state/rk/snapshots` on all platforms incl. macOS | Intake names the Linux path; Go has no UserStateDir; a uniform path keeps `rk snapshot` docs single-shaped | S:50 R:85 A:70 D:60 |
| 5 | Tentative | Content-dedup ignores `takenAt` so quiet-server safety passes skip writes entirely (no freshness-only rewrites) | Keeps history meaningful (10 real layout changes, not 10 minutes); tradeoff: latest file's mtime/takenAt goes stale on quiet servers | S:45 R:85 A:70 D:55 |
| 6 | Confident | Pin-sessions (`_rk-pin-*`) and `_rk-ctl` excluded from capture; board membership not restored in v1 | Pinned windows persist via home sessions; boards are re-derivable UI state; anchor is tmuxctl-owned and auto-recreated | S:60 R:80 A:80 D:70 |
| 7 | Tentative | Died tombstones pruned to last 10 per server (mirrors history retention) | Intake specifies retention only for history; unbounded tombstones would grow forever; 10 mirrors assumption #6 of intake | S:40 R:90 A:70 D:60 |
| 8 | Confident | Restore places windows by creating in index order, with a new `RenumberWindow` fixup for each session's first window | Existing `MoveWindow` is reorder-only (adjacent swaps) and no-ops onto a free index — proven by the live round-trip integration test, which drove the renumber primitive | S:55 R:85 A:80 D:70 |

8 assumptions (0 certain, 5 confident, 3 tentative).
