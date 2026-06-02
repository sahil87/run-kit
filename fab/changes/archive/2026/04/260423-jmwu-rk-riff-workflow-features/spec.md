# Spec: rk riff — Workflow Features

**Change**: 260423-jmwu-rk-riff-workflow-features
**Created**: 2026-04-23
**Affected memory**: `docs/memory/run-kit/rk-riff.md`, `docs/memory/run-kit/tmux-sessions.md`

## Non-Goals

- **No fab-change bridge.** `rk riff` SHALL NOT shell out to `fab change new`, `fab resolve`, or any other `fab` subcommand in this change. Users continue to create or attach fab changes manually via `/fab-new`, `/fab-draft`, or `fab change switch` before or after running `rk riff`.
- **No `--setup-pane` alias.** The flag is removed outright. `--cmd` fully subsumes its use case.
- **No `--json` output for `--list-presets`.** Plain text only; revisit when a scripting consumer appears.
- **No rk-side worktree naming for `--fan-out`.** Worktree names come from `wt create`'s own generator. `rk riff` does not impose a `-1..-N` suffix scheme.
- **No per-pane skill variation under `--fan-out`.** All N fan-out windows share the same pane shape.

## run-kit: Pane Array Model

### Requirement: Repeatable `--skill` and `--cmd` flags
`rk riff` SHALL accept `--skill` and `--cmd` as repeatable flags. Each occurrence adds one pane to the spawned tmux window. Argv order (left to right) determines pane order (pane 0, 1, 2, …). Both flags MAY be interleaved arbitrarily.

#### Scenario: Interleaved repeatable flags produce ordered panes
- **GIVEN** the user runs `rk riff --cmd --skill "/fab-discuss" --cmd htop --skill`
- **WHEN** the command completes successfully
- **THEN** the new tmux window SHALL have exactly 4 panes
- **AND** pane 0 SHALL run a bare `$SHELL` (fallback `zsh`)
- **AND** pane 1 SHALL run Claude with skill `/fab-discuss` preloaded
- **AND** pane 2 SHALL run a shell executing `htop`
- **AND** pane 3 SHALL run a blank Claude session (no skill argument)

#### Scenario: Single `--skill` invocation produces a 1-pane window
- **GIVEN** the user runs `rk riff --skill /fab-fff`
- **WHEN** the command completes
- **THEN** the window SHALL have exactly 1 pane
- **AND** that pane SHALL run Claude with skill `/fab-fff`
- **AND** no tmux split SHALL be performed

### Requirement: Bare-flag semantics
`--skill` with no value SHALL launch a Claude session with no skill argument. `--cmd` with no value SHALL launch `$SHELL` (fallback `/bin/sh` when unset), giving the user a bare interactive shell in that pane.

#### Scenario: Bare `--cmd` spawns user's shell
- **GIVEN** the user runs `rk riff --cmd` with `$SHELL=/bin/zsh`
- **WHEN** the pane is created
- **THEN** the pane SHALL run `/bin/zsh` as its initial process
- **AND** the pane SHALL remain interactive after the initial process exits (via `shellWrap` suffix)

#### Scenario: Bare `--skill` spawns blank Claude
- **GIVEN** the user runs `rk riff --skill`
- **WHEN** the pane is created
- **THEN** the launcher SHALL be invoked with no positional argument (no single-quoted skill string appended)
- **AND** the pane SHALL run the resolved launcher (e.g., `claude --dangerously-skip-permissions`)

### Requirement: Space-form and equals-form value parsing
The flag parser SHALL accept three forms per occurrence: bare (`--cmd`), space-form (`--cmd htop`), and equals-form (`--cmd=htop`). The space-form SHALL consume the next argv token as the value only when that token does not itself begin with `-` (short or long flag marker).

#### Scenario: Space-form with value
- **GIVEN** argv is `--cmd htop --skill /foo`
- **WHEN** the parser processes `--cmd`
- **THEN** the next token `htop` SHALL be consumed as the `--cmd` value
- **AND** `--skill /foo` SHALL be parsed independently as a second pane spec

