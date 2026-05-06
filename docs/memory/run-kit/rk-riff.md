# `rk riff`

`rk riff` is the Cobra subcommand that creates a git worktree, opens a new tmux window inside it, and launches one or more Claude Code sessions (or arbitrary shell panes) in a multi-pane layout. It generalizes the earlier single-skill riff model to an argv-ordered pane array with presets, named layouts, and parallel fan-out across N worktrees.

Implementation: `app/backend/cmd/rk/riff.go` (registered in `root.go` via `rootCmd.AddCommand(riffCmd)`). Supporting files: `pane_spec.go` (pflag.Value implementation), `layout.go` (layout alias table), `layout_help.go` (ASCII mocks), `../../internal/fabconfig/fabconfig.go` (`ReadPresets`).

## Purpose

Spin up an isolated AI development workspace in one shot, with multi-pane composition, named presets, and fan-out across siblings:

1. Read preset config (if a preset is invoked by positional or `--preset`).
2. Resolve the effective pane array, layout, fan-out, and `wt create` passthrough.
3. Create N worktrees via `wt create` (parallel when fan-out ≥ 2).
4. Open a tmux window per worktree rooted at its path.
5. For each pane spec in argv order, run `tmux new-window` (pane 0) then `tmux split-window` (panes 1..N-1).
6. Apply `tmux select-layout` when the layout is not empty.
7. Focus the first pane by capturing its pane id from `tmux new-window -P -F '#{pane_id}'` and running `tmux select-pane -t <pane-id>` (canonical tmux primitive — works on any `pane-base-index`).

## Invocation

```
rk riff [preset] [--skill <skill>...] [--cmd <cmd>...] [--layout <name>]
        [--count <N>] [--preset <name>] [--list-presets] [-- <wt-flags>...]
```

## Flag Surface

| Flag | Type | Default | Purpose |
|------|------|---------|---------|
| `--skill` | repeatable (custom `pflag.Value`) | — | Add one skill/slash-command pane. Bare form (no value) launches a blank Claude session. Argv order = pane order. |
| `--cmd` | repeatable (custom `pflag.Value`) | — | Add one shell-command pane. Bare form drops into `$SHELL` (fallback `/bin/sh`). Argv order = pane order. |
| `--layout` | string | `auto` | Canonical or shortform layout name (12 accepted: 6 canonical + 6 shortforms). See Layout Flag below. |
| `--count` / `-N` | int | `1` | Spawn N worktree/window pairs in parallel. N ≥ 1; invalid values (0, negative) error out pre-subprocess. Short form `-N` (uppercase). |
| `--preset` | string | `""` | Invoke a named preset from `fab/project/config.yaml`. Mutually exclusive with the positional form. |
| `--list-presets` | bool | `false` | Print defined presets in plain text and exit 0. Short-circuits all subprocesses. |
| `--` | separator | — | Everything after `--` forwards verbatim to `wt create`. Preset `wt_args` (if any) are prepended before the user's passthrough. |

Cobra's `SetInterspersed(true)` (pflag default) lets flags appear before or after the positional preset token (so `rk riff ship --count 3` works). The `--` separator still terminates parsing so the `wt create` passthrough mechanism is preserved. The command also sets `DisableFlagParsing: true` because pflag's `NoOptDefVal` pattern does not consume a space-form value — the custom pre-processor `rewritePaneSpaceForm` in `pane_spec.go` translates `--skill V` to `--skill=V` before the manual `Flags().Parse` call, so the final parsed state is identical to equals-form.

Package-level variables: `riffPaneSpecs []PaneSpec` (shared accumulator for both pane flags, preserving argv order), `riffLayoutFlag`, `riffCountFlag`, `riffPresetFlag`, `riffListPresetsFlg`. The pane flag instances (`skillPaneFlag`, `cmdPaneFlag`) are `*paneFlag` values bound to `&riffPaneSpecs`.

## Pane Array Model

`--skill` and `--cmd` are repeatable and produce panes in argv order. Interleaving is unrestricted:

```
rk riff --cmd --skill /fab-discuss --cmd htop --skill
         └──┬─┘ └──────┬───────┘ └───┬──┘ └──┬──┘
          pane 0     pane 1      pane 2   pane 3
         (bare sh) (/fab-discuss) (htop)  (blank claude)
```

