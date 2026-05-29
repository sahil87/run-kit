# Plan: rk riff — `--count` rename and fan-out correctness fixes

**Change**: 260504-lald-rk-riff-count-rename-and-fanout-fixes
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

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

## Acceptance

## Functional Completeness
<!-- Every requirement in spec.md has working implementation -->
- [ ] CHK-001 `--count` / `-N` flag registered: `rk riff` exposes `--count` integer flag with short form `-N`, default `1`; verify via `rk riff -h` and pflag registration in `riff.go` (`IntVarP(&riffCountFlag, "count", "N", 1, …)`).
- [ ] CHK-002 Sub-1 count rejected pre-subprocess: values `<= 0` (zero, negative) exit 1 with stderr `--count requires a positive integer`, before any `wt` or `tmux` invocation.
- [ ] CHK-003 `--fan-out` removed from flag set: the previous flag is not registered in any form; `rk riff --fan-out 2` produces cobra's "unknown flag" error referencing `fan-out`.
- [ ] CHK-004 Help text references `--count` / `-N`: `Use:` synopsis, `Long:` description (Count: section), and at least one example (`rk riff ship --count 3`) reference the new flag; no `--fan-out` strings remain in help output.
- [ ] CHK-005 Internal symbols renamed: `riffFanOutFlag` → `riffCountFlag`, `effectiveSpec.FanOut` → `effectiveSpec.Count`, `runFanOut` → `runCount` are renamed and `go build ./...` succeeds in `app/backend/` with no references to the old names.
- [ ] CHK-006 Internal mechanic helpers preserved: `fanOutResult`, `planFanOutRollback`, `rollbackFanOut`, `rollbackPlan`, and `TestPlanFanOutRollback` retain their existing names per spec Non-Goals.
- [ ] CHK-007 `-N` short-form parse test exists: a Go test asserts argv `["-N", "3"]` parses into count value `3` against a pflag set mirroring `riffCmd.Flags()`.
- [ ] CHK-008 `--fan-out` rejection regression test exists: a Go test asserts that parsing `["--fan-out", "2"]` against the post-rename `riffCmd` returns a non-nil error referencing `fan-out`.
- [ ] CHK-009 `select-pane` targets pane id, not hardcoded index: implementation captures the pane id from `tmux new-window -P -F '#{pane_id}'` and passes it as the `select-pane -t <pane_id>` target; no `.0` or `.1` suffix appears on `select-pane` argvs.
- [ ] CHK-010 Pane-id parse trims single line: stdout like `%87\n` is parsed to `%87` with no leading/trailing whitespace and no embedded newline; covered by a unit test.
- [ ] CHK-011 Pane-id capture uses `exec.CommandContext` with `tmuxTimeout`: the new subprocess invocation uses `exec.CommandContext` bounded by `tmuxTimeout` (10s), no shell-string construction, no template-string interpolation.
- [ ] CHK-012 Pane-id capture inherits tmux child env: `tmuxChildEnv()` is set on the subprocess so the call targets the user's tmux server (honouring `TMUX=<user's original value>`).
- [ ] CHK-013 Parent context propagation: pane-id-capturing subprocess derives its context from the parent so SIGINT/SIGTERM cancels the child rather than blocking past `tmuxTimeout`.
- [ ] CHK-014 Pane-id capture failure surfaces as exit 3: non-zero exit, timeout, or empty stdout returns a `*exitCodeError` with `code == 3` matching the rest of the riff path; user sees `rk riff: tmux new-window failed: …` on stderr.
- [ ] CHK-015 `buildSpawnArgvs` no longer emits trailing `select-pane`: the pure helper returns argvs for `new-window`, `split-window`(s), and optional `select-layout` only; runtime-constructed `select-pane -t <pane-id>` happens in the orchestrator (`spawnRiff` / `spawnRiffReturningName`).
- [ ] CHK-016 `runWtDelete` argv shape: invokes `wt delete --non-interactive <basename>` — positional name, includes `--non-interactive`, does NOT include `--worktree-name`; subprocess uses `exec.CommandContext` with `wtTimeout` (30s).
- [ ] CHK-017 `runWtDelete` argv unit test exists: a Go test asserts the exact argv slice (presence of `--non-interactive`, positional basename, absence of `--worktree-name`).
- [ ] CHK-018 Memory file `docs/memory/run-kit/rk-riff.md` updated: `--fan-out` references replaced with `--count`; pane-id capture pattern documented in the Pane Spawn / Window Construction area; `wt delete` description updated to `--non-interactive <name>` form; new changelog entry dated 2026-05-04 covers all three fixes.

## Behavioral Correctness
<!-- Changed requirements behave as specified, not as before -->
- [ ] CHK-019 `--count 1` (default) takes single-spawn path: behaviour is observably identical to `rk riff --cmd "echo hi"` (no `--count`); only `Count >= 2` enters `runCount` (renamed from `runFanOut`).
- [ ] CHK-020 `-N` is observably equivalent to `--count`: `rk riff -N 3 …` produces the same effective spec and the same external result as `rk riff --count 3 …`.
- [ ] CHK-021 Single-pane riff is silent on stderr after fix: on `pane-base-index 1`, `rk riff --cmd "echo hi"` no longer emits `can't find pane: 0` (cosmetic regression eliminated).
- [ ] CHK-022 Multi-pane riff focuses the new-window pane: after `select-layout` runs, the active pane is the one created by `new-window` regardless of `pane-base-index` value.
- [ ] CHK-023 Rollback runs without prompting: rollback path invokes `wt delete --non-interactive <name>` and does NOT block on stdin; no `Delete this worktree?` prompt appears in any output stream.
- [ ] CHK-024 Rollback errors do not mask primary error: `rollbackFanOut` continuing after a `wt delete` failure logs `rk riff: rollback warning: wt delete <name> failed: …` to stderr but the value returned from `runCount` (renamed `runFanOut`) is the original first-recorded goroutine error.
- [ ] CHK-025 Renamed `runCount` orchestrator dispatches off `spec.Count`: code paths previously branching on `effectiveSpec.FanOut` now branch on `effectiveSpec.Count` with identical semantics.

