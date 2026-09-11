# Plan: LXQt seeded defaults (S5 / L2)

**Change**: 260910-pfe4-gui-lxqt-seeded-defaults
**Intake**: `intake.md`

## Requirements

### GUI: LXQt seed content

#### R1: Five seed files, exact verified content
`internal/gui/seed_lxqt.go` SHALL `go:embed` the LXQt seed tree under
`internal/gui/seed/lxqt/` and write it beneath a caller-supplied defaults dir
`<dir>` (the directory later prepended to `XDG_CONFIG_DIRS`) as exactly five
files: `<dir>/lxqt/session.conf`, `<dir>/lxqt/panel.conf`,
`<dir>/lxqt/lxqt.conf`, `<dir>/pcmanfm-qt/lxqt/settings.conf`, and
`<dir>/autostart/lxqt-xscreensaver-autostart.desktop`. Content MUST match the
§ L0 verdict's "Config keys that worked" block verbatim, key for key:
`session.conf` → `[General] window_manager=openbox leave_confirmation=false
lock_screen_before_power_actions=false` + `[Environment] GTK_CSD=0
GTK_OVERLAY_SCROLLING=0`; `panel.conf` → `[General] panels=panel1`, `[panel1]
plugins=mainmenu,quicklaunch,taskbar,tray,statusnotifier,worldclock
position=Bottom desktop=0 panelSize=32 iconSize=22 lineCount=1`, per-plugin
sections, `[worldclock] formatType=custom useAdvancedManualFormat=true
customFormat=HH:mm showTooltip=false`; `lxqt.conf` → `[General] theme=dark`
(+ probed `icon_theme`, R2) and `[Qt] style=Fusion`; `settings.conf` →
`[Desktop] WallpaperMode=none BgColor=#3b4252 FgColor=#ffffff HideItems=true
DesktopShortcuts= ShowHidden=false`; the autostart entry → `[Desktop Entry]
Type=Application Name=XScreenSaver (disabled by rk) Exec=xscreensaver
-no-splash Hidden=true OnlyShowIn=LXQt;`. No `timeShowSeconds`, no
`WallpaperMode=color`, no power-management module, no locker module.

- **GIVEN** an empty temp dir
- **WHEN** `SeedLXQtDefaults(dir, LaunchResolution{})` runs once
- **THEN** the five files exist with the content above, `apps\size=0` in
  `[quicklaunch]`, and `seeded == true`

#### R2: Icon theme is probed, never fixed
At seed time `lxqt.conf` SHALL carry `icon_theme=<name>` for the first of
`breeze-dark`, `Papirus-Dark`, `Adwaita` whose directory exists under the
icon-theme root (default `/usr/share/icons`, a package-var seam for tests),
and SHALL omit the key when none is present (the panel degrades to text
labels — acceptable, not a failure).

- **GIVEN** a fake icon root containing only `Adwaita/`
- **WHEN** the seed writes `lxqt.conf`
- **THEN** it contains `icon_theme=Adwaita`
- **GIVEN** an empty fake icon root
- **WHEN** the seed writes `lxqt.conf`
- **THEN** no `icon_theme=` line is present and `theme=dark` still is

#### R3: Quick-launch entries are `.desktop` paths for resolved roles only
`panel.conf`'s `[quicklaunch]` section SHALL list one `apps\N\desktop=<path>`
entry per launcher role (terminal, browser) that resolved, in that order,
with `apps\size=N`; a role that did not resolve (empty name) contributes no
entry. `<path>` is the first existing `<applications dir>/<base>.desktop`
where `<base>` is tried as the resolved binary's `EvalSymlinks` basename
(`x-terminal-emulator → /usr/bin/qterminal → qterminal.desktop`) then the
ladder name itself, over the applications roots (default
`/usr/share/applications`, `/usr/local/share/applications`; a seam for
tests). When no desktop file exists for a resolved role, the entry falls
back to `apps\N\name=Terminal|Browser`, `apps\N\exec=<binary name>`,
`apps\N\icon=utilities-terminal|web-browser` — the binary IS resolved, so
the verdict's "unresolved raw exec renders no button" case cannot arise.
Raw `exec=` for an unresolved binary MUST never be written.

- **GIVEN** a fake applications root with `qterminal.desktop` and a fake
  `bin/x-terminal-emulator → qterminal` symlink, browser unresolved