Pane 0 receives focus after layout is applied. Focus uses the pane id captured from `tmux new-window -P -F '#{pane_id}'` (e.g., `%87`) — `tmux select-pane -t <pane-id>` — rather than a hardcoded `<window>.0` index, because user tmux configs vary in `pane-base-index` (commonly 0 or 1) and pane id is the canonical primitive. Bare-flag semantics:

- `--skill` with no value → launcher with no positional argument (blank Claude session).
- `--cmd` with no value → `exec "${SHELL:-/bin/sh}"` (bare interactive shell).

### Argv Parsing: Three Forms

The custom `paneFlag` type (in `pane_spec.go`) handles three argv shapes per occurrence:

1. **Equals-form**: `--cmd=htop` — pflag strips the `=` and calls `Set("htop")`.
2. **Space-form**: `--cmd htop` — `rewritePaneSpaceForm` rewrites to equals-form before pflag parses, iff the next token does not start with `-`.
3. **Bare form**: `--cmd` (or `--cmd --skill /foo`) — next token is a flag or absent; pflag fires `NoOptDefVal=paneBareSentinel` and `Set` translates that to `""`.

`rewritePaneSpaceForm` stops rewriting at the `--` separator so `wt create` passthrough arguments are preserved verbatim.

### Shell-String Composition

Per pane, the trailing tmux argv slot holds a shell string:

- **Skill panes**: three layers — `<launcher> '<escaped-skill>'` (or bare `<launcher>` when skill is empty), wrapped in `${SHELL:-/bin/sh} -i -c '...'` so `.zshrc`/`.bashrc` aliases reach the launcher, then `shellWrap` appends `; exec "${SHELL:-/bin/sh}"` so the pane stays interactive.
- **Cmd panes**: two layers — the user's command string directly, then `shellWrap` suffix. No interactive `sh -i -c` wrap (would alter argv semantics of user commands like `just dev`). Empty cmd value produces just `exec "${SHELL:-/bin/sh}"`.

Helpers: `buildSkillShellString(launcher, cmdArg)`, `buildCmdShellString(value)`, `paneShellString(launcher, pane)` dispatcher. `buildNewWindowArgs` retained as a back-compat test-seam for the single-skill-pane shape.

### Focus Rule

After all panes are created and `select-layout` is applied (when the layout is non-empty), `tmux select-pane -t <pane-id>` focuses the first pane — the first argv occurrence regardless of type. The pane id (e.g., `%87`) is captured at window-creation time from `tmux new-window -P -F '#{pane_id}'` rather than computed from a hardcoded `.0` index, because user tmux configs vary in `pane-base-index`.

## Layout Flag

`--layout` accepts 12 inputs — 6 canonical tmux layout names and 6 shortforms:

| Canonical | Shortform | Notes |
|-----------|-----------|-------|
| `auto` | `a` | Default. Dispatches by pane count (see below). |
| `tiled` | `t` | Grid arrangement. |
| `even-horizontal` | `h` | Side-by-side columns. |
| `even-vertical` | `v` | Stacked rows. |
| `main-horizontal` | `deck-h` | Main pane on top, deck of small panes below. |
| `main-vertical` | `deck-v` | Main pane on left, deck of small panes right. |

The `deck-*` shortforms exist because tmux's `main-horizontal` is visually counterintuitive ("main" is actually the big pane, and "horizontal" describes the separator orientation). Both shortform and canonical round-trip to the same tmux layout name.

**Unknown layout**: `resolveLayout` returns an error listing all 12 accepted values sorted alphabetically; `runRiff` returns this via `exitCodeError{code:1}` before any subprocess runs.

### `auto` Dispatch

`autoLayout(paneCount)` maps count → layout:

