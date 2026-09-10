# Plan: GUI session starters and the `rk gui wm` verb (S1 / L1)

**Change**: 260910-zsui-gui-session-starters-and-wm-verb
**Intake**: `intake.md`

## Requirements

### GUI backend: session-starter table and the D-Bus wrap

#### R1: Session starters run under `dbus-run-session`
`internal/gui/backend.go` MUST hold a `sessionStarters` set — `startlxqt`,
`lxqt-session`, `startxfce4`, `xfce4-session`, `startplasma-x11`,
`x-session-manager` — and `WMArgv(name)` MUST return
`["dbus-run-session", "--", name]` for every member. Every non-member keeps
its current argv: `icewm-session` stays `--nobg --notray`, any other bare WM
runs unwrapped. The exported predicate `IsSessionStarter(name string) bool`
MUST report set membership so the status summary (R5), the supervisor (R4),
and S3's candidate labeling share one table.

- **GIVEN** `WMArgv` is called with `startlxqt`
- **WHEN** the argv is built
- **THEN** it is `["dbus-run-session", "--", "startlxqt"]`
- **AND** `WMArgv("openbox")` is `["openbox"]` and `WMArgv("icewm-session")` is `["icewm-session", "--nobg", "--notray"]`
- **AND** `IsSessionStarter` is true for all six members and false for `openbox`, `icewm-session`, and `""`

### GUI backend: per-DE install hints

#### R2: `DEInstallHint` is package-manager-aware wording for a session starter
`internal/gui/hint.go` MUST add `DEInstallHint(name string, lookPath func(string) (string, error)) string`
returning, for the LXQt names (`startlxqt`, `lxqt-session`) and the XFCE
names (`startxfce4`, `xfce4-session`), a line worded for `PackageManager(lookPath)`:

| Manager | LXQt | XFCE |
|---------|------|------|
| apt | `sudo apt install --no-install-recommends lxqt-core` | `sudo apt install --no-install-recommends xfce4` |
| dnf | `sudo dnf install lxqt-session lxqt-panel lxqt-config pcmanfm-qt qterminal` | `sudo dnf install xfce4-session xfce4-panel xfce4-settings xfdesktop xfce4-terminal` |
| pacman | `sudo pacman -S lxqt` | `sudo pacman -S xfce4` |
| (none) | `install lxqt with your package manager` | `install xfce4 with your package manager` |

The dnf line MUST NOT use the `@lxqt-desktop` group. For any other name
(`startplasma-x11`, `x-session-manager`, a bare WM) and on every non-Linux
GOOS the function MUST return `""`. A shared helper
`PinInstallHint(name, lookPath)` MUST return `DEInstallHint` when non-empty
and `WMInstallHint(lookPath)` otherwise — the one fallback both the verb (R3)
and the supervisor (R4) print. rk never executes a package manager; these are
strings only.

- **GIVEN** `apt-get` is on PATH
- **WHEN** `DEInstallHint("startlxqt", lookPath)` is called
- **THEN** it returns `sudo apt install --no-install-recommends lxqt-core`
- **AND** `DEInstallHint("openbox", lookPath)` returns `""` while `PinInstallHint("openbox", lookPath)` returns `WMInstallHint`'s `sudo apt install --no-install-recommends icewm`

### CLI: the `rk gui wm` verb

#### R3: `rk gui wm [auto|icewm|lxqt|xfce|<binary>] [--restart] [--force]`
A new `cmd/rk/gui_wm.go` MUST register `wm` on the `gui` family (added before
the `usageArgs` wrap loop so arg-count violations exit 2) with `Args:
cobra.MaximumNArgs(1)` and this behavior:

- **Alias map**: `auto` ⇒ `""`, `icewm` ⇒ `icewm-session`, `lxqt` ⇒ `startlxqt`, `xfce` ⇒ `startxfce4`; any other argument is a literal binary name.
- **Name validation**: a literal name MUST be a bare binary name — non-empty, no `/`, no whitespace. Anything else is a usage error (exit 2): `window manager name must be a bare binary name`.
- **No argument** (read-only, never writes): print the pin and the live rung from `gatherGUIStatus` (`settings.Load().GUIWM` plus the `@rk_gui_wm` stamp the status document already carries). Copy: `wm: auto → <wm> (running)` / `wm: auto (running bare)` when the stamp is empty / `wm: auto (not running)` when unreachable; pinned: `wm: <pin> (pinned; running)` when the stamp equals the pin, `wm: <pin> (pinned; running <wm>)` when it differs, `wm: <pin> (pinned; not running)` when unreachable. Exit 0 in every case — this is state, not a verdict.
- **PATH check**: for a non-empty resolved name, `guiLookPathFn(name)`; on a miss refuse with `error: <name> not on PATH — <PinInstallHint> (pass --force to pin anyway)`, exit 1, and write nothing. With `--force` the pin is written regardless. `auto` never probes PATH.
- **Write path**: `guiSettingsLoad()` → `GUIWM = name` → `guiSettingsSave()` — the identical seams `rk gui on` uses; no new settings machinery. A save error is `saving settings: <err>`, exit 1.
- **Without `--restart`**: print `set gui.wm=<name> — takes effect on rk gui restart (kills apps on the display)` (for `auto`: `set gui.wm= (ladder) — takes effect on rk gui restart (kills apps on the display)`), exit 0 — regardless of `gui.enabled`.
- **With `--restart`**: print `set gui.wm=<name>` (or `set gui.wm= (ladder)`) after the write, then call `runGuiRestart` and let it print its own lines (`restarted (<bin> <display>)` + `  window manager: <wm>`). Its refusals propagate unchanged: gui off ⇒ `gui is off — turn it on with 'rk gui on'` exit 1; daemon down ⇒ the existing daemon-down error, exit 1.
- **Exit codes**: `0` successful set (with or without restart); `1` PATH refusal, save error, restart refusal (off / daemon down) or restart failure; `2` usage (two positionals, an unknown flag, an invalid literal name).

- **GIVEN** `startlxqt` is not on PATH and `--force` is absent
- **WHEN** `rk gui wm lxqt` runs
- **THEN** stderr carries `startlxqt not on PATH — sudo apt install --no-install-recommends lxqt-core (pass --force to pin anyway)`, exit 1, and `gui.wm` is unchanged
- **GIVEN** `startlxqt` is on PATH (or `--force` is passed) and gui is on with the daemon up
- **WHEN** `rk gui wm lxqt --restart` runs
- **THEN** `gui.wm` is `startlxqt` on disk, the restart seam is called once, and stdout carries `set gui.wm=startlxqt` followed by the restart's lines
- **GIVEN** gui is off
- **WHEN** `rk gui wm lxqt` runs (no `--restart`)
- **THEN** the pin is written and the command exits 0 with the takes-effect line
- **GIVEN** gui is off
- **WHEN** `rk gui wm lxqt --restart` runs
- **THEN** the pin is written, the restart refuses with the gui-off error, exit 1
- **GIVEN** no argument
- **WHEN** `rk gui wm` runs with an empty pin and a `icewm-session` stamp
- **THEN** stdout is `wm: auto → icewm-session (running)` and nothing is written

### Supervisor: DE-aware pin-miss and session-aware WM line

#### R4: Supervisor log lines name the session and the DE hint
In `cmd/rk/gui_supervise.go`, `guiPinMissLine` MUST gain the install hint:
`gui: gui.wm=<pin> not on PATH; falling back to the ladder — <PinInstallHint(pin)>`
(DE hint for a session-starter pin, `WMInstallHint` for a bare-WM pin). `guiWMLine`
MUST render `gui: window manager <name> (session under dbus-run-session)` when
`gui.IsSessionStarter(name)`; the icewm rung's `(config <dir>[, seeded preferences])`
line and the bare-WM `gui: window manager <name>` line are unchanged. No
`defaults …, seeded` segment exists in this change (S5 adds it).

- **GIVEN** `gui.wm=startlxqt` and `startlxqt` is not on PATH under apt
- **WHEN** the supervisor resolves the WM
- **THEN** it logs `gui: gui.wm=startlxqt not on PATH; falling back to the ladder — sudo apt install --no-install-recommends lxqt-core`
- **GIVEN** `gui.wm=xfwm4` is not on PATH under apt
- **WHEN** the supervisor resolves the WM
- **THEN** it logs `gui: gui.wm=xfwm4 not on PATH; falling back to the ladder — sudo apt install --no-install-recommends icewm`
- **GIVEN** the resolved WM is `startlxqt`
- **WHEN** the supervisor logs the WM line
- **THEN** it is `gui: window manager startlxqt (session under dbus-run-session)` and the WM was started with argv `["dbus-run-session", "--", "startlxqt"]`

### CLI: status summary suffix

