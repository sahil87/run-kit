# Spec: rk riff — CLI Surface Refinement

**Change**: 260423-udhe-rk-riff-cli-surface
**Created**: 2026-04-23
**Affected memory**: `docs/memory/run-kit/rk-riff.md`

## Non-Goals

- Changing the `--skill` effective default from `/fab-discuss` — deferred to change 3 (presets) which has a better home for per-project default-skill configuration.
- Switching the `/fab-discuss` delivery mechanism from positional argv to `tmux send-keys` — Bug 2 was verified on 2026-04-23 as a phantom (positional argv dispatches slash-commands correctly). No code change.
- Keeping `--cmd` and `--split` as deprecated aliases — the change hard-renames. See Design Decision 1.
- Introducing any `internal/fabconfig` functions beyond what change 1 shipped — no `ReadDefaultSkill`, no new config keys.
- Altering any of the behaviors change 1 just introduced (`shellWrap`, interactive-launcher wrap, `resolveWindowName`, SIGINT propagation, window-name collision resolution) — this change preserves them unchanged.

## CLI: Flag Surface

### Requirement: Flag `--skill` SHALL replace `--cmd`

`rk riff` SHALL accept a `--skill <value>` flag that specifies the Claude Code skill or slash-command launched in the new tmux window. The flag default SHALL be the literal string `/fab-discuss`. The flag SHALL NOT accept `--cmd` — invocations using `--cmd` MUST fail with cobra's standard "unknown flag: --cmd" error (exit code 1).

#### Scenario: `--skill` accepted with explicit value
- **GIVEN** a user runs `rk riff --skill /review`
- **WHEN** the command parses flags
- **THEN** the internal skill value is `/review`
- **AND** the tmux new-window composed shell string ends in `claude …dangerously-skip-permissions '/review'` (per the change-1 `buildNewWindowArgs` three-layer composition)

#### Scenario: `--skill` absent — default applies
- **GIVEN** a user runs `rk riff` with no flags before `--`
- **WHEN** the command parses flags
- **THEN** the internal skill value is `/fab-discuss`
- **AND** the window is created with `/fab-discuss` as the positional argv to the launcher

#### Scenario: `--cmd` rejected
- **GIVEN** a user runs `rk riff --cmd /review` (the pre-change flag name)
- **WHEN** cobra parses flags
- **THEN** the command exits with cobra's "unknown flag: --cmd" error
- **AND** no worktree is created, no tmux window is opened

### Requirement: Flag `--setup-pane` SHALL replace `--split`

`rk riff` SHALL accept a `--setup-pane <cmd>` flag that, when non-empty, splits the new tmux window horizontally and runs `<cmd>` in the right pane. The flag default SHALL be the empty string. `--setup-pane ""` SHALL be treated identically to the flag being unset (no split). The flag SHALL NOT accept `--split` — invocations using `--split` MUST fail with cobra's "unknown flag" error.

#### Scenario: `--setup-pane` with non-empty value creates the split
- **GIVEN** a user runs `rk riff --setup-pane "just dev"`
- **WHEN** the command completes precondition and wt-create steps
- **THEN** after `tmux new-window`, a `tmux split-window -h -c <worktree-path>` is run with the shell string produced by `shellWrap("just dev")`

#### Scenario: `--setup-pane` absent — no split
- **GIVEN** a user runs `rk riff` with no `--setup-pane` flag
- **WHEN** the command completes the new-window step
- **THEN** `tmux split-window` is NOT called

#### Scenario: `--setup-pane ""` — treated as unset
- **GIVEN** a user runs `rk riff --setup-pane ""`
- **WHEN** the command processes the flag
- **THEN** `tmux split-window` is NOT called (same as the unset case)

#### Scenario: `--split` rejected
- **GIVEN** a user runs `rk riff --split "just dev"` (the pre-change flag name)
- **WHEN** cobra parses flags
- **THEN** the command exits with cobra's "unknown flag: --split" error

### Requirement: Internal variable names SHALL track the flag rename

The Go package-level variables holding flag values SHALL be renamed in lockstep with the flag names: `riffCmdFlag` → `riffSkillFlag`, `riffSplitFlag` → `riffSetupPaneFlag`. All call sites in `riff.go` and `riff_test.go` SHALL use the new names.

#### Scenario: grep for old variable names finds zero references
- **GIVEN** the change is applied
- **WHEN** `grep -r "riffCmdFlag\|riffSplitFlag" app/backend/cmd/rk/` is run
- **THEN** it returns no matches

## CLI: Help Text

### Requirement: `Use` synopsis SHALL list primary flags

The cobra `Use:` field of `riffCmd` SHALL read `riff [--skill <name>] [--setup-pane <cmd>] [-- <wt-flags>...]` (or an equivalent that names both primary flags and the passthrough separator). The pre-change form `riff [-- wt-flags...]` hides the primary flags from `rk riff --help`'s synopsis line — the new form surfaces them.