## Removal Verification
<!-- Every deprecated requirement is actually gone -->
- [ ] CHK-026 `--fan-out` flag fully removed: no pflag/cobra registration for `fan-out`; `git grep -n -- '--fan-out' app/backend/cmd/rk/` returns no flag-registration or help-text matches; runtime `rk riff --fan-out` errors with cobra's unknown-flag diagnostic.
- [ ] CHK-027 Hardcoded pane-index `select-pane` targeting removed: `git grep -nE 'select-pane.*\.[01]"' app/backend/cmd/rk/riff.go` returns no matches; no `<window>.0` or `<window>.1` literal targets remain.
- [ ] CHK-028 `wt delete --worktree-name` form removed: `git grep -n -- '--worktree-name' app/backend/cmd/rk/` returns no matches; `runWtDelete` uses positional argument exclusively.
- [ ] CHK-029 No dead code from rename: the old symbols (`riffFanOutFlag`, `effectiveSpec.FanOut`, `runFanOut`) and old strings (`--fan-out requires a positive integer`, `// fan-out validation`) are gone from `app/backend/cmd/rk/`.

## Scenario Coverage
<!-- Key scenarios from spec.md have been exercised -->
- [ ] CHK-030 Scenario "`--count` with positive integer creates that many worktree/window pairs": `rk riff --count 2 --cmd "echo hi; sleep 30"` creates two worktrees and two `riff-<basename>` tmux windows, exits 0 with no stderr.
- [ ] CHK-031 Scenario "`-N` short form is equivalent to `--count`": covered by unit test asserting `-N 3` parses to `3` and by acceptance run `rk riff -N 3 --cmd "echo hi"`.
- [ ] CHK-032 Scenario "`--count 1` (default) takes the single-spawn path": acceptance run with no `--count` matches `--count 1` behaviour identically.
- [ ] CHK-033 Scenario "`--count 0` is rejected before any subprocess call": exits 1 with `--count requires a positive integer`; no `wt`/`tmux` invocation occurs.
- [ ] CHK-034 Scenario "negative `--count` is rejected": exits 1 (via rk validation message or cobra/pflag integer-parse error); no worktrees created.
- [ ] CHK-035 Scenario "`--fan-out` is rejected as an unknown flag": exits non-zero; stderr contains "unknown flag" referencing `fan-out`; no worktrees or windows created.
- [ ] CHK-036 Scenario "help text contains `--count` and `-N`, not `--fan-out`": `rk riff -h` contains `--count` and `-N`, contains no `--fan-out`, and includes at least one renamed example.
- [ ] CHK-037 Scenario "single-pane riff on `pane-base-index 1` produces no `select-pane` error": acceptance run on a tmux server with `pane-base-index 1` shows clean stderr.
- [ ] CHK-038 Scenario "single-pane riff on `pane-base-index 0` continues to work": acceptance run on default-config tmux still focuses pane 0 with no error output.
- [ ] CHK-039 Scenario "pane-id capture parses a single trimmed line": unit test covers `%87\n` → `%87`.
- [ ] CHK-040 Scenario "rollback after partial fan-out failure deletes worktrees without prompting": forced partial-failure repro removes the surviving worktree via `wt delete --non-interactive <basename>` with no prompt; surviving tmux window is killed by `kill-window`.
- [ ] CHK-041 Scenario "argv assertion catches a regression to `--worktree-name`": reverting `runWtDelete` to the previous form causes the dedicated unit test to fail with a message identifying the missing/extra flag.
- [ ] CHK-042 Acceptance scenario "single-pane riff is silent on stderr": end-to-end repro on `pane-base-index 1` shows no `can't find pane: 0` and no other tmux/wt error.
- [ ] CHK-043 Acceptance scenario "multi-count riff creates N worktrees + N windows": end-to-end repro confirms two worktrees on disk and two `riff-<basename>` windows exist after `rk riff --count 2`.
- [ ] CHK-044 Acceptance scenario "forced partial failure rolls back cleanly": deliberately-induced failure path produces non-zero exit, removes both worktrees, kills the surviving window, and surfaces the original failure on stderr.