#### R5: `(session)` suffix on the human summary only
`guiOnSummary` in `cmd/rk/gui.go` MUST append ` (session)` to the WM segment
when `gui.IsSessionStarter(wm)` — `on (Xtigervnc, :10, 1920x1080, 1 viewer, startlxqt (session))` —
so both `rk gui status` and the doctor row carry it; a bare WM renders as
today. `guiWMLines` (the `on`/`restart` chatter) SHOULD append the same
` (session)` to its `window manager:` line. `--json`'s `wm` field MUST stay
the plain binary name.

- **GIVEN** a reachable status with `WM: "startlxqt"`
- **WHEN** `rk gui status` renders
- **THEN** the line ends `startlxqt (session))` and `rk gui status --json` has `"wm": "startlxqt"`
- **AND** a status with `WM: "icewm-session"` renders `icewm-session)` with no suffix

### GUI backend: running-apps exclusion

#### R6: DE daemons are excluded from the apps list by comm name
`wmHelperComms` in `internal/gui/apps_linux.go` MUST additionally contain
`lxqt-session`, `lxqt-panel`, `lxqt-runner`, `lxqt-globalkeysd`,
`lxqt-notificationd`, `lxqt-policykit-agent`, `pcmanfm-qt`, `xfce4-session`,
`xfce4-panel`, `xfdesktop`, `xfsettingsd`, `xfce4-notifyd`,
`xfce4-power-manager`, `dbus-daemon`, `dbus-run-session`. The mechanism is
unchanged: filter on trimmed `comm` after the pid excludes, by name never by
ancestry.

- **GIVEN** a fake procRoot with `lxqt-panel`, `lxqt-session`, `dbus-daemon`, and `xterm` all on `DISPLAY=:10`
- **WHEN** `RunningApps(procRoot, ":10", nil)` runs
- **THEN** only `xterm ×1` is listed

### Docs: spec, skill page, help

#### R7: `docs/specs/gui.md` documents the wrap rule and the verb
§ The supervisor MUST replace the `x-session-manager keeps its dbus-run-session wrap`
sentence with the session-starter set and the rule that every member runs
under `dbus-run-session -- <name>` while bare WMs run unwrapped. A new
`## Switching desktops` section MUST follow § The supervisor, naming
`rk gui wm [auto|icewm|lxqt|xfce|<binary>] [--restart] [--force]`, the alias
map, the PATH refusal + `--force`, and the three § UX examples
(`rk gui wm lxqt` refusal, `rk gui wm lxqt --restart`, `rk gui wm auto --restart`).
§ Agent verbs is untouched (`wm` is a human verb).

- **GIVEN** the spec after this change
- **WHEN** a reader looks for how a pinned DE gets its session bus
- **THEN** § The supervisor states the table rule and § Switching desktops names `rk gui wm`

#### R8: Skill page trim first, then one gotcha, synced and within budget
`docs/site/skill/gui.md` MUST be trimmed before anything is added: merge the
`## rk gui env` and `## rk gui exec` sections into one section with one code
block and one prose paragraph; merge the `shot` default-path code line and
the `--out` code line into one line; trim further (e.g. fold the IceWM
profile section to two lines) until the file is **≤ 137 lines** (≥ 8 freed
from 145). Then add exactly one gotcha bullet: the desktop may be IceWM or a
full desktop environment (LXQt/XFCE); the agent verbs work identically; on a
full desktop `rk gui windows` lists the DE's panel as a window — filter by
`app` when looking for user apps. Final length MUST be ≤ 138. Run
`scripts/sync-skill.sh` so `app/backend/cmd/rk/skill/gui.md` is byte-identical;
`skill_test.go` MUST pass.

- **GIVEN** the edited page
- **WHEN** `wc -l docs/site/skill/gui.md` runs
- **THEN** it prints ≤ 138 and `go test ./cmd/rk -run TestSkill` passes

#### R9: `rk gui --help` lists `wm` under `display`
`guiCmd.Long`'s `Subcommands:` block MUST read
`display: on off status env restart exec launch open wm`, and the `wm`
command MUST carry a `Long` block. `TestGuiTreeRegistered` MUST expect `wm`.

- **GIVEN** `rk gui --help`
- **WHEN** the Subcommands block renders
- **THEN** `wm` appears exactly once, in the `display:` row

### Supervisor: process-group launch and teardown for session starters

#### R10: A session starter runs in its own process group and is stopped as a group
Binding from the L0 spike (`fab/plans/sahil/26-09-10-gui-lxqt-desktop.md`
§ L0 verdict, point 4): SIGTERM or SIGKILL to `dbus-run-session` alone exits
only the wrapper — `dbus-daemon`, `lxqt-session`, and every module reparent
to PID 1 and keep running; `kill -TERM -- -<pgid>` on the wrapper's process
group exits everything, `dbus-daemon` included. Therefore:

- `internal/gui/backend.go` MUST expose `WMOwnsProcessGroup(argv []string) bool`,
  true exactly when `IsSessionStarter(WMName(argv))` — the launch/teardown
  policy lives beside the wrap rule, not in the supervisor.
- `guiSuperviseStartWM` in `cmd/rk/gui_supervise.go` MUST gain an
  `ownGroup bool` parameter. When true the child starts with
  `SysProcAttr{Setpgid: true}` (its pid is the pgid), `cmd.Cancel` is
  overridden to SIGTERM the **group** (`syscall.Kill(-pid, SIGTERM)`) so a
  context cancel never SIGKILLs only the direct child, and `cmd.WaitDelay`
  is `guiWMStopTimeout`. When false the launch is unchanged.
- A new `guiStopWM(cmd *exec.Cmd, ownGroup bool)` MUST replace
  `guiKillAndWait(wm)` at every WM teardown site (signal trap, backend-exit,
  and the backend-exited-while-signalled path). nil-safe. `ownGroup` ⇒
  SIGTERM the group, wait up to `guiWMStopTimeout` (package var, default
  5 s — SIGTERM first so `lxqt-session` runs its module shutdown), then
  SIGKILL the group if it has not exited, then reap. Not `ownGroup` ⇒
  today's `Process.Kill` + `Wait`. The backend keeps `guiKillAndWait`.
- The stop path logs nothing new on the happy path; an escalation to
  SIGKILL logs `gui: window manager <name> did not exit within <d>; killing its process group`.

