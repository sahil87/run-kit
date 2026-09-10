# Plan: GUI desktop — the IceWM rung, seeded profile, WM stamp, and launcher (G1)

**Change**: 260910-2jl3-gui-desktop-icewm-and-launcher
**Intake**: `intake.md`

> Read `intake.md` in full first — it carries the exact copy, signatures, and file-by-file design (§ What Changes 1–13) this plan traces to. The plan file `fab/plans/sahil/26-09-10-gui-desktop.md` § Decision log (G-D1–G-D9) is binding and is not reopened here.

## Requirements

### GUI Supervisor: Window-manager ladder and pin

#### R1: IceWM heads the ladder and each binary owns its argv
`internal/gui/backend.go` SHALL define the ladder as `icewm-session, openbox, xfwm4, i3, kwin_x11, x-session-manager` (exported via a `WMLadder()` accessor or exported slice so the supervisor's log line and tests never hand-type it), a pure `WMArgv(name string) []string` returning `["icewm-session","--nobg","--notray"]` for `icewm-session`, `["dbus-run-session","--","x-session-manager"]` for `x-session-manager`, and `[name]` otherwise, and `ResolveWM(lookPath, pin string) (argv []string, pinMissed, ok bool)`: a non-empty `pin` that `lookPath` resolves wins (argv via `WMArgv`); a non-empty pin that does not resolve sets `pinMissed=true` and falls through to the ladder; the first ladder rung on PATH wins; `ok=false` when nothing resolves.

- **GIVEN** a `lookPath` that resolves both `openbox` and `icewm-session` and an empty pin
- **WHEN** `ResolveWM` runs
- **THEN** argv is `["icewm-session","--nobg","--notray"]`, `pinMissed=false`, `ok=true`

- **GIVEN** pin `xfwm4` not on PATH and `openbox` on PATH
- **WHEN** `ResolveWM` runs
- **THEN** argv is `["openbox"]`, `pinMissed=true`, `ok=true`

- **GIVEN** pin `icewm-session` on PATH
- **WHEN** `ResolveWM` runs
- **THEN** argv carries `--nobg --notray` exactly as the ladder rung would

#### R2: The supervisor pins, seeds, stamps in one burst, then starts the WM
`cmd/rk/gui_supervise.go` `runGuiSuperviseLinux` SHALL, after the backend socket is up and `chmod 0600`: (1) read `gui.wm` through a new package seam `guiSuperviseSettingsLoad` (default `settings.Load`), call `gui.ResolveWM(guiSuperviseLookPath, pin)`, and on `pinMissed` log `gui: gui.wm=<pin> not on PATH; falling back to the ladder`; (2) resolve the terminal and browser via `gui.ResolveApp` with a `guiSuperviseStat` seam (default `os.Stat`); (3) when `argv[0] == "icewm-session"`, call `gui.SeedProfile(gui.ProfileDir(), term, browser)` through a `guiSuperviseSeed` seam — a seed error logs `gui: seeding the IceWM profile at <dir> failed: <err>; starting icewm with its defaults` and continues; (4) stamp `@rk_gui_display`, `@rk_gui_backend`, then `@rk_gui_wm` (`argv[0]`, or `""` when `ok=false`) via `guiStampSessionOption(daemon.GUIOptionWM, …)`; (5) log per intake § What Changes 5 — `gui: window manager icewm-session (config <dir>, seeded preferences)` (suffix only when seeded; a non-icewm rung logs `gui: window manager <name>` with no config segment), then for icewm `gui: toolbar: terminal=<name|none> browser=<name|none>`, or when bare `gui: no window manager found (tried <ladder joined by ", ">); running bare — <WMInstallHint>, then rk gui restart` (`guiNoWMLine(hint)` derives the ladder text from `gui.WMLadder()`); (6) start the WM with `ICEWM_PRIVCFG=<dir>` added to the child env only for the icewm rung (the `guiSuperviseStartWM` seam gains an extra-env parameter); (7) paint the root as today. Teardown is unchanged.

- **GIVEN** a fake lookPath resolving `Xtigervnc` and `icewm-session`, a fake seed seam returning `seeded=true`
- **WHEN** the supervisor runs to the WM start
- **THEN** the captured stamp argv contains `@rk_gui_wm icewm-session` after the display and backend stamps, the log carries `gui: window manager icewm-session (config …/gui/icewm, seeded preferences)` and a `gui: toolbar:` line, and the WM start env contains `ICEWM_PRIVCFG=…/gui/icewm`

- **GIVEN** a fake lookPath resolving only `Xtigervnc`
- **WHEN** the supervisor runs
- **THEN** the stamp `@rk_gui_wm ""` is issued, the no-WM log line names all six ladder entries and carries the fake-manager install hint followed by `, then rk gui restart`, and no `ICEWM_PRIVCFG` is set

- **GIVEN** `gui.wm=xfwm4` in the settings seam and `xfwm4` absent
- **WHEN** the supervisor runs
- **THEN** the log carries `gui: gui.wm=xfwm4 not on PATH; falling back to the ladder` and the ladder result is used

### GUI Supervisor: Seeded IceWM profile

#### R3: `SeedProfile` seeds write-once preferences and regenerates toolbar/menu
`internal/gui/seed.go` SHALL provide `ProfileDir() (string, error)` = `<StateDir()>/icewm` and `SeedProfile(dir, terminal, browser string) (seeded bool, err error)`: `MkdirAll(dir, 0700)`; write `preferences` (the `go:embed`ded `seed/preferences`, content exactly as intake § What Changes 2) only when absent, returning `seeded=true` on that write; always rewrite `toolbar` and `menu` with the exact header comments and `prog Terminal terminal <terminal>` / `prog Browser web-browser <browser>` rows only for non-empty names, `menu` additionally carrying `separator` and `includeprog icewm-menu-fdo --no-sep-others --seps`; all files `0600`.

- **GIVEN** an empty temp dir
- **WHEN** `SeedProfile(dir, "x-terminal-emulator", "")` runs
- **THEN** `seeded=true`, the dir is `0700`, `preferences`/`toolbar`/`menu` exist `0600`, `toolbar` has exactly one `prog` row (Terminal), `menu` has no Browser row and ends with the `includeprog` line

- **GIVEN** the same dir with `preferences` edited by a user
- **WHEN** `SeedProfile(dir, "x-terminal-emulator", "chromium")` runs again
- **THEN** `seeded=false`, `preferences` is byte-identical to the edit, and `toolbar`/`menu` now carry the Browser row

- **GIVEN** `preferences` deleted
- **WHEN** `SeedProfile` runs
- **THEN** it is re-seeded with the embedded content and `seeded=true`

### GUI Launcher

#### R4: One allowlisted launcher resolves two roles server-side
`internal/gui/launch.go` SHALL provide `AppRole` (`AppTerminal="terminal"`, `AppBrowser="browser"`), `ParseAppRole(s) (AppRole, error)` (exact match only; the error text is `app must be terminal or browser`), `ResolveApp(role, lookPath, stat) (name, path string, ok bool)` walking the fixed ladders — terminal `x-terminal-emulator, xterm, uxterm, lxterm, foot, alacritty, kitty, gnome-terminal, xfce4-terminal`; browser `chromium, chromium-browser, google-chrome, google-chrome-stable, firefox, x-www-browser` — accepting a rung only when `lookPath` resolves it AND `stat` of the resolved path succeeds (the dangling Debian-alternative guard); `LaunchHint(role, lookPath) string` with the per-manager wording of intake § What Changes 3; `LaunchEnv(base, display, socket) []string` (the `guiExecEnv` replace-never-duplicate rule); and `StartDetached(argv, env) (pid int, err error)` (Setsid, stdio `/dev/null`, never waited). `cmd/rk/gui_exec.go`'s `guiExecEnv` and `guiExecStartDetached` MUST delegate to these two (no duplicated logic).

- **GIVEN** a lookPath map with `x-www-browser` → `/usr/bin/x-www-browser` whose stat fails and `firefox` → a path whose stat succeeds
- **WHEN** `ResolveApp(AppBrowser, …)` runs
- **THEN** it returns `name="firefox"`, `ok=true`

- **GIVEN** a lookPath that resolves nothing and a lookPath for hints that resolves `apt-get`
- **WHEN** `ResolveApp(AppBrowser, …)` and `LaunchHint(AppBrowser, …)` run
- **THEN** `ok=false` and the hint is `no browser on the GUI host — sudo apt install chromium-browser`

- **GIVEN** `ParseAppRole("xterm")`
- **WHEN** parsed
- **THEN** an error `app must be terminal or browser` is returned

#### R5: `rk gui launch <terminal|browser>` is a gated CLI verb
`cmd/rk/gui_launch.go` SHALL register `launch` on the `gui` family (with the `usageArgs` wrap; `guiCmd.Long`'s `Subcommands:` list gains a `launch` row) that: refuses on darwin via `guiDarwinRefusal("launch")`; gates through `guiRequireReachable` (`guiErrOff`/`guiErrNotRunning`, exit 1); treats a bad role as a usage error (exit 2, `error: app must be terminal or browser`); on a ladder miss prints `gui.LaunchHint(role, guiLookPathFn)` to stderr and exits 1; otherwise starts the resolved binary via a `guiLaunchStartFn` seam (default `gui.StartDetached`) with `gui.LaunchEnv(os.Environ(), st.Display, st.Socket)` and prints `started <name> (pid <pid>) on :N` via `Dataf`, exit 0; a start failure prints `error: <name>: <reason>`, exit 1.

- **GIVEN** the GUI enabled and reachable (stubbed) and a lookPath/stat resolving `xterm`
- **WHEN** `rk gui launch terminal` runs
- **THEN** the start seam receives argv `[<xterm path>]` with `DISPLAY=:10` in env and stdout is `started xterm (pid <n>) on :10`

- **GIVEN** the GUI enabled and reachable and no browser on the fake PATH with `apt-get` present
- **WHEN** `rk gui launch browser` runs
- **THEN** exit 1 and stderr `no browser on the GUI host — sudo apt install chromium-browser`

- **GIVEN** `gui.enabled=false`
- **WHEN** `rk gui launch terminal` runs
- **THEN** stderr `gui is off — turn it on with 'rk gui on'`, exit 1, nothing started

#### R6: `POST /api/gui/{id}/launch` is the HTTP twin
`api/gui.go` + `api/router.go` SHALL add `POST /api/gui/{id}/launch` with body `{"app":"terminal"|"browser"}` and this exact response table: invalid id → 400 (`validate.ValidateGUIID` text); unparsable body or bad app → 400 `{"error":"app must be terminal or browser"}`; `!GUIEnabled` → 409 `{"error":"gui disabled"}`; enabled but `buildGuiStatus` unreachable → 409 `{"error":"gui is on but not running — see 'rk gui status'"}`; ladder miss → 200 `{"ok":false,"app":"<role>","hint":"<LaunchHint>"}`; start failure → 500 `{"error":"<name>: <reason>"}`; success → 200 `{"ok":true,"app":"<role>","argv0":"<name>","pid":<n>}`. New Server seams `guiStatFn` (default `os.Stat`) and `guiLaunchFn` (default `gui.StartDetached`) follow the existing `guiLookPathFn` idiom; the env is `gui.LaunchEnv(os.Environ(), st.Display, st.Socket)`. The body carries a role, never argv.

- **GIVEN** an enabled, reachable stub and a lookPath/stat resolving `xterm`
- **WHEN** `POST /api/gui/host/launch {"app":"terminal"}`
- **THEN** 200 with `ok:true`, `argv0:"xterm"`, and the launch seam was called once with `DISPLAY=<display>` in env

- **GIVEN** an enabled, reachable stub and no browser on the fake PATH
- **WHEN** `POST /api/gui/host/launch {"app":"browser"}`
- **THEN** 200 `{"ok":false,"app":"browser","hint":"no browser on the GUI host — …"}` and the launch seam is not called

- **GIVEN** `{"app":"xterm"}`
- **WHEN** posted
- **THEN** 400 `app must be terminal or browser`

### GUI Hints

#### R7: Install hints are package-manager-aware wording, never executed
`internal/gui/hint.go` SHALL provide `PackageManager(lookPath) string` probing `apt-get`, `dnf`, `pacman` in that order (`"apt"|"dnf"|"pacman"|""`), `WMInstallHint(lookPath)` and `InstallHint(lookPath)` with the exact strings of intake § What Changes 4 (apt `sudo apt install --no-install-recommends icewm` / `sudo apt install --no-install-recommends tigervnc-standalone-server icewm`; dnf `sudo dnf install icewm` / `sudo dnf install tigervnc-server icewm`; pacman `sudo pacman -S icewm` / `sudo pacman -S tigervnc icewm`; none `install icewm with your package manager` / `install a VNC X server (TigerVNC) and icewm with your package manager`; darwin unchanged; other `""`). `InstallHint` MUST move out of `state.go` and gain the `lookPath` parameter; `NoBackendReason` MUST become `func NoBackendReason(lookPath) string` = `"no VNC backend: " + InstallHint(lookPath)`; every caller (`daemon.ensureGUICore`, `runGuiOn`, `runGuiSuperviseLinux`, `NotRunningReason`) MUST pass its own lookPath seam. rk never runs any of these commands.

- **GIVEN** a lookPath resolving `dnf` only
- **WHEN** `InstallHint` and `WMInstallHint` run on linux
- **THEN** they return `sudo dnf install tigervnc-server icewm` and `sudo dnf install icewm`

- **GIVEN** a lookPath resolving none of the three
- **WHEN** `NoBackendReason` runs on linux
- **THEN** it returns `no VNC backend: install a VNC X server (TigerVNC) and icewm with your package manager`

### GUI State: the stamp and its readers

#### R8: `wm` flows from the stamp to every status surface
`internal/daemon/gui.go` SHALL define `GUIOptionWM = "@rk_gui_wm"` and widen `GUISessionOptions` to `(display, backend, wm string, ok bool)` (`ok` semantics unchanged; `wm` best-effort, `""` when unset or empty). Every `guiSessionOptionsFn` seam and `gui.StatusDeps.SessionOptions` SHALL carry the fourth return. `gui.StreamEntry` gains `WM string \`json:"wm"\`` (ninth field); `gui.Status` gains `WM string \`json:"wm"\`` after `Viewers` and `WMHint string \`json:"wm_hint,omitempty"\`` among the document-only fields. `gui.Assemble` sets `st.WM` from the stamps and, when `st.Reachable && st.WM == ""`, `st.WMHint = WMInstallHint(d.LookPath)`. `api/sse.go`'s hub stores `guiWM` beside `guiDisplay`/`guiBackend` in `guiTick` and `guiPayloadLocked` emits it when enabled.

- **GIVEN** a stub `SessionOptions` returning `(":10","Xtigervnc","icewm-session",true)` and a reachable probe
- **WHEN** `Assemble` runs
- **THEN** `Status.WM == "icewm-session"` and `WMHint == ""`

- **GIVEN** the same with `wm == ""` and `apt-get` on the fake PATH
- **WHEN** `Assemble` runs
- **THEN** `WMHint == "sudo apt install --no-install-recommends icewm"`; and when the probe is unreachable `WMHint == ""`

- **GIVEN** the hub's `guiSessionOptionsFn` returning `wm="icewm-session"`
- **WHEN** `guiTick` renders
- **THEN** the `event: gui` payload's single entry carries `"wm":"icewm-session"`

#### R9: Running apps exclude window-manager helpers by name
`internal/gui/apps_linux.go` `RunningApps` SHALL skip processes whose trimmed `comm` is one of `icewm-session, icewm, icewmbg, icewmtray, icesound, icewmhint, openbox, xfwm4, i3, kwin_x11, xsetroot` (a package-level set), after the pid excludes and never by ancestry.

- **GIVEN** a fake procRoot with pids for `icewm`, `icewm-session`, and `xterm`, all carrying `DISPLAY=:10`, and no pid excludes
- **WHEN** `RunningApps(procRoot, ":10", nil)` runs
- **THEN** the result is exactly `[{xterm 1}]`

### GUI CLI and doctor copy

#### R10: `rk gui on` and `rk gui restart` report the window manager
`cmd/rk/gui.go` `guiAwaitStamps` SHALL return `(bin, display, wm string, ok bool)` and `runGuiOn`/`runGuiRestart` SHALL, after the `started (…)`/`restarted (…)` `Dataf` line, print via `Notef`: `  window manager: <wm>` when non-empty, or the two lines `  no window manager — running bare. Install one: <WMInstallHint>` and `  then: rk gui restart` when the await succeeded with `wm == ""`; on await timeout only the bare `started`/`restarted` line is printed. The no-backend branch prints `enabled — no VNC backend installed: <InstallHint(guiLookPathFn)>`.

- **GIVEN** stubs where the stamps read `(":10","Xtigervnc","icewm-session",true)`
- **WHEN** `rk gui on` runs with the daemon up
- **THEN** stdout is `started (Xtigervnc :10)` and stderr carries `  window manager: icewm-session`

- **GIVEN** stamps `(":10","Xtigervnc","",true)` and `apt-get` on the fake PATH
- **WHEN** `rk gui on` runs
- **THEN** the two-line hint names `sudo apt install --no-install-recommends icewm` and `then: rk gui restart`

#### R11: Status and doctor one-liners name the WM and pluralize viewers
`guiOnSummary(bin, display, w, h, viewers, wm)` SHALL render `on (<bin>, :N, WxH, <k> viewer|viewers, <wm|no window manager>)` with `viewer` at exactly 1 and `viewers` otherwise; `rk gui status` uses it unchanged; the doctor `guiCheck` receives `wm` and appends ` — <WMInstallHint(lookPath)>` after `no window manager` in its reachable+bare note (the status line does not). The doctor's not-running note uses the new `NoBackendReason(lookPath)` string.

- **GIVEN** a reachable status with `viewers=1`, `wm="icewm-session"`
- **WHEN** rendered
- **THEN** `gui: on (Xtigervnc, :10, 1920x1080, 1 viewer, icewm-session)`

- **GIVEN** the doctor row with `viewers=0`, `wm=""`, `apt-get` on PATH
- **WHEN** rendered
- **THEN** `on (Xtigervnc, :10, 1920x1080, 0 viewers, no window manager — sudo apt install --no-install-recommends icewm)`

### Settings

#### R12: `gui.wm` is a registry key
`internal/settings/settings.go` SHALL add `Settings.GUIWM string` and a registry row `gui.wm` immediately after `gui.enabled`: `kind: "string"`, `def: ""`, category `behavior`, `ui: true`, `live: false`, description `Pin the window manager the GUI supervisor starts. Empty picks the first installed one from the ladder (icewm-session → openbox → xfwm4 → i3 → kwin_x11 → x-session-manager). Takes effect on rk gui restart.`, parse via `quoteTrimmedScalar`, serialize via `quotedScalar("gui.wm", …)` (omitted when empty), apply via the string-scalar helper the `ssh_host` row uses. No env form. Any test asserting the registry inventory count is updated (14 → 15).

- **GIVEN** a settings file without `gui.wm`
- **WHEN** loaded and saved
- **THEN** the file round-trips byte-identically and `GUIWM == ""`

- **GIVEN** `POST /api/settings {"gui.wm":"openbox"}` then `{"gui.wm":null}`
- **WHEN** applied
- **THEN** the file carries `gui.wm: "openbox"` after the first and no `gui.wm` line after the second

### Tests

#### R13: A capability-gated integration test proves the rung end-to-end
`cmd/rk/gui_supervise_integration_test.go` (`//go:build linux`) SHALL skip unless `Xtigervnc` and `icewm-session` both resolve on PATH, and otherwise run `runGuiSuperviseLinux` under a cancelable context with `XDG_STATE_HOME` and `RK_CONFIG_DIR` at temp dirs, a display from `gui.FreeDisplay(90)`, and `guiSuperviseTmuxRun` replaced by a recorder (no tmux command is sent), then assert: a recorded `@rk_gui_wm icewm-session` stamp; `preferences`/`toolbar`/`menu` present under `<state>/run-kit/gui/icewm/` with mode `0600`; `gui.RunningApps("/proc", display, nil)` empty (icewm excluded by name); and after cancel a clean return with no `icewm*` process holding that `DISPLAY`. It MUST never touch the live `rk-gui` session or the `rk-daemon` socket.

- **GIVEN** this VM (both binaries installed)
- **WHEN** `go test ./cmd/rk -run Integration` runs
- **THEN** the test passes and leaves no X server or icewm process behind

### Docs

#### R14: Specs, the skill page, and the plan tables carry the new surface
`docs/specs/gui.md` SHALL describe the new ladder head with `--nobg --notray`, the seeded profile dir and its two file classes, the `@rk_gui_wm` stamp, `gui.wm`, `rk gui launch` and `POST /api/gui/{id}/launch`, the new hint lines, and the updated diagram WM line; its closing "WM probe order … proposed — C2" clause is struck and points at `fab/plans/sahil/26-09-10-gui-desktop.md`. `docs/site/skill/gui.md` SHALL gain a `rk gui launch` section and the profile directory (two file classes, delete-to-reset), stay ≤150 lines, and be synced to `cmd/rk/skill/gui.md` via `scripts/sync-skill.sh`. `fab/plans/sahil/26-09-09-gui-surface.md` § Change breakdown SHALL gain one pointer row to the child plan (no other edit). The toolkit standards governing the CLI surface (`shll standards help-dump`, `shll standards principles`, when `shll` is available) SHALL be checked for the new verb.

- **GIVEN** the docs edits
- **WHEN** `go test ./cmd/rk -run Skill` runs
- **THEN** the embedded skill copy matches the canonical page and the line budget holds

### Non-Goals

- Auto-installing IceWM, a browser, or a terminal — rk prints the line, the host owns the packages (G-D2)
- The tile strip, the palette `GUI: Open terminal/browser` rows, and the dedicated `Window manager` settings field with its placeholder — G2 (`gui-desktop-tile-strip-and-palette`)
- XFCE/LXQt as recommended rungs, a theme editor, per-viewer window managers, the macOS branch (G-D9)
- Arbitrary commands over HTTP — `rk gui exec` stays CLI-only (G-D5)
- Menu-curation preference keys — unverified on IceWM 2.9.6; the bottom `Settings` row is accepted (plan Risk 2)

### Design Decisions

#### IceWM is the recommended window manager
**Decision**: `icewm-session --nobg --notray` heads the ladder; the existing `xsetroot -solid #3b4252` paint stays the ground.
**Why**: the spike measured 29 MB idle for the pair with no D-Bus or session manager, a taskbar/start menu/clock built in, and a first-class private config dir; `--nobg` is the only way to keep rk's ground (a theme wallpaper otherwise wins over every preference).
**Rejected**: openbox first (a bare root with a dead right-click menu on phones); XFCE/LXQt (session plumbing, D-Bus, tens of MB more); an rk-drawn panel (Constitution III — IceWM already draws one).
*Introduced by*: 260910-2jl3-gui-desktop-icewm-and-launcher

#### rk owns the look through a seeded profile, not a config edit
**Decision**: `$XDG_STATE_HOME/run-kit/gui/icewm/` is passed as `ICEWM_PRIVCFG`; `preferences` is write-once (seeded when absent), `toolbar`/`menu` are regenerated every start from the launcher ladders.
**Why**: the code-server `settings.json` precedent — user edits persist, deleting resets; the toolbar must only name binaries that exist (this VM has no browser), and regenerating avoids baking an rk binary path into a user-editable file. `~/.icewm` is never touched.
**Rejected**: writing `~/.icewm` (collides with a user's own IceWM desktop); a fully static embedded toolbar (dead buttons on hosts without a browser).
*Introduced by*: 260910-2jl3-gui-desktop-icewm-and-launcher

#### One two-role launcher, never argv over HTTP
**Decision**: `rk gui launch <terminal|browser>` and `POST /api/gui/{id}/launch {"app":…}` share `gui.ResolveApp` over fixed ladders resolved with `LookPath` plus a stat of the resolved path; a miss returns `{ok:false, hint}`; `rk gui exec` stays CLI-only.
**Why**: Constitution I — the HTTP body carries a role, the server picks the argv; the phone and G2's palette need a tap-reachable launch; the IceWM toolbar rows, the CLI, and HTTP must agree on which binary "the terminal" is.
**Rejected**: exposing `exec` over HTTP (arbitrary command execution from the dashboard); resolving in the frontend (the browser cannot see the host's PATH).
*Introduced by*: 260910-2jl3-gui-desktop-icewm-and-launcher

#### WM helpers are excluded from the apps list by name, not ancestry
**Decision**: `RunningApps` drops a fixed comm-name set (`icewm-session, icewm, icewmbg, icewmtray, icesound, icewmhint, openbox, xfwm4, i3, kwin_x11, xsetroot`) after the pid-tree excludes.
**Why**: apps launched from the IceWM toolbar are children of `icewm` — an ancestry rule would hide exactly the apps the toolbar exists to launch; `icewm ×1` in the off-confirm dialog is noise.
**Rejected**: excluding the WM's whole process subtree; excluding by `DISPLAY` env owner (every X client has it).
*Introduced by*: 260910-2jl3-gui-desktop-icewm-and-launcher

#### The three stamps land in one burst before the WM starts
**Decision**: the supervisor resolves the WM (pin or ladder), resolves the launcher apps, seeds the profile, and only then stamps `@rk_gui_display`, `@rk_gui_backend`, `@rk_gui_wm` together, then starts the WM.
**Why**: `rk gui on` reads the stamps once with a single bounded await; stamping `wm` after the WM start would race that read and print a bare `started (…)` for a healthy desktop. Seeding needs no X server, so nothing is delayed.
**Rejected**: a second await for `wm` (a second timeout budget for one line of output); stamping `wm` from the daemon's probe tick (the daemon does not know which rung won).
*Introduced by*: 260910-2jl3-gui-desktop-icewm-and-launcher

#### Install hints are package-manager-aware wording only
**Decision**: `PackageManager(lookPath)` probes `apt-get → dnf → pacman` by presence; every hint string is built from it; nothing is ever executed.
**Why**: the toolkit `install-composition` standard — probe, degrade, hint; a Fedora or Arch user should not be told an apt line. Non-apt package names are best-effort (intake assumption #3).
**Rejected**: running `apt` from rk (G-D2 forbids it); a single generic sentence (unactionable on the common apt host).
*Introduced by*: 260910-2jl3-gui-desktop-icewm-and-launcher

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/backend/internal/gui/hint.go` with `PackageManager`, `WMInstallHint`, `InstallHint(lookPath)` (exact strings per intake § 4); delete `InstallHint()` from `state.go`; change `NoBackendReason` in `status.go` to a func; update every caller (`internal/daemon/gui.go` `ensureGUICore` → `guiLookPath`, `cmd/rk/gui.go` `runGuiOn` → `guiLookPathFn`, `cmd/rk/gui_supervise.go` → `guiSuperviseLookPath`, `NotRunningReason`) and every test asserting the old strings; add `hint_test.go` covering all four managers × three hints. <!-- R7 -->
- [x] T002 [P] Add `Settings.GUIWM` and the `gui.wm` registry row after `gui.enabled` in `app/backend/internal/settings/settings.go` (string, `""`, behavior, ui true, live false, description verbatim from R12); extend `settings_test.go` with round-trip (omitted when empty, `gui.wm: "openbox"` when set, `null` unsets) and bump any inventory-count assertion. <!-- R12 -->
- [x] T003 [P] Add `GUIOptionWM = "@rk_gui_wm"` to `app/backend/internal/daemon/gui.go` and widen `GUISessionOptions` to `(display, backend, wm string, ok bool)`; widen every seam and stub — `api/sse.go` hub `guiSessionOptionsFn`, `api/router.go` Server `guiSessionOptionsFn` + `api/gui.go` `guiSessionOptions`, `cmd/rk/gui.go` `guiSessionOptionsFn` + `guiAwaitStamps` callers, `cmd/rk/doctor.go` `guiDoctorCheck`, `internal/gui/assemble.go` `StatusDeps.SessionOptions` — and their tests so `go build ./... && go vet ./...` pass with `wm` threaded but not yet rendered. <!-- R8 -->

### Phase 2: Core Implementation

- [x] T004 In `app/backend/internal/gui/backend.go` reorder the ladder (`icewm-session` first), add `WMLadder()`, `WMArgv(name)`, and `ResolveWM(lookPath, pin) (argv, pinMissed, ok)`; update `backend_test.go` with the table from R1 (ladder order, pin hit, pin miss, pin miss + empty ladder, x-session-manager wrap on both paths, icewm flags on both paths). <!-- R1 -->
- [x] T005 [P] Create `app/backend/internal/gui/seed/preferences` (embedded content verbatim from intake § 2) and `app/backend/internal/gui/seed.go` with `ProfileDir()` and `SeedProfile(dir, terminal, browser)`; add `seed_test.go` per R3's three scenarios plus a permissions check. <!-- R3 -->
- [x] T006 [P] Create `app/backend/internal/gui/launch.go` with `AppRole`/`ParseAppRole`/`ResolveApp`/`LaunchHint`/`LaunchEnv`/`StartDetached` and `launch_test.go` (ladder order per role, dangling-alternative skip, whole-ladder miss, `ParseAppRole` rejections, hints × 4 managers × 2 roles, `LaunchEnv` replace-not-duplicate); make `cmd/rk/gui_exec.go`'s `guiExecEnv`/`guiExecStartDetached` delegate to them with the existing `gui_exec_test.go` still green. <!-- R4 -->
- [x] T007 [P] Add the `wmHelperComms` set and filter to `app/backend/internal/gui/apps_linux.go`; add the R9 fake-procRoot test to `apps_linux_test.go`. <!-- R9 -->
- [x] T008 Add `WM`/`WMHint` to `gui.Status` and `WM` to `gui.StreamEntry` in `app/backend/internal/gui/status.go`; fill `st.WM` and the reachable+bare `WMHint` in `assemble.go`; extend `assemble_test.go` per R8's first two scenarios. <!-- R8 -->
- [x] T009 Store `guiWM` in the hub (`api/sse.go` field, `guiTick` assignment, `guiPayloadLocked` emission) and assert `"wm"` in the payload in the hub's gui tests. <!-- R8 -->
- [x] T010 Rework `app/backend/cmd/rk/gui_supervise.go` per R2: `guiSuperviseSettingsLoad`/`guiSuperviseStat`/`guiSuperviseSeed` seams, pin resolution + pin-miss line, app resolution, icewm-only seeding with the failure line, the three-stamp burst (`daemon.GUIOptionWM`), the new log lines (`guiNoWMLine(hint)` derived from `gui.WMLadder()`), `ICEWM_PRIVCFG` in the WM env for the icewm rung only, and the updated `Long`; extend `gui_supervise_test.go` for R2's three scenarios. <!-- R2 -->

### Phase 3: Integration & Edge Cases

- [x] T011 In `app/backend/cmd/rk/gui.go`: `guiAwaitStamps` returns `wm`; `runGuiOn`/`runGuiRestart` print the R10 WM lines via `Notef`; `guiOnSummary` gains `wm` and viewer pluralization (R11); `guiStatusSummary` passes `st.WM`; update `gui_test.go` for R10/R11 and the pluralized strings; add the `launch` row to `guiCmd.Long`. <!-- R10 -->
- [x] T012 [P] Create `app/backend/cmd/rk/gui_launch.go` (verb, `guiStatFn`/`guiLaunchStartFn` seams, registration in `init()` before the `usageArgs` loop) and `gui_launch_test.go` covering R5's three scenarios plus the darwin refusal, bad-role exit 2, and start-failure exit 1. <!-- R5 -->
- [x] T013 [P] Add `handleGuiLaunch` to `app/backend/api/gui.go`, the `guiStatFn`/`guiLaunchFn` Server seam fields in `api/router.go`, and the `r.Post("/api/gui/{id}/launch", …)` route beside restart; extend `api/gui_test.go` with every row of R6's table. <!-- R6 -->
- [x] T014 [P] Thread `wm` into `guiCheck`/`guiDoctorCheck` in `app/backend/cmd/rk/doctor.go` and render the R11 doctor notes; update `doctor_test.go` for the three gui notes. <!-- R11 -->
- [x] T015 Create `app/backend/cmd/rk/gui_supervise_integration_test.go` per R13 (linux build tag, capability skip, temp `XDG_STATE_HOME`/`RK_CONFIG_DIR`, recorder stamps, profile-file and `RunningApps` assertions, clean teardown); run it on this VM. <!-- R13 -->
- [x] T016 Run `cd app/backend && go test ./... && go vet ./...` and `just build`; fix every failure without weakening a spec-conformant test (Test Integrity). All green 2026-09-10. <!-- R1 -->

### Phase 4: Polish

- [x] T017 Update `docs/specs/gui.md` per R14 (§ The substrate diagram WM line, § The switch hints + `gui.wm`, § Protocol and relay route list, § Agent verbs `launch`, § Phasing closing clause struck with a pointer to the child plan, § The supervisor content — add a short § The supervisor / § The desktop subsection if none exists). <!-- R14 -->
- [x] T018 [P] Extend `docs/site/skill/gui.md` with a `rk gui launch` section and the profile directory (≤150 lines), run `scripts/sync-skill.sh` so `app/backend/cmd/rk/skill/gui.md` matches, and confirm `go test ./cmd/rk -run Skill` passes. <!-- R14 -->
- [x] T019 [P] Add the pointer row to `fab/plans/sahil/26-09-09-gui-surface.md` § Change breakdown (`G1/G2 — see 26-09-10-gui-desktop.md`, no other edit); if `command -v shll` succeeds, read `shll standards help-dump` and `shll standards principles` and confirm the new verb conforms (help text present in `rk gui --help` Subcommands, `--quiet`-safe datum-only stdout), fixing any gap. <!-- R14 -->
- [x] T020 Run `just test` (backend + frontend + e2e) from the repo root and confirm green; record the run in the task line. 2026-09-10: backend ok 15s, frontend ok 22s, e2e ok 11m30s (399 passed, 1 skipped). <!-- R13 -->

## Execution Order

- T001–T003 first (they change shared signatures every later task compiles against); T002/T003 may run alongside T001
- T004–T007 are independent of each other but depend on T001/T003
- T008 depends on T003 and T001; T009 depends on T008; T010 depends on T004, T005, T006, T001
- T011 depends on T003, T008, T001; T012 depends on T006, T011 (the `Long` row and the family init); T013 depends on T006, T008; T014 depends on T003, T011 (`guiOnSummary`), T001
- T015 depends on T010, T005, T007; T016 after all code tasks
- T017–T019 after T016; T020 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `gui.WMLadder()` yields `icewm-session, openbox, xfwm4, i3, kwin_x11, x-session-manager` and `WMArgv` returns the three documented argv shapes
- [x] A-002 R1: `ResolveWM` honors a resolvable pin, reports `pinMissed` on an unresolvable one, and falls back to the ladder
- [x] A-003 R2: the supervisor stamps `@rk_gui_wm` with `argv[0]` (or `""`) after display/backend and before starting the WM
- [x] A-004 R2: the supervisor seeds the profile and sets `ICEWM_PRIVCFG` only for the icewm rung
- [x] A-005 R3: `SeedProfile` writes `preferences` once, regenerates `toolbar`/`menu` every call with rows only for resolved apps, dir `0700`/files `0600`
- [x] A-006 R4: `ResolveApp` walks the two fixed ladders with the stat guard; `ParseAppRole` accepts exactly two values; `LaunchHint` covers four managers for both roles
- [x] A-007 R4: `gui_exec.go` delegates env and detached start to `gui.LaunchEnv`/`gui.StartDetached` with no duplicated logic
- [x] A-008 R5: `rk gui launch terminal|browser` exists on the family, is listed in `rk gui --help`, and prints `started <name> (pid <n>) on :N`
- [x] A-009 R6: `POST /api/gui/{id}/launch` is routed and returns every row of R6's table
- [x] A-010 R7: `PackageManager`, `WMInstallHint`, `InstallHint(lookPath)` exist with the exact strings; `NoBackendReason` is a function; no caller uses the removed zero-arg `InstallHint`
- [x] A-011 R8: `GUISessionOptions` returns `wm`; `StreamEntry.wm`, `Status.wm`, `Status.wm_hint` exist; `Assemble` fills them; the hub payload carries `wm`
- [x] A-012 R9: `RunningApps` excludes the eleven helper comm names
- [x] A-013 R10: `rk gui on`/`restart` print the WM lines per § UX after the `started`/`restarted` datum
- [x] A-014 R11: `guiOnSummary` carries the WM segment and pluralizes viewers; the doctor bare note appends the install hint
- [x] A-015 R12: `gui.wm` is a registry row after `gui.enabled` with the specified attributes and description
- [x] A-016 R13: the integration test exists, is capability-gated, and passes on a host with both binaries
- [x] A-017 R14: `docs/specs/gui.md`, `docs/site/skill/gui.md` (+ synced embed), and the parent plan's pointer row are updated

### Behavioral Correctness

- [x] A-018 R1: on a host with both openbox and icewm, `ResolveWM` with an empty pin picks `icewm-session` (behavior change from openbox is intended; `gui.wm: "openbox"` restores it)
- [x] A-019 R7: the Linux no-backend hint no longer carries the `install a VNC X server and a window manager:` prefix nor names `openbox`
- [x] A-020 R11: a status with one viewer renders `1 viewer`, zero renders `0 viewers`
- [x] A-021 R2: the no-WM supervisor line names all six ladder entries and ends with `, then rk gui restart`

### Scenario Coverage

- [x] A-022 R2: unit test — icewm resolved ⇒ stamp order display/backend/wm, seeded log line, toolbar line, `ICEWM_PRIVCFG` in env
- [x] A-023 R2: unit test — nothing resolved ⇒ `@rk_gui_wm ""`, no-WM line with fake-manager hint, no `ICEWM_PRIVCFG`
- [x] A-024 R2: unit test — pin miss line `gui: gui.wm=xfwm4 not on PATH; falling back to the ladder`
- [x] A-025 R3: unit tests — first seed, user-edit survival (byte-identical), toolbar tracks a changed resolution, delete re-seeds
- [x] A-026 R4: unit test — dangling alternative skipped (lookPath hit, stat miss) and the next rung chosen
- [x] A-027 R5: unit tests — success line, browser-miss hint exit 1, off refusal exit 1, darwin refusal, bad role exit 2
- [x] A-028 R6: handler tests — 400 id, 400 app, 409 disabled, 409 not-running, 200 ok:false, 500 start failure, 200 ok:true
- [x] A-029 R8: `Assemble` tests — wm set; hint only when reachable and bare; stream payload carries `wm`
- [x] A-030 R9: fake-procRoot test yields `[{xterm 1}]` with icewm processes present
- [x] A-031 R10: `rk gui on` tests — WM line, two-line bare hint, timeout fallback prints `started` only
- [x] A-032 R12: settings round-trip tests — omitted when empty, set, `null` unsets
- [x] A-033 R13: integration test passes on this VM and leaves no `Xtigervnc`/`icewm*` process behind

### Edge Cases & Error Handling

- [x] A-034 R2: a `SeedProfile` error logs the failure line and the supervisor still starts icewm
- [x] A-035 R4: `ResolveApp` with an empty ladder result returns `ok=false` and the toolbar/menu omit that row rather than writing an empty command
- [x] A-036 R6: the launch handler never accepts argv — a body with extra keys or a non-string `app` is a 400
- [x] A-037 R7: `PackageManager` returning `""` yields the generic sentences on every hint surface
- [x] A-038 R8: an unset or empty `@rk_gui_wm` reads as `""` without affecting `ok`; `wm_hint` is absent from the JSON when empty

### Code Quality

- [x] A-039 Pattern consistency: new seams follow the existing `gui*Fn`/`guiSupervise*` package-var idiom; new files carry package-level doc comments in the surrounding style; comments state constraints, never narrate or cite change IDs
- [x] A-040 No unnecessary duplication: env composition and detached start exist once in `internal/gui`; the ladder text exists once (`WMLadder()`); `guiOnSummary` is the single renderer for status and doctor
- [x] A-041 Security first: every subprocess uses argv slices via `exec.Command`/`exec.CommandContext`; the launcher's argv is the resolved path only; the profile dir is `0700` and files `0600`; no shell strings
- [x] A-042 Named constants: `GUIOptionWM`, `wmHelperComms`, the ladders, and the hint strings are named, not inline magic literals
- [x] A-043 Tests included: every new behavior has a colocated `_test.go`; existing tests were updated to the spec, not the spec to the tests

### Security

- [x] A-044 R6: `POST /api/gui/{id}/launch` cannot start anything the two ladders do not name — verified by the bad-app 400 test and by inspection that argv derives only from `ResolveApp`
- [x] A-045 R5: `rk gui launch` refuses (exit 1) when the GUI is off or unreachable and starts no process

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **Live-VM acceptance** (the plan's manual checks — `rk gui restart` showing the NanoBlue taskbar, `rk gui launch terminal` appearing in `apps:`) is verified by the human against a rebuilt daemon binary; it is not a review gate. Do not touch the live `rk-gui` session while `tmux -L rk-daemon list-windows -t rk-jobs` shows a perf job.
- The G1 PR column in `fab/plans/sahil/26-09-10-gui-desktop.md` is filled by the orchestrator after ship; Status → Done at merge.

## Deletion Candidates

None — this change adds new functionality without making existing code redundant. The change's own planned removals were completed in-diff (the zero-arg `gui.InstallHint()` in `internal/gui/state.go`, the `NoBackendReason` const in `internal/gui/status.go`, and `gui_exec.go`'s inline env/detach bodies, replaced by delegation to `gui.LaunchEnv`/`gui.StartDetached`); review found no further dead code.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `ResolveWM` returns `(argv, pinMissed, ok)` and the per-binary flags live in `WMArgv(name)` | Intake assumptions #11/#25; one place owns flags for pin and ladder alike | S:85 R:90 A:90 D:85 |
| 2 | Confident | The launch handler's not-running gate uses `buildGuiStatus` (one assembly) and returns 409 with the `guiErrNotRunning` text | Intake assumption #13; mirrors the restart handler's 409 shape and reuses the CLI's hint vocabulary | S:70 R:90 A:80 D:65 |
| 3 | Confident | The integration test lives in `cmd/rk` and captures stamps via the `guiSuperviseTmuxRun` seam | Intake assumption #18 | S:65 R:90 A:85 D:70 |
| 4 | Confident | `guiSuperviseStartWM` gains an extra-env parameter (nil for non-icewm rungs) rather than a second seam | Smallest signature change that keeps the test's env assertion direct | S:60 R:90 A:85 D:70 |
| 5 | Certain | Menu-curation keys are omitted from the seeded `preferences`; the `Settings` row is accepted | Plan Risk 2; intake assumption #20 | S:90 R:95 A:80 D:85 |
| 6 | Confident | The `ICEWM_PRIVCFG`-relocates-`startup` question is verified during T015 on this VM; if it fails, `WMArgv` for icewm also passes `--config <dir>/preferences` | Plan Risk 3 with its stated fallback; intake assumption #19 | S:60 R:85 A:50 D:60 |

6 assumptions (2 certain, 4 confident, 0 tentative).
