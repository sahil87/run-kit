# Quality Checklist: rk riff — Workflow Features

**Change**: 260423-jmwu-rk-riff-workflow-features
**Generated**: 2026-04-23
**Spec**: `spec.md`

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