#### Scenario: Space-form with next-token-is-flag
- **GIVEN** argv is `--cmd --skill /foo`
- **WHEN** the parser processes `--cmd`
- **THEN** `--cmd` SHALL be interpreted as bare (no value)
- **AND** the next token `--skill /foo` SHALL be parsed as a separate pane spec

#### Scenario: Equals-form
- **GIVEN** argv is `--cmd=htop`
- **WHEN** the parser processes the token
- **THEN** the value `htop` SHALL be assigned to `--cmd`

### Requirement: Focus-pane selection
The first pane spec in argv (index 0) SHALL receive tmux focus when the window is shown. This rule applies regardless of whether the first spec is a `--skill` or a `--cmd`.

#### Scenario: Cmd-first focus
- **GIVEN** the user runs `rk riff --cmd "just logs" --skill /fab-fff`
- **WHEN** the window is created
- **THEN** the `just logs` pane SHALL be the active (focused) pane when tmux selects the window

### Requirement: `--setup-pane` removal
`rk riff` SHALL reject `--setup-pane` as an unknown flag. Users MUST migrate to `--cmd <cmd>`. No alias, no deprecation warning, no compatibility shim.

#### Scenario: `--setup-pane` rejected
- **GIVEN** the user runs `rk riff --setup-pane "just dev"`
- **WHEN** cobra parses the flags
- **THEN** the command SHALL fail with cobra's "unknown flag" error
- **AND** the exit code SHALL be 1 (generic cobra error, not precondition or subprocess)

## run-kit: Layout Flag

### Requirement: `--layout <name>` accepts 6 canonical values and 6 shortforms
`rk riff` SHALL accept a `--layout <name>` flag. Valid values are the six canonical names (`auto`, `tiled`, `even-horizontal`, `even-vertical`, `main-horizontal`, `main-vertical`) and their corresponding shortforms (`a`, `t`, `h`, `v`, `deck-h`, `deck-v`). Both canonical and shortform MUST resolve to the same underlying tmux layout. The default value when `--layout` is omitted SHALL be `auto`.

#### Scenario: Canonical name resolves
- **GIVEN** the user runs `rk riff --skill /a --cmd x --cmd y --layout main-vertical`
- **WHEN** the panes are laid out
- **THEN** tmux SHALL receive `select-layout main-vertical` as a final step after all panes are created

#### Scenario: Shortform resolves identically
- **GIVEN** the user runs `rk riff --skill /a --cmd x --cmd y --layout deck-v`
- **WHEN** the panes are laid out
- **THEN** tmux SHALL receive `select-layout main-vertical` (not `select-layout deck-v`) — the shortform is resolved to canonical before invoking tmux

#### Scenario: Unknown value rejected
- **GIVEN** the user runs `rk riff --layout diagonal`
- **WHEN** the flag is validated
- **THEN** the command SHALL fail before any subprocess invocation
- **AND** stderr SHALL list all 12 accepted names (6 canonical + 6 shortforms)
- **AND** the exit code SHALL be 1 (generic validation error)

### Requirement: `auto` layout dispatches by pane count
The `auto` value (the default) SHALL map to: 1 pane → no `select-layout` call; 2 panes → `even-horizontal`; 3 or more panes → `tiled`.

#### Scenario: Auto with 1 pane
- **GIVEN** the user runs `rk riff --skill /fab-fff` (no layout override)
- **WHEN** the window is created
- **THEN** tmux SHALL NOT receive any `select-layout` call
- **AND** the single pane SHALL fill the entire window

#### Scenario: Auto with 2 panes
- **GIVEN** the user runs `rk riff --skill /a --cmd "just dev"`
- **WHEN** the window is laid out
- **THEN** tmux SHALL receive `select-layout even-horizontal`

#### Scenario: Auto with 4 panes
- **GIVEN** the user runs `rk riff --cmd --skill /a --cmd htop --skill`
- **WHEN** the window is laid out
- **THEN** tmux SHALL receive `select-layout tiled`