- 0 or 1 panes → `""` (no `select-layout` call — single pane fills window, tmux won't re-lay-out a 1-pane window)
- 2 panes → `even-horizontal`
- ≥ 3 panes → `tiled`

When the user explicitly passes a non-auto layout (e.g., `--layout main-horizontal`) with 1 pane, the canonical name is recorded but `select-layout` is still effectively a no-op — tmux silently ignores layout changes on single-pane windows. The command exits 0 with no warning (matches tmux's own behavior).

### Help Output

`--layout`'s help text (via `layoutFlagUsage()` + `renderLayoutMocks()` in `layout_help.go`) renders Unicode box-drawing mockups inline in `rk riff -h`. The mocks cover all 6 layout options, with canonical names and shortforms on each block header so `rk riff -h | grep deck-v` hits.

## Presets

Presets live under `riff.presets.<name>` at the top level of `fab/project/config.yaml`. The parser does NOT look under `agent.riff.presets` — that nesting is ignored.

### Schema

```yaml
riff:
  presets:
    ship:
      layout: deck-h               # optional; any of the 12 --layout values
      panes:                       # optional; typed ordered list
        - skill: "/fab-fff"        # EITHER skill OR cmd per entry, not both
        - cmd: "just dev"
      wt_args:                     # optional; prepended to `-- <wt-flags>`
        - "--base"
        - main
```

**Validation (best-effort, silent):** a preset whose pane entry has BOTH `skill` and `cmd` keys is silently discarded from the returned map — matches the silent-fallback posture of `ReadSpawnCommand`. Malformed YAML, missing `riff` or `riff.presets` blocks, or any read failure returns an empty map. Unknown top-level keys in a preset (other than `layout`/`panes`/`wt_args`) are tolerated.

### Invocation

Two equivalent forms:

- **Positional**: `rk riff ship` — `args[0]` is consumed iff it exactly matches a defined preset name.
- **Named**: `rk riff --preset ship` — always checked against the defined presets.

Positional + `--preset` together is **rejected** (exit 1: "positional preset and --preset flag are mutually exclusive"). Unknown preset via `--preset` is rejected with the list of defined names. A positional token that doesn't match any preset falls through as a normal `args[]` element (cobra's `ArbitraryArgs`).

### Resolution Order (spec §Flag resolution order)

Effective values for each field:

1. **Panes**: CLI `--skill`/`--cmd` flags replace preset panes entirely. If no CLI panes AND preset has no panes AND no preset → single `/fab-discuss` skill pane (change-2 compatibility).
2. **Layout**: explicit CLI `--layout` (anything other than `auto`) > preset `layout` > `autoLayout(paneCount)`.
3. **Count**: CLI `--count` (short `-N`) only. Presets do not carry a count in this change.
4. **`wt_args`**: preset `wt_args` prepended to user's `-- <passthrough>` args.

### `--list-presets`

Prints defined presets in YAML source order (preserved via `ReadPresetsOrdered`) to stdout as indented plain text:

```
ship:
  layout: deck-h
  panes:
    - skill: /fab-fff
    - cmd: just dev
  wt_args:
    - --base
    - main
```

One blank line between presets. Empty map → `No presets defined in fab/project/config.yaml`. Short-circuits before preconditions — the user can list presets without being inside tmux and without `wt` on PATH. No subprocess is invoked. Exit code 0.

## Fan-Out

`--count <N>` (short `-N <N>`, e.g. `-N 3`; N ≥ 2) spawns N worktree/window pairs in parallel. N = 1 is the identity case (no goroutines). N = 0 or negative is rejected (exit 1). Internal helpers (`runCount`, `fanOutResult`, `planFanOutRollback`, `rollbackFanOut`, `rollbackPlan`) describe the parallelism mechanic and retain the `fanOut`/`Count` naming distinction: `runCount` is the orchestrator (matches the user-facing flag), while the result/plan/rollback types describe the mechanic.

Each goroutine runs the same `runWtCreate` + `spawnRiff` sequence. Worktree names come from `wt create`'s own generator — rk does not impose a `-1..-N` numbering. Each window is named `riff-<basename>` where `<basename>` is `filepath.Base(worktreePath)`; `resolveWindowName` applies `-2`, `-3`, … suffixes on collision.

### Rollback

On any goroutine failure:

1. The shared `context.CancelFunc` is invoked, propagating cancellation to sibling `exec.CommandContext` calls.
2. `planFanOutRollback(results, failureIdx)` (pure) computes which worktrees + windows to clean up — excludes the failing goroutine's own artifacts (its `wt create` may have returned no worktree, or its pre-tmux state is the error we're reporting).
3. `rollbackFanOut` invokes `wt delete --non-interactive <basename>` per worktree then `tmux kill-window -t <name>` per window. The `--non-interactive` flag suppresses `wt`'s `Delete this worktree?` prompt — rollback runs without a tty, and without it `wt` reads EOF on stdin and exits 1, silently leaking worktrees. The basename is passed positionally because `wt` deprecated `--worktree-name`. Argv built by the pure helper `buildWtDeleteArgs(name)`. Rollback errors are logged to stderr but do not mask the primary error. Uses a fresh (non-cancelled) context so rollback runs to completion.
4. The first-reported goroutine error propagates out as a `subprocessErr` (exit 3), unless it already is an `exitCodeError` (in which case its code is preserved).

