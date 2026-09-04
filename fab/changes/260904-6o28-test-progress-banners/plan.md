# Plan: Test-Run Phase Progress Banners

**Change**: 260904-6o28-test-progress-banners
**Intake**: `intake.md`

## Requirements

### Dev Tooling: Test-Run Phase Orchestrator

#### R1: Phase orchestrator script with timestamped banners
A new `scripts/test-all.sh` SHALL run the three test phases in sequence by invoking the existing recipes — `just test-backend`, `just test-frontend`, `just test-e2e` — never duplicating their bodies, and SHALL frame each phase with timestamped banners plus a final per-phase summary. Banner shape: `[N/3] <phase> — started HH:MM:SS` at entry and `[N/3] <phase> — ok in XmYYs` at success; the summary block lists each phase with status and duration.

- **GIVEN** a developer runs `just test` on a clean checkout
- **WHEN** all three phases pass
- **THEN** scrollback shows a start banner before each phase's own output, a completion banner with the phase duration after it, and a final summary listing all three phases as ok with durations
- **AND** each phase's own dependencies (e.g. `_ensure-tmux-conf` before `test-backend`) run because the phase is invoked as its `just` recipe

#### R2: Fail-fast with truthful summary and exit code
The script SHALL preserve today's dependency-chain failure semantics: a failing phase stops the run, later phases do not execute, and the script exits non-zero. The failure banner and summary SHALL mark the failed phase (`[N/3] <phase> — FAILED in XmYYs (exit E)`) and show unrun phases as not-run.

- **GIVEN** the frontend phase exits non-zero
- **WHEN** `just test` runs
- **THEN** the e2e phase never starts, the script exits with a non-zero status, and the summary shows backend ok, frontend failed (with exit code), e2e not-run

#### R3: Per-run log tee
The script SHALL tee the full run (banners + sub-suite output, stdout and stderr) into a per-run log file `/tmp/rk-test-<timestamp>.log` and SHALL echo the log path as the first line of the run. The tee MUST NOT mask phase exit codes.

- **GIVEN** a `just test` run in progress
- **WHEN** an agent or human tails the echoed log path from another shell
- **THEN** the log contains the same banners and sub-suite output the terminal shows, appended live
- **AND** a failing phase still exits the script non-zero despite the tee

#### R4: Thin justfile delegate
The `test` recipe SHALL become a one-liner delegating to `scripts/test-all.sh` (Constitution VIII). The recipe name stays `test` (the `verify` recipe consumes it by name) and it continues to take no arguments. The `test-backend`/`test-frontend`/`test-e2e` recipes and CI invocations are untouched.

- **GIVEN** the updated justfile
- **WHEN** `just verify` runs
- **THEN** its `test` step runs `scripts/test-all.sh` with banners, and `check`/`build` behave as before

#### R5: Append-only output, no reporter or dependency changes
All output the script itself emits SHALL be append-only lines — no spinners, no `\r` rewriting, no ANSI cursor control (agent-friendliness: rewrites garble captured logs and `tmux capture-pane` peeks). The script SHALL introduce no new dependencies beyond bash + coreutils and SHALL NOT change any sub-suite reporter configuration (`playwright.config.ts`, Vitest config, no gotestsum).

- **GIVEN** a background `just test` run captured via `tmux capture-pane`
- **WHEN** the capture is inspected mid-run
- **THEN** every orchestrator-emitted line is a complete, timestamped, append-only line

### Design Decisions

#### Invoke recipes, not bodies
**Decision**: Each phase runs `just <recipe>` rather than inlining the recipe's commands.
**Why**: Preserves per-recipe dependencies (`_ensure-tmux-conf`) and inherits future recipe edits automatically.
**Rejected**: Duplicating recipe bodies in the script — a second copy to keep in sync.
*Introduced by*: 260904-6o28-test-progress-banners

#### Append-only lines over live progress UI
**Decision**: Timestamped append-only banners; no spinners or `\r` progress bars.
**Why**: Rewriting output garbles captured logs and capture-pane peeks show only the final frame; append-only lines make a mid-run peek informative for humans and agents alike.
**Rejected**: Spinners/progress bars (agent-hostile); custom Playwright reporter or gotestsum (the existing per-unit line output already carries N-of-M signal; new deps for no gain).
*Introduced by*: 260904-6o28-test-progress-banners