#### Scenario: `--help` synopsis surfaces both primary flags
- **GIVEN** a user runs `rk riff --help`
- **WHEN** the output is printed
- **THEN** the Usage line names both `--skill` and `--setup-pane`

### Requirement: `Long` help SHALL match the serve.go house style

The cobra `Long:` field of `riffCmd` SHALL be expanded to include:

1. A one-sentence summary (what the command does).
2. A `Prerequisites:` block listing the three preconditions: `$TMUX` set, `wt` on PATH, launcher binary installed.
3. A paragraph explaining the `--` separator and passthrough to `wt create`, pointing to `wt create --help` for discoverability.
4. A `Launcher resolution:` block explaining the `fab/project/config.yaml` → hardcoded-default fallback chain.
5. An `Examples:` block with at least four representative invocations.
6. An `Exit codes:` block listing 0/2/3.

The text SHALL follow `serve.go:25-34`'s stylistic conventions (plain prose blocks separated by blank lines, each named block introduced by a capitalized label followed by a colon).

#### Scenario: `--help` shows Prerequisites
- **GIVEN** a user runs `rk riff --help`
- **WHEN** the output is printed
- **THEN** a `Prerequisites:` block appears with the three preconditions listed as bullets (or dash-prefixed lines)

#### Scenario: `--help` shows Launcher resolution
- **GIVEN** a user runs `rk riff --help`
- **WHEN** the output is printed
- **THEN** a `Launcher resolution:` block names `fab/project/config.yaml`, `agent.spawn_command`, and the `claude --dangerously-skip-permissions` fallback

#### Scenario: `--help` shows Examples
- **GIVEN** a user runs `rk riff --help`
- **WHEN** the output is printed
- **THEN** an `Examples:` block appears with at least four example invocations covering: bare default, `--skill <custom>`, `--setup-pane <cmd>`, and wt passthrough (`-- --worktree-name <name>` or similar)

#### Scenario: `--help` shows Exit codes
- **GIVEN** a user runs `rk riff --help`
- **WHEN** the output is printed
- **THEN** an `Exit codes:` block names 0 (success), 2 (precondition failure), and 3 (subprocess failure)

## Tests

### Requirement: Tests SHALL track the rename

`app/backend/cmd/rk/riff_test.go` SHALL reference only `riffSkillFlag` and `riffSetupPaneFlag` — never `riffCmdFlag` or `riffSplitFlag`. Existing test cases that construct inputs around these flags SHALL be updated in place; no new test cases are required for the rename itself.

#### Scenario: Tests pass after the rename
- **GIVEN** the change is applied
- **WHEN** `go test ./app/backend/cmd/rk/...` is run
- **THEN** all tests pass

### Requirement: Tests for pure helpers SHALL be preserved

The change SHALL NOT touch `TestBuildNewWindowArgs`, `TestShellWrap`, or `TestResolveWindowName` logic beyond mechanical substitution of the flag-name identifiers. The helper signatures and behaviors remain as they are after change 1.

#### Scenario: `TestBuildNewWindowArgs` unchanged signature
- **GIVEN** the change is applied
- **WHEN** the test file is inspected
- **THEN** the test still calls `buildNewWindowArgs(worktreePath, resolvedName, launcher, cmdArg)` with the existing four-argument shape

## Deprecated Requirements

### Flag `--cmd`
**Reason**: Ambiguous name — users can't tell if it's a shell command, a claude command, or REPL input text. Replaced with `--skill`, which matches the Claude Code terminology and the default value's nature.
**Migration**: Replace `--cmd <value>` with `--skill <value>` in all scripts, aliases, and docs. No deprecation alias — the rename is hard.

### Flag `--split`
**Reason**: Reads as a boolean flag, but its value is a shell command to run in a right-hand pane after splitting the window. Replaced with `--setup-pane`, which encodes both the pane semantics and the command-not-boolean shape.
**Migration**: Replace `--split <cmd>` with `--setup-pane <cmd>` in all scripts, aliases, and docs. No deprecation alias.

## Design Decisions

1. **Hard-rename over deprecated aliases**: Both `--cmd` and `--split` are removed outright; invocations using the old names fail with cobra's "unknown flag" error.
   - *Why*: rk is early (v1.4.0) with no external muscle memory to protect. The constitution's §IV Minimal Surface Area discourages compat shims. The whole rationale for bundling DX 2/3/4 into one PR is "break the surface once" — deprecated aliases leak a second break into a later change and undo the bundling logic. If post-merge pain is observed, re-adding aliases as a patch is a 5-minute follow-up.
   - *Rejected*: Keep `--cmd`/`--split` as hidden `pflag.Flag.Deprecated` aliases for one release. Costs: adds "two names for the same thing" surface to memory/docs; introduces a required follow-up deprecation-sweep change; carries forward the ambiguity the rename was meant to kill.