### Signal Handling

`runRiff` wraps `cmd.Context()` with `signal.NotifyContext(...)` for SIGINT/SIGTERM once, before any subprocess. All goroutines see the same ctx — a Ctrl-C during fan-out cancels every in-flight `wt`/`tmux` call via `exec.CommandContext` propagation, then rollback runs on the partial successes.

## Workflow Step Order

`runRiff` in `riff.go`:

1. **`--list-presets` short-circuit** — if set, print presets and return. No subprocess.
2. **Preconditions** — `$TMUX` set (via `tmux.OriginalTMUX`), `wt` on PATH. Exit 2 on miss.
3. **Signal wrap** — `signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)`.
4. **Count validation** — N ≥ 1 or exit 1.
5. **Layout validation** — `resolveLayout` or exit 1 (error lists all 12 valid values).
6. **Launcher resolution** — `fabconfig.ReadSpawnCommand` or hardcoded default.
7. **Preset resolution** — `resolveActivePreset` handles positional/named/conflict/unknown.
8. **Effective spec assembly** — `resolveEffectiveSpec` merges CLI + preset + defaults.
9. **Dispatch** — N = 1 calls `runWtCreate` + `spawnRiff` directly; N ≥ 2 calls `runCount` (the orchestrator dispatching by `spec.Count`).

`spawnRiff` internally calls `listWindowNames` + `resolveWindowName` for collision resolution, then runs the spawn sequence in three phases: (a) `tmux new-window -P -F '#{pane_id}' …` via `runTmuxNewWindowCapturePaneID` (argv built by pure helper `buildNewWindowCaptureArgs`; pane id parsed by pure helper `parsePaneID` — single trimmed line); (b) the remaining pure-argv slice from `buildSpawnArgvs(worktreePath, resolvedName, spec)` (split-window × N + optional select-layout) via `runTmuxArgv`; (c) `tmux select-pane -t <pane-id>` constructed at runtime from the captured pane id. All subprocesses run with `tmuxTimeout` (10 s) and `tmuxChildEnv`. `buildSpawnArgvs` is a pure helper (test seam) — it no longer emits a trailing `select-pane` row, because the focus target is a runtime value not knowable until `new-window` returns.

## Exit Code Discipline

`exitCodeError{code, msg}` + local `runRiffWithExitCode` wrapper prints `msg` to stderr and `os.Exit(code)` for non-zero codes. `main.execute()` is shared; generic errors fall through to exit 1.

| Exit | Condition |
|------|-----------|
| 0 | Success |
| 1 | Validation error (unknown layout, invalid count, unknown/conflicting preset) or generic/unclassified |
| 2 | Precondition failure (`$TMUX` unset, `wt` not on PATH) |
| 3 | Subprocess failure (wt / tmux non-zero, output parse failure, timeout) |

## Single-Quote Escaping

The launcher + skill are concatenated as `<launcher> '<escaped-skill>'` inside the outer `sh -i -c '...'` wrap. `escapeSingleQuotes(s)` replaces every `'` with `'\''` (canonical POSIX shell-safe encoding). The launcher string itself is NOT escaped — shell expansion inside the launcher (e.g., `claude -n "$(basename "$(pwd)")"`) is the documented exception to constitution §I.

## Window-Name Collision Resolution

Before each `tmux new-window`, `listWindowNames(ctx)` runs `tmux list-windows -F '#W'` on the user's server, and `resolveWindowName(existing, base)` picks the first free name starting from `base`, then `base-2`, `base-3`, … (filling gaps). Base is always `riff-<worktree-basename>`. Accepted TOCTOU race between list and new-window — fallback is silent duplicate under tmux's default `allow-rename`.

## `internal/fabconfig/` Package

Best-effort `yaml.v3` reader for `fab/project/config.yaml`. Public API:

```go
fabconfig.ReadSpawnCommand(repoRoot string) string
fabconfig.ReadPresets(repoRoot string) map[string]Preset
fabconfig.ReadPresetsOrdered(repoRoot string) []PresetEntry
```

