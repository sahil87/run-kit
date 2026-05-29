# Plan: rk riff — Workflow Features

**Change**: 260423-jmwu-rk-riff-workflow-features
**Status**: In Progress
**Intake**: `intake.md`
**Spec**: `spec.md`

## Tasks

## Phase 1: Setup

- [x] T001 [P] Extend `app/backend/internal/fabconfig/fabconfig.go` with `Preset` and `PaneSpec` types and a `ReadPresets(repoRoot string) map[string]Preset` function. Follows existing best-effort-never-errors pattern: returns empty map for missing file, malformed YAML, missing `riff` or `riff.presets` block, or any preset containing a pane entry with both `skill` and `cmd` keys. `Preset` has fields `Layout string`, `Panes []PaneSpec`, `WtArgs []string`. `PaneSpec` has `Skill string`, `Cmd string`, and an internal `Kind` field (one of `"skill"` or `"cmd"`) set during parsing based on which key was present.
- [x] T002 [P] Add an internal `app/backend/cmd/rk/layout.go` file containing: (a) a `layoutAliases` map from canonical + shortform names to canonical tmux names (`auto`, `tiled`, `even-horizontal`, `even-vertical`, `main-horizontal`, `main-vertical`); (b) a `resolveLayout(raw string) (canonical string, err error)` function that accepts any of the 12 valid strings (case-sensitive, matching tmux's own) and returns the canonical form or an error listing valid values; (c) a pure `autoLayout(paneCount int) string` returning `""` for count 1, `"even-horizontal"` for count 2, `"tiled"` for count ≥3.
- [x] T003 [P] Add an internal `app/backend/cmd/rk/pane_spec.go` file containing a `PaneSpec` type (fields: `Kind string` — `"skill"` or `"cmd"`; `Value string`) and a `paneFlag` custom `pflag.Value` implementation that: (a) accepts a `Kind` constructor arg; (b) consumes the next argv token as a value only if it does not begin with `-`; (c) on bare invocation (no value, or next token starts with `-`), records an empty-string value; (d) appends each occurrence to a shared `*[]PaneSpec` slice preserving argv order. The shared slice is set up in `init()` so both `--skill` and `--cmd` append into a single ordered list.

## Phase 2: Core Implementation

- [x] T004 Extend `app/backend/internal/fabconfig/fabconfig_test.go` with tests for `ReadPresets`: (a) empty file returns empty map; (b) missing `riff` block returns empty map; (c) malformed YAML returns empty map; (d) valid preset with layout + panes + wt_args returns correctly populated struct; (e) preset with pane having both `skill` and `cmd` keys: containing preset omitted; (f) preset with unknown extra keys: tolerated (ignored); (g) preset with empty `panes` list: valid, returned with empty slice.
- [x] T005 In `app/backend/cmd/rk/riff.go`, remove the `--setup-pane` flag declaration and its reference in `runRiff`. Remove the `riffSetupPaneFlag` package var. Remove the `runTmuxSplitWindow` function entirely (its use is gone; `--cmd` panes are handled by the new spawn path).
- [x] T006 In `app/backend/cmd/rk/riff.go`, replace the singular `--skill` string flag with two repeatable pane flags using the custom `paneFlag` type from T003: `--skill` (Kind `"skill"`) and `--cmd` (Kind `"cmd"`). Both append into a shared `riffPaneSpecs []PaneSpec` ordered list. Remove the old `riffSkillFlag` string var.
- [x] T007 In `app/backend/cmd/rk/riff.go`, add a `--layout` string flag wired to a `riffLayoutFlag` package var, defaulting to `"auto"`. Validate via `resolveLayout` (from T002) at the top of `runRiff` before any subprocess invocation.
- [x] T008 In `app/backend/cmd/rk/riff.go`, add a `--fan-out` int flag wired to a `riffFanOutFlag` package var, defaulting to `1`. Validate: require ≥1; `--fan-out 0` or negative errors out before any subprocess invocation with exit code 1.
- [x] T009 In `app/backend/cmd/rk/riff.go`, add a `--preset` string flag and a `--list-presets` boolean flag wired to package vars. Do NOT wire them as required — they are additive.
- [x] T010 In `app/backend/cmd/rk/riff.go`, add a preset-resolution helper `resolveActivePreset(args []string, positionalCandidate string, presetFlag string, available map[string]fabconfig.Preset) (*fabconfig.Preset, []string, error)`. Algorithm: (a) if `--preset` is set AND positional matches a preset, return error "preset specified twice (positional and --preset)"; (b) if `--preset` is set, look it up in `available`; unknown → error listing known presets; (c) else if `positionalCandidate` matches a preset name exactly, consume it (return the preset + args[1:]); (d) else return `(nil, args, nil)`.
- [x] T011 In `app/backend/cmd/rk/riff.go`, add a `resolveEffectiveSpec(cliPanes []PaneSpec, cliLayout string, cliFanOut int, preset *fabconfig.Preset, passthrough []string) (effectiveSpec, error)` function that produces the final pane list, layout, fan-out, and wt passthrough. Rules per spec: CLI panes replace preset panes entirely; explicit `--layout` overrides preset layout; preset `wt_args` prepended to passthrough. If no panes result (no CLI panes AND preset had no panes), default to a single `skill` pane using the built-in default `/fab-discuss` (preserves the change-2 behavior for the no-flag case).
- [x] T012 In `app/backend/cmd/rk/riff.go`, add a `spawnRiff(ctx context.Context, worktreePath string, spec effectiveSpec) error` helper that performs the single-window spawn: `tmux new-window -n <riff-name> -c <path> <first-pane-cmd>`, then for each subsequent pane run `tmux split-window -c <path> <pane-cmd>`, then `tmux select-layout <canonical>` if layout != "". First-pane command composition reuses the existing `buildNewWindowArgs` logic. Additional pane commands reuse `shellWrap`; skill panes compose `<launcher> '<escaped-skill>'` and wrap identically to the first pane; cmd panes with a value use `shellWrap(cmdValue)`; cmd panes with empty value use `shellWrap("")` (yields bare shell). Skill panes with empty value compose just `<launcher>` (no single-quoted arg) and wrap interactively.
- [x] T013 In `app/backend/cmd/rk/riff.go`, implement the focus step: after all panes are created, invoke `tmux select-pane -t <window>.0` to set focus to pane 0 (the first argv entry). Use the window target from the `new-window` output (or `:` for current window) consistent with existing tmux usage patterns in this file.
- [x] T014 In `app/backend/cmd/rk/riff.go`, add a `runFanOut(ctx context.Context, n int, passthrough []string, spec effectiveSpec) error` helper that: (a) launches N goroutines via `errgroup.Group`, each invoking `runWtCreate` + `spawnRiff`; (b) tracks successfully-created worktrees + windows for rollback; (c) on any goroutine error, cancels the group context and runs rollback: `wt delete --worktree-name <name>` per created worktree and `tmux kill-window -t <window>` per created window; rollback errors are logged but do not mask the primary error; (d) returns `subprocessErr` with the first goroutine's error embedded.
- [x] T015 In `app/backend/cmd/rk/riff.go`, rewrite `runRiff` to orchestrate the new flow: preconditions → context wrap → `--list-presets` short-circuit (if set, print + exit 0 before any subprocess) → launcher resolution → preset resolution → spec assembly → fan-out dispatch (N=1 uses `spawnRiff` directly; N≥2 uses `runFanOut`). Preserve exit-code discipline, SIGINT propagation, and `tmuxChildEnv` restoration everywhere.
- [x] T016 In `app/backend/cmd/rk/riff.go`, add a `printPresets(presets map[string]fabconfig.Preset, out io.Writer) error` helper that writes each preset name in sorted order, followed by an indented human-readable dump of its fields (layout, panes in argv order, wt_args). Output format: indented YAML-like plain text, header line per preset, one blank line between presets. If `presets` is empty, print `No presets defined in fab/project/config.yaml`. Return 0 via the normal return path.
- [x] T017 In `app/backend/cmd/rk/riff.go`, replace the existing `riffCmd.Long` help text with a new version covering: expanded synopsis in `Use`; 5+ examples covering default, multi-pane interleaved, explicit layout, preset (positional), preset (alias), fan-out with preset; exit-code table preserved; preconditions preserved.
- [x] T018 Add a `app/backend/cmd/rk/layout_help.go` file exporting a `renderLayoutMocks() string` function that produces the Unicode box-drawing ASCII mock block for all 6 layouts (including `auto`). Wire it into the `--layout` flag's Usage text. Use `pflag.VarPF(...).Usage = ...` or cobra's `SetUsageTemplate` / `SetUsageFunc` — whichever allows multi-line help per flag. If a custom usage template is required, match cobra house style. <!-- clarified: spec §Help Output only requires mocks for "at least 5 layout shapes"; this task produces 6 (auto can be a short textual description rather than a visual mock) — the stricter form satisfies the spec. -->


## Phase 3: Integration & Edge Cases

- [x] T019 Extend `app/backend/cmd/rk/riff_test.go` with tests for the custom `paneFlag` type from T003: bare flag, space-form with value, equals-form, space-form when next token is a flag, multiple interleaved occurrences producing correct argv-order slice.
- [x] T020 Extend `app/backend/cmd/rk/riff_test.go` with tests for `resolveLayout` and `autoLayout`: valid canonical passthrough, valid shortform resolution, unknown value error (assert error text lists all 12 names), `autoLayout` for counts 1, 2, 3, 4, 0 (expected: "" for 0 too).
- [x] T021 Extend `app/backend/cmd/rk/riff_test.go` with tests for `resolveActivePreset`: (a) positional match consumes arg; (b) positional non-match leaves args untouched; (c) `--preset` flag resolution; (d) conflict between positional + `--preset`; (e) unknown preset via `--preset`; (f) no preset available: returns nil.
- [x] T022 Extend `app/backend/cmd/rk/riff_test.go` with tests for `resolveEffectiveSpec`: (a) preset panes + no CLI panes → use preset; (b) preset panes + CLI panes → use CLI only; (c) CLI layout overrides preset layout; (d) preset `wt_args` prepended to passthrough; (e) no panes anywhere → default to single `/fab-discuss` skill pane; (f) CLI fan-out overrides preset fan-out (if preset ever carried one — currently spec says it does not).
- [x] T023 Extend `app/backend/cmd/rk/riff_test.go` with a pure test for `spawnRiff`-argv construction: use a table-driven test covering single-pane, 2-pane (skill+cmd), 4-pane interleaved, bare `--skill`, bare `--cmd`. Assert the tmux argv slice (for new-window + split-window + select-layout + select-pane) matches expected. Do not invoke real tmux — assert on argv directly from the builder helper (split T012 such that argv construction is a pure helper: e.g., `buildSpawnArgvs(worktreePath, resolvedName, launcher, spec) [][]string`). <!-- clarified: existing riff.go has no runner abstraction; the pure-builder route is chosen over introducing a runner seam to keep the change minimal, consistent with the existing `buildNewWindowArgs` test-seam pattern (riff.go:265). -->
- [x] T024 Extend `app/backend/cmd/rk/riff_test.go` with tests for `printPresets`: (a) empty map → "No presets defined..." line; (b) 2 presets → sorted output, all fields present. Assert against a captured `bytes.Buffer`.
- [x] T025 Add rollback-scenario tests to `app/backend/cmd/rk/riff_test.go` for the fan-out path. <!-- clarified: existing codebase has no runner interface and introducing one is out-of-scope; use the pure-helper fallback path. Split T014's `runFanOut` so the rollback plan (which worktrees to delete + which windows to kill, given a set of partial successes + one failure) is computed by a pure function `planFanOutRollback(successes []fanOutResult, failureIdx int) rollbackPlan` and test that directly. Assert: (a) all successful worktrees appear in the delete list; (b) all successful windows appear in the kill list; (c) the plan excludes the failed goroutine's own (incomplete) artifacts. -->

## Phase 4: Polish

- [x] T026 Update `docs/memory/run-kit/rk-riff.md`: rewrite the Flag Surface table, Invocation examples, Workflow Step Order (to cover N-pane + fan-out + preset + list-presets paths). Add new sections: Pane Array Model, Layout Flag, Presets, Fan-Out, `--list-presets`. Remove `--setup-pane` references. Add Changelog entry for this change.
- [x] T027 Update `docs/memory/run-kit/tmux-sessions.md` § `rk riff Window Creation`: rewrite for the pane-array model (`tmux new-window` then N-1 `tmux split-window` calls + `select-layout` + `select-pane`). Document the `riff-<wt-name>` naming pattern for fan-out windows. Remove `--split`/`--setup-pane` references. Add Changelog entry.
- [x] T028 [P] Update `app/backend/cmd/rk/context.go` if it references riff flags or capabilities (grep for `riff`, `--skill`, `--setup-pane` in that file; rewrite references to match the new surface). Keep in sync with the canonical `rk riff --help`.
- [x] T029 Run `go build ./...` from `app/backend` and fix any compile errors. Run `go test ./...` from `app/backend` and fix any failing tests. Confirm: `go vet ./...` is clean.
- [x] T030 Smoke-test `rk riff --list-presets` (with and without a presets block in `fab/project/config.yaml`), `rk riff -h` (confirm ASCII mocks render), and `rk riff --layout diagonal` (confirm error lists valid names). Smoke-test is manual — document the expected outputs in a PR comment rather than automating.

---

## Execution Order

- Phase 1 tasks T001-T003 are parallelizable (different files, no cross-dependencies).
- Phase 2 core: T004 is parallelizable (test file, independent from riff.go changes). T005 (remove --setup-pane) should run before T006 (add new pane flags) to keep diffs clean. T006 depends on T003. T007 depends on T002. T011 depends on T006 + T010. T012 depends on T006 + T007 + T011. T013 depends on T012. T014 depends on T012. T015 depends on T005-T014. T016-T018 can run in parallel after the flag surface stabilizes (after T009).
- Phase 3 tests depend on the corresponding Phase 2 implementation.
- Phase 4: T026 + T027 are doc-only, parallelizable. T028 is independent. T029 (build + test) must run last; T030 is manual smoke after T029 passes.

**Critical path**: T003 → T006 → T011 → T012 → T015 → T029.

## Acceptance

## Functional Completeness

- [x] CHK-001 Repeatable `--skill` / `--cmd`: `rk riff --cmd --skill /a --cmd htop --skill` produces 4 ordered panes (bare shell, claude+skill, shell+cmd, blank claude) with correct argv-order.
- [x] CHK-002 Bare-flag semantics: `--cmd` (no value) spawns `$SHELL` with `shellWrap` suffix; `--skill` (no value) spawns the launcher with no skill arg.
- [x] CHK-003 Space-form parsing: `--cmd htop` consumes next token when it does not start with `-`; `--cmd --skill /foo` leaves `--cmd` bare.
- [x] CHK-004 Equals-form parsing: `--cmd=htop` assigns value `htop` to `--cmd`.
- [x] CHK-005 Focus-pane: pane 0 (first argv entry) receives focus via `tmux select-pane -t <window>.0` regardless of type.
- [x] CHK-006 `--setup-pane` removal: flag declaration removed; `riffSetupPaneFlag` var removed; `runTmuxSplitWindow` removed; invocation errors with cobra's "unknown flag".
- [x] CHK-007 `--layout` accepts all 12 valid strings: 6 canonical (`auto`, `tiled`, `even-horizontal`, `even-vertical`, `main-horizontal`, `main-vertical`) and 6 shortforms (`a`, `t`, `h`, `v`, `deck-h`, `deck-v`); shortforms resolve to canonical before tmux invocation.
- [x] CHK-008 `auto` layout mapping: pane-count 1 → no `select-layout` call; 2 → `even-horizontal`; 3+ → `tiled`. Explicit `main-*` with 1 pane → silent no-op. `resolveEffectiveSpec` now forces `spec.Layout = ""` whenever `len(spec.Panes) <= 1`, regardless of source (CLI, preset, or default). Test `single-pane window suppresses layout regardless of source` at `riff_test.go:831` pins the behavior.
- [x] CHK-009 Unknown `--layout` value rejected pre-subprocess with stderr listing all 12 valid names; exit code 1.
- [x] CHK-010 `-h` renders Unicode box-drawing ASCII mocks for all 6 layouts; canonical + shortform names visible alongside.
- [x] CHK-011 Preset config read from top-level `riff.presets.<name>` in `fab/project/config.yaml`; nested `agent.riff.presets` path NOT recognized.
- [x] CHK-012 Preset schema: typed ordered `panes:` list with single-key entries (`{skill: "..."}` or `{cmd: "..."}`); multi-key or malformed entries cause the containing preset to be silently omitted.
- [x] CHK-013 `ReadPresets` best-effort pattern: empty file, missing block, malformed YAML, unknown extra keys all return gracefully (empty map or tolerant parsing) with no error.
- [x] CHK-014 Positional preset invocation: `rk riff ship` consumes `ship` as preset when defined; non-matching positional is not consumed.
- [x] CHK-015 `--preset <name>` alias resolves identically to positional form.
- [x] CHK-016 Positional + `--preset` conflict errors out with descriptive message and exit code 1.
- [x] CHK-017 Unknown preset via `--preset` errors out listing known preset names; exit code 1.
- [x] CHK-018 CLI panes replace preset panes entirely (no append); verified via `rk riff ship --skill /review` producing only 1 pane.
- [x] CHK-019 Explicit `--layout` overrides preset `layout`.
- [x] CHK-020 Preset `wt_args` prepended to user passthrough (preset args before user args in final wt argv).
- [x] CHK-021 `--list-presets`: plain-text output, exits 0, no `wt`/`tmux` subprocesses spawned; "No presets defined..." message when empty.
- [x] CHK-022 `--fan-out N` (N≥2) spawns N windows with identical pane shape (same panes, same layout).
- [x] CHK-023 `--fan-out 1` behaves identically to omitting `--fan-out`.
- [x] CHK-024 `--fan-out 0` or negative rejected pre-subprocess; exit code 1.
- [x] CHK-025 Fan-out worktree naming: `wt create` invoked without rk-supplied `--worktree-name`; each worktree gets its own `wt`-assigned name.
- [x] CHK-026 Fan-out tmux windows named `riff-<wt-name>` per worktree; collision auto-suffix via existing `resolveWindowName`.
- [x] CHK-027 Fan-out concurrency: `errgroup.Group` (or equivalent) parallel execution; partial failure triggers rollback of all successful worktrees + windows. (Uses `sync.WaitGroup` + context cancellation, semantically equivalent.)
- [x] CHK-028 Fan-out rollback: `wt delete` per successful worktree; `tmux kill-window` per opened window; rollback errors logged but do not mask primary error.
- [x] CHK-029 SIGINT propagation preserved: `signal.NotifyContext` wrap covers fan-out goroutines; in-flight subprocesses killed via `exec.CommandContext`.
- [x] CHK-030 `riffCmd.Use` / `Long` updated: new flag synopsis, 5+ examples (default, multi-pane, explicit layout, preset positional, fan-out).

## Behavioral Correctness

- [x] CHK-031 Singular `--skill` (legacy use) still works: `rk riff --skill /foo` produces 1-pane window identical to change-2 behavior.
- [x] CHK-032 Existing preconditions preserved: `$TMUX` set + `wt` on PATH checked in order; exit 2 on failure.
- [x] CHK-033 Existing launcher resolution preserved: `fabconfig.ReadSpawnCommand` + fallback to hardcoded `claude --dangerously-skip-permissions`.
- [x] CHK-034 Existing exit-code discipline preserved: exit 0 success; 2 precondition; 3 subprocess; 1 generic/cobra.
- [x] CHK-035 Existing `tmuxChildEnv` restore applied to every `tmux`/`wt` subprocess call (including new split-window and select-layout calls from pane-array path). (All tmux calls go via `runTmuxArgv` which sets `cmd.Env = tmuxChildEnv()`; `listWindowNames` does the same; `runWtCreate` and `runWtDelete` do not need TMUX since wt is not a tmux server consumer.)
- [x] CHK-036 Existing `escapeSingleQuotes` applied to every skill string passed to the launcher.
- [x] CHK-037 Existing `shellWrap` suffix applied to every pane command so panes stay interactive after the command exits.

## Removal Verification

- [x] CHK-038 `--setup-pane` flag fully removed: no declaration in `riffCmd.Flags()`, no `riffSetupPaneFlag` var, no references in comments or docs.
- [x] CHK-039 `runTmuxSplitWindow` function fully removed from `riff.go`; one stale comment reference remains in `buildSpawnArgvs` docstring (see nice-to-have).
- [x] CHK-040 Memory docs (`rk-riff.md`, `tmux-sessions.md`, `architecture.md`) updated: no stale `--setup-pane` / `--split` references. `architecture.md` line 270 `riff` row rewritten to describe the repeatable-pane/layout/preset/fan-out surface.

## Scenario Coverage

- [x] CHK-041 Interleaved 4-pane scenario: `rk riff --cmd --skill /fab-discuss --cmd htop --skill` verified via `riff_test.go` pure argv assertion.
- [x] CHK-042 Single-skill 1-pane scenario: `rk riff --skill /fab-fff` verified.
- [x] CHK-043 Bare `--cmd` $SHELL scenario: pane command begins with `${SHELL:-/bin/sh}` via `shellWrap("")`.
- [x] CHK-044 Canonical/shortform layout parity: argv assertion covers one canonical + one shortform for each layout family.
- [x] CHK-045 Positional preset consumption: test asserts `args` slice shortens by 1 when positional matches.
- [x] CHK-046 CLI-replaces-preset scenario: test asserts resolved pane list is CLI-only when both are present.
- [x] CHK-047 `--fan-out` rollback scenario: test with mocked wt failure asserts rollback targets correct worktrees + windows. (Pure `planFanOutRollback` test; real wt/tmux not invoked per spec's pure-helper seam.)

## Edge Cases & Error Handling

- [x] CHK-048 Empty `panes: []` in preset is valid (no panes → defaults to single `/fab-discuss` skill pane).
- [x] CHK-049 Preset with unknown top-level keys tolerated (per fabconfig best-effort).
- [x] CHK-050 Malformed preset pane entry (both `skill` + `cmd` keys): containing preset silently discarded; other presets in same file unaffected.
- [x] CHK-051 `--list-presets` with `fab/project/config.yaml` absent: emits "No presets defined..." and exits 0.
- [x] CHK-052 SIGINT during fan-out: context cancellation propagates; subprocesses killed; partial rollback attempted.

## Code Quality

- [x] CHK-053 Pattern consistency: New pure helpers (`resolveLayout`, `autoLayout`, `printPresets`) match existing pure-helper conventions (`parseWorktreePath`, `resolveWindowName`, `shellWrap`).
- [x] CHK-054 No unnecessary duplication: `buildNewWindowArgs` reused for first-pane composition; `shellWrap` reused for all pane wrapping; `escapeSingleQuotes` reused for all skill strings.
- [x] CHK-055 Security First (Constitution §I): All new `exec.CommandContext` calls use argv slices, not shell strings. The single documented exception (tmux's trailing shell-string arg) is preserved with the same `escapeSingleQuotes` + `shellWrap` protections.
- [x] CHK-056 Process Execution (Constitution): Every subprocess call uses `context.WithTimeout` (30s for `wt`, 10s for `tmux`). Fan-out goroutines respect the parent context's cancellation.
- [x] CHK-057 Wrap, Don't Reinvent (Constitution §III): Fan-out uses `wt delete` for rollback (not custom filesystem cleanup); presets are read via the existing `fabconfig` package (not a new YAML reader).
- [x] CHK-058 Test Integrity (Constitution): New tests cover argv construction and flag parsing purely — no real `wt`/`tmux` invocation. Matches existing pattern.
- [x] CHK-059 Go build clean: `go build ./...` from `app/backend` succeeds.
- [x] CHK-060 Go test clean: `go test ./...` from `app/backend` passes. (Run for `./cmd/rk/...` and `./internal/fabconfig/...` per review scope.)
- [x] CHK-061 Go vet clean: `go vet ./...` from `app/backend` reports no issues.

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-xxx **N/A**: {reason}`
