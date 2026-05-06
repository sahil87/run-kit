# Tasks: rk riff — `--count` rename and fan-out correctness fixes

**Change**: 260504-lald-rk-riff-count-rename-and-fanout-fixes
**Spec**: `spec.md`
**Intake**: `intake.md`

<!--
  TASK FORMAT: - [ ] {ID} [{markers}] {Description with file paths}

  Markers:
    [P]   — Parallelizable (different files, no dependencies on other [P] tasks in same group)

  IDs are sequential: T001, T002, ...
  Tasks are grouped by phase. Phases execute sequentially.
  Within a phase, [P] tasks can execute in parallel.
-->

## Phase 1: Setup

<!-- Nothing to scaffold — `riff.go` and `riff_test.go` already exist; no new
     dependencies, no new packages, no new files. The only "setup" is verifying
     the working tree is on the change branch and tests pass before edits. -->

- [x] T001 Verify working tree is on branch `bold-moose` for change `260504-lald-rk-riff-count-rename-and-fanout-fixes`, and run baseline `cd app/backend && go test ./cmd/rk/...` so any post-change regression is attributable to this change

## Phase 2: Core Implementation

<!-- Three concrete fixes. Order matters: Bug A reshapes buildSpawnArgvs and
     spawnRiff/spawnRiffReturningName, which the rename also touches; doing
     Bug A first means the rename works against the new shape and avoids
     within-change merge churn. Bug B is independent of both and can run in
     parallel with either. -->

