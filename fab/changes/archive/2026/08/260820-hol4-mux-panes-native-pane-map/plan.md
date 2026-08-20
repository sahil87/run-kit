# Plan: rk mux panes — native pane-map enumeration

**Change**: 260820-hol4-mux-panes-native-pane-map
**Intake**: `intake.md`

## Requirements

### CLI: `rk mux panes`

- **R1** — `rk mux panes` MUST exist as the tenth `mux` family member (`app/backend/cmd/rk/mux_panes.go`): a whole-server enumeration query with **no positional target argument**, listing one row per pane across all sessions of the resolved server. It SHALL consume the family's inherited `-L/--server` flag with the standard resolution order (`-L` wins → caller's `$TMUX` socket basename via `muxServer()` → default) and MUST talk to tmux directly from the caller's context (no daemon dependency), reusing `tmux.ListSessions` + `tmux.ListWindows` (which already carry reconciled `@rk_agent_state` per pane). Enumeration flows through the `parseSessions` chokepoint, so `_rk-pin-*` pin-sessions and the `_rk-ctl` anchor are excluded and a pinned window appears once (via its home session).
  - **GIVEN** a server with two sessions and a pinned window, **WHEN** `rk mux panes -L foo` runs, **THEN** every pane of both sessions prints exactly once, the pin-session and anchor contribute no rows, and no `fab` binary is executed.

- **R2** — `--json` MUST emit a two-space-indented JSON array, one object per pane, with exactly these keys: `session`, `session_id`, `window_index`, `window_id`, `window_name`, `window_active`, `pane`, `pane_index`, `pane_active`, `command`, `cwd`, `agent_state`, `agent_state_duration`. `agent_state`/`agent_state_duration` SHALL be `null` when the pane is uninstrumented or the reconciler rejects the value (the `mux capture --json` semantics); the duration SHALL be present only for `idle`/`waiting` (epoch > 0), never `active`, formatted via `sessions.FormatAgentDuration`. **No choreography keys** (`change`/`stage`/`display_state`) — enrichment is the fab-kit half's job.
  - **GIVEN** a pane with `@rk_agent_state=idle:<epoch 5m ago>:<live-pid>` and a shell pane with none, **WHEN** `rk mux panes --json` runs, **THEN** the first object carries `"agent_state": "idle", "agent_state_duration": "5m"`, the second carries `null` for both, and no object has a `change` key.

- **R3** — The default (non-`--json`) output MUST be a human-readable aligned table, one pane per row, carrying at least session, window (`index:name`), pane ID, active markers, agent state (+ duration), and cwd. Diagnostics go to stderr; rows are data (stdout).
  - **GIVEN** a server with panes, **WHEN** `rk mux panes` runs, **THEN** stdout is only the aligned rows (plus an optional header line) and column values never interleave with warnings.

- **R4** — Exit codes MUST follow the toolkit convention: **0** success — including an alive server whose enumeration is empty (prints `[]` under `--json`, no rows otherwise); **1** operational failure (no server running on the resolved socket / tmux failure), carrying tmux's diagnostic on stderr; **2** usage (unknown flag, unexpected positional argument, `--json` misuse).
  - **GIVEN** no server on socket `nope`, **WHEN** `rk mux panes -L nope` runs, **THEN** exit is 1 with tmux's diagnostic; **AND GIVEN** a stray positional argument, **THEN** exit is 2.

- **R5** — The CLI surface additions MUST land with: the `mux panes` entry in `cmd/rk/help_dump_test.go` expectations; a `## rk mux panes` section in the `rk skill mux` topic page (`cmd/rk/skill/mux.md`) and its `docs/site/skill/mux.md` twin (following the existing sync direction between the two); the family framing updated from nine to ten members in `cmd/rk/mux.go`'s doc comment and the `mux` parent's Short/Long text; and a `shll standards` audit of the new surface against a HEAD build (help-dump, ten principles — notably Principle 9 output discipline — skill topic pages).
  - **GIVEN** the change is complete, **WHEN** `go test ./cmd/rk/` runs, **THEN** the help-dump test passes with the new entry; **WHEN** `shll standards` governing surfaces are checked, **THEN** no violation is introduced.

### Server: native fab-state derivation (drop the `fab pane map` join)