<!-- clarified: explicit non-auto layout with 1 pane is a silent no-op (per intake Open Questions lean) -->
#### Scenario: Explicit `main-*` layout with 1 pane is a silent no-op
- **GIVEN** the user runs `rk riff --skill /fab-fff --layout main-horizontal`
- **WHEN** the window is laid out
- **THEN** tmux SHALL NOT receive any `select-layout` call (single-pane windows cannot be meaningfully re-laid out)
- **AND** the command SHALL exit with code 0
- **AND** no warning SHALL be printed (silent no-op matches tmux's own behavior)

### Requirement: Help output renders ASCII layout mockups inline
`rk riff -h` (and `rk riff --help`) SHALL render inline ASCII mockups for all 6 layout options (including `auto`) using Unicode box-drawing characters. The mocks SHALL appear in the flag description section for `--layout`.

#### Scenario: Help output contains mocks
- **GIVEN** the user runs `rk riff -h`
- **WHEN** the help text is rendered
- **THEN** stdout SHALL contain the canonical name and shortform for each of the 6 layouts (e.g., `t, tiled`, `h, even-horizontal`, `deck-v, main-vertical`)
- **AND** stdout SHALL contain Unicode box-drawing characters forming visual mockups of at least 5 layout shapes (auto may be described textually rather than as a mock)

## run-kit: Presets

### Requirement: Preset config lives under `riff.presets` at config root
`rk riff` SHALL read preset definitions from `fab/project/config.yaml` at the top-level path `riff.presets.<name>`. The parser MUST NOT look under `agent.riff.presets` or any nested location.

#### Scenario: Top-level location
- **GIVEN** `fab/project/config.yaml` contains `riff:\n    presets:\n        ship:\n            layout: h`
- **WHEN** `rk riff` reads preset config
- **THEN** a preset named `ship` SHALL be discovered with `layout: h`

#### Scenario: Nested location ignored
- **GIVEN** `fab/project/config.yaml` contains only `agent:\n    riff:\n        presets:\n            ship: {}`
- **WHEN** `rk riff` reads preset config
- **THEN** no preset SHALL be discovered (agent-nested presets are not recognized)

### Requirement: Preset schema is typed ordered list
A preset SHALL be a map with four optional keys: `layout` (string), `panes` (ordered list), `wt_args` (list of strings), and — for nested structure — no other keys. Each entry in `panes` SHALL have exactly one of two keys: `skill` (string; value may be empty string) or `cmd` (string; value may be empty string). Multiple keys in one entry, or other key names, SHALL cause the preset to be silently discarded (best-effort-never-errors per existing fabconfig posture).

#### Scenario: Valid preset parses
- **GIVEN** a preset block `ship: { layout: deck-h, panes: [ {skill: "/fab-fff"}, {cmd: "just dev"} ], wt_args: [] }`
- **WHEN** `ReadPresets` is called
- **THEN** the returned map SHALL contain key `ship`
- **AND** the `ship` preset SHALL have layout `deck-h`, 2 panes (skill then cmd), and empty `wt_args`

#### Scenario: Pane entry with both keys discarded
- **GIVEN** a preset with a pane entry `{skill: "/foo", cmd: "bar"}`
- **WHEN** `ReadPresets` is called
- **THEN** the containing preset SHALL be omitted from the returned map
<!-- clarified: align silent-failure posture with ReadSpawnCommand — no log emission to avoid stderr noise from repo-scan callers -->
- **AND** no error SHALL be returned
- **AND** no log output SHALL be emitted (matches existing `ReadSpawnCommand` best-effort-silent posture)

#### Scenario: Malformed YAML returns empty map
- **GIVEN** `fab/project/config.yaml` contains syntactically invalid YAML
- **WHEN** `ReadPresets` is called
- **THEN** the returned map SHALL be empty
- **AND** no error SHALL be returned
<!-- clarified: align with existing ReadSpawnCommand posture — silent on all failures, no log, per fabconfig.go lines 38-51 -->
- **AND** `ReadPresets` SHALL NOT emit any log output (matches existing `ReadSpawnCommand` best-effort-silent posture)

### Requirement: Positional and named preset invocation
`rk riff <preset-name>` (positional) and `rk riff --preset <preset-name>` (named alias) SHALL resolve to the same preset lookup. The positional form SHALL consume the first positional argument only if it matches a defined preset name. If the first positional does not match any preset, it SHALL NOT be consumed and SHALL fall through to cobra's normal argument handling.

#### Scenario: Positional preset consumed
- **GIVEN** `fab/project/config.yaml` defines a preset `ship`
- **WHEN** the user runs `rk riff ship`
- **THEN** the `ship` preset SHALL be applied
- **AND** the `ship` token SHALL NOT be treated as a positional value for other flags

#### Scenario: Named alias
- **GIVEN** `fab/project/config.yaml` defines a preset `ship`
- **WHEN** the user runs `rk riff --preset ship`
- **THEN** the `ship` preset SHALL be applied identically to the positional form

#### Scenario: Unknown preset name fails fast
- **GIVEN** `fab/project/config.yaml` defines no preset named `nope`
- **WHEN** the user runs `rk riff --preset nope`
- **THEN** the command SHALL fail before any subprocess invocation
- **AND** stderr SHALL list the defined preset names
- **AND** the exit code SHALL be 1

#### Scenario: Positional non-preset token left alone
- **GIVEN** `fab/project/config.yaml` defines no preset named `foo`
- **WHEN** the user runs `rk riff foo`
- **THEN** `foo` SHALL NOT be consumed as a preset
- **AND** cobra's normal positional-argument handling SHALL apply (in this command's case, passed through via `args []string`)