- [x] T002 Bug A — pane-id capture in `app/backend/cmd/rk/riff.go`: (a) drop the trailing `select-pane -t <name>.0` row from `buildSpawnArgvs` (riff.go:670) so the pure helper no longer carries a runtime-only step; (b) add a new exported helper (e.g., `runTmuxNewWindowCapturePaneID`) that invokes `tmux new-window -P -F '#{pane_id}' -n <name> -c <path> <shell>` via `exec.CommandContext` with `tmuxTimeout`, parent-context propagation for SIGINT/SIGTERM, and `tmuxChildEnv()`, then trims the single-line stdout into a pane id (e.g., `%87`); (c) restructure `spawnRiffReturningName` (riff.go:697) to call the new capture helper for the first argv (replacing the generic `runTmuxArgv` loop's first element), run remaining argvs (`split-window` × N, optional `select-layout`) via the existing `runTmuxArgv` loop, and finally invoke `runTmuxArgv(ctx, []string{"select-pane", "-t", paneID})` with the captured id; (d) on `new-window` non-zero or empty stdout, return `subprocessErr` (exit code 3) matching the rest of the riff path

- [x] T003 Bug B — fix `runWtDelete` argv in `app/backend/cmd/rk/riff.go` (riff.go:889-898): replace `exec.CommandContext(ctx, "wt", "delete", "--worktree-name", name)` with `exec.CommandContext(ctx, "wt", "delete", "--non-interactive", name)` (positional name, drop `--worktree-name`, add `--non-interactive` so the wrapped `wt` does not prompt on stdin); update the function-level comment block (riff.go:886-888) to describe the new argv shape [P]

- [x] T004 Flag rename + internal symbol rename in `app/backend/cmd/rk/riff.go` — DEPENDS ON T002. Rename `riffFanOutFlag` → `riffCountFlag` (riff.go:72, riff.go:168, riff.go:194, riff.go:274, riff.go:275, riff.go:306); replace `IntVar(&riffFanOutFlag, "fan-out", 1, …)` with `IntVarP(&riffCountFlag, "count", "N", 1, "Spawn N worktree/window pairs in parallel (N >= 1)")`; rename `effectiveSpec.FanOut` → `effectiveSpec.Count` (riff.go:240, riff.go:306, riff.go:315, riff.go:326, riff.go:459, riff.go:796) and the `cliFanOut` parameter on `resolveEffectiveSpec` accordingly; rename `runFanOut` → `runCount` (riff.go:326, riff.go:795); update validation message `--fan-out requires a positive integer` → `--count requires a positive integer` (riff.go:275); update `Use:` line (riff.go:78) to swap `[--fan-out <N>]` for `[--count <N>]`; update the `Long:` "Fan-out:" section heading and body (riff.go:110-114) to "Count:" and update the example (riff.go:124) `rk riff ship --fan-out 3` → `rk riff ship --count 3`; update the inline comment at riff.go:273 (`// fan-out validation` → `// count validation`); leave internal helpers `fanOutResult`, `planFanOutRollback`, `rollbackFanOut`, `rollbackPlan` untouched per spec Non-Goals

## Phase 3: Integration & Edge Cases

<!-- Test updates that pin the spec's behavioral guarantees. Each task here
     either modifies an existing test or adds a new one. After each task,
     run `cd app/backend && go test ./cmd/rk/...` to catch regressions early. -->

- [x] T005 Update `TestBuildSpawnArgvs` in `app/backend/cmd/rk/riff_test.go` (around riff_test.go:906-1010) — DEPENDS ON T002. Drop the `select-pane` row expectation from every sub-test: single-pane case (riff_test.go:911-931) now expects `len(got) == 1` (just `new-window`); 2-pane case (riff_test.go:933-967) now expects `len(got) == 3` (new-window + split-window + select-layout); 4-pane case (riff_test.go:969-995) now expects `len(got) == 5` (new-window + 3 split-window + select-layout); bare-skill 1-pane case (riff_test.go:997-1010) now expects `len(got) == 1`. Remove all assertions on `select-pane` argvs and the `riff-alpha.0` target assertion (riff_test.go:927-930); update `t.Fatalf` count messages accordingly

- [x] T006 Add new pane-id-capture parsing/orchestration test(s) in `app/backend/cmd/rk/riff_test.go` — DEPENDS ON T002. At minimum: a unit test asserting that the new pane-id parser trims a `%87\n` stdout to `%87` (per spec scenario "pane-id capture parses a single trimmed line"). If the capture is implemented as an extracted pure parser helper (recommended for testability), assert against that helper directly with sample inputs `"%87\n"`, `"  %12  \n"`, and `""` (empty → error)

- [x] T007 Rename test fixtures and test names referencing `--fan-out` as a flag in `app/backend/cmd/rk/riff_test.go` — DEPENDS ON T004. Replace `--fan-out` strings at riff_test.go:515-516 with `--count` (in/out fixtures for `rewritePaneSpaceForm` round-trip); rename the sub-test `"fan-out respects CLI value"` (riff_test.go:892) to `"count respects CLI value"`; update its body to read `spec.Count` instead of `spec.FanOut` (riff_test.go:897-898) and adjust the error message string accordingly. Leave `TestPlanFanOutRollback` and any other tests of internal mechanics untouched per spec [P]

- [x] T008 Add `-N` short-form parse test in `app/backend/cmd/rk/riff_test.go` — DEPENDS ON T004. New test (e.g., `TestRiffCountShortForm`) that constructs a fresh pflag set mirroring `riffCmd.Flags()` registration of `--count`/`-N`, parses argv `["-N", "3"]`, and asserts the resulting integer is `3` (covers spec scenario "short-form parse test asserts `-N 3` populates count") [P]

- [x] T009 Add `--fan-out` rejection regression test in `app/backend/cmd/rk/riff_test.go` — DEPENDS ON T004. New test (e.g., `TestRiffFanOutFlagRejected`) that invokes `riffCmd.Flags().Parse([]string{"--fan-out", "2"})` (or the equivalent path that exercises the post-rewrite parse) and asserts a non-nil error referencing `fan-out` (cobra/pflag's "unknown flag" diagnostic). Covers spec scenario "post-rename rejection test fails-fast on `--fan-out`" [P]

- [x] T010 Add `runWtDelete` argv-shape unit test in `app/backend/cmd/rk/riff_test.go` — DEPENDS ON T003. New test (e.g., `TestRunWtDeleteArgv`) that asserts the exact argv slice constructed by `runWtDelete` (or an extracted pure helper, e.g., `buildWtDeleteArgs(name string) []string`). Asserts: (a) argv contains `--non-interactive`, (b) the positional argument is the worktree basename, (c) argv does NOT contain `--worktree-name`. If extracting a pure helper is needed to make the argv testable without invoking real `wt`, do so as part of this task. Covers spec scenario "argv assertion catches a regression to `--worktree-name`" [P]

- [x] T011 Run `cd app/backend && go test ./cmd/rk/...` after T002–T010 land. All tests MUST pass; if any fail, fix the underlying implementation or the test (per constitution §Test Integrity, tests conform to spec — never the other way around)

## Phase 4: Polish

<!-- Documentation + final gates. -->

- [x] T012 Update `docs/memory/run-kit/rk-riff.md` — DEPENDS ON T004. Replace `--fan-out` with `--count` at lines 3, 9, 12, 13, 23, 33, 38, 40, 148, 170, 199, 210 (per repro grep — re-grep to catch any others); update the Quick Reference flag table entry (line 33) to document `--count` / `-N`, default `1`; update the Synopsis (line 23); update the Fan-out section heading (line 148) and body (line 170) — section can stay titled "Fan-out" because it describes the *mechanic*, but the flag references in its body change to `--count`; replace the `tmux select-pane -t <window>.0` description (lines 17, 53, 79) with a description of the pane-id capture pattern (`tmux new-window -P -F '#{pane_id}'` → captured id used as `select-pane` target); update the `wt delete --worktree-name` description (line 180) to reflect `wt delete --non-interactive <name>`; add a new changelog entry dated 2026-05-04 covering the rename, the pane-id fix, and the wt-delete fix

- [x] T013 Final gates — run `cd app/backend && go test ./cmd/rk/...` AND `cd app/backend && go vet ./...` after T012 lands. Both MUST be clean. If `go vet` flags anything in the touched files, fix at the root cause

---

## Execution Order

- **T001 → T002, T003 (parallel)** — T002 (Bug A) and T003 (Bug B) edit different regions of `riff.go` and have no logical dependency.
- **T002 MUST land before T004** — both touch `buildSpawnArgvs` / `spawnRiff*` and the `Use:`/`Long:` text region of `riff.go`. Doing Bug A first means T004 rebases against the new (smaller) `buildSpawnArgvs` shape and avoids within-change merge conflicts on the same hunk. T002 also reshapes `spawnRiffReturningName`'s argv loop, which T004's `runFanOut` → `runCount` rename does not depend on, but the file-level adjacency is a real concern.
- **T003 is independent** — `runWtDelete` lives at riff.go:889 and is not touched by T002 or T004; can run any time after T001.
- **T005 depends on T002** — the test expectation changes (`select-pane` row removed) only become correct once `buildSpawnArgvs` is reshaped.
- **T006 depends on T002** — exercises the new pane-id capture path that does not exist before T002.
- **T007, T008, T009 depend on T004** — they reference `--count`, `-N`, the renamed `spec.Count` field, and the post-rename rejection contract.
- **T010 depends on T003** — exercises the new argv shape produced by the wt-delete fix.
- **T007–T010 can run in parallel with each other** — they edit different test functions in the same file (`riff_test.go`); coordinate so the file is committed once.
- **T011 is a gate** — runs after all Phase 3 edits and before Phase 4 to catch regressions while context is fresh.
- **T012 depends on T004** — the doc updates reference the post-rename flag names. Independent of test tasks T005–T010 — can run in parallel with them after T004.
- **T013 is the final gate** — runs after T011 and T012; closes out the change.