- **WHEN** the seed runs
- **THEN** `[quicklaunch]` carries `apps\size=1` and
  `apps\1\desktop=<root>/qterminal.desktop`, no browser entry
- **GIVEN** a resolved browser `chromium` with no desktop file anywhere
- **WHEN** the seed runs
- **THEN** its entry is the `name=/exec=chromium/icon=web-browser` triple

#### R4: Write-once files, regenerated quick-launch, delete-to-re-seed
`session.conf`, `lxqt.conf`, `settings.conf`, and the autostart entry SHALL
be write-once: written when absent, never rewritten while present (a user
edit survives byte-identical; deleting one file re-seeds only that file).
`panel.conf` SHALL be write-once as a file, but on every call its
`[quicklaunch]` section's `apps\*` keys SHALL be rewritten in place from the
current launcher resolution, leaving every other line of the file (a user's
`panelSize` edit, the other sections) intact; when the user has removed the
`[quicklaunch]` section entirely, nothing is regenerated. The defaults dir
and its subdirectories are `0700`, every file `0600`, normalized on every
call (the G1 `SeedProfile` rule). `seeded` reports whether any file was newly
written on this call.

- **GIVEN** a seeded dir where the user edited `session.conf`
- **WHEN** the seed runs again
- **THEN** `session.conf` is byte-identical to the edit and `seeded == false`
- **GIVEN** a seeded dir with `panelSize=32` hand-edited to `40`, and a
  browser that now resolves
- **WHEN** the seed runs again
- **THEN** `panel.conf` still reads `panelSize=40` and its `[quicklaunch]`
  now carries the browser entry
- **GIVEN** a seeded dir with `lxqt.conf` deleted
- **WHEN** the seed runs again
- **THEN** only `lxqt.conf` is rewritten from the seed and `seeded == true`

### GUI: Supervisor wiring

#### R5: LXQt rung detection and the defaults dir
`internal/gui` SHALL expose `IsLXQt(name string) bool`, true exactly for
`startlxqt` and `lxqt-session`, and `LXQtDefaultsDir()` =
`<StateDir>/lxqt/etc` (`$XDG_STATE_HOME/run-kit/gui/lxqt/etc`, beside the
IceWM `ProfileDir`). `LXQtConfigDirsEnv(dir, inherited string) string`
SHALL compose `XDG_CONFIG_DIRS=<dir>:<inherited>` with `/etc/xdg`
substituted when `inherited` is empty.

- **GIVEN** `inherited == ""`
- **WHEN** `LXQtConfigDirsEnv("/s/lxqt/etc", "")` runs
- **THEN** it returns `XDG_CONFIG_DIRS=/s/lxqt/etc:/etc/xdg`
- **GIVEN** `inherited == "/a:/b"`
- **THEN** it returns `XDG_CONFIG_DIRS=/s/lxqt/etc:/a:/b`

#### R6: Seed before the WM starts, env only for the LXQt rung
When the resolved WM name satisfies `IsLXQt`, `runGuiSuperviseLinux` SHALL
call the seed (through a `guiSuperviseSeedLXQt` package seam, default
`gui.SeedLXQtDefaults`) with the resolved terminal/browser names and paths
BEFORE stamping and BEFORE `guiSuperviseStartWM`, and SHALL pass
`extraEnv = [LXQtConfigDirsEnv(dir, os.Getenv("XDG_CONFIG_DIRS"))]` to the
session starter. Every non-LXQt rung MUST run with no `XDG_CONFIG_DIRS`
entry in `extraEnv` (icewm keeps `ICEWM_PRIVCFG`; bare WMs and XFCE get
nothing). Seeding is best-effort: a `LXQtDefaultsDir` or seed error logs
`gui: seeding the LXQt defaults at <dir> failed: <err>; starting <name>
with its defaults` (or the dir-resolution variant) and the WM starts with
NO `XDG_CONFIG_DIRS` override — a failed or partial seed is never handed to
LXQt. No `XDG_CONFIG_HOME` / `RK_USER_CONFIG_HOME` fallback exists.

- **GIVEN** `gui.wm` pinned to `startlxqt` (and separately `lxqt-session`)
  with the binary resolvable
- **WHEN** the supervisor runs
- **THEN** the seed seam is called exactly once before the WM-start seam,
  `extraEnv` equals `["XDG_CONFIG_DIRS=<stateHome>/run-kit/gui/lxqt/etc:/etc/xdg"]`
  (inherited unset in the test), and `ownGroup == true`
