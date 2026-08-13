# Plan: Persistent Job Windows

**Change**: 260813-4n9h-persistent-job-windows
**Intake**: `intake.md`

## Requirements

### Daemon Jobs: Window Persistence After Exit

#### R1: Job windows persist after every exit
`daemon.RunJob`'s post-spawn window option (`app/backend/internal/daemon/jobs.go:214`) SHALL set `remain-on-exit on` (was `failed`), so a job window survives its command's exit as a dead pane — success and failure alike — until the next run of the same job respawns it in place. The call stays best-effort/warn-only and never fails the spawn.

- **GIVEN** a job window whose command exits 0
- **WHEN** the command completes
- **THEN** the window remains with a dead pane showing the final scrollback, and the next `RunJob` for the same window respawns it in place (same window ID)

#### R2: Comments and the warn log state present truth
The jobs.go prose SHALL be updated: RunJob doc-block step 5 (pane persists after ANY exit; drop/adjust the tmux ≥ 3.2 caveat — only the `failed` value required 3.2), step-3 dedup wording and the respawn-branch body comment (a dead pane is a completed prior run, any exit status), and the `set-option` failure warn message (option unset ⇒ the window closes on exit, losing the persistent evidence).

- **GIVEN** a reader of jobs.go
- **WHEN** they read the RunJob contract and the respawn branch
- **THEN** no text claims the pane persists only on failure

#### R3: `rk daemon run` help text follows
`app/backend/cmd/rk/daemon_run.go` Long help ("On a non-zero exit the pane remains (remain-on-exit failed)…") SHALL update to: the pane remains after the command exits (success or failure) so the output stays visible; the next run of the same `--window` respawns in place. Prose-only — no flag or output-shape change (Toolkit Principle 9 untouched).

- **GIVEN** `rk daemon run --help`
- **WHEN** the Long text renders
- **THEN** it describes persistence after any exit

#### R4: Tests cover the flipped behavior
`jobs_test.go` SHALL flip the argv assertion (`remain-on-exit failed` → `remain-on-exit on`, line ~137), update comments referencing the old semantics in `TestRunJobIntegration_FailedJobRemainsDeadThenRespawns` (which still passes — a failed pane still remains), and ADD integration coverage asserting a **successful** (exit 0) job also remains dead and is respawned in place by the next run.

- **GIVEN** the jobs integration socket
- **WHEN** a job runs a script that exits 0
- **THEN** the probe reads the window dead with the same window ID, and a follow-up `RunJob` respawns it live in place

### Non-Goals

- No dashboard/UI changes — the persistent dead-pane row rides `ListServers` for free.
- No change to respawn/dedup logic, pipe-pane logging, window naming, or the daemon gate.
- No per-job configurability — a flat flip for all job windows.
- rk-remotes windows untouched (the option is set per job window, `-t =rk-jobs:=<window>`).

## Tasks

### Phase 2: Core Implementation

- [x] T001 `app/backend/internal/daemon/jobs.go`: flip the set-option argv to `remain-on-exit on` (line 214); reword the warn message (line 215); update RunJob doc-block step 5 (lines 125–128), step-3 dedup wording (lines 113–116), and the respawn-branch comment (lines 186–191) to present truth. <!-- R1, R2 -->
- [x] T002 [P] `app/backend/cmd/rk/daemon_run.go`: update the Long help sentence about pane persistence (lines 25–28). <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T003 `app/backend/internal/daemon/jobs_test.go`: flip the argv assertion at line ~137 to `remain-on-exit on`; sweep remaining `remain-on-exit` literals in comments; add `TestRunJobIntegration_SucceededJobRemainsDeadThenRespawns` (exit-0 script → probe reads dead, same window ID → next RunJob respawns in place, mirroring the existing failed-job integration test). <!-- R4 -->
- [x] T004 Run verification gates: `cd app/backend && go test ./internal/daemon/... ./cmd/...` then `go test ./...` and `just build`. <!-- R4 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: The set-option argv is `remain-on-exit on`; best-effort/warn-only posture unchanged.
- [x] A-002 R3: `rk daemon run` Long help describes persistence after any exit, respawn-in-place on the next run.

### Behavioral Correctness

- [x] A-003 R1: A successful job's window remains as a dead pane and is respawned in place — proven by the new integration test.
- [x] A-004 R4: The existing failed-job integration test still passes (failure persistence is a subset of `on`).

### Scenario Coverage

- [x] A-005 R4: `go test ./internal/daemon/...` passes, including both persistence integration tests.

### Edge Cases & Error Handling

- [x] A-006 R2: No comment or log message still claims failure-only persistence or the tmux ≥ 3.2 requirement for the current value (grep `remain-on-exit` across app/backend shows only present-truth text).

### Code Quality

- [x] A-007 Pattern consistency: edits follow jobs.go idioms (seam-routed tmux calls, warn-only best-effort options) and the new test mirrors the existing integration-test structure.
- [x] A-008 No unnecessary duplication: the new integration test reuses `jobsIntegrationSocket`, `jobTargetFor`, and `jobWindowState` — no new helpers.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New integration test mirrors the failed-job test's script-file pattern (single-word argv survives tmux's unquoted join) | Existing test documents the constraint in place | S:85 R:95 A:95 D:90 |
| 2 | Confident | Warn message wording: "job window remain-on-exit failed to set; the window will close on exit and the output will not persist" (semantic fixed by intake, phrasing apply's) | Intake assumption 5 delegates phrasing to apply | S:70 R:95 A:85 D:80 |

2 assumptions (1 certain, 1 confident).