`ReadPresets` returns an empty map for any failure path; `ReadPresetsOrdered` preserves YAML source order (walks `*yaml.Node` directly because struct-decoded `*yaml.Node` fields don't populate — yaml.v3 requires top-level Node decoding for node access). `Preset` has `Layout string`, `Panes []PaneSpec`, `WtArgs []string`. `PaneSpec` has `Kind` (one of `PaneKindSkill`/`PaneKindCmd`), `Skill`, `Cmd`.

Callers never get an error or log emission — the silent-fallback posture matches `ReadSpawnCommand` so repo-scan callers don't get stderr noise.

## `tmux.OriginalTMUX` Usage

Same as before: `internal/tmux`'s `init()` strips `$TMUX`, and `checkPreconditions()` + `tmuxChildEnv()` restore it so `rk riff`-spawned tmux subprocesses target the user's current server (not managed `runkit`/`default`).

## Security / Trust Boundary

Unchanged from prior changes: `fab/project/config.yaml` is a trust boundary equivalent to committed code. Preset `wt_args`, preset `cmd` values, and `agent.spawn_command` are all unescaped on their way to tmux's shell. Users consuming third-party repos SHOULD audit `fab/project/config.yaml` before running `rk riff` against them.

## Tests

- `app/backend/cmd/rk/riff_test.go` — existing helpers (`parseWorktreePath`, `escapeSingleQuotes`, `buildNewWindowArgs`, `shellWrap`, `resolveWindowName`, `resolveLauncher`) plus coverage: `rewritePaneSpaceForm`, `paneFlag` parsing (interleaved argv → correct PaneSpec order), `resolveLayout` (all 12 inputs + unknown-value error), `autoLayout`, `resolveActivePreset` (6 scenarios), `resolveEffectiveSpec` (7 resolution rules), `buildSpawnArgvs` (single/2/4-pane shapes, bare skill, bare cmd; no longer emits a trailing `select-pane` row), `buildNewWindowCaptureArgs` (argv shape for the `-P -F '#{pane_id}'` step), `parsePaneID` (single-line trim + empty-input error), `printPresets` (empty + two-preset), `planFanOutRollback` (full success, partial with failure, no failure), `TestRiffCountShortForm` (`-N`/`--count`/`--count=`/default), `TestRiffFanOutFlagRejected` (post-rename hard-rename regression), `TestBuildWtDeleteArgs` (`--non-interactive` + positional name; rejects `--worktree-name`).
- `app/backend/internal/fabconfig/fabconfig_test.go` — existing `ReadSpawnCommand` cases plus `ReadPresets` cases (empty file, missing riff block, malformed YAML, valid preset with all fields, pane-with-both-keys discarded, unknown keys tolerated, empty panes list, multiple presets, nested `agent.riff.presets` ignored) and `ReadPresetsOrdered` preserves source order.

No integration tests invoke real `wt`/`tmux` — the pure helpers remain the unit-test surface. SIGINT propagation and the fan-out goroutine orchestration are deliberately not automated — manual verification against a hung `wt create` + `--count 3` is the acceptance check.

## Related Files

- `app/backend/cmd/rk/riff.go` — command implementation
- `app/backend/cmd/rk/pane_spec.go` — `paneFlag` pflag.Value + argv pre-processor
- `app/backend/cmd/rk/layout.go` — `layoutAliases`, `resolveLayout`, `autoLayout`
- `app/backend/cmd/rk/layout_help.go` — `renderLayoutMocks`, `layoutFlagUsage`
- `app/backend/cmd/rk/riff_test.go` — pure-helper unit tests
- `app/backend/cmd/rk/root.go` — registration via `rootCmd.AddCommand(riffCmd)`
- `app/backend/cmd/rk/context.go` — lists `rk riff` under **Workflow** in the CLI Commands section
- `app/backend/internal/fabconfig/fabconfig.go` — `ReadSpawnCommand`, `ReadPresets`, `ReadPresetsOrdered`
- `app/backend/internal/fabconfig/fabconfig_test.go` — fabconfig unit tests
- `app/backend/internal/config/runkit_yaml.go` — `FindGitRoot(dir)` walk-up helper reused by launcher + preset resolution
- `app/backend/internal/tmux/tmux.go` — `OriginalTMUX` package-level var

## Design Decisions

- **Custom `pflag.Value` + argv pre-processor for repeatable pane flags with bare / space / equals forms** (`260423-jmwu-rk-riff-workflow-features`). pflag's built-in `NoOptDefVal` pattern does not consume a space-form value (the next token) — it only fires when the flag appears with no attached value, leaving the following token as a separate positional arg. To support all three shapes uniformly (`--cmd`, `--cmd htop`, `--cmd=htop`) with repeated occurrences AND preserve interleaved argv order across two flags (`--skill` / `--cmd`), this change combines: (1) a shared `*paneFlag` pflag.Value bound to a single `[]PaneSpec` accumulator, (2) `NoOptDefVal = paneBareSentinel` so pflag fires `Set(sentinel)` on bare occurrences, (3) a pre-parse `rewritePaneSpaceForm(argv)` helper that translates `--flag V` to `--flag=V` in argv iff the next token doesn't start with `-`, stopping at the `--` separator so `wt create` passthrough is preserved verbatim. Future commands needing the same three-form repeatable-flag UX SHOULD reuse this pattern (`pane_spec.go` is the reference implementation).

## Changelog

| Date | Change | Reference |
|------|--------|-----------|
| 2026-04-17 | Initial `rk riff` subcommand — worktree + tmux window + Claude launcher. Unifies the personal-dotfile `riff`/`riffs` shell functions into a first-class `rk` command. `--cmd` (default `/fab-discuss`), `--split <setup-cmd>` (optional horizontal split), `-- <wt-flags>` passthrough to `wt create`. Preconditions: `$TMUX` set + `wt` on PATH (exit 2). Launcher from `agent.spawn_command` in `fab/project/config.yaml` via new `internal/fabconfig/` (falls back to `claude --dangerously-skip-permissions`). Local `exitCodeError` wrapper maps exit codes (2 precondition, 3 subprocess) without touching `main.execute()`. `exec.CommandContext` with 30s/10s timeouts. `tmux.OriginalTMUX` restored in child env so tmux targets the user's current server. | `260416-r1j6-add-riff-command` |
| 2026-04-17 | Name the tmux window `riff-<worktree-basename>` via the `-n` flag, and document via the pure helper `buildNewWindowArgs`. | `260417-w4af-name-riff-window-after-worktree` |
| 2026-04-23 | Correctness and portability fixes — no CLI surface change. (1) New pure `shellWrap(cmd)` helper appends `; exec "${SHELL:-/bin/sh}"`; used by both new-window and split paths so panes stay interactive after their commands exit. (2) Launcher now runs under an interactive `${SHELL:-/bin/sh} -i -c '...'` wrap inside `buildNewWindowArgs` so `.zshrc`/`.bashrc` aliases, functions, and interactive-only PATH tweaks reach the Claude Code launcher (closes Bug 3). (3) Split pane replaces the hardcoded `exec zsh` with `shellWrap(setupCmd)` — bash/fish users land in their own shell (closes Bug 8). (4) SIGINT/SIGTERM propagation — `runRiff` wraps its root context via `signal.NotifyContext(cmd.Context(), os.Interrupt, syscall.SIGTERM)` with `defer stop()`, threaded through all three subprocess call sites; Ctrl-C no longer leaves orphan `wt`/`tmux` children (closes Bug 10). (5) Window-name auto-suffix — `listWindowNames(ctx)` probes `tmux list-windows -F '#W'` and `resolveWindowName(existing, base)` (pure, gap-filling) applies `-2`, `-3`, … on collision; TOCTOU race between list and new-window is accepted (closes Bug 11). (6) Added Security / Trust Boundary section documenting `fab/project/config.yaml` as committed-code-equivalent and naming launcher shell expansion as the intentional exception to constitution §I (addresses Bug 9 via docs only — no code mitigation). `buildNewWindowArgs` signature changed to accept the resolved name; new `TestShellWrap` and `TestResolveWindowName` cover the new pure helpers. | `260423-ba9f-rk-riff-correctness-fixes` |
| 2026-04-23 | CLI surface refinement — hard-rename flags and expand help text, no behavioral change. (1) `--cmd` renamed to `--skill` (hard-rename, no deprecation alias — invocations using `--cmd` fail with cobra's "unknown flag" error). (2) `--split` renamed to `--setup-pane` (hard-rename, no deprecation alias). (3) Package-level Go variables renamed in lockstep: `riffCmdFlag` → `riffSkillFlag`, `riffSplitFlag` → `riffSetupPaneFlag`. (4) `Use:` synopsis expanded from `riff [-- wt-flags...]` to `riff [--skill <name>] [--setup-pane <cmd>] [-- <wt-flags>...]`. (5) `Long:` help expanded to match `serve.go` house style. (6) Bug 2 investigation note — verified positional argv to `claude` dispatches slash-commands correctly. | `260423-udhe-rk-riff-cli-surface` |
| 2026-04-23 | Workflow features — pane-array model, layouts, presets, and fan-out. (1) `--skill` and `--cmd` are now repeatable with argv-ordered pane composition; a custom `paneFlag` pflag.Value + argv pre-processor (`rewritePaneSpaceForm`) support bare / space-form / equals-form syntax uniformly. Pane 0 always gets tmux focus via `select-pane -t <window>.0`. (2) `--layout` flag accepts 6 canonical tmux names + 6 shortforms (`a`/`t`/`h`/`v`/`deck-h`/`deck-v`), resolved via `layoutAliases`; `auto` dispatches by pane count via `autoLayout`. Unicode box-drawing mockups render inline in `rk riff -h` via `layout_help.go`. (3) `--setup-pane` removed outright (no alias, no deprecation warning) — `--cmd` subsumes it. (4) Presets under `riff.presets.<name>` in `fab/project/config.yaml` invokable positionally (`rk riff ship`) or via `--preset`; panes are a typed ordered list of `{skill|cmd: value}` entries; CLI panes replace preset panes entirely; CLI layout overrides preset layout; preset `wt_args` are prepended to user passthrough. Preset with a pane having both `skill` and `cmd` keys is silently discarded (best-effort posture matching `ReadSpawnCommand`). (5) `--list-presets` short-circuits before preconditions and prints presets in YAML source order. (6) `--fan-out N` spawns N parallel worktree/window pairs sharing one pane shape; failure triggers rollback via `wt delete` + `tmux kill-window` for the non-failing goroutines' artifacts (computed by pure `planFanOutRollback`). `fabconfig.ReadPresets` + `ReadPresetsOrdered` added. New pure helpers: `resolveActivePreset`, `resolveEffectiveSpec`, `buildSpawnArgvs`, `buildSkillShellString`, `buildCmdShellString`, `planFanOutRollback`. | `260423-jmwu-rk-riff-workflow-features` |
| 2026-05-06 | `--count` rename and fan-out correctness fixes. (1) Hard-rename `--fan-out N` → `--count N` (short form `-N`, uppercase) — no alias, no deprecation warning; `--fan-out` is now an unknown flag. Internal renames track the user-facing flag: `riffFanOutFlag` → `riffCountFlag`, `effectiveSpec.FanOut` → `effectiveSpec.Count`, `runFanOut` → `runCount`. The parallelism-mechanic helpers (`fanOutResult`, `planFanOutRollback`, `rollbackFanOut`, `rollbackPlan`) keep their `fanOut`/`Plan` naming because they describe the mechanic, not the flag. (2) Bug fix: pane focus targets the captured pane id from `tmux new-window -P -F '#{pane_id}'` rather than a hardcoded `<window>.0` index, which was wrong on tmux configs with `pane-base-index 1` (every riff invocation printed `can't find pane: 0` on stderr). New helpers: `buildNewWindowCaptureArgs` (pure argv shape), `parsePaneID` (pure stdout parser — single trimmed line), `runTmuxNewWindowCapturePaneID` (subprocess with `tmuxTimeout`, parent context propagation, `tmuxChildEnv()`). `buildSpawnArgvs` no longer emits the trailing `select-pane` row — pane id is a runtime value, so that step is constructed by the orchestrator (`spawnRiffReturningName`). (3) Bug fix: `runWtDelete` now invokes `wt delete --non-interactive <name>` (positional name; deprecated `--worktree-name` removed; `--non-interactive` suppresses the `Delete this worktree?` prompt that previously caused silent rollback failures because rollback runs without a tty). Argv shape extracted to pure helper `buildWtDeleteArgs`. (4) New tests: `TestParsePaneID`, `TestBuildNewWindowCaptureArgs`, `TestRiffCountShortForm` (`-N`/`--count`/`--count=`/default), `TestRiffFanOutFlagRejected` (regression-protect the rename), `TestBuildWtDeleteArgs` (regression-protect the `--non-interactive` + positional-name argv). `TestBuildSpawnArgvs` updated to drop the `select-pane` row expectation. | `260504-lald-rk-riff-count-rename-and-fanout-fixes` |
