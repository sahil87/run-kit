# Intake: Daemon Layout Snapshots + Restore

**Change**: 260805-htmy-daemon-layout-snapshots-restore
**Created**: 2026-08-05

## Origin

> rk daemon periodic per-server layout snapshots for restore

Conversational — created via `/fab-draft` after the fabKit1 tmux-server death (2026-08-05 21:38 IST) and its manual restore. The user endorsed this as one of two follow-ups ("both 2 and 4 good ideas"). Key discussion context:

- fabKit1 (session `fabKit`, 9 windows across fab-kit worktrees) was killed by an agent's misdirected `tmux kill-server`. The layout was reconstructed **only by luck**: the fab operator happened to have logged a `fab pane map --all-sessions --json` output 54 seconds before death, from which every window name and cwd was recovered by hand.
- The rk daemon already observes every covered server continuously (control-mode clients via `internal/tmuxctl`, hub + SSE polling) — it has the layout in hand at all times; it just never persists it.
- Companion change `260805-blyf-tmux-guard-path-shim` attacks *prevention*; this change is the *mitigation* layer for whatever gets through.

## Why

1. **Pain point**: When a tmux server dies (agent misfire, crash, reboot), its session/window/pane layout is gone. Reconstruction requires forensics across daemon logs and agent transcripts, and succeeds only if some other process happened to record the layout. tmux servers on this box host long-running multi-agent fleets — losing the layout means losing the operating picture of hours of work.
2. **Consequence of not fixing**: Every future server death is another manual forensic restore, or an unrecoverable loss. Four deaths have occurred to date; the tmux-testing work in fab-kit makes further incidents likely despite the guard shim (absolute-path invocations, non-shimmed environments, plain crashes and reboots are all outside the shim's reach).
3. **Why this approach**: The daemon is the one process that already watches all covered servers with the right data in hand — snapshotting there adds no new observation machinery. Alternatives rejected: tmux-resurrect (per-server tmux plugin, foreign to run-kit's centralized daemon model, and must be installed inside each server's config); relying on fab operator pane-map logs (fab-scoped, tick-cadence luck, wrong owner — run-kit owns tmux infrastructure per the agent-state ownership split).

## What Changes

### 1. Snapshot writer in the daemon

The daemon (`internal/daemon`, observing servers via `internal/tmuxctl`) periodically persists a layout snapshot per covered server:

- **Trigger**: debounced write on layout-changing control-mode events (window/session add, close, rename), plus a periodic safety interval so covered-but-quiet servers and missed events still snapshot (mirrors the existing 12s safety-poll pattern; snapshot safety interval can be far coarser, e.g. 60s, since snapshots only need freshness, not UI latency).
- **Captured per server** (JSON, derived entirely from tmux at snapshot time):
  - server socket name;
  - sessions: name, creation time;
  - windows: session, index, window id, name, active flag;
  - panes: window, pane id, index, current working directory, current command (informational — restore does not relaunch it), layout string;
  - rk-owned user options that shape the UI (`@rk_server_rank`, row label/color options) so a restore preserves run-kit presentation state.
  - Explicitly NOT captured: scrollback contents, environment, running processes.
- **Storage**: `~/.local/state/rk/snapshots/{server}.json` — latest snapshot per server, plus a small rolling history `{server}/{unix-ts}.json` (retention: last 10). State dir (not `~/.cache`) because these are recovery artifacts and caches are droppable by contract.
- **Tombstone on death**: when the daemon sees a socket removed (it already logs `tmuxctl: socket removed (tmux server exited)`), the last snapshot is renamed/marked (e.g. `{server}.died-{ts}.json`) rather than deleted — the moment a server dies is exactly when its snapshot becomes valuable. Snapshots for servers deliberately killed through run-kit's audited kill path are marked the same way but noted as audited.
- **Scope filter**: only servers the daemon already treats as covered; ephemeral test servers (`rk-test-*`, scratch sockets) are excluded by the same filtering the daemon uses today for enumeration/anchoring.

### 2. Restore CLI

New `rk snapshot` subcommand family:

```
rk snapshot list [<server>]        # show available snapshots (live + died), age, session/window counts
rk snapshot show <server> [--at ts] # print the layout (sessions → windows → cwds) without acting
rk snapshot restore <server> [--at ts]
```

Restore behavior (mirrors the manual fabKit1 restore performed in this session):

- Refuses to run if the target server is alive with sessions (no clobbering; `--force` not offered in v1 — restore is for dead servers).
- Recreates the server (explicit `-L {server}` on every tmux invocation), sessions, and windows with original names, indexes (respecting base-index), and pane cwds; recreates split layouts from the stored layout string where the pane set allows it; reapplies captured rk user options.
- Panes come back as fresh shells at the right cwd. **No process relaunch** — the stored "current command" is displayed in the restore report so the user can decide what to resume (e.g. `claude -c` per agent window).
- Prints a restore report: what was recreated, what was skipped, and the per-window former command.

### 3. Constitution note (Principle II: No Database)

Snapshots are **derived state persisted as a disaster-recovery backup**, not a state store: nothing at request time reads a snapshot to answer API queries — live state continues to be derived from tmux and the filesystem exactly as today. Snapshots are write-only until a human runs `rk snapshot restore` against a dead server, at which point tmux itself becomes the live source again. This is the same category as the daemon's log file: an artifact about the past, not a database about the present. The plan SHOULD restate this boundary in `## Requirements` so review can hold the line (no handler may ever serve snapshot data as live state).

## Affected Memory

- `run-kit/layout-snapshots`: (new) Snapshot capture set, storage/retention/tombstone contract, restore semantics (no process relaunch), Constitution II boundary.

## Impact

- `internal/daemon` (snapshot writer, socket-removed tombstone hook), `internal/tmuxctl` (layout read helpers if not already exposed), new `internal/snapshot` or equivalent (serialization, storage, retention).
- `app/backend/cmd/rk/` — new `snapshot.go` subcommand family (+ tests).
- `~/.local/state/rk/snapshots/` on user machines.
- No frontend changes in v1 (a Board/UI surfacing of "this server died, snapshot available — restore?" is a natural follow-up, deliberately out of scope).
- Constitution §I: all tmux interaction via `internal/tmux` with `exec.CommandContext` argument slices; §VI: the daemon never manages tmux lifecycles — restore is explicitly user-initiated via CLI, never automatic.

## Open Questions

- Should restore also be exposed as a POST endpoint for the web UI in v1, or CLI-only? (CLI-only assumed below.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Snapshot writer lives in the rk daemon, which already observes all covered servers | Discussed — the daemon is the only always-on process with the data; user endorsed this shape | S:85 R:85 A:90 D:90 |
| 2 | Certain | Restore never relaunches processes — fresh shells at recorded cwds, former commands reported | Discussed and matches the manual fabKit1 restore performed live in this conversation | S:85 R:90 A:90 D:85 |
| 3 | Confident | Storage in `~/.local/state/rk/snapshots/`, latest + rolling history, tombstoned on server death | State-dir semantics fit recovery artifacts; cache dirs are droppable by contract | S:60 R:85 A:80 D:70 |
| 4 | Confident | Event-debounced writes + coarse periodic safety interval (~60s), reusing existing hub/safety-poll patterns | Mirrors established daemon cadence design; exact interval tunable during apply | S:60 R:90 A:80 D:70 |
| 5 | Confident | Constitution II is satisfied: snapshots are write-only recovery backups, never read to serve live state | Reasoned in discussion; boundary restated in plan Requirements for review enforcement | S:65 R:75 A:80 D:75 |
| 6 | Tentative | Retention: keep last 10 snapshots per server | Round number; no signal on real disk/history tradeoff — trivially tunable | S:40 R:95 A:60 D:60 |
| 7 | Tentative | v1 restore is CLI-only (`rk snapshot restore`), no POST endpoint / UI surfacing | Minimal-surface-area principle favors CLI; user may want one-click restore from the Board — flagged as open question | S:45 R:80 A:55 D:50 |

7 assumptions (2 certain, 3 confident, 2 tentative, 0 unresolved).
