# Plan: GUI Agent Verbs — `rk gui exec`, `rk gui shot`, DISPLAY export, `rk skill gui` (plan C4)

**Change**: 260909-bbv1-gui-agent-verbs
**Intake**: `intake.md`

> Scope guard: Go work lives in `app/backend/cmd/rk/` only (`gui.go`, new `gui_exec.go`,
> `gui_shot.go`, their tests, `agent_setup.go` + tests, `skill.go` + tests, `skill/gui.md`), plus
> `scripts/sync-skill.sh`, `docs/site/skill.md`, new `docs/site/skill/gui.md`, and the plan file
> `fab/plans/sahil/26-09-09-gui-surface.md`. **No file under `app/frontend/` is touched** (C3 runs
> in parallel). No frontend, route, settings-key, env-key, or tmux-option additions.

## Requirements

### CLI: `rk gui exec`

#### R1: `exec` is gated on the switch, the backend, and the OS
`rk gui exec` SHALL refuse with exit 1 before running anything when (in this order): the host is
macOS (`gui exec is not supported on macOS in v1 — the GUI mirrors your live session view-only`);
the GUI is off (`gui is off — turn it on with 'rk gui on'`); the GUI is on but not reachable
(`gui is on but not running — see 'rk gui status'`). The off/not-running strings MUST be the same
bytes `rk gui env` prints, produced by one shared helper over `gatherGUIStatus` → `gui.Assemble`.
A missing command word is a usage error (exit 2) via the `usageArgs` wrap.

- **GIVEN** `gui.enabled=false`
- **WHEN** `rk gui exec xterm` runs
- **THEN** stderr carries `gui is off — turn it on with 'rk gui on'`, the exit code is 1, and no
  process is started (the exec seam is never called)

- **GIVEN** `gui.enabled=true` and the probe reports `Reachable:false`
- **WHEN** `rk gui exec xterm` runs
- **THEN** stderr carries `gui is on but not running — see 'rk gui status'`, exit 1

- **GIVEN** `GOOS=darwin`
- **WHEN** `rk gui exec xterm` runs
- **THEN** the macOS refusal prints and exits 1 before any status read

#### R2: Foreground `exec` replaces the process on the GUI display
When the gate passes, `rk gui exec <cmd> [args…]` SHALL resolve `<cmd>` with `exec.LookPath` and
replace the rk process via `syscall.Exec(path, argv, env)` where `env` is `os.Environ()` with
`DISPLAY=<st.Display>` and `RK_GUI_SOCKET=<st.Socket>` set (any pre-existing `DISPLAY` /
`RK_GUI_SOCKET` entries are replaced, never duplicated); cwd is inherited; no `XAUTHORITY` is set;
no timeout applies (the command owns the tty, signals, and exit status). A `LookPath` failure
SHALL print `error: <cmd>: not found on PATH` and exit 1. A literal `--` SHALL end flag parsing.

- **GIVEN** the gate passes with `Display=":10"` and `Socket="/s/host.sock"` and the caller's env
  carries `DISPLAY=:0`
- **WHEN** `rk gui exec -- xdotool -v` runs
- **THEN** the exec seam receives the resolved `xdotool` path, argv `["xdotool","-v"]`, and an
  env containing exactly one `DISPLAY=:10` and one `RK_GUI_SOCKET=/s/host.sock`, with every other
  caller variable preserved

- **GIVEN** the gate passes and `nosuchprog` is not on PATH
- **WHEN** `rk gui exec nosuchprog` runs
- **THEN** stderr carries `error: nosuchprog: not found on PATH`, exit 1

