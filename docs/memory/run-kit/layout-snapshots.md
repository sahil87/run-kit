---
type: memory
description: "Per-server tmux layout snapshots (`internal/snapshot`): the sessions/windows/panes + rk-options capture set, the `$XDG_STATE_HOME/rk/snapshots` store (atomic latest, 10-entry history, content-dedup, zero-session guard, `.died-{ts}` tombstones marked on audited kills), the Snapshotter's tick debounce + 60s safety pass + removal-race guard, `internal/tmux` layout read/restore primitives, the `rk snapshot list|show|restore` CLI (fresh shells, no relaunch), and the write-only Constitution II line."
---
# Layout Snapshots & Restore

**Domain**: run-kit

## Overview

The run-kit daemon persists a layout snapshot per covered tmux server so a server death (agent misfire, crash, reboot) is recoverable instead of a forensic reconstruction. `internal/snapshot` owns the schema, the file store, the periodic writer, and the restore engine; `rk snapshot list|show|restore` is the only reader. Snapshots are **write-only disaster-recovery backups** — no request-time path reads them, and restore never relaunches a process.

## Requirements

### Requirement: Capture set

`internal/snapshot.CaptureServer(ctx, server)` derives the whole recreate-able layout from tmux at capture time and nothing more. Scrollback contents, environment variables, and running processes MUST NOT be captured.

The JSON schema (`snapshot.go`):

| Level | Fields |
|-------|--------|
| `Snapshot` | `server`, `takenAt`, `serverRank` (nullable, `@rk_server_rank`), `sessionOrder` (`@rk_session_order`), `sessions[]`, plus tombstone-only `diedAt` / `auditedKill` |
| `Session` | `name`, `createdAt` (unix seconds), `color` (raw `@session_color`), `windows[]` |
| `Window` | `index`, `id`, `name`, `active`, `layout` (`#{window_layout}`), `color`, `rkType`, `rkUrl`, `marker`, `panes[]` |
| `Pane` | `id`, `index`, `cwd`, `command`, `active` |

`Pane.Command` is informational only — reported by restore, never relaunched. `Pane.Active` is consumed by restore's active-pane re-select.

Capture assembles from the `internal/tmux` layout reads plus `GetSessionOrder`/`GetServerRank`, grouping windows under their owning sessions with a **deterministic order** (sessions by creation time then name; windows and panes by index). Determinism is load-bearing: the store's write dedup compares serialized content, so equal layouts MUST serialize equally. The two rk option reads are best-effort — a malformed stored value degrades to `slog.Debug` with the field left empty rather than sinking the layout capture. The layout reads themselves are hard errors.

#### Scenario: Dead server never captures as empty
- **GIVEN** a capture racing its server's death
- **WHEN** the layout reads fail
- **THEN** `CaptureServer` returns an error, never an empty snapshot — an empty snapshot overwriting a good one is exactly the loss snapshots exist to prevent

### Requirement: `internal/tmux` layout primitives

`internal/tmux/layout.go` holds both halves — the read-only layout queries and the restore mutators — all routed through the package's `Run`/`RunOutput` core with `exec.CommandContext` argument slices and `TmuxTimeout` (Constitution §I).

**Reads** (tab-delimited `-F` formats + pure `parseLayout*` helpers, same shape as `parseSessions`):

- `ListLayoutSessions` — `#{session_name}`, `#{session_created}`, `#{@session_color}`.
- `ListLayoutWindows` — `list-windows -a`, keyed to the non-pin owning session, **deduplicated by window id** (a board-pinned window is linked into both its home session and its `_rk-pin-*` pin-session, so `-a` surfaces it once per link; the first non-hidden occurrence wins).
- `ListLayoutPanes` — `list-panes -a` grouped into a `windowID → panes` map, deduped by pane id.

`isLayoutHiddenSession` excludes board pin-sessions (`PinSessionPrefix`) and the `_rk-ctl` control anchor — pinned windows persist via home-session membership and the anchor is daemon-recreated. Unlike `ListSessions`, these helpers deliberately do NOT map a dead-server error to an empty result.

