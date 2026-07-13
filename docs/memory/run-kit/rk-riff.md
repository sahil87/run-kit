---
description: "`rk riff` spawn engine — worktree + tmux window + Claude launcher with argv-ordered pane arrays, presets, named layouts, and parallel fan-out; extracted into internal/riff (parameterized by explicit {server, session, repoRoot}) with the CLI thinned to flags/preconditions/derivation and the web-UI POST /api/riff as a second frontend"
type: memory
---
# `rk riff`

`rk riff` creates a git worktree, opens a new tmux window inside it, and launches one or more Claude Code sessions (or arbitrary shell panes) in a multi-pane layout. It generalizes the earlier single-skill riff model to an argv-ordered pane array with presets, named layouts, and parallel fan-out across N worktrees.

**Engine extracted into `internal/riff` (since `260713-sbk1-web-spawn-agent`).** The spawn mechanics now live in the package `app/backend/internal/riff/`, parameterized by **explicit `{server, session, repoRoot}` targets** instead of the ambient `$TMUX` / process-cwd state the CLI used to rely on. Two thin frontends drive the same engine:

- **CLI** (`app/backend/cmd/rk/riff.go`, registered in `root.go` via `rootCmd.AddCommand(riffCmd)`) — flag parsing + CLI-only preconditions + param derivation, calling `riff.Run` with an **empty server label** (target the user's current tmux server via the restored `$TMUX`). Byte-identical to pre-extraction behavior.
- **HTTP handler** (`app/backend/api/riff.go`, `POST /api/riff`) — derives its targets from the request + target session and calls `riff.Spawn` with a **non-empty server label** (`-L <server>` daemon path) — the web-UI agent-spawn surface (see [architecture](/run-kit/architecture.md) § API Layer and [ui-patterns](/run-kit/ui-patterns.md) § Spawn-Agent Dialog).

`internal/riff` files: `riff.go` (engine entry `Spawn`/`Run`, `ResolveLauncher`, `runWtCreate`, `spawnRiffReturningName`, fan-out + rollback, targeting seam), `spec.go` (`ResolveActivePreset`, `ResolveEffectiveSpec`, `composePanes`, `presetPaneToSpec`), `shell.go` (pane/argv/shell-string helpers, session-scoped targeting), `layout.go` (`layoutAliases`, `ResolveLayout`, `autoLayout`). CLI-side supporting files: `pane_spec.go` (pflag.Value implementation), `layout_help.go` (ASCII mocks — the mock strings are self-contained and do NOT depend on the moved alias table). Preset reads via `../../internal/fabconfig/fabconfig.go` (`ReadPresets`/`ReadPresetsOrdered`).

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

Helpers (in `internal/riff/shell.go` since `260713-sbk1`): `buildSkillShellString(launcher, cmdArg)`, `buildCmdShellString(value)`, `paneShellString(launcher, pane)` dispatcher. (The former `buildNewWindowArgs` single-skill-pane back-compat test-seam was **deleted** by `260713-sbk1` — `buildNewWindowCaptureArgs` + `buildSpawnArgvs` are the argv seams, covered directly by `TestBuildNewWindowCaptureArgs`/`TestBuildSpawnArgvs`.)

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

Effective values for each field (`ResolveEffectiveSpec`, in `spec.go`):

1. **Panes**: caller-supplied "CLI panes" replace preset panes entirely. If no CLI panes AND preset has no panes AND no preset → single `/fab-discuss` skill pane (change-2 compatibility). **This last fallback is the CLI's** — the HTTP endpoint supplies its own pane BEFORE calling `ResolveEffectiveSpec` (see § Endpoint Pane Composition below), so it never reaches the `/fab-discuss` default.
2. **Layout**: explicit CLI `--layout` (anything other than `auto`) > preset `layout` > `autoLayout(paneCount)`. `layoutExplicit` distinguishes "user didn't set a layout" (defer to preset) from "user explicitly chose auto" (override preset). The HTTP endpoint passes `layoutExplicit=false` so a preset layout wins, else auto-by-count.
3. **Count**: CLI `--count` (short `-N`) only. Presets do not carry a count. The HTTP endpoint fixes count at 1.
4. **`wt_args`**: preset `wt_args` prepended to the caller's `-- <passthrough>` args.

### Endpoint Pane Composition (`composePanes`, since `260713-sbk1`)

The HTTP endpoint maps its `(task, preset)` pair to a CLI-pane slice via the pure `composePanes(task, preset)` helper (in `spec.go`) BEFORE calling `ResolveEffectiveSpec`, so its task-injection rules (R6/R7) ride the same resolution path as the CLI's `--skill`/`--cmd` panes:

- **task non-empty** → a single skill pane carrying the task as its launcher positional arg. This **replaces** any preset panes (via rule 1); the preset still contributes layout + `wt_args`.
- **task empty, preset panes present** → `nil` CLI panes, so `ResolveEffectiveSpec` falls through to the preset's own panes.
- **task empty, no preset panes** → a single **BARE** skill pane (bare launcher, blank agent session). This is the endpoint's deliberate blank-agent default — **NOT** the CLI's `/fab-discuss` change-2 fallback, which only fires when NO CLI panes are supplied. `composePanes` always returns a non-nil slice in the task-empty/no-preset-panes case, short-circuiting the fallback. A dedicated table test (`composePanes`) covers this blank-agent-vs-`/fab-discuss` distinction directly.

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

### CLI (`runRiff` in `cmd/rk/riff.go`)

The CLI is the flag/precondition/derivation frontend; the numbered steps below own no spawn mechanics — they assemble an `EffectiveSpec` and hand off to the engine:

1. **`--list-presets` short-circuit** — if set, print presets and return. No subprocess.
2. **Preconditions** — `$TMUX` set (via `tmux.OriginalTMUX`), `wt` on PATH. Exit 2 on miss. **CLI-only** — the engine has no precondition step (the daemon path targets an explicit server + repo root, not `$TMUX`/cwd).
3. **Signal wrap** — `signal.NotifyContext(ctx, os.Interrupt, syscall.SIGTERM)`.
4. **Count validation** — N ≥ 1 or exit 1.
5. **Layout validation** — `riff.ResolveLayout` or exit 1 (error lists all 12 valid values).
6. **Repo-root derivation** — process cwd → `config.FindGitRoot` (empty tolerated → engine runs subprocesses in the inherited cwd, matching prior behavior).
7. **Launcher resolution** — `riff.ResolveLauncher(ctx, repoRoot)` (the engine helper; see § Launcher Resolution). Never errors.
8. **Preset resolution** — `riff.ResolveActivePreset` handles positional/named/conflict/unknown.
9. **Effective spec assembly** — `riff.ResolveEffectiveSpec` merges CLI + preset + defaults. The CLI then sets `spec.Launcher`, `spec.Server = ""` (current-server sentinel), `spec.RepoRoot`, and `spec.OriginalTMUX = tmux.OriginalTMUX`.
10. **Dispatch** — `riff.Run(ctx, spec)`: N = 1 calls `runWtCreate` + `spawnRiffReturningName` directly; N ≥ 2 calls `runCount` (the orchestrator dispatching by `spec.Count`).

### HTTP handler (`riff.Spawn` via `POST /api/riff`)

`Spawn(ctx, Options{Server, Session, RepoRoot, Task, Preset})` (count fixed at 1) resolves the launcher rooted at `RepoRoot`, reads the named preset (unknown → `ExitCodeError{Code: ExitValidation}` → the handler maps it to 400), composes the effective pane spec via `composePanes` + `ResolveEffectiveSpec`, then runs `runWtCreate` + `spawnRiffReturningName` once and returns a `Result{Server, Session, WindowName, WindowID}`. It requires a non-empty `RepoRoot` (empty → `ValidationErr`). See [architecture](/run-kit/architecture.md) § API Layer for the handler's repo-root derivation and 400 discipline.

### `spawnRiffReturningName` (shared spawn sequence)

`spawnRiffReturningName(ctx, worktreePath, spec)` calls `listWindowNames` + `resolveWindowName` for collision resolution, then runs the spawn sequence in three phases: (a) `tmux new-window -P -F '#{pane_id}' …` via `runTmuxNewWindowCapturePaneID` (argv built by pure helper `buildNewWindowCaptureArgs`; pane id parsed by pure helper `parsePaneID` — single trimmed line); (b) the remaining pure-argv slice from `buildSpawnArgvs(worktreePath, resolvedName, spec)` (split-window × N + optional select-layout) via `runTmuxArgv`; (c) `tmux select-pane -t <pane-id>` constructed at runtime from the captured pane id. It then does a **best-effort window-id resolution** — `resolveWindowIDFromPane` runs `display-message -t <pane-id> -p '#{window_id}'` so the HTTP caller can navigate to `/$server/$window`; a resolve failure returns an empty id (non-fatal — the CLI ignores the id, and the window surfaces via SSE regardless). All subprocesses run with `TmuxTimeout` (10 s) via `runTmuxArgv`/`runTmuxNewWindowCapturePaneID` and `childEnv(spec)`. `buildSpawnArgvs`/`buildNewWindowCaptureArgs` are pure helpers (test seams) — `buildSpawnArgvs` emits no trailing `select-pane` row, because the focus target is a runtime value not knowable until `new-window` returns.

### Server + Session Targeting Seam

The engine targets tmux by two orthogonal seams, both driven off `EffectiveSpec`:

- **Server** — `tmuxArgv(spec, args…)` prepends `-L <server>` when `spec.Server` is non-empty (daemon path); when empty (CLI path) no prefix is added and `childEnv(spec)` restores `$TMUX` from `spec.OriginalTMUX` so bare tmux calls reach the user's current server. `-L` selects only the **socket**, NOT the session.
- **Session** — `spec.Session` scopes *which session the window is created in* on the daemon path (a bare `-L`-only `new-window` with no attached client would land in the socket's ambient session, not the requested one). When `spec.Session` is non-empty: `new-window` carries `-t <session>` (`sessionTarget`), `split-window`/`select-layout` target `<session>:<name>` (`windowTarget`), and the collision probe reads `list-windows -t <session>`. Empty `Session` (the CLI path) leaves every call unscoped — byte-identical to pre-session behavior. (This session threading was a review must-fix during `260713-sbk1`: the first extraction pass emitted `-L` only and never targeted the requested session; `TestBuildNewWindowCaptureArgs`/`TestBuildSpawnArgvs` now lock both the daemon `-t`-bearing and the CLI unscoped argv shapes.)

## Exit Code Discipline

Since `260713-sbk1` the exit-code type is the **exported** `riff.ExitCodeError{Code, Msg}` (in `internal/riff/riff.go`) so **both** frontends can classify engine failures without re-parsing error strings. The engine constructs failures via `riff.ValidationErr(...)` (`Code: ExitValidation`) and `riff.SubprocessErr(...)` (`Code: ExitSubprocess`); preconditions (`ExitPrecondition`) stay CLI-side. The exit-code sentinel constants are `ExitValidation=1`, `ExitPrecondition=2`, `ExitSubprocess=3`.

- **CLI**: the `runRiffWithExitCode` wrapper (`cmd/rk/riff.go`) `errors.As`-matches `*riff.ExitCodeError`, prints `Msg` to stderr, and `os.Exit(Code)`. `main.execute()` is shared; a non-`ExitCodeError` falls through to exit 1. (The CLI-local `exitCodeError` type still exists in `cmd/rk/exit_code.go` — now used only by `rk shell-init`.)
- **HTTP handler**: `riffStatusForError` (`api/riff.go`) `errors.As`-matches `*riff.ExitCodeError` and maps `Code == ExitValidation` → `400` (client-correctable: unknown preset / invalid layout, nothing created); everything else → `500`.

| Exit / Status | Condition |
|------|-----------|
| 0 / 200 | Success |
| 1 / 400 | Validation error (unknown layout, invalid count, unknown/conflicting/unknown preset) |
| 2 / — | Precondition failure (`$TMUX` unset, `wt` not on PATH) — CLI-only |
| 3 / 500 | Subprocess failure (wt / tmux non-zero, output parse failure, timeout) |

## Single-Quote Escaping and Task Injection

The launcher + skill/task are concatenated as `<launcher> '<escaped-skill>'` inside the outer `sh -i -c '...'` wrap (`buildSkillShellString` in `shell.go`). `escapeSingleQuotes(s)` replaces every `'` with `'\''` (canonical POSIX shell-safe encoding). The launcher string itself is NOT escaped — shell expansion inside the launcher (e.g., `claude -n "$(basename "$(pwd)")"`) is the documented exception to constitution §I.

**Web-UI task injection (since `260713-sbk1`)** reuses this exact seam: `POST /api/riff`'s `task` text is passed as `buildSkillShellString`'s `cmdArg` (a skill pane's `Value`), so a non-empty task becomes the launcher positional arg that auto-submits on boot — the same trust model as `--skill`, single-quote-escaped into the documented launcher exception. This is the deliberate v1 injection mechanism: no timing dependency, no post-boot send-keys. (The paste-unsubmitted-for-human-review variant is **deferred** — it would need send-keys after agent boot, and no boot-complete hook event exists in the `@rk_agent_state` registry. See [architecture](/run-kit/architecture.md) § API Layer and the intake's Out-of-Scope list.)

## Window-Name Collision Resolution

Before each `tmux new-window`, `listWindowNames(ctx, spec)` runs `tmux list-windows -F '#W'` on the target server — **scoped to `spec.Session` (`-t <session>`) on the daemon path** so the collision probe reads the SAME session the window will be created in; **unscoped on the CLI path** — and `resolveWindowName(existing, base)` picks the first free name starting from `base`, then `base-2`, `base-3`, … (filling gaps). Base is always `riff-<worktree-basename>`. Accepted TOCTOU race between list and new-window — fallback is silent duplicate under tmux's default `allow-rename`.

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

`riff.ResolveLauncher(ctx, repoRoot)` (in `internal/riff/riff.go`, exported so both the CLI and the HTTP handler call it) resolves the agent launcher by shelling out to **`fab agent --print`**, which prints fab-kit's fully-resolved default-tier session command (tier → provider → `session_command`, with `{model}`/`{effort}` substitution via fab's own `internal/spawn`). Delegating to the fab CLI means rk never parses fab-kit's config schema itself and can't drift from it (constitution §III Wrap, Don't Reinvent) — the design decision that replaced the deleted `fabconfig.ReadSpawnCommand`, which read the now-dead `agent.spawn_command` key.

Mechanics:

- `exec.CommandContext(ctx, "fab", "agent", "--print")` with `ctx` bounded by the named `FabTimeout = 10 * time.Second` constant (in the timeouts `const` block alongside `WtTimeout`/`TmuxTimeout`) — constitution §I Security First + §Process Execution.
- Stdout captured via `cmd.Output()` (**not** `CombinedOutput()`) so stderr can't pollute the launcher string.
- **Explicit repo-root rooting (since `260713-sbk1`)**: `cmd.Dir` is set to `repoRoot` (when non-empty) so fab's cwd-based repo discovery resolves the **target** project. The CLI passes its process cwd (`rk riff` always runs inside the repo — today's behavior preserved); the HTTP handler passes the request-derived repo root, because the daemon's own cwd is NOT the target repo. An empty `repoRoot` leaves `cmd.Dir` unset (inherited cwd).

**Silent best-effort fallback (never errors):** the pure seam `parseFabAgentOutput(stdout string, err error) (string, bool)` makes the fallback decision. It returns `(trimmed-launcher, true)` only when `err` is nil and stdout trims to a single non-empty line; otherwise `("", false)` and `ResolveLauncher` returns `DefaultLauncher` (`claude --dangerously-skip-permissions`). Fallback cases: `fab` absent from PATH, non-zero exit, timeout, empty/whitespace-only stdout, and **multi-line** trimmed output (an embedded newline is treated as malformed — a valid session command is one line). No stderr noise, no returned error. The pure helper mirrors the established test-seam pattern (`parsePaneID`, `parseWorktreePath`, `buildWtDeleteArgs`) so the fallback rules are unit-testable without staging a subprocess.

> **Duplicate `--effort`**: the resolved command can carry `--effort` twice (once from the user's `session_command` string, once appended by fab's profile injection). Last-wins, harmless — user config hygiene, out of scope for rk.

## `tmux.OriginalTMUX` Usage (CLI path)

`internal/tmux`'s `init()` strips `$TMUX`. The **CLI** reads the original via `tmux.OriginalTMUX` (captured pre-init) in two places: `checkPreconditions()` (the `$TMUX`-set gate) and the `spec.OriginalTMUX` it sets on the `EffectiveSpec`. The engine's `childEnv(spec)` then restores `TMUX=<OriginalTMUX>` into the subprocess env **only on the CLI path** (`spec.Server == ""`), so bare tmux calls target the user's current server (not managed `runkit`/`default`). On the **daemon path** (`spec.Server != ""`) no `$TMUX` is restored — the `-L <server>` prefix selects the socket and `-t <session>` selects the session, so the ambient env is used unchanged.

## Security / Trust Boundary

Unchanged from prior changes: `fab/project/config.yaml` is a trust boundary equivalent to committed code. Preset `wt_args` and preset `cmd` values are unescaped on their way to tmux's shell. The launcher itself is now the trimmed stdout of `fab agent --print` — fab-kit resolves it from the *same* committed `fab/project/config.yaml` (`providers.<name>.session_command`), so the boundary is unchanged (config ≙ committed code) and actually narrows: rk no longer parses the config for the launcher, the `fab` binary does. Users consuming third-party repos SHOULD audit `fab/project/config.yaml` before running `rk riff` against them.

## Tests

The pure-helper tests **moved with the code** (since `260713-sbk1`): every helper that moved to `internal/riff` has its test in `internal/riff/riff_test.go`; the pane-flag/argv-grammar tests that stay CLI-side remain in `cmd/rk/riff_test.go`. Coverage was not reduced.

- `app/backend/internal/riff/riff_test.go` (moved) — `TestParseWorktreePath`, `TestEscapeSingleQuotes`, `TestBuildSkillShellString`, `TestShellWrap`, `TestResolveWindowName`, `TestResolveLayout` (all 12 inputs + unknown-value error), `TestAutoLayout`, `TestResolveActivePreset` (6 scenarios), `TestResolveEffectiveSpec` (resolution rules), `TestComposePanes` (the endpoint's task/preset → CLI-pane mapping — the **blank-agent-vs-`/fab-discuss`** distinction table), `TestBuildSpawnArgvs` (single/2/4-pane shapes, bare skill/cmd; **daemon `-t`-bearing AND CLI unscoped** subtests; no trailing `select-pane` row), `TestBuildNewWindowCaptureArgs` (the `-P -F '#{pane_id}'` argv — daemon + CLI subtests), `TestParsePaneID`, `TestPlanFanOutRollback`, `TestBuildWtDeleteArgs`, `TestTmuxArgv` (the `-L <server>` prefix seam: empty server → no prefix, non-empty → `-L <server>`). **Launcher coverage** (moved from `260703-w884`): `TestParseFabAgentOutput` (pure table — success/whitespace-trim; error/empty/whitespace-only/multi-line → fallback) and `TestResolveLauncher_StubFab` (end-to-end via a stub `fab` on a temp-dir `PATH`: stub prints → verbatim; non-zero exit / absent → `DefaultLauncher`).
- `app/backend/cmd/rk/riff_test.go` (stays CLI-side) — `TestRewritePaneSpaceForm`, `TestPaneFlagParsing` (interleaved argv → correct PaneSpec order), `TestPrintPresets` (empty + two-preset), `TestRiffCountShortForm` (`-N`/`--count`/`--count=`/default), `TestRiffFanOutFlagRejected` (post-rename hard-rename regression). These cover the flag grammar + CLI-only glue that did NOT move packages.
- `app/backend/api/riff_test.go` (new, `260713-sbk1`) — httptest handler coverage with a dedicated **mock `RiffEngine`** (records its `{Server, Session, RepoRoot, Task, Preset}` inputs) and a stub `ListWindows` returning an active-pane cwd (via the shared `mockTmuxOps`, wired through `NewTestRouterWithRiff` — the shared mock is untouched): `TestRiffSpawnSuccess` (200 `{server, session, window, windowId}` + repo-root fed to the engine), `TestRiffSpawnTaskWithSingleQuote` (task text reaches the engine verbatim — the escape itself is unit-tested in `internal/riff`), `TestRiffSpawnEmptySession`/`…NonRepoCwd`/`…SessionReadError`/`…UnknownPreset` (400 with no/short-circuited engine call), `TestRiffSpawnSubprocessError` (engine `ExitSubprocess` → 500), and the presets endpoint (`TestRiffPresetsSuccess` source-order + `{name, layout, paneCount}`, `TestRiffPresetsEmpty`, `TestRiffPresetsNonRepoCwd` 400).
- `app/backend/internal/fabconfig/fabconfig_test.go` — `ReadPresets` cases (empty file, missing riff block, malformed YAML, valid preset with all fields, pane-with-both-keys discarded, unknown keys tolerated, empty panes list, multiple presets, nested `agent.riff.presets` ignored) and `ReadPresetsOrdered` preserves source order. Unchanged by the extraction.

No integration tests invoke real `wt`/`tmux` — the pure helpers remain the unit-test surface. SIGINT propagation and the fan-out goroutine orchestration are deliberately not automated — manual verification against a hung `wt create` + `--count 3` is the acceptance check.

## Related Files

- `app/backend/internal/riff/riff.go` — engine entry (`Spawn`/`Run`/`Options`/`Result`/`EffectiveSpec`), `ResolveLauncher`/`parseFabAgentOutput`, `runWtCreate`, `spawnRiffReturningName`, targeting seam (`tmuxArgv`/`childEnv`), fan-out + rollback, and the `WtTimeout`/`TmuxTimeout`/`FabTimeout`/`DefaultLauncher`/`DefaultRiffSkill` + `ExitCodeError`/`Exit*` consts
- `app/backend/internal/riff/spec.go` — `ResolveActivePreset`, `ResolveEffectiveSpec`, `composePanes`, `presetPaneToSpec`, `joinPresetNames`
- `app/backend/internal/riff/shell.go` — `buildSkillShellString`/`buildCmdShellString`/`paneShellString`, `buildSpawnArgvs`/`buildNewWindowCaptureArgs`, `sessionTarget`/`windowTarget`, `parsePaneID`, `shellWrap`, `escapeSingleQuotes`
- `app/backend/internal/riff/layout.go` — `layoutAliases`, `ResolveLayout`, `autoLayout`
- `app/backend/internal/riff/riff_test.go` — moved pure-helper unit tests
- `app/backend/cmd/rk/riff.go` — CLI FRONTEND (flags/preconditions/derivation + `riff.Run` handoff); `readPresetsForRepo`/`readPresetsOrderedForRepo`/`printPresets`, `checkPreconditions`
- `app/backend/cmd/rk/pane_spec.go` — `paneFlag` pflag.Value + argv pre-processor (CLI-only)
- `app/backend/cmd/rk/layout_help.go` — `renderLayoutMocks`, `layoutFlagUsage` (CLI help; self-contained mock strings, no dependency on the moved alias table)
- `app/backend/cmd/rk/exit_code.go` — the CLI-local `exitCodeError` (now used only by `rk shell-init` — riff's exit-code type moved to `riff.ExitCodeError`)
- `app/backend/cmd/rk/riff_test.go` — CLI-side flag-grammar tests
- `app/backend/cmd/rk/root.go` — registration via `rootCmd.AddCommand(riffCmd)`
- `app/backend/cmd/rk/context.go` — lists `rk riff` under **Workflow** in the CLI Commands section
- `app/backend/api/riff.go` — `handleRiffSpawn` / `handleRiffPresets` + `deriveRepoRoot` (web-UI frontend; see [architecture](/run-kit/architecture.md) § API Layer)
- `app/backend/api/router.go` — `RiffEngine` interface + `prodRiffEngine` wrapper + `NewTestRouterWithRiff` + route registration
- `app/backend/internal/fabconfig/fabconfig.go` — `ReadPresets`, `ReadPresetsOrdered` (presets only; `ReadSpawnCommand` + the `fabConfig` struct were deleted in `260703-w884`)
- `app/backend/internal/config/runkit_yaml.go` — `FindGitRoot(dir)` walk-up helper: the CLI uses it for repo-root derivation + preset resolution; the HTTP handler uses it in `deriveRepoRoot`; `ResolveLauncher` no longer walks it (it sets `cmd.Dir` and lets fab discover the repo)
- `app/backend/internal/tmux/tmux.go` — `OriginalTMUX` package-level var (CLI path)

## Design Decisions

- **Extract the engine into `internal/riff` parameterized by explicit targets, rather than shell out to `rk riff` from the daemon** (`260713-sbk1-web-spawn-agent`). *Decision*: move the spawn mechanics into a package taking `{server, session, repoRoot}` inputs; the CLI thins to a frontend that derives those from `$TMUX`/cwd; the HTTP handler is a second frontend deriving them from the request. *Why*: the CLI's preconditions (`$TMUX` set, cwd = repo) don't hold in a daemon process, and faking them (env injection, cwd swapping) would be fragile; a parameterized engine gives one recipe with two thin frontends and keeps CLI behavior byte-identical. *Rejected*: shelling out to the `rk riff` CLI from the daemon (fragile precondition-faking); folding the spawn into `TmuxOps` (would churn the shared `mockTmuxOps` used by every handler test — the engine is instead injected as a dedicated `RiffEngine` interface, see [architecture](/run-kit/architecture.md)). The **session must thread through the daemon path** (`-t <session>` on new-window and session-scoped split/select/list targets): `-L <server>` selects only the socket, so a `-L`-only call with no attached client lands the window in the socket's ambient session, not the requested one (a review must-fix during the change).
- **Custom `pflag.Value` + argv pre-processor for repeatable pane flags with bare / space / equals forms** (`260423-jmwu-rk-riff-workflow-features`). pflag's built-in `NoOptDefVal` pattern does not consume a space-form value (the next token) — it only fires when the flag appears with no attached value, leaving the following token as a separate positional arg. To support all three shapes uniformly (`--cmd`, `--cmd htop`, `--cmd=htop`) with repeated occurrences AND preserve interleaved argv order across two flags (`--skill` / `--cmd`), this change combines: (1) a shared `*paneFlag` pflag.Value bound to a single `[]PaneSpec` accumulator, (2) `NoOptDefVal = paneBareSentinel` so pflag fires `Set(sentinel)` on bare occurrences, (3) a pre-parse `rewritePaneSpaceForm(argv)` helper that translates `--flag V` to `--flag=V` in argv iff the next token doesn't start with `-`, stopping at the `--` separator so `wt create` passthrough is preserved verbatim. Future commands needing the same three-form repeatable-flag UX SHOULD reuse this pattern (`pane_spec.go` is the reference implementation).