#### R3: `exec --detach` starts the command in its own session
With `--detach` (`-d`) the command SHALL be started (not exec'd) with the same env and cwd, as a
new session (`SysProcAttr{Setsid: true}`), stdin/stdout/stderr on `/dev/null`, not waited on; on
success stdout SHALL carry exactly `started <pid> on <display>` and the exit code is 0. A start
failure SHALL exit 1 with `error: <cmd>: <reason>`.

- **GIVEN** the gate passes with `Display=":10"`
- **WHEN** `rk gui exec --detach chromium https://example.com` runs
- **THEN** the start seam receives argv `["chromium","https://example.com"]` with `DISPLAY=:10`
  in the env and `Setsid` set, stdout is `started <pid> on :10\n`, exit 0, and the exec seam is
  not called

### CLI: `rk gui shot`

#### R4: `shot` shares `exec`'s gate
`rk gui shot` SHALL apply the same three-step gate as R1 with the shot-specific macOS message
(`gui shot is not supported on macOS in v1 — the GUI mirrors your live session view-only`) and
the identical off/not-running strings; it takes no positional arguments (exit 2 otherwise).

- **GIVEN** `gui.enabled=false`
- **WHEN** `rk gui shot` runs
- **THEN** exit 1 with the off hint and no file is written

#### R5: Screenshot tool ladder, argv slices, bounded run
The screenshot SHALL be taken by the first available tool in the fixed ladder, probed by
`LookPath`: (1) `import -display :N -window root <out>`; (2) `scrot <out>` with `DISPLAY=:N` in
its env; (3) `xwd -display :N -root -silent` piped in Go into `convert xwd:- <out>` (both must be
present). Every subprocess SHALL run through `exec.CommandContext` under a 15 s timeout
(`guiShotTimeout`, a package var). No tool ⇒ `no screenshot tool found (tried import, scrot,
xwd+convert) — sudo apt install imagemagick`, exit 1. A tool failure ⇒ `error: <tool> failed:
<stderr tail>`, exit 1. Ladder selection SHALL be a pure function over `(lookPath, display, out)`.

- **GIVEN** `import` and `scrot` are absent and `xwd` + `convert` are present
- **WHEN** the ladder resolves for display `:10` and out `/tmp/a.png`
- **THEN** it yields the two-stage pipeline `xwd -display :10 -root -silent` → `convert xwd:-
  /tmp/a.png`, tool name `xwd+convert`

- **GIVEN** `import` is present
- **WHEN** the ladder resolves
- **THEN** it yields the single argv `import -display :10 -window root /tmp/a.png`

- **GIVEN** none of the tools is on PATH
- **WHEN** `rk gui shot` runs past the gate
- **THEN** exit 1 with the no-tool message naming all three options and the apt hint

#### R6: Output path contract
Without `--out`, the file SHALL be `<os.TempDir()>/rk-gui-shot-<YYYYMMDD-HHMMSS>.png` (clock via
a `guiShotNowFn` seam). With `--out <path>` (`-o`), the path is made absolute, its parent created
with `MkdirAll` 0755, and an existing file overwritten. On success stdout SHALL carry exactly the
absolute PNG path followed by a newline (Dataf — survives `--quiet`); all diagnostics go to stderr.

- **GIVEN** the gate passes and the clock reads 2026-09-09 14:05:06 local
- **WHEN** `rk gui shot` runs with a stubbed successful runner
- **THEN** stdout is `<TempDir>/rk-gui-shot-20260909-140506.png\n`

- **GIVEN** `--out /tmp/x/y/shot.png` where `/tmp/x/y` does not exist
- **WHEN** `rk gui shot --out /tmp/x/y/shot.png` runs with a stubbed runner
- **THEN** `/tmp/x/y` exists afterwards, the runner received that path, stdout is the path

### Agent setup: the gui display block

#### R7: `rk agent setup` manages a marker-owned gui display block
`rk agent setup` SHALL manage a third user-global artifact family, applied once after
`applyTmuxShim`: the block

```sh
# >>> rk gui display >>>
[ -n "$TMUX_PANE" ] && [ -z "${DISPLAY-}" ] && eval "$("<abs-rk>" gui env 2>/dev/null)"
# <<< rk gui display <<<
```

(`<abs-rk>` = the `resolveRkPath`/`validateHookPath`-validated path already threaded as
`rkPath`) upserted via `upsertMarkerBlock` into every file `tmuxGuardStartupFiles(home, zdotdir)`
returns, and removed via `removeMarkerBlock` on `--uninstall`. It SHALL reuse the PATH block's
flow verbatim: per-file tolerant read (`readSkill`), malformed-block refusal with a skip note,
"already present" no-op note on install, silence on uninstall when absent, `--dry-run` diff via
`renderArtifactDiff` (a one-line summary + the block lines otherwise), consent through
`cons.authorizeWrite`, mode-preserving write with `MkdirAll` of the parent after consent. Unlike
the PATH block it does NOT depend on the shim being in place.

- **GIVEN** a home with an empty `.zshenv` and `.bashrc` and no `.bash_profile`
- **WHEN** `rk agent setup --yes` runs
- **THEN** both files end with the 3-line block embedding the absolute rk path, no
  `.bash_profile` is created, and a second run reports "already present" for each and writes
  nothing

- **GIVEN** the block is present alongside user lines
- **WHEN** `rk agent setup --uninstall --yes` runs
- **THEN** exactly the block is removed and every other byte is unchanged

- **GIVEN** `--dry-run`
- **WHEN** setup runs
- **THEN** a diff per file is shown and no file is modified

#### R8: The block is read-time derivation and inert while off
The block content SHALL (a) run only inside a tmux pane (`$TMUX_PANE`), (b) never override a
pre-set `DISPLAY`, (c) source `rk gui env`'s stdout only, discarding stderr, so that with the GUI
off or not running it evaluates nothing and the shell starts normally. The block MUST NOT embed a
display number or any other GUI state — the value is derived at each shell start.

- **GIVEN** the block installed, `gui.enabled=false`, a new `zsh -c 'echo "$DISPLAY"'` inside a
  tmux pane
- **WHEN** the shell starts
- **THEN** it prints an empty line and exits 0 (verified in the intake's manual acceptance; the
  unit test pins the block text's three guards)

### Skill: `rk skill gui` and the core bundle

#### R9: The `gui` topic page ships through the existing topic machinery
A canonical `docs/site/skill/gui.md` (≤150 lines by `countLines`) SHALL be synced by a new row in
`scripts/sync-skill.sh` to `app/backend/cmd/rk/skill/gui.md`, embedded as `skillGuiTopic`,
registered as `skillTopics["gui"]`, and covered by rows in all three `skill_test.go` tables
(byte-identical print, canonical drift guard, line budget). Content MUST cover: gate first
(`command -v rk`, `rk gui status`, never running `rk gui on` yourself — the switch is the user's),
`rk gui env` vs the installed block (DISPLAY lands in new shells), `rk gui exec` (foreground vs
`--detach`, `--` for dash-args), `rk gui shot` (default path, `--out`, read the PNG to look), the
screenshot loop with `xdotool`, pairing with `rk notify`/`rk present`, output & exit-code
contracts, and gotchas (macOS view-only refusals, the display is shared with the human, apps die
on `rk gui off`, install hints for imagemagick/xdotool).

- **GIVEN** the built binary
- **WHEN** `rk skill gui` runs
- **THEN** stdout equals `docs/site/skill/gui.md` byte-for-byte, stderr is empty, exit 0; `rk skill
  topics` lists `gui`; `rk skill --help` names it in `Topics:`

#### R10: The core bundle points at the topic
`docs/site/skill.md` SHALL gain one topic-index bullet (`**drive and screenshot the host GUI
display** … → \`rk skill gui\``) and one Capabilities bullet for `rk gui exec <cmd…>` /
`rk gui shot [--out f.png]` (gated on the switch; depth `rk skill gui`), staying ≤150 lines, with
the synced copy `app/backend/cmd/rk/skill/skill.md` byte-identical.

- **GIVEN** the edited core bundle
- **WHEN** `go test ./cmd/rk/ -run TestSkill` runs
- **THEN** the drift and budget tests pass

### Help text and plan bookkeeping

#### R11: `rk gui` help enumerates the new verbs
`guiCmd.Long`'s `Subcommands:` list SHALL include `exec` and `shot` rows; `rk gui env`'s Long
SHALL mention that `rk agent setup` installs the eval into shell startup files; `rk gui exec
--help` SHALL carry the example block from the intake (foreground, `--detach`, `xdotool`).

- **GIVEN** the built binary
- **WHEN** `rk gui --help` runs
- **THEN** the output lists `exec` and `shot`

#### R12: Plan tracking row
`fab/plans/sahil/26-09-09-gui-surface.md` SHALL have its C4 row filled with the change folder
`260909-bbv1-gui-agent-verbs`, a `(PR pending)` PR cell to be replaced by the PR URL at ship, and
status `in review`, and its "Status (2026-09-09)" paragraph updated to say C2 is Done and C3 ∥ C4
are in progress.

- **GIVEN** the plan file
- **WHEN** the C4 row is read
- **THEN** it names the change folder

### Non-Goals

- No frontend changes (C3 owns the tile, palette, settings row).
- No install of screenshot or input tools (`imagemagick`, `xdotool`) — hints only.
- No macOS `exec`/`shot` (D6 view-only mirror); no per-session displays (D10).
- No `tmux set-environment` push of `DISPLAY`; no agent-hook export.
- No spec edits beyond a hydrate proposal (specs are human-curated).

### Design Decisions

#### DISPLAY reaches panes through a shell-startup block that evals `rk gui env`
**Decision**: `rk agent setup` installs a marker-owned block into the guard PATH block's startup
files whose body is `[ -n "$TMUX_PANE" ] && [ -z "${DISPLAY-}" ] && eval "$("<abs-rk>" gui env
2>/dev/null)"`; the block is installed regardless of `gui.enabled`.
**Why**: Constitution X — the display is derivable from the supervisor's `@rk_gui_display` stamp,
so panes must read it at shell start rather than receive a pushed copy; the existing `rk gui env`
already is that read and its disabled path costs one settings-file read, so the block is inert and
cheap while off and needs no re-setup when the GUI is turned on later.
**Rejected**: `tmux set-environment -g DISPLAY` on `rk gui on` (a second source of truth swept
across every server and unset on `off`); exporting from agent hooks (subprocesses cannot set a
shell's env, and hooks carry only the underivable).
*Introduced by*: 260909-bbv1-gui-agent-verbs

#### Foreground `exec` is a process-replacing passthrough
**Decision**: `rk gui exec <cmd…>` resolves the command and `syscall.Exec`s it with the display
env; no wait, no timeout, the child's exit status is the caller's.
**Why**: a GUI application runs until the user closes it, so a wait-timeout would be wrong;
replacing the process hands the tty and signals to the command with no relay code — the `rk mux
guard` passthrough precedent. Constitution I's timeout rule governs subprocesses rk waits on.
**Rejected**: `cmd.Run()` with a relay of the exit code (adds a signal-forwarding layer for no
benefit); a bounded run (kills the app the agent just launched).
*Introduced by*: 260909-bbv1-gui-agent-verbs

#### `--detach` for agent launchers
**Decision**: `rk gui exec --detach` starts the command as its own session with stdio on
`/dev/null`, prints `started <pid> on :N`, and returns.
**Why**: agents' Bash tools time out on a foreground chromium; the study's launch-then-screenshot
loop needs a launcher that returns. `Setsid` keeps the app alive when the agent's shell exits.
**Rejected**: leaving it to `nohup … &` (works but every agent re-derives the incantation, and the
output line gives the pid for a later kill).
*Introduced by*: 260909-bbv1-gui-agent-verbs

#### Screenshots default to the OS temp dir, stdout carries only the path
**Decision**: `rk gui shot` writes `<TempDir>/rk-gui-shot-<ts>.png` unless `--out` is given and
prints only the absolute path.
**Why**: never litters the agent's cwd (usually a repo); the state dir under `$XDG_STATE_HOME`
is reserved for rk-owned droppable files and screenshots accumulate without GC; the
`rk present` prints-only-the-datum idiom lets an agent pipe the path straight into a file read.
**Rejected**: cwd default (repo litter); state-dir default (unbounded growth in a tenant with no
GC); PNG on stdout (agents read images by path).
*Introduced by*: 260909-bbv1-gui-agent-verbs

## Tasks

### Phase 1: Setup

- [x] T001 In `app/backend/cmd/rk/gui.go` extract the shared gate: `guiRequireReachable(ctx) (gui.Status, error)` returning the two existing errors (make them named constants `guiErrOff`/`guiErrNotRunning`), and `guiDarwinRefusal(verb string) error` rendering `gui <verb> is not supported on macOS in v1 — the GUI mirrors your live session view-only`; refactor `runGuiEnv` to call `guiRequireReachable` (behavior byte-identical — `TestGuiEnv*` stay green). Add a `guiGOOS = runtime.GOOS` package seam. <!-- R1, R4 -->

### Phase 2: Core Implementation

- [x] T002 Create `app/backend/cmd/rk/gui_exec.go`: `guiExecCmd` (`Use: "exec <cmd> [args…]"`, `Args: cobra.MinimumNArgs(1)`, `SilenceUsage`, `--detach`/`-d` bool flag, Long with the example block), `runGuiExec` applying the gate order darwin → off → not running, `guiExecEnv(base []string, display, socket string) []string` (pure; replaces existing `DISPLAY=`/`RK_GUI_SOCKET=` entries, appends otherwise), the foreground path via seams `guiExecLookPathFn = exec.LookPath` and `guiExecFn = syscall.Exec`, the `error: <cmd>: not found on PATH` exit-1 path. Register it on `guiCmd` before the `usageArgs` loop. <!-- R1, R2 -->
- [x] T003 In `gui_exec.go` add the `--detach` branch: `guiExecStartFn` seam (default builds an `exec.Cmd` with `Dir` inherited, `Env` from `guiExecEnv`, `SysProcAttr{Setsid: true}`, stdio nil ⇒ `/dev/null`, calls `Start()`, returns pid), prints `started <pid> on <display>` via `sink.Dataf`; start failure ⇒ `error: <cmd>: <reason>` exit 1. <!-- R3 -->
- [x] T004 Create `app/backend/cmd/rk/gui_exec_test.go` using the `withGuiCLISeams`/`seedGuiOn`/`bareCmd`/`exitCode` idioms from `gui_test.go`: off refusal, not-running refusal, darwin refusal (exec seam never called), env composition (dedupe + override, other vars preserved), foreground passthrough argv/path/env, `not found on PATH` exit 1, `--detach` start-seam args + stdout line + exit 0, tree registration (`exec` under `gui` in `TestGuiTreeRegistered`'s style). <!-- R1, R2, R3 -->
- [x] T005 Create `app/backend/cmd/rk/gui_shot.go`: `guiShotCmd` (`Use: "shot"`, `Args: cobra.NoArgs`, `--out`/`-o`), `runGuiShot` with the shared gate (darwin message uses `guiDarwinRefusal("shot")`), pure `guiShotArgv(lookPath, display, out) (stages [][]string, tool string, ok bool)` implementing the ladder import → scrot → xwd+convert (scrot stage carries `DISPLAY=:N` via a returned env hint or a parallel struct field), `guiShotRunFn(ctx, stages, env)` default running the stages under `guiShotTimeout = 15 * time.Second` with `exec.CommandContext`, piping stage 1 stdout into stage 2 stdin when two stages exist, capturing stderr for the failure message; default path `filepath.Join(os.TempDir(), "rk-gui-shot-"+guiShotNowFn().Format("20060102-150405")+".png")`; `--out` → `filepath.Abs` + `MkdirAll(Dir, 0755)`; success prints the path with `sink.Dataf`. Register on `guiCmd`. <!-- R4, R5, R6 -->
- [x] T006 Create `app/backend/cmd/rk/gui_shot_test.go`: gate refusals (off / not running / darwin, runner never called), ladder table test (import only; scrot only; xwd+convert; xwd without convert ⇒ falls through; none ⇒ `ok=false`), argv shapes per tool, no-tool error text + exit 1, runner failure text + exit 1, default path shape from a fixed `guiShotNowFn`, `--out` parent creation + absolute path echo, tree registration. <!-- R4, R5, R6 -->
- [x] T007 In `app/backend/cmd/rk/agent_setup.go` add the gui display block family: constants `guiDisplayBlockBegin = "# >>> rk gui display >>>"`, `guiDisplayBlockEnd = "# <<< rk gui display <<<"`, `guiDisplayBlock(rkPath string) string` (the 3-line block with the double-quoted absolute path), and `applyGuiDisplayBlocks(sink, reader, home, zdotdir, rkPath string, uninstall bool, cons consent) error` mirroring `applyTmuxGuardPathBlocks` line-for-line (prefix messages `gui display:`; dry-run diff header `gui display: will add/remove the rk gui display block in <path>`; placement wording; consent; mode-preserving write). Call it from `runAgentSetup` after `applyTmuxShim` (on uninstall pass `rkPath=""` — removal needs no path). Update the file-header comment's "two artifact families" paragraph to three. <!-- R7, R8 -->
- [x] T008 In `app/backend/cmd/rk/agent_setup_test.go` add tests following the `TestTmuxShimPathBlock*` idiom over a temp home/zdotdir: install writes the block into `.zshenv` + `.bashrc` and not a missing `.bash_profile`; existing `.bash_profile` gets it; idempotent second run reports already-present and is byte-stable; uninstall strips exactly the block leaving user lines intact; `--dry-run` shows the diff and writes nothing; malformed block (begin without end) is skipped with the note; the block text pins the three guards (`$TMUX_PANE`, `${DISPLAY-}`, `2>/dev/null`) and embeds the given rk path double-quoted; the gui block is written even when the shim write was declined. <!-- R7, R8 -->

### Phase 3: Integration & Edge Cases

- [x] T009 In `app/backend/cmd/rk/gui.go` extend `guiCmd.Long`'s `Subcommands:` list with `exec` ("Run a command on the GUI display (DISPLAY set); --detach to launch and return") and `shot` ("Screenshot the display to a PNG and print its path"); extend `guiEnvCmd.Long` with the sentence about `rk agent setup` installing this eval into shell startup files; verify `TestGuiTreeRegistered` covers the new children. <!-- R11 -->
- [x] T010 Write `docs/site/skill/gui.md` (≤150 lines, static-only, structured like `docs/site/skill/code.md`: intro + gate block, `## rk gui env`, `## rk gui exec`, `## rk gui shot`, `## Recipe: the screenshot loop` with `xdotool`, `## Exit codes`, `## Gotchas` incl. never run `rk gui on` yourself); add `sync "docs/site/skill/gui.md" "$DEST_DIR/gui.md"` to `scripts/sync-skill.sh` and run the script; in `app/backend/cmd/rk/skill.go` add the `//go:embed skill/gui.md` var `skillGuiTopic` with the standard doc comment and the `"gui": skillGuiTopic` map row; add `gui` rows to the three tables in `skill_test.go`. <!-- R9 -->
- [x] T011 Edit `docs/site/skill.md`: add the `## Topics` bullet `**drive and screenshot the host GUI display** (launch apps with DISPLAY set, take a PNG the human also sees in the GUI tile) → \`rk skill gui\`` and a `## Capabilities` bullet for `rk gui exec <cmd…>` / `rk gui shot [--out f.png]` (gated on the user's `gui.enabled` switch — exit 1 with the hint when off; depth `rk skill gui`); re-run `scripts/sync-skill.sh`; confirm ≤150 lines and drift test green. <!-- R10 -->
- [x] T012 [P] Edit `fab/plans/sahil/26-09-09-gui-surface.md`: C2 row status → `Done`; C4 row → change folder `260909-bbv1-gui-agent-verbs`, PR cell `(PR pending)`, status `in review`; "Status (2026-09-09)" paragraph → C2 Done (PR #892 merged), C3 ∥ C4 in progress. <!-- R12 -->

### Phase 4: Polish

- [x] T013 Run `cd app/backend && gofmt -l ./cmd/rk && go vet ./cmd/rk/ && go test ./cmd/rk/ ./internal/gui/` then `go test ./...`; run `bash scripts/sync-skill.sh` once more and confirm `git status` shows the synced copies identical to canon; if this VM has the GUI on (`rk gui status`), smoke `rk gui shot --out /tmp/rk-c4-smoke.png` and `rk gui exec --detach xterm` (or skip with a note when off — never run `rk gui on`). <!-- R1, R2, R3, R4, R5, R6, R9, R10 -->

## Execution Order

- T001 blocks T002–T006 (shared gate helpers).
- T002 blocks T003; T005 is independent of T002/T003.
- T007 blocks T008. T010 blocks T011 (both edit the synced bundle set).
- T012 is independent and may run any time.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk gui exec` refuses off / not-running / darwin with the exact strings, exit 1, before any exec
- [x] A-002 R2: foreground `exec` calls `syscall.Exec` with the resolved path, the caller's argv, and an env carrying exactly one `DISPLAY=<display>` and one `RK_GUI_SOCKET=<socket>`
- [x] A-003 R3: `--detach` starts a `Setsid` session with `/dev/null` stdio and prints `started <pid> on <display>`
- [x] A-004 R4: `rk gui shot` applies the same gate with the shot-specific darwin message
- [x] A-005 R5: the ladder resolves import → scrot → xwd+convert as a pure function with the exact argv shapes; runs are bounded by `guiShotTimeout`
- [x] A-006 R6: default path is `<TempDir>/rk-gui-shot-<YYYYMMDD-HHMMSS>.png`; `--out` is made absolute with its parent created; stdout carries only the path
- [x] A-007 R7: `rk agent setup` upserts the gui display block into every `tmuxGuardStartupFiles` file and removes it on `--uninstall`, reusing the marker-block machinery and consent flow
- [x] A-008 R8: the block text carries the `$TMUX_PANE`, `${DISPLAY-}`, and `2>/dev/null` guards and embeds no GUI state
- [x] A-009 R9: `rk skill gui` prints `docs/site/skill/gui.md` byte-identically; `gui` appears in `rk skill topics` and the `Topics:` help line; the page is ≤150 lines
- [x] A-010 R10: the core bundle carries the topic-index and capability bullets and stays ≤150 lines with the synced copy identical
- [x] A-011 R11: `rk gui --help` lists `exec` and `shot`; `rk gui env --help` mentions the installed block
- [x] A-012 R12: the plan's C4 row names `260909-bbv1-gui-agent-verbs`

### Behavioral Correctness

- [x] A-013 R1: `rk gui env`'s behavior and error strings are unchanged after the gate extraction (existing `TestGuiEnv*` pass unmodified)
- [x] A-014 R2: an existing `DISPLAY` in the caller's env is overridden by `exec`, not duplicated

### Scenario Coverage

- [x] A-015 R5: a host with only `xwd` (no `convert`) falls through to the no-tool error rather than producing a non-PNG
- [x] A-016 R7: a second `rk agent setup --yes` is byte-stable and reports the block already present per file
- [x] A-017 R7: the gui block is written even when the shim write was declined (independent of the PATH block's shim gate)

### Edge Cases & Error Handling

- [x] A-018 R2: unknown program ⇒ `error: <cmd>: not found on PATH`, exit 1; missing command word ⇒ exit 2
- [x] A-019 R5: a failing tool ⇒ `error: <tool> failed: <stderr tail>`, exit 1; no tool ⇒ the apt hint, exit 1
- [x] A-020 R7: a malformed marker block (begin without end) leaves the file untouched with a skip note; `--dry-run` writes nothing

### Code Quality

- [x] A-021 Pattern consistency: new verbs follow the `gui.go` package-seam + `newSink` + `usageArgs` idioms; tests use the `withGuiCLISeams`/`bareCmd`/`exitCode` helpers
- [x] A-022 No unnecessary duplication: one shared gate helper serves `env`/`exec`/`shot`; the block installer reuses `upsertMarkerBlock`/`removeMarkerBlock`/`markerBlockBounds`/`renderArtifactDiff`/`authorizeWrite`
- [x] A-023 Go backend: every waited-on subprocess uses `exec.CommandContext` with a timeout; no shell strings anywhere
- [x] A-024 Tests included for every new behavior (code-quality.md principle); no comment narration or change-id citations in code comments
- [x] A-025 Magic strings/numbers are named constants (`guiShotTimeout`, block markers, error strings)

### Security

- [x] A-026 R2: `exec` passes only the caller's own argv (their shell authority) and never a shell string; the display env values come from the rk-owned stamp
- [x] A-027 R7: the block embeds only the `validateHookPath`-validated absolute rk path, double-quoted

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. (The gate extraction in `runGuiEnv`/`runGuiRestart` replaced the inline refusal strings with the shared `guiErrOff`/`guiRequireReachable` in the same edit; no dead code left behind.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Gate helper names `guiRequireReachable`/`guiDarwinRefusal`, error constants `guiErrOff`/`guiErrNotRunning`; the darwin check precedes the status read | Names follow the file's `gui*` prefix idiom; checking OS first avoids a needless tmux/probe round-trip on macOS | S:60 R:95 A:90 D:80 |
| 2 | Confident | `--detach` stdout line is exactly `started <pid> on <display>`; LookPath failure exits 1 (not 127) | Toolkit exit convention 0/1/2; one bounded data line per Principle 9 | S:55 R:90 A:85 D:70 |
| 3 | Confident | `scrot` stage receives `DISPLAY=:N` via env (scrot has no display flag); ladder order import → scrot → xwd+convert | scrot reads `$DISPLAY` only; order is trivially reversible | S:60 R:95 A:85 D:70 |
| 4 | Confident | The gui display block is applied on uninstall even with `rkPath=""` (removal needs no path), and on install regardless of the shim outcome | Mirrors the PATH block's uninstall independence; the block fronts nothing so the shim gate does not apply | S:65 R:90 A:85 D:80 |
| 5 | Confident | Plan-file C4 PR cell reads `(PR pending)` at apply and is replaced with the URL by the ship step | The URL does not exist before `/git-pr`; the row must still be filled in the same PR | S:70 R:95 A:90 D:85 |

5 assumptions (0 certain, 5 confident, 0 tentative).