<!-- clarified: conflict between positional and --preset — reject fast rather than pick a winner, matches "fail fast on ambiguous input" posture established elsewhere in riff.go -->
#### Scenario: Both positional and `--preset` provided rejected
- **GIVEN** `fab/project/config.yaml` defines presets `ship` and `investigate`
- **WHEN** the user runs `rk riff ship --preset investigate`
- **THEN** the command SHALL fail before any subprocess invocation
- **AND** stderr SHALL indicate that positional preset and `--preset` flag are mutually exclusive
- **AND** the exit code SHALL be 1

### Requirement: CLI panes replace preset panes entirely
When a preset is invoked AND the CLI invocation also specifies at least one `--skill` or `--cmd` flag, the CLI's pane list SHALL replace the preset's `panes:` list entirely. No append, no per-slot merge.

#### Scenario: CLI override
- **GIVEN** preset `ship` defines 3 panes (`/fab-fff`, `just dev`, `just logs`)
- **WHEN** the user runs `rk riff ship --skill /review`
- **THEN** the resulting window SHALL have exactly 1 pane running Claude with skill `/review`
- **AND** none of the preset's 3 panes SHALL be present

#### Scenario: No CLI panes — preset panes used
- **GIVEN** preset `ship` defines 3 panes
- **WHEN** the user runs `rk riff ship` (no CLI pane flags)
- **THEN** the resulting window SHALL have the preset's 3 panes in declared order

### Requirement: Flag resolution order
<!-- clarified: intake references `agent.default_skill` as if it exists from change 2, but grep confirms neither `default_skill` nor `DefaultSkill` appears anywhere under app/backend/. Intake wording was aspirational. Drop the reference; the resolution chain is (1) CLI, (2) preset, (3) built-in default ("/fab-discuss" for a bare `rk riff` invocation, per existing riff.go behavior). -->
Effective values for `layout` and `wt_args` SHALL resolve in this order: (1) explicit CLI flag, (2) preset value, (3) built-in default. When no `--skill`, `--cmd`, or preset panes are specified at all, `rk riff` SHALL behave as today: a single-pane window running the resolved launcher with the existing default skill (`/fab-discuss`). No `agent.default_skill` config key is added in this change.

#### Scenario: Explicit `--layout` overrides preset
- **GIVEN** preset `ship` defines `layout: deck-h`
- **WHEN** the user runs `rk riff ship --layout v`
- **THEN** the resolved layout SHALL be `even-vertical` (from the shortform on the CLI)

#### Scenario: Preset `wt_args` prepended to passthrough
- **GIVEN** preset `investigate` defines `wt_args: ["--base", "main"]`
- **WHEN** the user runs `rk riff investigate -- --reuse`
- **THEN** `wt create` SHALL be invoked with `--non-interactive --worktree-open skip --base main --reuse`
- **AND** the preset's `wt_args` SHALL appear before the user's passthrough args