## Edge Cases & Error Handling
<!-- Error states, boundary conditions, failure modes -->
- [ ] CHK-045 Empty pane-id stdout: `tmux new-window -P -F '#{pane_id}'` returning empty stdout (or whitespace-only) is treated as a failure and surfaces as `subprocessErr` (exit code 3), not a silent skip of `select-pane`.
- [ ] CHK-046 Pane-id capture timeout: subprocess that exceeds `tmuxTimeout` is cancelled by `exec.CommandContext`; the function returns a non-nil error rather than blocking.
- [ ] CHK-047 Parent SIGINT during pane-id capture: pressing Ctrl-C while `new-window` is in flight cancels the child and returns a context-cancellation error.
- [ ] CHK-048 Worktree path missing at `new-window`: when `tmux new-window -c <missing-path>` fails, `spawnRiff` returns a `*exitCodeError{code: 3}` with stderr `rk riff: tmux new-window failed: …`.
- [ ] CHK-049 Rollback `wt delete` non-zero exit logged not masked: rollback continues across multiple goroutine cleanups; per-goroutine failures are logged as `rk riff: rollback warning: wt delete <name> failed: …` and the original error is preserved as the return value.
- [ ] CHK-050 Stdin-less rollback context: `wt delete --non-interactive` does not block on EOF stdin in rollback path (which runs without a tty attached).
- [ ] CHK-051 Multi-pane window with empty Layout: `buildSpawnArgvs` returns only `new-window` + `split-window`(s) (no `select-layout`, no `select-pane`); orchestrator still constructs runtime `select-pane` from captured id.
- [ ] CHK-052 `pane-base-index` server vs window scoping: the implementation correctness does not depend on which scope the option is set in — pane-id capture is canonical and works regardless.

