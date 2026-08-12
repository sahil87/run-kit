# Plan: Fix Job-Window Probe Fallback

**Change**: 260812-anac-fix-job-window-probe-fallback
**Intake**: `intake.md`

## Requirements

### Backend: RunJob Probe & Spawn Shape (`internal/daemon/jobs.go`)

#### R1: Dedup probe hard-fails on a missing window
`jobWindowState` SHALL probe with `list-panes -t <target> -F '#{window_id} #{pane_dead}'` — a command verified to error (`can't find window`, exit 1) when the window does not exist — instead of `display-message`, whose unresolvable-window fallback to the session's active window is the released bug. The implementation SHALL route through the declared `jobRunTmuxOutput` seam (resolving the original review's should-fix). Parse the first output line (job windows are single-pane by construction; tolerate extra lines from a manual split).

- **GIVEN** a `rk-jobs` session whose only window is an idle shell
- **WHEN** `jobWindowState` probes `=rk-jobs:=update`
- **THEN** it returns `exists=false` (the released bug returned the idle window as a live `update` job)

- **GIVEN** a live spawned job window
- **WHEN** probed
- **THEN** `exists=true, dead=false` with its window id; after the command exits non-zero under `remain-on-exit failed`, `dead=true`

#### R2: Session created with the first job window
When `rk-jobs` is absent, `RunJob` SHALL create it WITH the job window as its first window (`new-session -d -s rk-jobs -n <window> -P -F '#{window_id}' <argv…>` — the `internal/remote/tunnel.go` pattern), skipping the dedup probe (no session ⇒ no in-flight job). The idle default shell window is never created. When the session exists, the fixed probe → dedup → `new-window` path runs as today. The `duplicate session` create-race fallback SHALL retry through the session-exists path (probe + new-window) rather than erroring. Post-spawn options (remain-on-exit failed, pipe-pane tee) apply identically after either spawn shape.

- **GIVEN** no `rk-jobs` session
- **WHEN** `RunJob(ctx, "update", argv)` runs
- **THEN** the session's ONLY window is `update` running argv (`started=true`), with no idle default window

- **GIVEN** two concurrent `RunJob` calls racing session creation
- **WHEN** the loser's `new-session` reports `duplicate session`
- **THEN** it falls through to the probe + `new-window` path (in-flight dedup then applies normally)