- **GIVEN** the resolved WM is `startlxqt`
- **WHEN** the supervisor starts it
- **THEN** `guiSuperviseStartWM` is called with `ownGroup == true` and the real seam sets `Setpgid` (the child's pgid equals its pid)
- **GIVEN** the resolved WM is `icewm-session` or `openbox`
- **WHEN** the supervisor starts it
- **THEN** `ownGroup == false` and the launch argv/env are as before
- **GIVEN** a group-owning child whose tree includes a grandchild (`sh -c 'sleep 30 & wait'`)
- **WHEN** `guiStopWM(cmd, true)` runs
- **THEN** the whole group is gone afterwards (`kill(-pgid, 0)` reports ESRCH) and the call returned well within `guiWMStopTimeout`
- **GIVEN** a group-owning child that ignores SIGTERM (`sh -c 'trap "" TERM; while :; do sleep 1; done'`) and `guiWMStopTimeout` shrunk to 200 ms
- **WHEN** `guiStopWM(cmd, true)` runs
- **THEN** the group is gone within ~1 s (SIGKILL escalation) and the escalation line was logged

### Non-Goals

- LXQt seeding (`XDG_CONFIG_DIRS`, the four config files) — S5/L2.
- The Settings-dialog / palette desktop picker and `wm_candidates` — S3/L3.
- XFCE/KDE/GNOME seeds, Wayland sessions, per-viewer DEs, installing packages.

### Design Decisions

#### Session starters generalize the D-Bus wrap rule
**Decision**: One `sessionStarters` table beside the ladder; `WMArgv` wraps every member in `dbus-run-session --`, and `IsSessionStarter` exposes membership.
**Why**: A pinned desktop environment without a session bus is the first failure a user hits (panel, tray, and policy agents fail silently); `x-session-manager` already had the wrap, so the rule generalizes rather than special-casing each DE.
**Rejected**: Per-DE `case` arms in `WMArgv` — each new DE would need a code change in three places (argv, status suffix, S3 labeling).
*Introduced by*: 260910-zsui-gui-session-starters-and-wm-verb

#### `rk gui wm` is the CLI face of the existing `gui.wm` key
**Decision**: The verb writes through the same `settings.Load → apply → Save` seams `rk gui on|off` use, probes PATH before pinning, and chains `--restart` into `runGuiRestart` verbatim.
**Why**: Constitution IV's single settings *surface* is the dialog; a CLI setter for a key the gui verbs own is the same carve-out `on|off` already uses. Reusing the restart path keeps one destructive verb with one set of refusals.
**Rejected**: A separate `rk gui wm` daemon route or a new settings field — no schema change is needed, and a second write path would drift.
*Introduced by*: 260910-zsui-gui-session-starters-and-wm-verb

#### Session starters are stopped as a process group, SIGTERM then SIGKILL
**Decision**: A session starter launches with `Setpgid` and teardown signals its process group — SIGTERM first, SIGKILL after a bounded wait (`guiWMStopTimeout`, 5 s). Bare WMs keep the direct-child kill.
**Why**: Under the `dbus-run-session` wrap the direct child is the wrapper; killing it alone reparents `dbus-daemon`, `lxqt-session`, and every module to PID 1 and leaves the desktop running (L0 verdict § 4). SIGTERM first lets `lxqt-session` run its module shutdown; the group also cleans up `dbus-daemon`, which has no X connection and would otherwise outlive the display.
**Rejected**: Signalling `lxqt-session` by name (leaks `dbus-daemon`, and needs per-DE knowledge of the session binary); `Process.Kill` on the wrapper (the orphaning bug); a group kill for every WM (bare WMs are single processes today and the narrower rule matches the L0 finding).
*Introduced by*: 260910-zsui-gui-session-starters-and-wm-verb

## Tasks

### Phase 1: Setup

- [x] T001 Add `sessionStarters` and `IsSessionStarter` to `app/backend/internal/gui/backend.go`; generalize `WMArgv`'s `x-session-manager` arm into a set lookup; extend `TestWMArgv` and add `TestIsSessionStarter` in `app/backend/internal/gui/backend_test.go` <!-- R1 -->
- [x] T002 [P] Add `DEInstallHint` and `PinInstallHint` to `app/backend/internal/gui/hint.go`; add `TestDEInstallHint` (4 managers × lxqt/xfce, the `""` cases, off-linux) and `TestPinInstallHintFallsBackToWM` in `app/backend/internal/gui/hint_test.go` <!-- R2 -->
- [x] T003 [P] Widen `wmHelperComms` in `app/backend/internal/gui/apps_linux.go` with the L-D6 names; add a test in `app/backend/internal/gui/apps_linux_test.go` with `lxqt-panel`, `lxqt-session`, `dbus-daemon`, `xterm` → only `xterm` <!-- R6 -->

### Phase 2: Core Implementation

- [x] T004 Create `app/backend/cmd/rk/gui_wm.go`: `guiWmCmd` (Use `wm [auto|icewm|lxqt|xfce|<binary>]`, Long block, `--restart`/`--force` flags, `Args: cobra.MaximumNArgs(1)`), alias map, bare-name validation (usage error), the no-arg read-only report via `gatherGUIStatus`, the PATH check with `--force`, the `guiSettingsLoad`/`guiSettingsSave` write, the takes-effect line, and the `runGuiRestart` chain; register it in `cmd/rk/gui.go`'s `init()` before the `usageArgs` loop <!-- R3 -->
- [x] T005 Add `app/backend/cmd/rk/gui_wm_test.go` using `withGuiCLISeams`: alias table; bare-name validation → `exitUsage`; two positionals → `exitUsage`; PATH miss refuses with the DE hint and leaves `gui.wm` unchanged; `--force` pins on a miss; PATH hit writes `gui.wm` and prints the takes-effect line (gui off, no restart → exit 0); `--restart` chains (restart counter 1, `set gui.wm=startlxqt` then `restarted …`); `--restart` while off → gui-off error, pin still written; `auto` prints `set gui.wm= (ladder) …` and never probes PATH; no-arg report for auto/running, auto/bare, auto/not-running, pinned-equal, pinned-differs, pinned/not-running <!-- R3 -->
- [x] T006 In `app/backend/cmd/rk/gui_supervise.go`: `guiPinMissLine(pin, hint)` appends ` — <hint>` and the call site passes `gui.PinInstallHint(pin, guiSuperviseLookPath)`; `guiWMLine` renders the `(session under dbus-run-session)` suffix via `gui.IsSessionStarter`; update `TestGuiSuperviseLineFormats` and `TestGuiSuperviseLinuxPinMissFallsBackToLadder` (bare-WM pin → icewm hint) and add a session-starter pin-miss test and a `startlxqt`-resolves test asserting the WM argv is the dbus wrap and the log line carries the suffix, in `app/backend/cmd/rk/gui_supervise_test.go` <!-- R4 -->
- [x] T007 In `app/backend/cmd/rk/gui.go`: `guiOnSummary` appends ` (session)` to the wm segment when `gui.IsSessionStarter(wm)`; `guiWMLines` appends the same suffix to its `window manager:` chatter; add `TestGuiStatusSessionStarterSuffix` (summary line has `startlxqt (session))`, `--json` wm stays `startlxqt`, bare WM has no suffix) in `app/backend/cmd/rk/gui_test.go` <!-- R5 -->

### Phase 3: Integration & Edge Cases

- [x] T008 Update `guiCmd.Long` in `app/backend/cmd/rk/gui.go` so the `display:` row ends with `wm`; add `"wm": false` to `TestGuiTreeRegistered`'s want map; confirm `TestGuiHelpGroupsNewVerbs` still passes <!-- R9 -->
- [x] T009 Run `cd app/backend && go test ./...` and `go vet ./...`; fix any failure before moving to docs <!-- R3 -->

### Phase 4: Polish

- [x] T010 [P] Edit `docs/specs/gui.md`: rewrite the § The supervisor wrap sentence to the session-starter rule; insert `## Switching desktops` (verb, aliases, refusal + `--force`, the three UX examples) between § The supervisor and § The switch <!-- R7 -->
- [x] T011 [P] Trim `docs/site/skill/gui.md` to ≤ 137 lines (merge the env + exec sections; merge the two shot code lines; fold further as needed), then add the one DE gotcha bullet (final ≤ 138); run `scripts/sync-skill.sh`; run `cd app/backend && go test ./cmd/rk -run 'TestSkill'` <!-- R8 -->
- [x] T012 Final gates: `cd app/backend && go test ./...`, then `just test` and `just build` from the repo root; record any skipped live-VM acceptance (LXQt not installed) in `## Notes` <!-- R3 -->

### Phase 5: Rework — process-group teardown (operator correction from the L0 verdict)

- [x] T013 Add `WMOwnsProcessGroup(argv []string) bool` to `app/backend/internal/gui/backend.go` (true iff `IsSessionStarter(WMName(argv))`) with a table test in `backend_test.go` (dbus-wrapped `startlxqt` → true; `icewm-session --nobg --notray`, `openbox` → false) <!-- R10 -->
- [x] T014 In `app/backend/cmd/rk/gui_supervise.go`: add `guiWMStopTimeout` (5 s var); extend `guiSuperviseStartWM` with `ownGroup bool` (Setpgid, `cmd.Cancel` → group SIGTERM, `cmd.WaitDelay`); add `guiStopWM(cmd, ownGroup)` (group SIGTERM → bounded wait → group SIGKILL → reap; escalation log line; nil-safe) and call it at all three WM teardown sites; pass `gui.WMOwnsProcessGroup(wmArgv)` at the launch site and keep the flag beside `wm` for teardown <!-- R10 -->
- [x] T015 Tests in `app/backend/cmd/rk/gui_supervise_test.go`: `guiWMStartRec` records `ownGroup`; assert true in `TestGuiSuperviseLinuxSessionStarterResolvesUnderDBus`, false in the icewm and pin-miss→openbox tests; add `TestGuiSuperviseStartWMOwnGroupSetsPgid` (real seam starts `sleep 30` with ownGroup; `syscall.Getpgid(pid) == pid`; then `guiStopWM`), `TestGuiStopWMSignalsWholeGroup` (`sh -c 'sleep 30 & wait'`; group gone, returned fast), and `TestGuiStopWMEscalatesToSIGKILL` (TERM-ignoring sh, `guiWMStopTimeout` = 200 ms; group gone, escalation line logged). Unix-only build tag if the package is not already unix-only <!-- R10 -->
- [x] T016 Docs + gates: `docs/specs/gui.md` § The supervisor gains one sentence on the process-group launch/teardown rule for session starters; then `cd app/backend && go vet ./... && go test ./...`, `just test-backend`, `just build` (skip `just test`'s e2e phase — no frontend files change in this rework) <!-- R10 -->

## Execution Order

- T001 and T002 block T004, T006, T007 (they import `IsSessionStarter` / `PinInstallHint`)
- T004 blocks T005 and T008
- T009 gates Phase 4; T012 is last for the original scope
- Phase 5 (T013–T016) is the operator-requested rework: T013 blocks T014; T014 blocks T015; T016 is last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `WMArgv` wraps all six session starters in `dbus-run-session --` and leaves `icewm-session` and bare WMs unchanged; `IsSessionStarter` is exported and table-tested
- [x] A-002 R2: `DEInstallHint` returns the eight LXQt/XFCE lines exactly as tabled, `""` for other names and off-linux; `PinInstallHint` falls back to `WMInstallHint`
- [x] A-003 R3: `rk gui wm` exists with the alias map, no-arg report, PATH refusal, `--force`, the `Load → GUIWM → Save` write, and `--restart` chaining into `runGuiRestart`
- [x] A-004 R4: the supervisor's pin-miss line carries `PinInstallHint` and the WM line carries `(session under dbus-run-session)` exactly when `IsSessionStarter`
- [x] A-005 R5: `guiOnSummary` appends `(session)` for a session starter; `--json` `wm` is unchanged
- [x] A-006 R6: `wmHelperComms` contains all fifteen L-D6 names
- [x] A-007 R7: `docs/specs/gui.md` § The supervisor states the wrap rule and a `## Switching desktops` section names the verb and the three examples
- [x] A-008 R8: `docs/site/skill/gui.md` is ≤ 138 lines with exactly one new DE gotcha, and `app/backend/cmd/rk/skill/gui.md` is byte-identical
- [x] A-009 R9: `rk gui --help` lists `wm` once, under `display:`

### Behavioral Correctness

- [x] A-010 R1: `WMArgv("x-session-manager")` still returns the dbus wrap (the special case generalized, not dropped)
- [x] A-011 R3: a bare set without `--restart` succeeds (exit 0) while gui is off; the same set with `--restart` exits 1 with the gui-off error after writing the pin
- [x] A-012 R3: `auto` writes `""`, prints `set gui.wm= (ladder) …`, and never calls `guiLookPathFn`
- [x] A-013 R4: a bare-WM pin miss (`xfwm4`) still prints the icewm `WMInstallHint`, not a DE hint

### Scenario Coverage

- [x] A-014 R3: tests cover the PATH refusal message verbatim (`startlxqt not on PATH — sudo apt install --no-install-recommends lxqt-core (pass --force to pin anyway)`) and that `gui.wm` is unchanged after it
- [x] A-015 R3: tests cover all six no-arg report shapes
- [x] A-016 R4: a supervisor test resolves `startlxqt` and asserts argv `["dbus-run-session", "--", "startlxqt"]`, the `@rk_gui_wm` stamp `startlxqt`, and the session log line
- [x] A-017 R6: a `RunningApps` test with LXQt daemons plus `dbus-daemon` lists only the user app

### Edge Cases & Error Handling

- [x] A-018 R3: two positionals, an unknown flag, and a literal name containing `/` or whitespace all exit 2 (usage)
- [x] A-019 R3: a settings save error surfaces as `saving settings: …`, exit 1
- [x] A-020 R2: `PackageManager` receiving a nil `lookPath` still yields the generic (none) DE wording, never a panic

### Process-Group Teardown (R10 — operator correction)

- [x] A-027 R10: `WMOwnsProcessGroup` is true for a dbus-wrapped session-starter argv and false for `icewm-session`/bare WMs, table-tested
- [x] A-028 R10: a session starter is launched with `ownGroup == true` and the real start seam sets `Setpgid` (pgid == pid); icewm/bare WMs launch with `ownGroup == false` and an unchanged argv/env
- [x] A-029 R10: `guiStopWM` replaces `guiKillAndWait` at all three WM teardown sites; the backend still uses `guiKillAndWait`
- [x] A-030 R10: a real-process test proves the whole group (including a grandchild) is gone after `guiStopWM(cmd, true)` on the SIGTERM path
- [x] A-031 R10: a real-process test proves SIGKILL escalation after `guiWMStopTimeout` for a TERM-ignoring child, and the escalation line is logged
- [x] A-032 R10: `docs/specs/gui.md` § The supervisor states the process-group launch/teardown rule

### Code Quality

- [x] A-021 Pattern consistency: `gui_wm.go` follows the `gui.go` verb idiom (package seams, `newSink`, `Dataf` for the datum / `Notef` for chatter, `SilenceUsage`, Long block)
- [x] A-022 No unnecessary duplication: one `sessionStarters` table; one `PinInstallHint` fallback used by both the verb and the supervisor; no second settings write path
- [x] A-023 Subprocess safety: no new `exec` call sites; the pin is validated as a bare binary name before it is persisted (Constitution I)
- [x] A-024 Tests alongside: every touched Go file has tests for the added behavior; no test invokes a real X server, tmux, or package manager
- [x] A-025 Comments state constraints, not narration; no change IDs or PR numbers in code comments or the skill page
- [x] A-026 Named constants / no magic strings: alias map and user-facing copy live in named vars or funcs, not scattered literals

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- The live-VM acceptance line (LXQt desktop appears in the tile after `rk gui wm lxqt --restart`) is manual and skipped when `lxqt-core` is not installed on this host — note the outcome here.

Apply outcomes (2026-09-10):
- `go test ./...` and `go vet ./...` green; `just build` ok; skill page 138 lines, synced copy byte-identical, `TestSkill` green.
- `just test`: backend ok, frontend ok; e2e has 6 deterministic failures (`boards-multi-server`, `create-server-waiting`, `legacy-color-sweep`, `legacy-scope-sweep`, `multi-server-sidebar`, `protected-kill-confirm`) plus one flake (`top-bar-overflow`, passed on re-run). Verified pre-existing: the same 6 fail identically on the base tree with this change stashed; the change touches no frontend files.
- Live-VM acceptance: `lxqt-core` IS installed on this host (`/usr/bin/startlxqt`), so the manual `rk gui wm lxqt --restart` check is runnable by the operator; not run during apply (it kills apps on the live display).

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. `guiKillAndWait` is still needed: the backend teardown (`app/backend/cmd/rk/gui_supervise.go:297`, the socket-wait failure path) uses it; `guiStopWM` replaced it only at the three WM teardown sites. The old `x-session-manager` special-case arm in `WMArgv` was removed by generalizing into the `sessionStarters` table; the old `guiPinMissLine(pin)` signature and the `wmArgv[0]` stamp/log reads were fully replaced at their only call sites by `guiPinMissLine(pin, hint)` and `gui.WMName`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The no-arg report has six shapes (auto/pinned × running / running-bare-or-differs / not-running), all exit 0, derived from `gatherGUIStatus` | Intake fixes two examples and says "reading … the same way `rk gui status` does"; the remaining states need copy, and status's "state not verdict" rule fixes exit 0 | S:70 R:90 A:85 D:75 |
| 2 | Confident | With `--restart` while gui is off, the pin is written first and the restart's refusal exits 1 | Intake: "after the write, chain into runGuiRestart exactly as if the user had typed rk gui restart next" — the write precedes the chain by construction | S:70 R:90 A:85 D:70 |
| 3 | Confident | A literal WM name must be a bare binary name (non-empty, no `/`, no whitespace); otherwise usage exit 2 | Constitution I requires validating user input before it reaches a subprocess seam (the supervisor `LookPath`s and execs the pin) | S:60 R:90 A:90 D:80 |
| 4 | Confident | `DEInstallHint` returns `""` for names it has no packaging line for; `PinInstallHint` falls back to `WMInstallHint` and is the one helper both call sites use | Intake names only `startlxqt`/`startxfce4`; a `startplasma-x11` pin miss still needs a non-empty hint, and two call sites want one fallback | S:65 R:90 A:85 D:75 |
| 5 | Confident | `guiWMLines` (`on`/`restart` chatter) also appends ` (session)` | Plan § UX shows the restart line carrying `(session, …)`; it is Notef chatter, not the datum, so the shape rule is unaffected | S:65 R:95 A:80 D:70 |
| 6 | Confident | Skill-page trim merges the env and exec sections into one and the two shot code lines into one, then folds further to reach ≤ 137 before the one new bullet (final ≤ 138) | Intake names the two mergers and sets ≥ 8 lines as a floor with latitude to trim further | S:75 R:95 A:85 D:75 |
| 7 | Confident | XFCE dnf line is the explicit package list `xfce4-session xfce4-panel xfce4-settings xfdesktop xfce4-terminal`, analogous to the LXQt list | Intake #4 marks non-apt names Confident and says "analogous"; wording only, never executed | S:60 R:95 A:55 D:65 |
| 8 | Certain | Session starters launch with `Setpgid` and are stopped by signalling the process group, SIGTERM then SIGKILL; bare WMs keep the direct-child kill | Operator correction citing the L0 verdict § 4 measurement (group signal is the only variant that exits `dbus-daemon` too) | S:95 R:85 A:90 D:95 |
| 9 | Confident | `guiWMStopTimeout` (SIGTERM → SIGKILL bound) is 5 s, a package var so tests shrink it | Matches the file's other 5 s budgets (`guiSocketWaitTimeout`, tmux stamps); `lxqt-session`'s module shutdown finishes in well under a second in the L0 runs | S:70 R:95 A:85 D:80 |
| 10 | Confident | `cmd.Cancel` is overridden to the group SIGTERM (and `WaitDelay` set) on the group-owning launch so `exec.CommandContext`'s default direct-child SIGKILL can never race the explicit stop path | Go ≥ 1.20 API; without it a ctx cancel reproduces the exact orphaning the L0 verdict measured | S:70 R:90 A:85 D:80 |

10 assumptions (1 certain, 9 confident, 0 tentative).