### Non-Goals

- No changes to sub-suite reporters, CI workflows, or the `test-backend`/`test-frontend`/`test-e2e` recipes.
- No shell-test framework; verification is a smoke run (standing directive 2026-09-03: the full suite is on-demand only).

## Tasks

### Phase 1: Core Implementation

- [x] T001 Create `scripts/test-all.sh` (executable, `#!/usr/bin/env bash`, `set -euo pipefail`, `REPO_ROOT` derivation per `scripts/build.sh`): echo the log path, `exec`-tee stdout+stderr into `/tmp/rk-test-<timestamp>.log`, run the three phases via `just test-backend` / `just test-frontend` / `just test-e2e` with `[N/3]` start/ok/FAILED banners and per-phase durations, fail-fast on a phase failure, and print the final per-phase summary (ok / failed / not-run) with matching exit code <!-- R1 R2 R3 R5 -->
- [x] T002 Update `justfile`: replace `test: test-backend test-frontend test-e2e` with a one-liner `test:` recipe delegating to `scripts/test-all.sh`; update the recipe comment; leave `verify` and the three sub-recipes untouched <!-- R4 -->

### Phase 2: Verification

- [x] T003 Smoke-verify without paying the full suite: run the script with the phase commands exercised cheaply (e.g. a temporary run where a phase is forced to fail fast, plus a pass-path run against fast stand-ins) to confirm banners, durations, summary rows (ok/failed/not-run), non-zero exit on failure, log-file creation with the echoed path, and absence of `\r`/cursor-control bytes in the log <!-- R2 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `scripts/test-all.sh` runs the three phases sequentially via their `just` recipes, with a start banner (wall-clock time), a completion banner (duration), and a final per-phase summary
- [x] A-002 R4: the `test` recipe is a one-liner delegating to `scripts/test-all.sh`; recipe name, argument surface, `verify`, sub-recipes, and CI are unchanged
- [x] A-003 R3: the run is teed to `/tmp/rk-test-<timestamp>.log`, the path is echoed as the first line, and the log carries banners plus sub-suite output

### Behavioral Correctness

- [x] A-004 R2: a failing phase stops the run (later phases not executed), the script exits non-zero, and the summary marks the failed phase with its exit code and unrun phases as not-run
- [x] A-005 R3: the tee does not mask exit codes — a failed phase propagates through to the script's exit status

### Scenario Coverage

- [x] A-006 R2: the failure path was exercised in a smoke run (forced failing phase) and the success path on fast stand-ins — both verified against banners, summary, exit code, and log file

### Edge Cases & Error Handling

- [x] A-007 R5: orchestrator-emitted output contains no `\r` rewriting or ANSI cursor-control sequences; sub-suite output passes through untouched

### Code Quality

- [x] A-008 Pattern consistency: the script follows `scripts/` conventions (`#!/usr/bin/env bash`, `set -euo pipefail`, `REPO_ROOT` derivation) and the justfile stays a thin index (Constitution VIII)
- [x] A-009 No unnecessary duplication: phases invoke existing recipes; no recipe bodies, reporter configs, or dependencies are duplicated or added

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant (the old `test:` dependency-chain body was replaced in place in the same edit; no leftover redundant code remains).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Tee mechanics: one `exec > >(tee "$LOG") 2>&1` redirection of the whole script rather than per-phase pipes | Intake names both as implementer's choice; a single redirection cannot mask phase exit codes (no pipeline around the phase commands) and keeps the script simple | S:70 R:90 A:85 D:75 |
| 2 | Confident | Duration format `XmYYs` computed from epoch seconds (`date +%s`); timestamp `HH:MM:SS` via `date +%H:%M:%S` | Matches the intake's banner examples; coreutils-only | S:75 R:95 A:90 D:85 |
| 3 | Confident | Log filename `rk-test-$(date +%Y%m%d-%H%M%S).log` in `/tmp` | Intake example shows `/tmp/rk-test-20260904-140211.log`; per-run uniqueness at second granularity is sufficient for a manual entry point | S:70 R:90 A:80 D:75 |

3 assumptions (0 certain, 3 confident, 0 tentative).