- **GIVEN** `startxfce4` pinned
- **THEN** `extraEnv` is empty and the seed seam is never called
- **GIVEN** the seed seam returns an error
- **THEN** the failure line is logged, `extraEnv` is empty, and the WM still
  starts

#### R7: The WM-found log line names the defaults dir
`guiWMLine(name, dir, seeded)` SHALL render, for a session starter with a
non-empty `dir`, `gui: window manager <name> (session under
dbus-run-session; defaults <dir>)`, with `, seeded` appended inside the
parentheses when `seeded` is true; with an empty `dir` the existing
`(session under dbus-run-session)` form is unchanged, and the icewm and bare
forms are unchanged.

- **GIVEN** a first LXQt start
- **THEN** the log carries `gui: window manager startlxqt (session under
  dbus-run-session; defaults /s/gui/lxqt/etc, seeded)`
- **GIVEN** a later start with the seed dir already present
- **THEN** the same line without `, seeded`

### GUI: Integration coverage and docs

#### R8: Capability-gated LXQt integration test
`cmd/rk/gui_supervise_integration_test.go` (`//go:build linux`) SHALL gain
`TestGuiSuperviseLxqtIntegration`, skipped unless `Xtigervnc`,
`dbus-run-session`, and `startlxqt` (or `lxqt-session`) resolve. It runs
`runGuiSuperviseLinux` for real on a throwaway display (`gui.FreeDisplay(90)`)
with temp `XDG_STATE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`,
`XDG_CACHE_HOME`, and `XDG_DESKTOP_DIR` (LXQt's first-start writes and
`startlxqt`'s `mkdir -p "$XDG_DESKTOP_DIR"` must never touch the real home),
the tmux stamp seam swapped for a recorder (no tmux command may reach the
live `rk-gui` session), and `gui.wm` pinned through the settings seam. It
asserts: the `@rk_gui_wm` stamp equals the pinned LXQt name; the five seed
files exist with mode `0600`; `lxqt-panel` and `pcmanfm-qt` processes appear
on the display; `gui.RunningApps("/proc", display, nil)` is empty (S1's
widened `wmHelperComms`); a root screenshot via `import -display :N -window
root` sampled at the desktop centre is `#3b4252` within ±8 per channel and
a pixel in the bottom panel band differs from it; and after cancel no
process carrying `DISPLAY=:N` and no `Xtigervnc :N` survives (5 s settle).

- **GIVEN** the three binaries on PATH
- **WHEN** `go test ./cmd/rk -run TestGuiSuperviseLxqtIntegration` runs
- **THEN** it passes; on a host missing any binary it skips

#### R9: Spec paragraph
`docs/specs/gui.md` § Switching desktops SHALL gain a paragraph stating
that the LXQt rung is seeded through `XDG_CONFIG_DIRS` (the prepended
`<state>/run-kit/gui/lxqt/etc`), naming the five files, the write-once vs
regenerated-quick-launch split, and the delete-the-file/dir-to-re-seed
rule, with no `XDG_CONFIG_HOME` fallback mentioned. The `rk gui supervise`
cobra `Long` text SHALL mention the LXQt seed beside the icewm profile.

- **GIVEN** the spec after this change
- **WHEN** a reader looks up how LXQt gets its look
- **THEN** § Switching desktops answers it in one paragraph

### Non-Goals

- Seeding XFCE or any other desktop — LXQt is the one seeded DE (L-D8).
- Any locker, screensaver, seconds clock, or desktop icons.
- An `XDG_CONFIG_HOME` / `RK_USER_CONFIG_HOME` fallback — the verdict
  confirmed the primary mechanism for every seeded file.
- Fighting `startlxqt`'s `mkdir -p "$XDG_DESKTOP_DIR"` — documented, not
  fought.
- A frontend change of any kind.

### Design Decisions

#### `panel.conf` is write-once as a file with a regenerated `[quicklaunch]` section
**Decision**: The whole file is seeded once; on every call only the
`apps\*` keys inside `[quicklaunch]` are rewritten from the launcher
resolution. Other lines and sections are preserved verbatim; a removed
section is not re-added.
**Why**: The intake binds both "a hand-edited `panel.conf` survives
restart" and "quick-launch entries track a changed launcher resolution".
IceWM could split those into two files (`preferences` vs `toolbar`); LXQt's
panel reads one `panel.conf`, so the split has to live inside the file. A
section-scoped rewrite honors both without a second `XDG_CONFIG_DIRS` layer
(unverified QSettings merge semantics across two custom dirs).
**Rejected**: Regenerating `panel.conf` wholesale (kills the user's edits);
a second `gen/` config dir prepended after `etc/` (depends on per-key
QSettings fallback across two rk dirs that the spike never exercised).
*Introduced by*: 260910-pfe4-gui-lxqt-seeded-defaults

#### The prepended dir is `<StateDir>/lxqt/etc`, and it is what the seed function receives
**Decision**: `LXQtDefaultsDir()` returns the `etc` directory itself;
`SeedLXQtDefaults(dir, …)` writes `dir/lxqt/…`, `dir/pcmanfm-qt/…`,
`dir/autostart/…`; the same string is prepended to `XDG_CONFIG_DIRS` and
printed in the log line.
**Why**: One path serves the seed, the env, the log, and the user's
"delete the dir to re-seed" instruction — no `/etc` suffix appended in one
place and not another.
**Rejected**: Passing the parent `lxqt/` and appending `etc` inside the
seed (two callers would have to agree on the suffix).
*Introduced by*: 260910-pfe4-gui-lxqt-seeded-defaults

#### Desktop-file and icon-theme roots are package-var seams, not parameters
**Decision**: `lxqtIconThemeRoot`, `lxqtApplicationsDirs`, and
`lxqtEvalSymlinks` are unexported package vars in `internal/gui` with
production defaults; tests override them.
**Why**: The probe roots are host facts, not caller decisions — the
supervisor has nothing to pass; the seam idiom is the one `cmd/rk`'s
supervisor already uses (`guiSuperviseLookPath`, `guiSuperviseStat`).
**Rejected**: Widening the `SeedLXQtDefaults` signature with three roots
every caller would pass identically.
*Introduced by*: 260910-pfe4-gui-lxqt-seeded-defaults

## Tasks

### Phase 1: Setup

- [x] T001 Prerequisite check: `git fetch origin && git show origin/main:fab/plans/sahil/26-09-10-gui-lxqt-desktop.md | grep -q '^## L0 verdict'` succeeds (stop and re-sync if not) <!-- R1 -->
- [x] T002 [P] Add `IsLXQt`, `LXQtDefaultsDir`, and `LXQtConfigDirsEnv` to `app/backend/internal/gui/backend.go` / `state.go` with tests in `backend_test.go` / `state_test.go` <!-- R5 -->
- [x] T003 [P] Create the embedded seed tree under `app/backend/internal/gui/seed/lxqt/`: `lxqt/session.conf`, `lxqt/panel.conf` (with an empty `[quicklaunch]` apps block), `lxqt/lxqt.conf` (no `icon_theme` line — inserted at seed time), `pcmanfm-qt/lxqt/settings.conf`, `autostart/lxqt-xscreensaver-autostart.desktop`, content per R1 <!-- R1 -->

### Phase 2: Core Implementation

- [x] T004 Implement `app/backend/internal/gui/seed_lxqt.go`: `LaunchResolution{Terminal, Browser LaunchApp{Name, Path}}`, `SeedLXQtDefaults(dir string, apps LaunchResolution) (seeded bool, err error)` with the `embed.FS`, write-once per file, mode normalization (0700 dirs / 0600 files), the icon-theme probe (`lxqtIconThemeRoot` seam), the `.desktop` lookup with `name=/exec=/icon=` fallback (`lxqtApplicationsDirs`, `lxqtEvalSymlinks` seams), and the section-scoped `[quicklaunch]` `apps\*` rewrite <!-- R1 R2 R3 R4 -->
- [x] T005 Write `app/backend/internal/gui/seed_lxqt_test.go`: first seed (five files, modes, verbatim content, `apps\size=0`), icon probe present/absent, `.desktop` path vs exec fallback vs unresolved role, user edit to `session.conf`/`lxqt.conf` survives byte-identical with `seeded=false`, `panel.conf` hand edit survives while quick-launch tracks a new browser, deleting one file re-seeds only that file, loose modes normalized, `LXQtDefaultsDir` under `XDG_STATE_HOME` <!-- R1 R2 R3 R4 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Wire `app/backend/cmd/rk/gui_supervise.go`: `guiSuperviseSeedLXQt` seam, `lxqt := wmOK && gui.IsLXQt(wmName)`, seed before the stamp burst, `extraEnv` from `gui.LXQtConfigDirsEnv(dir, os.Getenv("XDG_CONFIG_DIRS"))` on success only, the `guiLXQtDefaultsDirFailedLine`/`guiLXQtSeedFailedLine` lines, `guiWMLine` extended with the `; defaults <dir>[, seeded]` segment, and the `supervise` `Long` text <!-- R6 R7 R9 -->
- [x] T007 Extend `app/backend/cmd/rk/gui_supervise_test.go`: `guiWMLine` variants in `TestGuiSuperviseLineFormats`, `TestGuiSuperviseLinuxLxqtSeedsAndSetsConfigDirs` (both `startlxqt` and `lxqt-session`; seed called once before WM start; exact `extraEnv`; `ownGroup`), the unseeded log variant, the seed-failure variant (line logged, no env), and an `startxfce4` pin asserting no seed call and empty `extraEnv` <!-- R6 R7 -->
- [x] T008 Add `TestGuiSuperviseLxqtIntegration` to `app/backend/cmd/rk/gui_supervise_integration_test.go` per R8 (capability gate, temp XDG homes, stamp recorder, seed-file modes, process presence, RunningApps empty, centre-pixel and panel-band screenshot check via `import`, clean teardown) <!-- R8 -->

### Phase 4: Polish

- [x] T009 Add the seed paragraph to `docs/specs/gui.md` § Switching desktops per R9 <!-- R9 -->
- [x] T010 Gates: `cd app/backend && go test ./...`, `just test`, `just build` all green <!-- R1 R6 R8 -->

## Execution Order

- T002 and T003 are independent; T004 needs both.
- T006 needs T002 and T004; T007 needs T006; T008 needs T006 and a host with LXQt (skips otherwise).
- T010 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `SeedLXQtDefaults` writes exactly the five files with the verdict's key/value content; no `timeShowSeconds`, `WallpaperMode=color`, power-management, or locker-module keys appear
- [x] A-002 R2: `lxqt.conf` carries the first probed icon theme of `breeze-dark → Papirus-Dark → Adwaita` and omits the key when none exists
- [x] A-003 R3: `[quicklaunch]` lists `.desktop` paths for resolved roles only, in terminal→browser order, with the `name=/exec=/icon=` fallback for a resolved binary lacking a desktop file
- [x] A-004 R4: every non-panel seed file is write-once; `panel.conf` preserves user lines while its `apps\*` keys regenerate; deleting one file re-seeds only that file; dir 0700 / files 0600 normalized on every call
- [x] A-005 R5: `IsLXQt` is true exactly for `startlxqt`/`lxqt-session`; `LXQtDefaultsDir()` is `<StateDir>/lxqt/etc`; `LXQtConfigDirsEnv` substitutes `/etc/xdg` for an empty inherited value
- [x] A-006 R6: the supervisor seeds before stamping/starting and passes `XDG_CONFIG_DIRS` only for the LXQt rung; a seed failure logs and starts LXQt with no override
- [x] A-007 R7: the WM line reads `(session under dbus-run-session; defaults <dir>[, seeded])` for LXQt and is unchanged for every other rung
- [x] A-008 R8: `TestGuiSuperviseLxqtIntegration` exists, is capability-gated, and passes on this host
- [x] A-009 R9: `docs/specs/gui.md` § Switching desktops carries the seed paragraph; the `supervise` `Long` text names the LXQt seed

### Behavioral Correctness

- [x] A-010 R6: `startxfce4`, bare WMs, and `icewm-session` see no `XDG_CONFIG_DIRS` in `extraEnv` (icewm keeps only `ICEWM_PRIVCFG`)
- [x] A-011 R4: a second seed call over an untouched tree returns `seeded=false` and changes no byte outside `[quicklaunch]` `apps\*`

### Scenario Coverage

- [x] A-012 R6: unit tests cover both LXQt names, the unseeded log variant, and the seed-failure path
- [x] A-013 R8: the integration test asserts the `#3b4252` centre pixel, a differing panel-band pixel, empty `RunningApps`, and no surviving `DISPLAY=:N` process after teardown

### Edge Cases & Error Handling

- [x] A-014 R3: an unresolved role writes no quick-launch entry at all (no raw `exec=` for a missing binary)
- [x] A-015 R4: a `panel.conf` whose `[quicklaunch]` section the user removed is left untouched
- [x] A-016 R6: a `LXQtDefaultsDir` error logs its own line and the WM still starts

### Code Quality

- [x] A-017 Pattern consistency: the seed mirrors `seed.go` (`SeedProfile`) naming, doc-comment style, mode normalization, and error wrapping; supervisor seams follow the `guiSupervise*` var idiom
- [x] A-018 No unnecessary duplication: launcher resolution reuses `gui.ResolveApp`; no second INI writer or state-dir resolver is introduced
- [x] A-019 Constitution I: no shell strings; the integration test's `import` runs through `exec.CommandContext` with a timeout
- [x] A-020 Tests cover the added behavior (unit + capability-gated integration); no comment narration or change-ID citations in code comments
- [x] A-021 Constitution II: the seed dir is a startup-written file tree under `$XDG_STATE_HOME`, never read back as state

### Security

- [x] A-022 R4: seed dir `0700`, files `0600`; the env var value is composed from a state path and the inherited env, never from user input

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

None — this change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `panel.conf` is write-once as a file while its `[quicklaunch]` `apps\*` keys are rewritten in place on every call; a removed section is not re-added | The intake binds both "hand-edited panel.conf survives restart" and "quick-launch tracks resolution"; a section-scoped rewrite is the only single-file reading that satisfies both, and it stays inside the verified one-dir `XDG_CONFIG_DIRS` mechanism | S:70 R:80 A:80 D:65 |
| 2 | Certain | `LXQtDefaultsDir()` returns the `etc` dir itself (`<StateDir>/lxqt/etc`) and that string is the seed root, the env prefix, and the logged path | One path for seed, env, log, and the user's delete-to-re-seed instruction; mirrors `ProfileDir()` returning the dir handed to `ICEWM_PRIVCFG` | S:85 R:90 A:90 D:85 |
| 3 | Certain | The `.desktop` lookup tries the resolved binary's `EvalSymlinks` basename then the ladder name over `/usr/share/applications` and `/usr/local/share/applications`; a resolved role with no desktop file falls back to `name=/exec=/icon=` | The verdict's own recommendation ("prefer its own desktop file and fall back to name=/exec=/icon= with a resolved binary"); `x-terminal-emulator` is a Debian alternative with no desktop file of its own, so the symlink chain is the reliable base | S:85 R:85 A:85 D:80 |
| 4 | Certain | Probe roots (`/usr/share/icons`, the applications dirs) and `EvalSymlinks` are unexported package-var seams in `internal/gui`, not function parameters | Host facts the supervisor has nothing to pass; the seam idiom the supervisor already uses for `LookPath`/`Stat` | S:80 R:90 A:90 D:85 |
| 5 | Certain | `seeded` reports whether any seed file was newly written on this call (first seed or after a delete), driving the log suffix | Direct analogue of `SeedProfile`'s `seeded` for `preferences`; the intake's log-line rule ("when seeding actually occurred") | S:85 R:90 A:90 D:90 |
| 6 | Confident | The integration test pins `gui.wm` through the `guiSuperviseSettingsLoad` seam and sets temp `XDG_CONFIG_HOME`/`XDG_DATA_HOME`/`XDG_CACHE_HOME`/`XDG_DESKTOP_DIR` so LXQt's first-start writes never touch the real home | The verdict documents liblxqt's `__userfile__` stubs and `startlxqt`'s `mkdir -p "$XDG_DESKTOP_DIR"`; the icewm integration test already uses the seam-swap pattern for tmux | S:75 R:85 A:80 D:75 |
| 7 | Confident | The screenshot check samples the desktop centre for `#3b4252` (±8/channel) only after `pcmanfm-qt` and `lxqt-panel` are on the display, and additionally asserts a bottom-band pixel differs | `xsetroot` paints the same `#3b4252` before pcmanfm-qt is up, so the centre pixel alone would pass trivially; the panel-band difference is what proves the seeded panel rendered | S:70 R:85 A:80 D:70 |
| 8 | Certain | Comments inside the seeded INI files use `;` (the INI comment form QSettings reads) rather than `#` | The IceWM seed uses `#` because IceWM's parser does; QSettings' INI reader documents `;` — the safer choice for a file LXQt parses | S:75 R:90 A:85 D:85 |

8 assumptions (6 certain, 2 confident, 0 tentative).