### Requirement: `--list-presets` emits plain text and exits 0
`rk riff --list-presets` SHALL print the resolved preset names and their values in human-readable plain text, then exit with code 0. It MUST NOT perform worktree creation, tmux calls, or any other side effect.

#### Scenario: Listing with presets defined
- **GIVEN** `fab/project/config.yaml` defines presets `ship` and `investigate`
- **WHEN** the user runs `rk riff --list-presets`
- **THEN** stdout SHALL contain the names `ship` and `investigate`
- **AND** stdout SHALL contain each preset's `layout`, `panes`, and `wt_args` values
- **AND** no `wt create` or `tmux` subprocess SHALL be invoked
- **AND** the exit code SHALL be 0
<!-- clarified: output format from intake Open Question — indented YAML-like plain text matches human-readable goal without committing to a table library -->
- **AND** the output format SHALL be indented plain text with one preset per block: a header line `<name>:`, followed by indented `layout:`, `panes:` (one pane per sub-line as `- skill: <value>` or `- cmd: <value>`), and `wt_args:` lines; presets SHALL appear in the order they are defined in the YAML file

#### Scenario: Listing with no presets defined
- **GIVEN** `fab/project/config.yaml` has no `riff.presets` block
- **WHEN** the user runs `rk riff --list-presets`
- **THEN** stdout SHALL contain a message indicating no presets are defined (e.g., `No presets defined in fab/project/config.yaml`)
- **AND** the exit code SHALL be 0

## run-kit: Fan-Out

### Requirement: `--fan-out N` spawns N windows sharing one pane shape
`rk riff --fan-out N` (where N is a positive integer ≥ 2) SHALL spawn N independent worktree/window pairs. Each window SHALL have the same pane shape — derived from the CLI flags or the preset, whichever applies — with identical `--skill`, `--cmd`, and `--layout` values duplicated across all N windows.

#### Scenario: Fan-out duplicates the full pane shape
- **GIVEN** the user runs `rk riff --fan-out 3 --skill /fab-fff --cmd "just dev" --layout deck-h`
- **WHEN** all N worktrees are created
- **THEN** 3 tmux windows SHALL exist
- **AND** each window SHALL have 2 panes (claude `/fab-fff` and `just dev`)
- **AND** each window SHALL be laid out as `main-horizontal` (canonical of `deck-h`)

#### Scenario: Fan-out with preset
- **GIVEN** preset `compare` defines `panes: [ {skill: "/fab-fff"}, {skill: "/review"} ]`
- **WHEN** the user runs `rk riff compare --fan-out 2`
- **THEN** 2 windows SHALL be spawned, each with the 2-skill compare layout
- **AND** the total number of Claude sessions SHALL be 4 (2 per window × 2 windows)

#### Scenario: `--fan-out 1` behaves identically to single riff
- **GIVEN** the user runs `rk riff --fan-out 1 --skill /fab-fff`
- **WHEN** the command completes
- **THEN** exactly 1 worktree + 1 window SHALL be created
- **AND** the behavior SHALL be equivalent to omitting `--fan-out`

#### Scenario: `--fan-out 0` or negative rejected
- **GIVEN** the user runs `rk riff --fan-out 0` or `rk riff --fan-out -2`
- **WHEN** the flag is validated
- **THEN** the command SHALL fail before any subprocess invocation
- **AND** stderr SHALL indicate that `--fan-out` requires a positive integer
- **AND** the exit code SHALL be 1

### Requirement: Worktree naming delegates to `wt create`
For each of the N fan-out invocations, `wt create` SHALL be called without a rk-supplied `--worktree-name` (unless the user passed one via `--` passthrough). Each worktree receives `wt`'s own random adjective-noun name. rk SHALL NOT impose a `-1..-N` suffix scheme on top.

#### Scenario: Independent wt names
- **GIVEN** `rk riff --fan-out 3 --skill /a`
- **WHEN** the 3 `wt create` invocations succeed
- **THEN** each worktree SHALL have a distinct name assigned by `wt` (e.g., `swift-fox`, `clever-crab`, `brave-bear`)
- **AND** no two worktree paths SHALL be identical