**Restore mutators**:

- `CreateSessionForRestore(name, windowName, cwd, server) (windowID, bornIndex, error)` — `new-session -d -P -F '#{window_id}\t#{window_index}'`; server-birth-capable, so it carries the same pins as `CreateSession` (config `-f`, `CleanEnvForServer`, `ServerBirthDir`). Returns the born index so the caller can renumber.
- `CreateWindowAtIndex(session, index, name, cwd, server)` — `new-window -d -P` at an explicit `=session:index` target.
- `RenumberWindow(session, windowID, index, server)` — `move-window -s <windowID> -t =session:<index>`. Distinct from `MoveWindow`, which is a reorder-among-existing-windows primitive built on adjacent swaps and no-ops onto a free index.
- `SelectLayout(windowID, layout, server)` — `select-layout -t <windowID> -- <layout>`; the `--` pins the layout string positionally (mirrors `set-buffer` in `SetChatSendBuffer`).
- `SelectPane(paneID, server)` — `select-pane -t %N`.

**Supervisor seams** (`internal/tmuxctl/supervisor.go`), all nil-safe/no-op when unwired: `Sockets() []string` (the covered-server set — `rk-test-*`/`.lock` candidates never open a Client, so the snapshotter inherits the daemon's scope filter with no new enumeration), `Generation(name) int64`, and the `OnSocketRemoved func(string)` callback invoked from `closeSocket` outside the mutex on the event-loop goroutine.

### Requirement: Store layout and retention

`snapshot.Store` roots at `DefaultDir()` — `$XDG_STATE_HOME/rk/snapshots` when set, else `~/.local/state/rk/snapshots` on every platform. State dir, not cache: recovery artifacts must not be droppable by contract.

```
{server}.json                 — latest snapshot (live server)
{server}/{unix-ts}.json       — rolling history, last 10
{server}.died-{unix-ts}.json  — tombstones, last 10
```

`Write` skips entirely when content equals the current latest **ignoring `takenAt`** (`ContentEqual`), so safety-interval passes on quiet servers never churn history — history holds 10 real layout changes, not 10 minutes. Both the latest and the history entry go through `fsatomic.WriteFile`; history beyond 10 entries is pruned oldest-first on write. A **same-second collision** (two content-different writes inside one second) bumps the history timestamp forward to the next free second, keeping the filename grammar a bare unix-seconds integer so `--at`/`LoadAt` stay compatible.

`Tombstone(server, diedAt, audited)` loads the latest, stamps `diedAt` (+ `auditedKill`), atomically writes `{server}.died-{ts}.json`, removes `{server}.json`, and prunes tombstones to 10; history directories are left intact. A server with no latest snapshot is a no-op.

Readers: `LoadLatest`, `LoadAt(server, ts)` (history entry, then tombstone), `Resolve(server, at)` (the entry at `at`, else the latest, else the newest tombstone), and `List(serverFilter)` (every live latest and every tombstone, newest-first, with session/window counts and history depth). The `.died-` infix can never occur inside a server name — validated names are `[A-Za-z0-9_-]`, no dots — so the filename grammar is unambiguous.

#### Scenario: Zero-session snapshot never overwrites a good latest
- **GIVEN** the `_rk-ctl` anchor holding a socket alive after the last user-facing session closes
- **WHEN** capture succeeds and yields a 0-session snapshot
- **THEN** `Store.Write` skips it with a `slog.Debug` line — the last good layout and its history survive

#### Scenario: Freshness-only recapture writes nothing
- **GIVEN** a store with an existing latest snapshot for `kit`
- **WHEN** an identical-content snapshot with a newer `takenAt` is written
- **THEN** neither the latest file nor the history changes

### Requirement: Snapshotter cadence

`snapshot.Snapshotter` runs inside the serve process over a `ServerSource` (`Sockets()` / `Generation(name)`, satisfied by the tmuxctl Supervisor) and a `Store`.

- **Debounce** — a 2s check tick compares each covered server's control-mode generation counter (an in-memory int read, zero subprocess cost) against the last written one; a write lands after the counter has been **stable for one full tick**, so event bursts coalesce into one capture.
- **Churn bound** — `maxHold` (15s) caps how long the debounce may defer a continuously-churning server, so sustained window cycling still snapshots rather than starving writes until quiescence.
- **Safety pass** — every ≥60s per server, capture and write-if-changed regardless of events, covering missed notifications and layout-invisible drift. Mirrors the SSE hub's safety-poll backstop at a far coarser cadence: snapshots need freshness, not UI latency.
- **First observation** — a newly covered server (daemon start or a fresh socket) snapshots immediately rather than waiting out a safety interval.
- **Bookkeeping advances only on success** — `writtenGen`, `lastPass`, and `dirtySince` move only after a pass whose capture succeeded and whose write landed or deduped, so a failed capture retries on the very next tick instead of being parked until the safety interval.
- **Resilience** — every failure degrades to a log line (`IsServerGone` capture errors at `Debug`, everything else `Warn`); snapshotting never crashes or blocks serving, and a snapshotter that fails to start is non-fatal.

`OnServerRemoved(server)` tombstones the dead server's latest snapshot. `NoteAuditedKill(server)` records a kill through run-kit's audited path; a removal observed within 30s tombstones as `auditedKill: true`.

#### Scenario: A capture racing removal never resurrects a live latest
- **GIVEN** an in-flight capture for a server whose socket is then removed
- **WHEN** `OnServerRemoved` bumps that server's `removedEpoch` and takes `writeMu` to tombstone
- **THEN** a write already inside `writeMu` completes and is legitimately part of the tombstone, while any write acquiring `writeMu` afterwards observes the bumped epoch and drops — no "live" latest ever reappears after the tombstone

### Requirement: `rk snapshot` CLI

`cmd/rk/snapshot.go` is a cobra parent with three children, all validating `<server>` via `validate.ValidateServerName` and `--at` as a non-negative unix timestamp **before** any filesystem or tmux use. All output goes to `cmd.OutOrStdout()` — it is data, unaffected by `--quiet` (the `reaper` posture).

- `list [<server>]` — one row per entry: server, state (`live` / `died <age> ago` / `died <age> ago (audited)`), snapshot age, session/window counts, history depth. Capped at 10 rendered rows with a stated truncation notice and `--all` to lift it (Toolkit Principle 9, mirroring `reaper`); the header count stays exact.
- `show <server> [--at <ts>]` — prints the stored layout tree (sessions → windows → panes with cwds and former commands) plus rank/session-order/death metadata, touching no tmux.
- `restore <server> [--at <ts>]` — recreates the layout and renders the report.

### Requirement: Restore semantics

`snapshot.Restore(ctx, server, snap)` recreates a dead server's layout through the `restoreOps` seam (production adapters over `internal/tmux`; tests inject fakes). Restore is user-initiated only — the daemon never restores automatically (Constitution §VI).

- **Target agreement** — the operative target is the caller-validated `server` argument, not the JSON-embedded `Server` field; a snapshot whose field disagrees is rejected. No JSON-sourced value ever reaches a tmux target.
- **Refusal** — a server alive with ≥1 user-facing session (`ListSessions`, which maps a dead server to `(nil, nil)`) is refused. There is no `--force`: restore is for dead servers.
- **Sessions** — recreated oldest-first with original names. The first window rides `CreateSessionForRestore` (which births the server with the standard pins) and is renumbered from the born base-index to its stored index when they differ; later windows are created at their explicit stored index.
- **Panes** — fresh shells at the recorded cwd, appended as sequential detached splits. `select-layout` restores geometry best-effort; a failure is a report note, never fatal. A stored active pane beyond position 0 is re-selected via `SelectPane` (splits are detached, so position 0 needs no call).
- **Options** — `@rk_server_rank`, `@rk_session_order`, session color, and per-window `@color` / `@rk_type` / `@rk_url` / `@rk_marker` are reapplied from the snapshot (empty values are omitted, never unset), and each session's stored active window is re-selected. Every failure is a report note.
- **Missing cwd** — a deleted worktree falls back to the server default dir (no `-c`) with a note; it never fails the restore.
- **Report** — what was recreated, what was skipped, per-window notes, and each window's former command so the user can decide what to resume (e.g. `claude -c` per agent window), closing with the attach hint.

Split-order fidelity has a stated limit: `select-layout` maps panes to layout cells **positionally**, so a window whose original panes were created in a different split order can see panes occupy different cells than they originally did. Each pane's cwd and former command stay with the pane, not the cell.

#### Scenario: No process is ever relaunched
- **GIVEN** a tombstoned snapshot whose panes recorded long-running commands
- **WHEN** `rk snapshot restore <server>` runs
- **THEN** every recreated pane is a fresh shell and the stored commands appear only in the report output

### Requirement: Write-only boundary (Constitution II / VI)

Snapshots are derived state persisted as a disaster-recovery backup, not a state store — the same category as the daemon's log file: an artifact about the past, not a database about the present. No HTTP handler or request-time read path reads a snapshot file to answer a query; live state stays derived from tmux and the filesystem. `api/` has **zero** `internal/snapshot` imports — the only importers are `cmd/rk/serve.go` (writer wiring) and `cmd/rk/snapshot.go` (the user-initiated CLI reader).

The one api-side touchpoint is the write-path annotation: `api.Server.SetServerKillNotifier(fn)` (`api/tmuxctl_bridge.go`) is wired by `rk serve` to the snapshotter's `NoteAuditedKill`, and `handleServerKill` (`POST /api/servers/kill`) invokes it with the server name just before `tmux.KillServer` so the imminent tombstone records the kill as audited. Fire-and-forget, nil-safe, and it reads nothing.

#### Scenario: No handler serves snapshot data as live state
- **GIVEN** the api package
- **WHEN** its imports are grepped for `internal/snapshot`
- **THEN** there are none, and the only snapshot coupling is the nil-safe `serverKillNotify` function field

## Design Decisions

### Snapshotter home: `internal/snapshot`, wired in `cmd/rk/serve.go`
**Decision**: The writer lives in `internal/snapshot` and is wired in `serve.go` next to the tmuxctl Supervisor, not in `internal/daemon`.
**Why**: The "daemon" that observes servers is the long-running serve process; `internal/daemon` is the tmux-session daemonizer (start/stop lifecycle) and holds no observation machinery. The Supervisor plus its serve wiring is where covered-server observation already lives.
**Rejected**: Extending `internal/daemon` (wrong layer — it never sees sockets or events); hooking the SSE hub's poll loop (it only runs while clients are connected, and snapshots must run unconditionally).
*Introduced by*: 260805-htmy-daemon-layout-snapshots-restore

### Event debounce via generation-counter ticks, not a new EventSink
**Decision**: The snapshotter polls the Supervisor's in-memory per-server generation counters on a 2s tick and writes after one stable tick.
**Why**: Generation counters already increment on every layout-changing control-mode notification, the read is an in-memory int (zero subprocess cost), and tick-compare gives debounce for free without touching the Client read-loop contract (callbacks must not block).
**Rejected**: A dedicated EventSink chained into `NewHubSinkFactory` (couples snapshotting into the SSE sink path and still needs its own debounce timer plumbing); reusing the SSE hub's `Wait` fan-in (the hub only polls servers with connected clients).
*Introduced by*: 260805-htmy-daemon-layout-snapshots-restore

### Tombstone rewrites the JSON rather than renaming only
**Decision**: Tombstoning loads the latest snapshot, stamps `diedAt` (+ `auditedKill` when noted), atomically writes `{server}.died-{ts}.json`, and removes `{server}.json`.
**Why**: A bare rename cannot carry the audited-kill annotation, and stamping inside the JSON keeps one machine-readable artifact per death.
**Rejected**: Sidecar metadata files (two files to keep consistent); encoding "audited" in the filename (unparseable growth of the filename grammar).
*Introduced by*: 260805-htmy-daemon-layout-snapshots-restore

### Content dedup ignores `takenAt`
**Decision**: A write whose content matches the current latest apart from `takenAt` is skipped entirely — no latest rewrite, no history entry.
**Why**: History then holds 10 real layout changes rather than 10 consecutive safety passes, which is what a recovery reader wants.
**Rejected**: Rewriting the latest for freshness (churns history into uselessness). Accepted tradeoff: a quiet server's latest file carries a stale `takenAt`/mtime, so snapshot age reads as "age of the last layout change", not "age of the last check".
*Introduced by*: 260805-htmy-daemon-layout-snapshots-restore

### Storage under `$XDG_STATE_HOME`, uniform across platforms
**Decision**: `DefaultDir()` honors `$XDG_STATE_HOME`, defaulting to `~/.local/state/rk/snapshots` on every platform including macOS.
**Why**: Recovery artifacts must not live in a cache dir, which is droppable by contract; Go offers no `UserStateDir`, and a uniform path keeps the `rk snapshot` docs single-shaped.
**Rejected**: A per-platform path (`~/Library/Application Support` on darwin) — two shapes to document for an artifact users mostly reach through the CLI.
*Introduced by*: 260805-htmy-daemon-layout-snapshots-restore

### `RenumberWindow` as a distinct primitive from `MoveWindow`
**Decision**: Restore places a session's first window with `RenumberWindow` (`move-window -s <id> -t =session:<index>`), a primitive distinct from `MoveWindow`.
**Why**: `MoveWindow` is a reorder-among-existing-windows primitive built on adjacent swaps and no-ops when the target index is unoccupied — which is exactly the restore case (a fresh session with one window at the base index). The live round-trip integration test is what pins the distinction.
**Rejected**: Overloading `MoveWindow` with a renumber mode (two different semantics behind one name, with existing reorder callers to re-verify).
*Introduced by*: 260805-htmy-daemon-layout-snapshots-restore

### Shared `internal/fsatomic.WriteFile` for all file stores
**Decision**: One `internal/fsatomic` package provides `WriteFile(path, data, perm)` — temp file in the same directory, write, atomic rename, temp removed on any failure — and `internal/push`, `internal/remote`, and `internal/snapshot` all call it.
**Why**: Constitution §II keeps state in plain files rather than a database, which makes torn writes a real corruption vector, so every file store needs the same guarantee; three copies of it would drift. `perm` applies at file **creation** (`O_CREATE|O_EXCL`) so the process umask is respected exactly like `os.WriteFile`.
**Rejected**: A per-package private copy (n implementations to keep in sync); `os.CreateTemp` plus an explicit `Chmod` (chmod silently *widens* permissions on hardened-umask hosts, so a 0600 keypair could land wider than `os.WriteFile` would have produced).
*Introduced by*: 260805-htmy-daemon-layout-snapshots-restore

### Board membership is not restored
**Decision**: Pin-sessions (`_rk-pin-*`) and the `_rk-ctl` anchor are excluded from capture, so board pins are not recreated by restore.
**Why**: Pinned windows come back through their home sessions (the capture keys each window to its non-pin owner), board membership is re-derivable UI state, and the anchor is tmuxctl-owned and auto-recreated on the next dial.
**Rejected**: Capturing and replaying pin-session links (restores derived UI state at the cost of a link-recreation ordering problem on a fresh server). See [tmux-sessions](/run-kit/tmux-sessions.md) § Pin Sessions.
*Introduced by*: 260805-htmy-daemon-layout-snapshots-restore