#### R3: Integration coverage of the real seams
An integration test (in `jobs_test.go`, following `daemon_test.go`'s conventions: isolated `-L` scratch socket via the `serverSocket` test seam, `t.Skip` when tmux is absent or `testing.Short()`, kill-server cleanup) SHALL exercise the REAL `jobWindowState` and both real spawn shapes:

1. probe against a session holding only an idle default window returns `exists=false` for a job-window name — the exact released regression;
2. session-absent `RunJob` yields a session whose only window is the job window;
3. probe reports a live window, and `dead=true` after its command exits non-zero under `remain-on-exit failed`.

Existing seam-stubbed unit tests stay (they cover RunJob's branching); their argv assertions are updated for the new session-absent spawn shape.

- **GIVEN** the integration test running against a scratch socket with the pre-fix `display-message` probe
- **WHEN** scenario 1 executes
- **THEN** it fails — proving the test detects the released bug

### Non-Goals

- The fast-exit options race (a command exiting before `set-option remain-on-exit` lands leaves no failure evidence) — millisecond window, worst case equals pre-3.15.10 fire-and-forget; deliberately untouched to keep the fix surgical.
- API handlers, response shapes, frontend navigation, `rk daemon run` CLI surface — all correct given a truthful `RunJob`; unchanged.
- No cleanup migration for hosts carrying the junk idle window (self-heals on next spawn; documented ops note in the intake).

### Design Decisions

#### Dead windows respawn in place, never kill-window + new-window
**Decision**: the dead-pane dedup branch relaunches argv in the dead window via `respawn-window -k`; `kill-window` is gone from RunJob.
**Why**: with the session now created around the job window, the dead window is usually the session's ONLY window — and killing a session's last window kills the session, stranding the follow-up `new-window` ("can't find session", caught live by the new scratch-socket integration test). Respawn also keeps the window id stable for any open dashboard URL.
**Rejected**: kill-window + re-checking session existence before new-window (more branches, racy between the two calls, and loses the window id).
*Introduced by*: 260812-anac-fix-job-window-probe-fallback

#### Probe via list-panes, not has-window guards around display-message
**Decision**: replace the probe command wholesale with `list-panes -F '#{window_id} #{pane_dead}'`.
**Why**: verified on the affected host to hard-fail on missing windows while carrying both needed fields in one call; one command keeps the single-cmdTimeout budget intact.
**Rejected**: pre-checking with `list-windows` + name matching in Go (two calls, and re-implements exact-match the `=` target already does); trusting `display-message` with output validation (fragile — the fallback output is well-formed).
*Introduced by*: 260812-anac-fix-job-window-probe-fallback

## Tasks

### Phase 2: Core Implementation

- [x] T001 Fix `jobWindowState` in `app/backend/internal/daemon/jobs.go`: `list-panes` via the `jobRunTmuxOutput` seam, first-line parse <!-- R1 -->
- [x] T002 Restructure `RunJob` spawn shape in `app/backend/internal/daemon/jobs.go`: session-absent → `new-session -n <window> <argv…>` (skip probe), session-present → probe + dedup + `new-window`; `duplicate session` race falls through to the session-exists path; options unchanged after both shapes <!-- R2 -->
- [x] T003 Update seam-stubbed unit tests in `app/backend/internal/daemon/jobs_test.go` for the new spawn shapes (session-absent argv, race fallthrough) <!-- R2 -->
- [x] T004 Add the scratch-socket integration test in `app/backend/internal/daemon/jobs_test.go` per R3's three scenarios, following `daemon_test.go` conventions <!-- R1, R3 -->

### Phase 4: Polish

- [x] T005 Verification gates: `cd app/backend && go test ./...` (incl. integration un-short), then `just build` <!-- R1, R2, R3 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `jobWindowState` uses `list-panes` through the declared seam and returns `exists=false` for missing windows
- [x] A-002 R2: session-absent spawn creates `rk-jobs` with the job window as its only window; session-present path unchanged with the fixed probe

### Behavioral Correctness

- [x] A-003 R1: the released failure sequence (fresh session → first click) now spawns the command and returns `started=true` — no false already-running
- [x] A-004 R2: the `duplicate session` race falls through to probe + new-window instead of erroring

### Scenario Coverage

- [x] A-005 R3: integration test covers the three real-seam scenarios on an isolated scratch socket with skip guards
- [x] A-006 R3: scenario 1 demonstrably fails against the pre-fix probe (verified once during development, e.g. by temporarily reverting T001)

### Edge Cases & Error Handling

- [x] A-007 R1: a manually split (multi-pane) job window doesn't break the first-line parse

### Code Quality

- [x] A-008 Pattern consistency: probe/spawn changes keep jobs.go's seam discipline; integration test mirrors daemon_test.go's harness
- [x] A-009 No unnecessary duplication: no new tmux runners; existing seams and test fixtures reused

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `jobs.go` — the old `display-message` probe body, the standalone `new-session -d -s rk-jobs` ensure branch, and the `kill-window` reap were deleted inline by this change; no leftover references remain
- None beyond the above — this change removes its own superseded code without leaving other code redundant

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `list-panes` is the replacement probe | Verified live on the affected host (exit 1 + "can't find window" for missing windows) | S:90 R:90 A:95 D:90 |
| 2 | Confident | Session-absent path skips the probe entirely | No session ⇒ no in-flight window; one fewer tmux call inside the shared budget | S:75 R:85 A:90 D:85 |
| 3 | Confident | Integration test lives in jobs_test.go using daemon_test.go's socket harness conventions | Same package, existing precedent; a separate harness would duplicate setup | S:70 R:90 A:85 D:85 |
| 4 | Certain | Dead-window reap switches from kill-window + new-window to `respawn-window -k` in place | Discovered during apply: the integration test proved kill-window on the session's last window kills the session and strands the respawn; respawn-window is tmux's purpose-built primitive for exactly this | S:85 R:85 A:95 D:90 |

4 assumptions (2 certain, 2 confident, 0 tentative).