- **R6** — `internal/sessions` MUST NOT execute the `fab` binary. The following MUST be deleted from `sessions.go`: `paneMapEntry`, `fetchPaneMap`, `keyPaneEntries`, `paneMapCacheEntry`, `paneMapCache`/`paneMapCacheMu`/`paneMapCacheTTL`, `fetchPaneMapCached`, `joinPaneMapByWindow`, and the `fetchPaneMapCached(server)` call in `FetchSessions` (with its doc comments).
  - **GIVEN** the final tree, **WHEN** `grep -rn '"fab"' internal/sessions/` runs, **THEN** no subprocess invocation of fab remains.

- **R7** — A native per-pane derivation MUST replace the join (new file `internal/sessions/fabstate.go`), computing `(change, stage, displayState)` from disk: (a) from the pane's cwd, walk up parent directories to the nearest one containing `.fab-status.yaml`, bounded by filesystem root, skipping panes with empty or missing cwd; (b) resolve the symlink — its target is `fab/changes/{name}/.status.yaml`; the **change name is the target's parent directory basename** (resolve relative targets against the symlink's own directory); (c) read the target file and parse only its `progress:` map (ordered, `gopkg.in/yaml.v3`), deriving `(stage, displayState)` with fab's 5-tier display-stage rule mirrored exactly from fab-kit `internal/status/status.go DisplayStage`: first `active` → first `failed` → first `ready` → last `done`/`skipped` → first stage `pending`.
  - **GIVEN** a pane whose cwd is a subdirectory of a worktree whose `.fab-status.yaml` points at a change with `progress: {intake: done, apply: active, …}`, **WHEN** the derivation runs, **THEN** it yields that change's folder name, stage `apply`, displayState `active`; **AND GIVEN** `progress: {…, review: failed, hydrate: ready}` with nothing active, **THEN** stage `review`, displayState `failed`.

- **R8** — `FetchSessions` MUST populate the same `WindowInfo.FabChange`/`FabStage`/`FabDisplayState` fields with the window-level selection semantics preserved: among a window's panes, a **change-bound** pane's derivation wins; otherwise the **first pane in pane order** with any derivation. The JSON contract to the frontend is unchanged (no frontend edits).
  - **GIVEN** a window whose pane 0 resolves no change and pane 1 resolves change X, **WHEN** `FetchSessions` runs, **THEN** the window carries `FabChange: X`; **AND GIVEN** two change-bound panes, **THEN** the first in pane order wins.

- **R9** — The derivation MUST run fresh on every `FetchSessions` call (this is what kills the ~5s StatusDot lag class): no TTL cache, no state persisted across requests. A per-call memo keyed by the resolved `.fab-status.yaml` directory MAY dedupe reads within one call (many panes share a worktree). Walk-up results MAY also be memoized per call, keyed by cwd.
  - **GIVEN** a stage transition written to `.status.yaml`, **WHEN** the next `FetchSessions` runs (next SSE tick), **THEN** the new displayState is already reflected — no 5s staleness window.

- **R10** — Degradation MUST be per-pane and fail-open: no `.fab-status.yaml` ancestor, a dangling symlink (archived change), an unreadable or unparsable `.status.yaml`, or an empty/unknown `progress:` map each yield empty fab fields for that pane — never an error, never a partial value, and never a failure of the whole fetch.
  - **GIVEN** a worktree whose symlink points at an archived (deleted) change, **WHEN** `FetchSessions` runs, **THEN** that window has empty fab fields and every other window is enriched normally.

- **R11** — Stale documentation MUST be corrected: `internal/tmux/tmux.go`'s `WindowInfo` PR-fields comment ("PrURL/PrNumber come from `fab pane map`" — they are branch-derived via `prstatus`) and any remaining comment references to the deleted join machinery.
  - **GIVEN** the final tree, **WHEN** `grep -rn "pane map" app/backend/` runs, **THEN** no comment describes the deleted mechanism as current behavior.

### Design Decisions

- **Decision**: The server derives change/stage/displayState by reading fab artifacts natively (symlink + YAML), while `rk mux panes` stays substrate-only.
  **Why**: Constitution II names `.status.yaml`/`fab/current` as the source of fab state; status-pyramid.md documents the L2 register source as `cwd → .fab-status.yaml → .status.yaml`; the subprocess+cache is the lag class being removed. The CLI verb stays substrate-only per cli-layering Part 8 (fab enriches).
  **Rejected**: shelling to `fab pane map` without the cache (keeps the fab dependency + subprocess cost per tick); dropping the fab fields (regresses the StatusDot L2 tier).
  *Introduced by*: 260820-hol4-mux-panes-native-pane-map

- **Decision**: The existing agent-messaging memory decision "capture enrichment is substrate-only — porting the `.fab-status.yaml` parse reimplements fab's layer" is scoped to the **CLI substrate verbs** and stands; the server's L2 register derivation is the sanctioned Constitution II read. Hydrate records the scope distinction.
  **Why**: the two consumers have different contracts — CLI verbs are the cross-tool substrate surface; the server's dashboard registers are constitutionally derived from the filesystem.
  **Rejected**: treating that decision as banning any rk read of fab artifacts (contradicts Constitution II and status-pyramid.md).
  *Introduced by*: 260820-hol4-mux-panes-native-pane-map

- **Decision**: `rk mux panes` enumerates through the `parseSessions`-filtered view (`_rk-pin-*`/`_rk-ctl` skipped; group-derived copies filtered).
  **Why**: matches the dashboard's user-facing truth and avoids duplicate rows for dual-membership (pinned) windows; the fab enrichment consumer wants one row per real pane.
  **Rejected**: raw unfiltered enumeration (duplicates pinned windows, leaks internal sessions).
  *Introduced by*: 260820-hol4-mux-panes-native-pane-map

### Non-Goals

- The fab-kit half (rebuilding `fab pane map` as enrichment over `rk mux panes`) — separate repo, held until this change releases.
- Any behavior change to `fab pane map` itself.
- PR derivation (`prstatus`), agent-state rollup, chat rollup — already native; untouched.
- Frontend changes — the WindowInfo JSON contract is unchanged.

## Tasks

### Phase 1: Core Implementation — native fab-state derivation

- [x] T001 Create `app/backend/internal/sessions/fabstate.go`: bounded walk-up from a cwd to the nearest `.fab-status.yaml`, symlink→change-name extraction (relative targets resolved against the symlink's dir), `progress:` YAML parse, and the 5-tier display-stage derivation; expose a per-call memo type for FetchSessions. <!-- R7, R9, R10 -->
- [x] T002 [P] Create `app/backend/internal/sessions/fabstate_test.go`: temp-dir fixtures (real symlink + `.status.yaml`) covering all 5 display-stage tiers, change-name extraction, walk-up from a subdirectory, and degradation (no symlink / dangling symlink / corrupt YAML / empty progress / missing cwd). <!-- R7, R10 -->
- [x] T003 Rewire `FetchSessions` in `app/backend/internal/sessions/sessions.go`: call the native derivation per pane (fresh, per-call memo), apply the change-bound-wins/first-seen window rollup, populate `FabChange`/`FabStage`/`FabDisplayState`; delete `paneMapEntry`, `fetchPaneMap`, `keyPaneEntries`, the cache trio, `fetchPaneMapCached`, `joinPaneMapByWindow`, and their doc comments. <!-- R6, R8, R9 -->
- [x] T004 Update `app/backend/internal/sessions/sessions_test.go`: remove/replace the pane-map join tests with native-path tests for the window-rollup selection semantics (change-bound wins, first-seen fallback, empty-fields degradation). <!-- R8, R10 -->
- [x] T005 [P] Fix stale comments: `internal/tmux/tmux.go` `WindowInfo` PR-fields doc; sweep `app/backend/` comments referencing the deleted join as current behavior. <!-- R11 -->

### Phase 2: CLI verb

- [x] T006 Create `app/backend/cmd/rk/mux_panes.go`: `panes` subcommand under `muxCmd` — no positional args, `--json` flag, `-L` consumption via `muxServer()`, enumeration via `tmux.ListSessions`+`tmux.ListWindows`, table + JSON renderers per R2/R3, toolkit exit codes per R4. <!-- R1, R2, R3, R4 -->
- [x] T007 [P] Create `app/backend/cmd/rk/mux_panes_test.go`: JSON key set + null agent fields, table smoke, empty-enumeration exit 0, stray-positional exit 2, no-server operational error path (unit-level where a live tmux is unavailable, following the existing mux twins' test patterns). <!-- R2, R3, R4 -->
- [x] T008 Update `app/backend/cmd/rk/mux.go` (family doc comment + Short/Long: ten members, panes described) and `app/backend/cmd/rk/help_dump_test.go` (new surface entry). <!-- R5 -->

### Phase 3: Docs, standards, verification

- [x] T009 Add `## rk mux panes` to `app/backend/cmd/rk/skill/mux.md` and sync `docs/site/skill/mux.md` per the existing sync direction. <!-- R5 -->
- [x] T010 Run the standards audit (`shll standards` surfaces relevant to help output/CLI) against a HEAD build and the full verification gates (`cd app/backend && go test ./...`, `just build`); fix anything surfaced. <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk mux panes` enumerates every pane of every (filtered) session on the resolved server, once each, without executing fab and without the daemon.
- [x] A-002 R2: `--json` emits exactly the specified key set with correct null semantics for uninstrumented panes and idle/waiting-only durations.
- [x] A-003 R3: default output is an aligned one-pane-per-row table on stdout only.
- [x] A-004 R4: exit codes are 0 (incl. empty enumeration), 1 (tmux/operational), 2 (usage).
- [x] A-005 R6: `internal/sessions` contains no fab subprocess invocation and none of the deleted join machinery.
- [x] A-006 R7: the native derivation yields (change, stage, displayState) per the symlink contract and the 5-tier rule for every tier.
- [x] A-007 R8: window-level fab fields match today's selection semantics and the frontend JSON contract is unchanged.
- [x] A-008 R9: derivation is fresh per FetchSessions — no TTL cache or cross-request state remains.
- [x] A-009 R10: each degradation case yields empty fab fields for the affected pane only, with no error.
- [x] A-010 R5: help-dump expectations, the mux skill topic page (both copies), and the ten-member family framing are updated.

### Scenario Coverage

- [x] A-011 R7: unit fixtures prove all 5 display-stage tiers (active / failed / ready / last done-or-skipped / pending).
- [x] A-012 R8: a window with mixed panes (no-change + change-bound) resolves to the change-bound pane's values.
- [x] A-013 R10: a dangling symlink (archived change) degrades to empty fields while sibling windows stay enriched.

### Edge Cases & Error Handling

- [x] A-014 R7: a pane cwd in a subdirectory of the worktree still resolves via the walk-up; a missing cwd is skipped.
- [x] A-015 R4: `rk mux panes -L <dead-socket>` exits 1 with tmux's diagnostic on stderr.

### Removal Verification

- [x] A-016 R6: `fetchPaneMap`/`fetchPaneMapCached`/`joinPaneMapByWindow`/`paneMapEntry` and the cache globals no longer exist.
- [x] A-017 R11: no comment in `app/backend/` describes the fab pane-map join as current behavior.

### Code Quality

- [x] A-018: All subprocess calls use `exec.CommandContext` with bounded timeouts and argv slices (Constitution I); the derivation itself is pure file I/O with no subprocesses.
- [x] A-019: No new in-memory caches beyond the per-call memo (Constitution II); no state store introduced.
- [x] A-020 Pattern consistency: the new verb follows the mux family patterns (cobra wiring, `--json` two-space indent, one-line report/output discipline, toolkit exit codes); no duplication of existing utilities in `internal/tmux`/`internal/sessions`.
- [x] A-021: New behavior is covered by tests (fabstate unit fixtures, sessions rollup tests, mux_panes command tests); `go test ./...` and `just build` pass.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Derivation lives in a new `internal/sessions/fabstate.go` (not a new package) | Single consumer (FetchSessions); package split would be premature | S:60 R:90 A:85 D:75 |
| 2 | Confident | `rk mux panes` uses the `parseSessions`-filtered enumeration (pin-sessions/anchor skipped) | Matches dashboard truth; avoids dual-membership duplicate rows | S:55 R:80 A:80 D:65 |
| 3 | Confident | Walk-up bounded at filesystem root with per-call cwd memo; no depth knob | Simple, correct, cheap; panes overwhelmingly sit at or one level under the worktree root | S:55 R:85 A:85 D:75 |
| 4 | Certain | Progress-map parse uses `gopkg.in/yaml.v3` (already a direct dependency) | go.mod already carries it; no new dependency decision exists | S:80 R:90 A:100 D:95 |

4 assumptions (1 certain, 3 confident, 0 tentative, 0 unresolved).

## Deletion Candidates

The change's own removals (the `fab pane map` subprocess/cache/join machinery: `paneMapEntry`, `fetchPaneMap`, `keyPaneEntries`, the pane-map cache trio, `fetchPaneMapCached`, `joinPaneMapByWindow`, `derefStr`, and their tests/helpers) were executed at apply and verified gone (A-016: `grep -rn 'paneMap\|pane map\|pane-map' app/backend --include='*.go'` finds no live references). Beyond those, none — this change adds new functionality (`rk mux panes`, native fab-state derivation) without leaving further redundant code behind. The remaining look-alike, `tmux.probeServerAlive`, is deliberately kept: it serves `ListServers`/reaper fan-out with a 2s bool probe, while the new `tmux.ServerAlive` carries tmux's diagnostic for CLI error reporting — different contracts, both with live call sites.