### Requirement: tmux windows named `riff-<wt-name>`
Each tmux window in a fan-out SHALL be named `riff-<wt-name>` where `<wt-name>` is the basename of the worktree path returned by `wt create`. Window-name collision handling (auto-suffix `-2`, `-3`, …) continues to apply per the existing `resolveWindowName` helper.

#### Scenario: Window naming from wt output
- **GIVEN** `wt create` returns a worktree path `/home/user/project.worktrees/swift-fox`
- **WHEN** the tmux window is created
- **THEN** the window's `-n` value SHALL be `riff-swift-fox`
- **AND** on collision with an existing `riff-swift-fox`, the resolved name SHALL be `riff-swift-fox-2` (etc.)

### Requirement: Parallel worktree creation with rollback
Fan-out SHALL invoke the N `wt create` calls concurrently (goroutines or equivalent). If any `wt create` fails, the successful worktrees and their associated tmux windows SHALL be cleaned up before the command returns an error. Partial success is not permitted at command-exit time.

#### Scenario: All succeed
- **GIVEN** all N `wt create` calls succeed
- **WHEN** the fan-out completes
- **THEN** N worktrees and N windows SHALL exist
- **AND** the command SHALL exit with code 0

#### Scenario: One fails — others rolled back
- **GIVEN** N = 3, the second `wt create` returns a non-zero exit
- **WHEN** the fan-out orchestrator observes the failure
- **THEN** the already-successful worktrees SHALL be removed (via `wt delete` or filesystem cleanup matching the existing wt rollback pattern)
- **AND** the tmux windows that were opened SHALL be killed (via `tmux kill-window`)
- **AND** the command SHALL exit with code 3 (subprocess failure) and stderr SHALL surface the first error

#### Scenario: User interrupt during fan-out
- **GIVEN** fan-out is in progress (goroutines running)
- **WHEN** the user sends SIGINT (Ctrl-C)
- **THEN** the parent context SHALL be cancelled (existing `signal.NotifyContext` path)
- **AND** in-flight `wt`/`tmux` subprocesses SHALL be killed via `exec.CommandContext`
- **AND** any fully-created worktrees/windows from this fan-out SHALL be rolled back

## run-kit: Help Output

### Requirement: Updated Use line
`riffCmd.Use` SHALL document the new flag surface: repeatable `--skill`/`--cmd`, optional `--layout`, `--fan-out`, `--list-presets`, and `--preset`. The `--` passthrough marker SHALL be retained.

#### Scenario: Use line reflects new surface
- **GIVEN** the user runs `rk riff -h`
- **WHEN** the Usage line is rendered
- **THEN** it SHALL include `[--skill <skill>...]`, `[--cmd <cmd>...]`, `[--layout <name>]`, `[--fan-out <N>]`, and `[-- <wt-flags>...]`

### Requirement: Examples section updated
The `Long` help SHALL include at least 5 examples covering: (1) default single-pane invocation, (2) multi-pane with interleaved `--skill`/`--cmd`, (3) explicit layout, (4) preset invocation (positional), (5) fan-out with preset.

#### Scenario: Examples present
- **GIVEN** the user runs `rk riff -h`
- **WHEN** the Examples section is rendered
- **THEN** the output SHALL include invocations demonstrating each of the five patterns above

## Deprecated Requirements

### Requirement: `--setup-pane` flag

**Reason**: Removed. The pane-array model (`--cmd`) fully subsumes the single-split use case and generalizes it to N panes.

**Migration**: Replace `--setup-pane "<cmd>"` with `--cmd "<cmd>"`. Behavior is identical for the single-split case (the second pane runs the command). Bare `--setup-pane` (no value) had no equivalent (the flag was required to be non-empty to take effect) — no migration needed.

### Requirement: Singular `--skill` semantics

**Reason**: Changed — not removed. `--skill` is now repeatable. Existing single-use invocations (`rk riff --skill /foo`) continue to work and produce a 1-pane window identical to the legacy behavior.

**Migration**: None required for single-skill users. Users wanting multiple Claude panes adopt repeated `--skill` invocations.

## Design Decisions