2. **`--skill` default stays hardcoded `/fab-discuss` (DX 1 deferred)**: This change does NOT add `agent.default_skill` to `fab/project/config.yaml`, does NOT add a `ReadDefaultSkill` function to `internal/fabconfig`, and does NOT flip the default to empty for non-fab repos.
   - *Why*: Change 3 (presets) is the better home for per-project default-skill configuration — it can build a single config surface for multiple riff defaults rather than carving out one narrow `default_skill` key here. Keeping the hardcoded `/fab-discuss` preserves the current behavior for fab users and defers the onboarding-landmine fix to a change that can solve it holistically.
   - *Rejected*: Option (b) — context-aware default that flips to empty when `fab/project/config.yaml` is absent. Costs: `--help` cannot honestly show a single default (it varies by cwd); introduces implicit behavior that depends on repo state.
   - *Rejected*: Option (c) — add `agent.default_skill` config key + `ReadDefaultSkill` function. Costs: competes with the presets mechanism that change 3 will introduce; requires a later migration to consolidate.

3. **Bug 2 closure is documentation-only**: The Changelog entry in `docs/memory/run-kit/rk-riff.md` SHALL note Bug 2 was verified-as-phantom on 2026-04-23 (positional argv dispatches slash-commands correctly via `claude`'s `[prompt]` positional arg). No code change, no new test.
   - *Why*: The current `buildNewWindowArgs` composition (`<launcher> '<escaped-cmd>'`) is correct. Documenting the verification prevents a future reader from re-opening the "switch to tmux send-keys" investigation.
   - *Rejected*: Switch delivery to `tmux new-window` bare + `tmux send-keys` with an 800ms fixed readiness delay. Costs: adds complexity and a readiness heuristic to solve a non-problem.

## Assumptions

<!-- Spec-stage Assumptions: all intake assumptions are Certain after 2026-04-23 clarification.
     Spec generation introduces no new ambiguities — scope is tight and every decision has
     a concrete artifact (code change, help-text block, Changelog entry). -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope bundles DX 2/3/4 (help text + flag renames); Bug 2 is documentation-only; DX 1 is deferred to change 3 | Confirmed from intake #1 and #7 after 2026-04-23 clarification | S:95 R:70 A:85 D:90 |
| 2 | Certain | Change 1 (`260423-ba9f`) has landed on main as `f792890`; `shellWrap`, `resolveWindowName`, and the interactive-launcher wrap are present and untouched | Confirmed from intake #2; verified post-rebase on 2026-04-23 | S:95 R:80 A:90 D:95 |
| 3 | Certain | `--cmd` is renamed to `--skill` (hard-rename, no alias) | Confirmed from intake #3 via bulk confirm 2026-04-23 | S:95 R:65 A:75 D:70 |
| 4 | Certain | `--split` is renamed to `--setup-pane` (hard-rename, no alias) | Confirmed from intake #4 via bulk confirm 2026-04-23 | S:95 R:65 A:75 D:70 |
| 5 | Certain | `Long` help text is expanded to match `serve.go:25-34` house style with Prerequisites, Launcher resolution, Examples, and Exit codes blocks | Confirmed from intake #5 via bulk confirm 2026-04-23 | S:95 R:95 A:85 D:90 |
| 6 | Certain | `Use:` synopsis is expanded to list `--skill`, `--setup-pane`, and the `--` passthrough | Confirmed from intake #6 via bulk confirm 2026-04-23 | S:95 R:95 A:85 D:90 |
| 7 | Certain | `--skill` effective default is hardcoded `/fab-discuss`; no config resolution layer, no `ReadDefaultSkill`, no `agent.default_skill` key | Confirmed from intake #7 and #10 after 2026-04-23 clarification (option a selected) | S:95 R:70 A:80 D:70 |
| 8 | Certain | Bug 2 requires no code change; Changelog entry in memory notes the phantom verification | Confirmed from intake #8 and #11 after live smoke test 2026-04-23 (outcome A) | S:95 R:50 A:60 D:50 |
| 9 | Certain | No deprecated aliases; `--cmd` and `--split` are removed outright | Confirmed from intake #9 after 2026-04-23 clarification (option a selected) | S:95 R:60 A:55 D:55 |
| 10 | Certain | Internal Go variable names `riffCmdFlag`/`riffSplitFlag` are renamed to `riffSkillFlag`/`riffSetupPaneFlag` in lockstep with the flag names | New spec-stage decision — follows from #3, #4 for naming consistency and grep-cleanliness | S:90 R:75 A:85 D:85 |
| 11 | Certain | `--setup-pane ""` (empty string) continues to be treated identically to the flag being unset (no split) — preserving the change-1 behavior | Spec-stage verification — matches `runRiff` guard `if riffSplitFlag != ""` at `riff.go:140` | S:95 R:75 A:90 D:95 |
| 12 | Certain | Tests are updated in-place for the rename; no new test cases are added for the rename itself, and the three pure-helper tests (`TestBuildNewWindowArgs`, `TestShellWrap`, `TestResolveWindowName`) remain on their change-1 signatures | Follows from #3, #4, #10 — mechanical substitution only | S:95 R:80 A:90 D:90 |

12 assumptions (12 certain, 0 confident, 0 tentative, 0 unresolved).