## Code Quality
<!-- Always included. Baseline items when no code_quality config; expanded when config exists -->
- [ ] CHK-053 Pattern consistency: new code in `riff.go` follows existing naming/structural patterns (e.g., `runTmuxArgv` style helpers, `subprocessErr` exit-code discipline, capitalised exported helpers if any).
- [ ] CHK-054 No unnecessary duplication: pane-id capture helper reuses existing `tmuxChildEnv()`, `tmuxTimeout`, and `subprocessErr`/`exitCodeError` plumbing rather than reimplementing them; tmux argv construction stays consolidated in `internal/tmux/` patterns where applicable.
- [ ] CHK-055 Readability over cleverness: the orchestrator restructure in `spawnRiff*` (capture id → run remaining argvs → runtime `select-pane`) is straight-line and easy to follow; no clever metaprogramming over the argv loop.
- [ ] CHK-056 Existing project patterns followed: `IntVarP` registration mirrors other flag registrations; `runWtDelete` argv update preserves the existing logging/error wrapping behaviour.
- [ ] CHK-057 `exec.CommandContext` with timeout: the new pane-id-capturing subprocess uses `exec.CommandContext` bounded by `tmuxTimeout`; no `exec.Command` without context, no shell strings, no template-string interpolation.
- [ ] CHK-058 State derived at request time: no in-memory caching of pane ids, base-index values, or wt arg shape — every invocation re-derives at request time per Convention.
- [ ] CHK-059 Tests added for added/changed behaviour: `-N` parse test, `--fan-out` rejection test, pane-id parse test, `runWtDelete` argv test, and `TestBuildSpawnArgvs` updates all land in `riff_test.go` for the new contract.
- [ ] CHK-060 Anti-pattern — no shell-string subprocess construction: pane-id capture and `wt delete` invocations use argv slices, never shell concatenation or template strings.
- [ ] CHK-061 Anti-pattern — no inline tmux command construction outside the established helpers: pane-id capture lives in a named helper alongside `runTmuxArgv` rather than ad-hoc inline `exec.CommandContext` calls scattered through `spawnRiff*`.
- [ ] CHK-062 Anti-pattern — no magic strings/numbers: pane-id format string `'#{pane_id}'`, exit code `3`, and timeout constants reuse named constants (`tmuxTimeout`, `wtTimeout`) or are localised to a single declaration site with a clear name.
- [ ] CHK-063 Anti-pattern — no god functions: the restructured `spawnRiffReturningName` stays within the project's readability bar (no >50-line single-purpose blob); pure helpers continue to carry the deterministic argv construction.

## Security
<!-- Only include if the change has security surface -->
- [ ] CHK-064 No shell injection vector in pane-id capture: subprocess invoked via `exec.CommandContext("tmux", "new-window", "-P", "-F", "#{pane_id}", "-n", resolvedName, "-c", worktreePath, paneShellString)` with explicit argv slice — no shell-string concatenation, no `sh -c` indirection.
- [ ] CHK-065 User-controlled inputs validated before subprocess: `resolvedName` (window/session basename) and `worktreePath` continue to flow through existing validation paths before reaching `tmux new-window` argv (no new bypass introduced by the restructure).
- [ ] CHK-066 No shell injection vector in `wt delete` rollback: `exec.CommandContext("wt", "delete", "--non-interactive", name)` uses an explicit argv slice; positional `name` is the validated worktree basename.
- [ ] CHK-067 Pane-id parse is bounded: stdout from `tmux new-window -P -F '#{pane_id}'` is trimmed and treated as opaque; no eval, no interpolation into a subsequent shell string.
- [ ] CHK-068 Subprocess timeouts enforced: per project Code Review rules, every `execFile`/`exec.CommandContext` in the riff path includes a timeout (`tmuxTimeout` = 10s for tmux ops, `wtTimeout` = 30s for wt ops) — verify no hung tmux/wt subprocess can block the server.
- [ ] CHK-069 Captured pane id is treated as data, not code: pane id (e.g., `%87`) is passed as a single argv element to `select-pane -t <pane-id>`, never concatenated into a shell string or used as part of a format/template that could be misinterpreted.

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