1. **Custom `pflag.Value` type for `--skill`/`--cmd` parsing**
   - *Why*: Supporting all three forms (bare, space, equals) with repeated occurrences requires more than pflag's built-in `NoOptDefVal` pattern — specifically, pflag's `NoOptDefVal` does not consume the next argv token for space-form. A ~30-50 line custom `Value` implementation handles the lookahead: if the next token starts with `-` or is absent, bare; otherwise consume.
   - *Rejected*: Requiring `=` syntax only (`--cmd=htop`). Forces users to adopt an awkward form that doesn't match common CLI expectations; hurts the core UX proposition of the pane-array flag.
   - *Rejected*: Two separate flags (`--cmd`/`--cmd-empty`). Clutters the surface for a small implementation win.

2. **Preset panes: typed ordered list, not flat key lists**
   - *Why*: A pane's type (skill vs cmd) is a first-class attribute; the typed entry `{skill: "..."}` or `{cmd: "..."}` preserves both type and order in one structure. Flat sibling lists (`skills: [...]`, `cmds: [...]`) would destroy the cross-type ordering that CLI argv naturally preserves.
   - *Rejected*: Flat typed lists. Would require a separate ordering mechanism or implicit "skills first then cmds" rule; both are worse.

3. **Layout shortform map accepts `deck-h`/`deck-v` alongside `main-*`**
   - *Why*: tmux's `main-horizontal` puts the main pane on top (a horizontal split line below it), which is counterintuitive. The `deck-*` shortforms use a clearer metaphor (main card on top / left, deck stacked below / right). Both names round-trip identically.
   - *Rejected*: Renaming `main-*` to `deck-*` and dropping the tmux-canonical names. Would create a private vocabulary incompatible with anyone copying a layout from tmux documentation.

4. **CLI panes replace preset panes entirely**
   - *Why*: Matches the existing "CLI flag wins over preset value" resolution rule for scalar fields. Append semantics would produce surprising pane counts ("I said `rk riff ship --cmd htop` — why do I have 4 panes?").
   - *Rejected*: Append. Surprising and inconsistent with scalar-flag precedence.

5. **Fan-out window naming derives from wt output, not a rk-side numbering scheme**
   - *Why*: Keeps rk out of the naming business; `wt` already provides unique, human-memorable names (`swift-fox`, `clever-crab`). A rk-side `-1..-N` scheme would fight against user-supplied `--worktree-name` values and would duplicate `wt`'s uniqueness guarantees.
   - *Rejected*: rk-side `-1..-N` suffix scheme. Loses uniqueness guarantees the moment a user re-fans-out with the same preset name.

