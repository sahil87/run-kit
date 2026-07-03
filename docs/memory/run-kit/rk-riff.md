---
description: "`rk riff` subcommand — worktree + tmux window + Claude launcher with argv-ordered pane arrays, presets, named layouts, and parallel fan-out"
type: memory
---
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

**Validation (best-effort, silent):** a preset whose pane entry has BOTH `skill` and `cmd` keys is silently discarded from the returned map — matches the silent-fallback posture shared across `internal/fabconfig` (`ReadPresets`/`ReadPresetsOrdered` return empty on any failure, never an error). Malformed YAML, missing `riff` or `riff.presets` blocks, or any read failure returns an empty map. Unknown top-level keys in a preset (other than `layout`/`panes`/`wt_args`) are tolerated.

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
6. **Launcher resolution** — `resolveLauncher` shells out to `fab agent --print` (fab-kit's fully-resolved default-tier session command) via `exec.CommandContext` with `fabTimeout` (10 s); silent best-effort fallback to `defaultLauncher` (`claude --dangerously-skip-permissions`) on any failure. Never errors.
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

Best-effort `yaml.v3` reader for `fab/project/config.yaml` — **presets only**. Public API:

```go
fabconfig.ReadPresets(repoRoot string) map[string]Preset
fabconfig.ReadPresetsOrdered(repoRoot string) []PresetEntry
```

The package no longer reads the agent launcher: `ReadSpawnCommand` (and the `fabConfig` struct it decoded) were **deleted** in `260703-w884` because the launcher key it read (`agent.spawn_command`) is dead in the fab-kit 2.13.3 config schema (the launcher now lives at `providers.<name>.session_command` with per-tier profiles under `agent.tiers`). `rk riff` resolves the launcher by shelling out to `fab agent --print` instead of parsing that schema itself (see §Launcher Resolution). `ReadPresets`/`ReadPresetsOrdered` and all preset types are unchanged.

`ReadPresets` returns an empty map for any failure path; `ReadPresetsOrdered` preserves YAML source order (walks `*yaml.Node` directly because struct-decoded `*yaml.Node` fields don't populate — yaml.v3 requires top-level Node decoding for node access). `Preset` has `Layout string`, `Panes []PaneSpec`, `WtArgs []string`. `PaneSpec` has `Kind` (one of `PaneKindSkill`/`PaneKindCmd`), `Skill`, `Cmd`.

Callers never get an error or log emission — a silent-fallback posture so repo-scan callers don't get stderr noise from malformed configs.

## Launcher Resolution

`resolveLauncher()` (riff.go) resolves the agent launcher by shelling out to **`fab agent --print`**, which prints fab-kit's fully-resolved default-tier session command (tier → provider → `session_command`, with `{model}`/`{effort}` substitution via fab's own `internal/spawn`). Delegating to the fab CLI means rk never parses fab-kit's config schema itself and can't drift from it (constitution §III Wrap, Don't Reinvent) — the design decision that replaced the deleted `fabconfig.ReadSpawnCommand`, which read the now-dead `agent.spawn_command` key.

Mechanics:

- `exec.CommandContext(ctx, "fab", "agent", "--print")` with `ctx` bounded by the named `fabTimeout = 10 * time.Second` constant (in the timeouts `const` block alongside `wtTimeout`/`tmuxTimeout`) — constitution §I Security First + §Process Execution.
- Stdout captured via `cmd.Output()` (**not** `CombinedOutput()`) so stderr can't pollute the launcher string.
- fab discovers the repo from the process cwd; `rk riff` always runs inside the repo, so **no `--repo` flag and no `config.FindGitRoot` walk** are needed in `resolveLauncher` (`FindGitRoot` is still used by the preset helpers — see §Related Files).

**Silent best-effort fallback (never errors):** the pure seam `parseFabAgentOutput(stdout string, err error) (string, bool)` makes the fallback decision. It returns `(trimmed-launcher, true)` only when `err` is nil and stdout trims to a single non-empty line; otherwise `("", false)` and `resolveLauncher` returns `defaultLauncher`. Fallback cases: `fab` absent from PATH, non-zero exit, timeout, empty/whitespace-only stdout, and **multi-line** trimmed output (an embedded newline is treated as malformed — a valid session command is one line). No stderr noise, no returned error — the never-errors posture of runRiff Step 5. The pure helper mirrors riff.go's established test-seam pattern (`parsePaneID`, `parseWorktreePath`, `buildWtDeleteArgs`) so the fallback rules are unit-testable without staging a subprocess.

> **Duplicate `--effort`**: the resolved command can carry `--effort` twice (once from the user's `session_command` string, once appended by fab's profile injection). Last-wins, harmless — user config hygiene, out of scope for rk.

## `tmux.OriginalTMUX` Usage

Same as before: `internal/tmux`'s `init()` strips `$TMUX`, and `checkPreconditions()` + `tmuxChildEnv()` restore it so `rk riff`-spawned tmux subprocesses target the user's current server (not managed `runkit`/`default`).

## Security / Trust Boundary

Unchanged from prior changes: `fab/project/config.yaml` is a trust boundary equivalent to committed code. Preset `wt_args` and preset `cmd` values are unescaped on their way to tmux's shell. The launcher itself is now the trimmed stdout of `fab agent --print` — fab-kit resolves it from the *same* committed `fab/project/config.yaml` (`providers.<name>.session_command`), so the boundary is unchanged (config ≙ committed code) and actually narrows: rk no longer parses the config for the launcher, the `fab` binary does. Users consuming third-party repos SHOULD audit `fab/project/config.yaml` before running `rk riff` against them.

## Tests

- `app/backend/cmd/rk/riff_test.go` — existing helpers (`parseWorktreePath`, `escapeSingleQuotes`, `buildNewWindowArgs`, `shellWrap`, `resolveWindowName`) plus coverage: `rewritePaneSpaceForm`, `paneFlag` parsing (interleaved argv → correct PaneSpec order), `resolveLayout` (all 12 inputs + unknown-value error), `autoLayout`, `resolveActivePreset` (6 scenarios), `resolveEffectiveSpec` (7 resolution rules), `buildSpawnArgvs` (single/2/4-pane shapes, bare skill, bare cmd; no longer emits a trailing `select-pane` row), `buildNewWindowCaptureArgs` (argv shape for the `-P -F '#{pane_id}'` step), `parsePaneID` (single-line trim + empty-input error), `printPresets` (empty + two-preset), `planFanOutRollback` (full success, partial with failure, no failure), `TestRiffCountShortForm` (`-N`/`--count`/`--count=`/default), `TestRiffFanOutFlagRejected` (post-rename hard-rename regression), `TestBuildWtDeleteArgs` (`--non-interactive` + positional name; rejects `--worktree-name`). **Launcher coverage** (`260703-w884`, replacing the deleted config-read tests `TestResolveLauncher`/`TestResolveLauncher_ReadsFromSubdir`/`TestFabconfigIntegration` and the `writeGitDir` helper): `TestParseFabAgentOutput` (pure table — success trims to a single line; leading/trailing whitespace trimmed; error / empty / whitespace-only / multi-line stdout → fallback) and `TestResolveLauncher_StubFab` (end-to-end via a stub `fab` executable on a temp-dir `PATH`: stub prints a launcher → returned verbatim; stub exits non-zero → `defaultLauncher`; empty PATH so `fab` is absent → `defaultLauncher`).
- `app/backend/internal/fabconfig/fabconfig_test.go` — `ReadPresets` cases (empty file, missing riff block, malformed YAML, valid preset with all fields, pane-with-both-keys discarded, unknown keys tolerated, empty panes list, multiple presets, nested `agent.riff.presets` ignored) and `ReadPresetsOrdered` preserves source order. The `TestReadSpawnCommand`/`TestReadSpawnCommand_EmptyRoot` cases were **deleted** with `ReadSpawnCommand` (`260703-w884`).

No integration tests invoke real `wt`/`tmux` — the pure helpers remain the unit-test surface. SIGINT propagation and the fan-out goroutine orchestration are deliberately not automated — manual verification against a hung `wt create` + `--count 3` is the acceptance check.

## Related Files

- `app/backend/cmd/rk/riff.go` — command implementation, incl. `resolveLauncher` / `parseFabAgentOutput` (launcher via `fab agent --print`) and the `fabTimeout` const
- `app/backend/cmd/rk/pane_spec.go` — `paneFlag` pflag.Value + argv pre-processor
- `app/backend/cmd/rk/layout.go` — `layoutAliases`, `resolveLayout`, `autoLayout`
- `app/backend/cmd/rk/layout_help.go` — `renderLayoutMocks`, `layoutFlagUsage`
- `app/backend/cmd/rk/riff_test.go` — pure-helper unit tests
- `app/backend/cmd/rk/root.go` — registration via `rootCmd.AddCommand(riffCmd)`
- `app/backend/cmd/rk/context.go` — lists `rk riff` under **Workflow** in the CLI Commands section
- `app/backend/internal/fabconfig/fabconfig.go` — `ReadPresets`, `ReadPresetsOrdered` (presets only; `ReadSpawnCommand` + the `fabConfig` struct were deleted in `260703-w884`)
- `app/backend/internal/fabconfig/fabconfig_test.go` — fabconfig unit tests
- `app/backend/internal/config/runkit_yaml.go` — `FindGitRoot(dir)` walk-up helper reused by preset resolution (`readPresetsForRepo`/`readPresetsOrderedForRepo`); `resolveLauncher` no longer uses it (fab does its own cwd-based repo discovery)
- `app/backend/internal/tmux/tmux.go` — `OriginalTMUX` package-level var

## Design Decisions

- **Custom `pflag.Value` + argv pre-processor for repeatable pane flags with bare / space / equals forms** (`260423-jmwu-rk-riff-workflow-features`). pflag's built-in `NoOptDefVal` pattern does not consume a space-form value (the next token) — it only fires when the flag appears with no attached value, leaving the following token as a separate positional arg. To support all three shapes uniformly (`--cmd`, `--cmd htop`, `--cmd=htop`) with repeated occurrences AND preserve interleaved argv order across two flags (`--skill` / `--cmd`), this change combines: (1) a shared `*paneFlag` pflag.Value bound to a single `[]PaneSpec` accumulator, (2) `NoOptDefVal = paneBareSentinel` so pflag fires `Set(sentinel)` on bare occurrences, (3) a pre-parse `rewritePaneSpaceForm(argv)` helper that translates `--flag V` to `--flag=V` in argv iff the next token doesn't start with `-`, stopping at the `--` separator so `wt create` passthrough is preserved verbatim. Future commands needing the same three-form repeatable-flag UX SHOULD reuse this pattern (`pane_spec.go` is the reference implementation).