6. **`--setup-pane` hard-removed, not aliased**
   - *Why*: Change 2 (the most recent predecessor) just finished renaming `--cmd` → `--skill` and `--split` → `--setup-pane` with no alias; this change continues that "hard rename, no compat shim" posture. Aliasing `--setup-pane` to `--cmd` would be redundant (the user has already adopted `--setup-pane`; they'll adopt `--cmd` with the same urgency).
   - *Rejected*: Hidden alias during a deprecation window. Adds surface area to maintain; users inspect `rk riff -h` and see a flag; removing it later is a second breaking change instead of one.

7. **Layout help mocks rendered inline in `-h`, not on a dedicated sub-flag**
   - *Why*: Layouts are inherently visual — the help is most useful at the moment the user is already looking for the flag. Inline mocks fit naturally into cobra's flag-description slot (Cobra supports multi-line flag descriptions).
   - *Rejected*: Dedicated `--help-layouts`. Extra flag to discover; help pages are where users look by default.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope: pane arrays + layouts + presets + fan-out in one change; no fab-change bridge | Confirmed from intake #1, #2; cross-checked against all 22 intake assumptions and 14 Clarifications-log entries | S:95 R:65 A:85 D:90 |
| 2 | Certain | `--setup-pane` removed entirely; `--cmd` subsumes | Confirmed from intake #3; matches change-2 "hard rename" posture | S:95 R:55 A:85 D:90 |
| 3 | Certain | `--skill` / `--cmd` repeatable; argv order = pane order; bare form allowed for both | Confirmed from intake #4, #5; user specified syntax with a concrete example | S:95 R:60 A:85 D:90 |
| 4 | Certain | First pane in argv (regardless of type) gets focus | Confirmed from intake #6 | S:95 R:80 A:85 D:85 |
| 5 | Certain | Layout accepts 6 canonical + 6 shortforms; default `auto`; unknown rejected with valid-list | Confirmed from intake #14 | S:95 R:75 A:90 D:85 |
| 6 | Certain | `auto` layout mapping: 1 → none, 2 → even-horizontal, 3+ → tiled | Confirmed from intake #15 | S:95 R:85 A:85 D:80 |
| 7 | Certain | Preset location: top-level `riff.presets.<name>` | Confirmed from intake #10 | S:95 R:75 A:80 D:80 |
| 8 | Certain | Preset invocation: positional + `--preset <name>` alias | Confirmed from intake #11 | S:95 R:75 A:80 D:80 |
| 9 | Certain | Preset schema: typed ordered `panes:` list with `{skill|cmd: ...}` entries; optional `layout`, `wt_args` | Confirmed from intake #12 | S:95 R:70 A:80 D:85 |
| 10 | Certain | CLI panes replace preset panes entirely (not append) | Confirmed from intake #13 | S:95 R:70 A:80 D:85 |
| 11 | Certain | `--list-presets` emits plain text; exits 0 without side effects | Confirmed from intake #9 | S:95 R:85 A:75 D:65 |
| 12 | Certain | Fan-out = N separate windows, each with full pane shape | Confirmed from intake #17 | S:95 R:65 A:80 D:80 |
| 13 | Certain | Fan-out worktree naming delegates to `wt create` | Confirmed from intake #7 | S:95 R:60 A:70 D:60 |
| 14 | Certain | tmux windows named `riff-<wt-name>` | Confirmed from intake #8 | S:95 R:75 A:80 D:75 |
| 15 | Certain | Inline layout ASCII mocks in `rk riff -h` | Confirmed from intake #16; Cobra supports multi-line flag descriptions via UsageFunc | S:95 R:85 A:80 D:80 |
| 16 | Confident | Custom `pflag.Value` type (~30-50 lines) supports space-form with optional values | Upgraded from intake #21 after implementation analysis: pflag's `NoOptDefVal` alone does not consume space-form; custom Value is the minimal path | S:80 R:80 A:85 D:75 |
| 17 | Certain | Flag resolution order: explicit > preset > config default > built-in | Explicit in intake #18; matches the same precedence rule already established for `--skill` and `--setup-pane` resolution in change 2 | S:90 R:75 A:80 D:80 |
| 18 | Confident | Extract `spawnRiff(ctx, opts) error` helper so fan-out calls it N times | Avoids duplicating the full spawn sequence; clean test seam; intake #19 | S:80 R:85 A:85 D:85 |
| 19 | Confident | Fan-out uses parallel goroutines; rollback on partial failure | 30s × N serial is too slow; goroutine + errgroup is the obvious stdlib pattern; intake #20 | S:75 R:75 A:80 D:75 |
| 20 | Certain | No new positional args besides the preset name | Follows from the scope decision to keep `rk riff`'s positional surface small and reserve it for future uses; intake #22 | S:90 R:70 A:75 D:80 |
| 21 | Confident | Rollback on fan-out failure: `wt delete` for worktrees, `tmux kill-window` for windows, best-effort | Matches existing wt rollback patterns; individual rollback failures logged but do not mask the primary error | S:70 R:70 A:75 D:70 |
| 22 | Certain | `--fan-out 1` is valid and behaves identically to omitting `--fan-out`; `--fan-out 0` / negative rejected | Identity-for-1 is the standard "no special-case" principle; rejection of 0/negative is the standard positive-integer convention for count flags | S:90 R:85 A:85 D:80 |
| 23 | Confident | Preset name resolution for positional arg: exact match required, no fuzzy/prefix matching | Keeps CLI predictable; fuzzy matching can be added later via `--preset` flag and explicit resolver | S:75 R:85 A:80 D:80 |

23 assumptions (18 certain, 5 confident, 0 tentative, 0 unresolved).
