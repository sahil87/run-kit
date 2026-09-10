# Intake: GUI desktop — the IceWM rung, seeded profile, WM stamp, and launcher (G1)

**Change**: 260910-2jl3-gui-desktop-icewm-and-launcher
**Created**: 2026-09-10

## Origin

> Implement G1 from fab/plans/sahil/26-09-10-gui-desktop.md — Backend: the IceWM rung, seeded profile, stamp, and launcher (slug: gui-desktop-icewm-and-launcher). Read the full plan file in full, especially the § Spike verdict, § Decision log (G-D1 through G-D9 — treat as Certain in SRAD scoring, except the non-apt package names in G-D2 which are Likely), § UX, and the G1 § Do / § Acceptance sections, before drafting the intake. Follow the § Pickup protocol section too (read docs/specs/gui.md and the named memory files first).

One-shot `/fab-new` invocation. No conversational discussion in this session — the design record is the plan file `fab/plans/sahil/26-09-10-gui-desktop.md` (written from the bronze-crane `/fab-discuss` thread), whose § Decision log G-D1–G-D9 is binding and whose § UX lines are the exact copy this change ships. Per the plan's § Pickup protocol the intake author read: the plan in full, the parent plan `26-09-09-gui-surface.md` § Decision log and § C5 verdict, `docs/specs/gui.md`, the constitution, and the memory files `gui`, `daemon-lifecycle`, `configuration`, `tmux-sessions`, plus the current source of `internal/gui/`, `internal/daemon/gui.go`, `cmd/rk/gui*.go`, `api/gui.go`, `api/sse.go` (the `guiTick`), `cmd/rk/doctor.go` (the gui row), `internal/settings/settings.go` (the `gui.enabled` row), and `docs/site/skill/gui.md`. The G1 row in the plan's § Change breakdown was filled with this change's folder name at creation (the pickup protocol's step 4); the PR column and the parent-plan pointer row land in the same PR as the code.

G2 (`gui-desktop-tile-strip-and-palette`, the frontend strip + palette rows, G-D8) is a separate later change that depends on this one's `wm` stream field and launch endpoint being on `main`.

## Why

**The pain.** The supervisor's window-manager ladder is `openbox → xfwm4 → i3 → kwin_x11 → x-session-manager`, and the development VM (`dev-ws-sahil01`, Ubuntu 22.04) has openbox, so the gui tile on a fresh host shows a bare openbox root: the solid `#3b4252` ground C5 painted and a right-click menu whose entries point at `x-terminal-emulator` / `x-www-browser`. Nothing on screen says "this is a desktop", nothing is reachable by tap on a phone (a right-click menu needs a fine pointer), and `x-www-browser` has no alternative registered on this host so the browser entry fails silently. A person opening the tile sees a colored rectangle and does not know what to do; an agent has `rk gui exec` but the human has no launcher at all.

**The consequence of not fixing it.** The GUI surface is turned on by the user (Constitution: never on by default), and the first thing they see after turning it on decides whether they keep it on. A bare root with a dead menu reads as broken. Every later GUI change (C6 bandwidth work, G2's strip) inherits a desktop nobody can drive without an agent.

**The approach, and why.** The plan's spike (§ Spike verdict) measured IceWM 2.9.6 on throwaway displays: 29 MB idle RSS for the `icewm-session` + `icewm` pair, no D-Bus, no session manager, a taskbar with a start menu and clock built in, and a first-class private config directory (`ICEWM_PRIVCFG`) that IceWM never writes into on start — so rk can own the look by seeding files. `--nobg` skips `icewmbg` and keeps rk's `xsetroot` ground (a theme's `DesktopBackgroundImage` otherwise wins over every preference). Install is 4 packages with `--no-install-recommends` (49 without). It costs nothing against the parent plan's D9 budget. XFCE/LXQt stay reachable via `x-session-manager` or a pin but are not recommended.

Three constraints shape the rest:

- **rk never runs the package manager** (G-D2; toolkit `install-composition` standard — probe, degrade, hint). So the change is a better ladder rung plus one actionable install line on *every* surface: `rk gui on`, the supervisor pane, `rk gui status`, `GET /api/gui/{id}`, the `event: gui` stream (for G2's strip), and `rk doctor`.
- **Constitution I / IV**: the human and the phone need a tap-reachable "open a terminal" — but never an arbitrary command over HTTP. So one two-role allowlisted launcher (`terminal` | `browser`) resolved server-side with `LookPath`, shared by the CLI verb, the HTTP endpoint, and the seeded IceWM toolbar/menu rows.
- **Constitution II / X**: the supervisor is the only process that knows which WM rung won, so it stamps `@rk_gui_wm` on the `rk-gui` session (the existing `@rk_gui_display`/`@rk_gui_backend` idiom) and every reader derives from that stamp on its tick. The tile (G2) can then render the bare-WM strip without polling.

Alternatives the plan rejected and this intake does not reopen: auto-installing anything; building an rk-drawn panel instead of a WM's taskbar (Constitution III — IceWM draws the desktop); XFCE/LXQt as recommended rungs; ancestry-based exclusion of WM helpers from the running-apps list (apps launched from the IceWM toolbar are children of `icewm` and must stay listed); a "no apps yet" overlay in the tile (with IceWM the taskbar is the affordance).

## What Changes

All backend (`app/backend/`) plus docs. Every user-facing string below is the plan's § UX copy verbatim and is the acceptance copy; `<pm-line>` is the package-manager-aware WM install line, `<pm-line-backend>` its backend+WM form (§ Install hints below).

### 1. The WM ladder: IceWM first, an optional pin — `internal/gui/backend.go`

`wmLadder` becomes `[]string{"icewm-session", "openbox", "xfwm4", "i3", "kwin_x11", "x-session-manager"}` (G-D1).

`ResolveWM` gains the pin and a pin-miss signal. Target shape:

```go
// WMArgv returns the launch argv for one window-manager binary name:
// icewm-session runs --nobg --notray (icewmbg would paint a theme wallpaper
// over rk's xsetroot ground; the tray is dead weight on a single-user
// display), x-session-manager runs under dbus-run-session, anything else
// runs bare.
func WMArgv(name string) []string

// ResolveWM picks the window manager: the pin (gui.wm) when non-empty and
// on PATH, else the first ladder rung on PATH. pinMissed reports a non-empty
// pin that did not resolve (the caller logs the fallback line); ok=false
// means nothing resolved and the display runs bare.
func ResolveWM(lookPath func(string) (string, error), pin string) (argv []string, pinMissed, ok bool)
```

- `WMArgv("icewm-session")` = `["icewm-session", "--nobg", "--notray"]`; `WMArgv("x-session-manager")` = `["dbus-run-session", "--", "x-session-manager"]`; `WMArgv("openbox")` = `["openbox"]`. A pin of `icewm-session` gets the same flags as the ladder rung (the flags belong to the binary, not to how it was chosen).
- `WMLadder()` (exported accessor, or an exported `WMLadder` slice) so the supervisor's no-WM log line and tests name the ladder from one place — the string `icewm-session, openbox, xfwm4, i3, kwin_x11, x-session-manager` must not be hand-typed twice.
- Table test (`backend_test.go`): ladder order (icewm-session wins over an installed openbox), pin hit (pin `openbox` with icewm installed → `["openbox"]`, `pinMissed=false`), pin miss (pin `xfwm4` not on PATH → falls to the ladder, `pinMissed=true`), pin miss with an empty ladder (`pinMissed=true, ok=false`), `x-session-manager` wrap preserved for both pin and ladder, icewm flags for both pin and ladder.

### 2. The seeded IceWM profile — `internal/gui/seed.go` (new) + `internal/gui/seed/preferences` (new, `go:embed`)

Directory `<gui.StateDir()>/icewm/` = `$XDG_STATE_HOME/run-kit/gui/icewm/` (beside `host.sock`), created `0700`; files `0600` (G-D3). Two file classes:

- **`preferences` — write-once.** Seeded when absent; never rewritten while present (the code-server `settings.json` rule: user edits persist, deleting the file re-seeds). Content, `go:embed`ded verbatim:

  ```
  # run-kit seeded IceWM preferences — edit freely; delete to re-seed.
  Theme="NanoBlue/default.theme"
  TaskBarShowCPUStatus=0
  TaskBarShowMailboxStatus=0
  TaskBarShowNetStatus=0
  TaskBarShowAPMStatus=0
  TaskBarShowWorkspaces=0
  TaskBarShowShowDesktopButton=0
  TaskBarShowWindowListMenu=0
  TaskBarClockLeds=0
  WorkspaceNames=" run-kit "
  ```

  No menu-curation keys (`ShowSettingsMenu`/`ShowThemesMenu` had no effect on 2.9.6 in the spike — plan Risk 2): the bottom `Settings` row is accepted. IceWM logs and ignores an unknown key, so the unverified taskbar keys are harmless if a version lacks them.

- **`toolbar` and `menu` — regenerated on every supervise start** from the runtime-resolved terminal/browser (§ 3), rows omitted when a role did not resolve. Header comments say so:

  ```
  # generated by rk gui supervise on every start — edit preferences instead
  prog Terminal terminal <resolved-terminal>
  prog Browser web-browser <resolved-browser>
  ```
  ```
  # generated by rk gui supervise on every start
  prog Terminal terminal <resolved-terminal>
  prog Browser web-browser <resolved-browser>
  separator
  includeprog icewm-menu-fdo --no-sep-others --seps
  ```

  `<resolved-terminal>` / `<resolved-browser>` are the **argv[0] as resolved by the launcher ladder** (e.g. `x-terminal-emulator`, `chromium`) — the plain binary name, not an absolute path and never an rk binary path (regenerating each start is what keeps user files free of rk paths). IceWM `prog` syntax is `prog <Title> <icon-name> <command…>`.

API:

```go
// SeedProfile seeds the IceWM private config dir: writes preferences only
// when absent (write-once — user edits persist; delete to re-seed) and
// always rewrites toolbar and menu from the resolved apps (rows only for
// non-empty names). Directory 0700, files 0600. seeded reports whether
// preferences was written on this call (the supervisor's log line).
func SeedProfile(dir string, terminal, browser string) (seeded bool, err error)

// ProfileDir is <StateDir>/icewm — the value passed as ICEWM_PRIVCFG.
func ProfileDir() (string, error)
```

Tests on a `t.TempDir()`: first call seeds all three files with `0600` and dir `0700`, `seeded=true`; a user edit to `preferences` survives a second call byte-identical (`seeded=false`); `toolbar`/`menu` track a changed resolution (browser `""` → no Browser row; then `chromium` → row present); deleting `preferences` re-seeds.

**Apply-time verification (plan Risk 3):** confirm on this VM that `ICEWM_PRIVCFG` also relocates `startup`/`shutdown` (IceWM's docs say the private dir is the one home). If `icewm-session` still reads `~/.icewm/startup`, pass `--config <dir>/preferences` and `--theme` explicitly in `WMArgv` for the icewm rung and record the finding in memory. Either way `~/.icewm` is never written by rk.

### 3. The launcher ladders — `internal/gui/launch.go` (new)

G-D5. Two roles, fixed ladders, resolved server-side:

| Role | Ladder (first on PATH wins) |
|---|---|
| `terminal` | `x-terminal-emulator, xterm, uxterm, lxterm, foot, alacritty, kitty, gnome-terminal, xfce4-terminal` |
| `browser` | `chromium, chromium-browser, google-chrome, google-chrome-stable, firefox, x-www-browser` |

```go
type AppRole string
const (
    AppTerminal AppRole = "terminal"
    AppBrowser  AppRole = "browser"
)

// ParseAppRole accepts exactly "terminal" | "browser" (the HTTP body and
// the CLI argument share it); anything else is an error naming both.
func ParseAppRole(s string) (AppRole, error)

// ResolveApp returns the first ladder entry for role that lookPath resolves
// AND whose resolved path stat succeeds — a Debian alternative
// (/usr/bin/x-www-browser → /etc/alternatives/x-www-browser → <missing>)
// can be a dangling symlink; the stat follows it. name is the ladder entry
// (argv[0] for the toolbar rows), path the resolved binary. ok=false when
// the whole ladder misses.
func ResolveApp(role AppRole, lookPath func(string) (string, error), stat func(string) (os.FileInfo, error)) (name, path string, ok bool)

// LaunchHint is the per-manager missing-app line (G-D2 wording):
//   browser  apt: "no browser on the GUI host — sudo apt install chromium-browser"
//            dnf: "… — sudo dnf install chromium"   pacman: "… — sudo pacman -S chromium"
//            none: "no browser on the GUI host — install a browser with your package manager"
//   terminal apt: "no terminal on the GUI host — sudo apt install xterm"
//            dnf: "… — sudo dnf install xterm"      pacman: "… — sudo pacman -S xterm"
//            none: "no terminal on the GUI host — install a terminal with your package manager"
func LaunchHint(role AppRole, lookPath func(string) (string, error)) string

// LaunchEnv is the child environment: base with DISPLAY and RK_GUI_SOCKET
// set (existing entries replaced, never duplicated) — guiExecEnv's rule,
// moved here so the CLI verb and the HTTP handler share it.
func LaunchEnv(base []string, display, socket string) []string

// StartDetached starts argv as its own session (Setsid) with stdio on
// /dev/null and never waits — the `rk gui exec --detach` primitive, moved
// here so api/ can launch without importing cmd/rk. Returns the pid.
func StartDetached(argv, env []string) (pid int, err error)
```

`cmd/rk/gui_exec.go`'s `guiExecEnv` and `guiExecStartDetached` become thin delegations to `gui.LaunchEnv` / `gui.StartDetached` (no duplicated utility — code-quality anti-pattern); their existing tests keep passing through the delegation. Tests for `launch.go` use fake `lookPath`/`stat` maps: ladder order per role, the dangling-alternative skip (lookPath hits, stat fails → next rung), whole-ladder miss, `ParseAppRole` rejects `xterm`/`""`, `LaunchHint` for all four manager cases × two roles, `LaunchEnv` replace-not-duplicate.

### 4. Package-manager-aware install hints — `internal/gui/hint.go` (new)

G-D2. Detection is by binary presence, wording only — rk never executes any of these:

```go
// PackageManager reports "apt" | "dnf" | "pacman" | "" by probing
// apt-get, dnf, pacman on PATH in that order.
func PackageManager(lookPath func(string) (string, error)) string

// WMInstallHint is the one-line install command for the window manager:
//   apt    "sudo apt install --no-install-recommends icewm"
//   dnf    "sudo dnf install icewm"
//   pacman "sudo pacman -S icewm"
//   ""     "install icewm with your package manager"
func WMInstallHint(lookPath func(string) (string, error)) string

// InstallHint is the missing-backend line (backend + WM):
//   linux/apt    "sudo apt install --no-install-recommends tigervnc-standalone-server icewm"
//   linux/dnf    "sudo dnf install tigervnc-server icewm"
//   linux/pacman "sudo pacman -S tigervnc icewm"
//   linux/""     "install a VNC X server (TigerVNC) and icewm with your package manager"
//   darwin       "enable System Settings › General › Sharing › Screen Sharing"   (unchanged)
//   other        ""
func InstallHint(lookPath func(string) (string, error)) string
```

`InstallHint()` moves from `state.go` to `hint.go` and **gains the `lookPath` parameter** (the old form took none and hard-coded apt). The Linux line drops the old `install a VNC X server and a window manager:` prefix — the § UX line is `enabled — no VNC backend installed: sudo apt install --no-install-recommends tigervnc-standalone-server icewm`, the caller supplies the prefix. Callers updated: `daemon.ensureGUICore` (its `slog.Warn` hint; use `guiLookPath`), `cmd/rk/gui.go runGuiOn` (`guiLookPathFn`), `cmd/rk/gui_supervise.go` (the no-backend error; `guiSuperviseLookPath`).

`gui.NoBackendReason` (currently a const `no VNC backend: sudo apt install tigervnc-standalone-server openbox`) becomes `func NoBackendReason(lookPath) string` = `"no VNC backend: " + InstallHint(lookPath)`; `NotRunningReason` already receives `lookPath` and passes it through. The non-apt package names (`tigervnc-server` on dnf, `tigervnc` on pacman, `chromium` on dnf/pacman) are from packaging knowledge and unverified here — recorded Confident, not Certain, in § Assumptions; they are wording, never executed.

Tests: `PackageManager` for the four cases; every hint string for every manager; the existing `InstallHint` / `NotRunningReason` / doctor / status tests updated for the new strings.

### 5. The supervisor — `cmd/rk/gui_supervise.go`

New behavior in `runGuiSuperviseLinux`, in this order (the order matters for `rk gui on`'s stamp read — § 8):

1. After the backend is up and the socket is `chmod 0600`: **resolve the WM** — `pin := guiSuperviseSettingsLoad().GUIWM` (new seam over `settings.Load`, so tests stay config-free), `argv, pinMissed, ok := gui.ResolveWM(guiSuperviseLookPath, pin)`. When `pinMissed`, log `gui: gui.wm=<pin> not on PATH; falling back to the ladder`.
2. **Resolve the launcher apps** once: `term, _, _ := gui.ResolveApp(gui.AppTerminal, guiSuperviseLookPath, guiSuperviseStat)`, same for browser (`guiSuperviseStat` = `os.Stat` seam).
3. **Seed the profile** when the chosen WM is the icewm rung (`argv[0] == "icewm-session"`): `dir, _ := gui.ProfileDir()`; `seeded, err := guiSuperviseSeed(dir, term, browser)` (seam over `gui.SeedProfile`); an error logs `gui: seeding the IceWM profile at <dir> failed: <err>; starting icewm with its defaults` and continues (best-effort — the desktop must still come up).
4. **Stamp all three options together**: `@rk_gui_display :N`, `@rk_gui_backend <bin>`, then `@rk_gui_wm <argv[0]>` (or `""` when `!ok`) via `guiStampSessionOption(daemon.GUIOptionWM, wm)` — the constant is new in `internal/daemon/gui.go` (§ 6). Stamping `""` is deliberate: the reader distinguishes nothing between "bare" and "unset", both render `wm:""`.
5. **Log lines** (§ UX Supervisor pane), after the existing `gui: Xtigervnc up on :10 (socket …)`:
   - WM found: `gui: window manager icewm-session (config <dir>, seeded preferences)` — the `, seeded preferences` suffix only when `seeded` is true; a non-icewm rung logs `gui: window manager openbox` (no config segment).
   - Then, for the icewm rung only: `gui: toolbar: terminal=<name|none> browser=<name|none>` (e.g. `gui: toolbar: terminal=x-terminal-emulator browser=none`).
   - No WM: `gui: no window manager found (tried icewm-session, openbox, xfwm4, i3, kwin_x11, x-session-manager); running bare — <pm-line>, then rk gui restart` — `guiNoWMLine(hint string)` takes the hint and derives the ladder text from `gui.WMLadder()`.
6. **Start the WM** with the existing `guiSuperviseStartWM(ctx, argv, display)` — the seam gains the env: for the icewm rung the child env carries `ICEWM_PRIVCFG=<dir>` in addition to `DISPLAY`; every other rung is unchanged. Shape: `guiSuperviseStartWM(ctx, argv, display string, extraEnv []string)` or the seam builds env from a `[]string` the caller passes — either way the test asserts `ICEWM_PRIVCFG` is present exactly for the icewm rung.
7. `paintGuiRootBackground` unchanged (the `xsetroot -solid #3b4252` ground stays; `--nobg` is what lets it show).

Teardown unchanged: the signal trap and the backend-exit path kill the WM (`icewm-session` on SIGTERM/kill leaves no icewm process behind — spike verified); the seeded dir is never deleted by rk.

`newGuiSuperviseCmd`'s `Long` text names the new ladder head and the profile dir. Tests (`gui_supervise_test.go`, already X-free via seams): the stamp argv includes `@rk_gui_wm icewm-session` when the fake lookPath has icewm; `""` when nothing resolves; `ICEWM_PRIVCFG` only on the icewm rung; the pin-miss log line; the seeded/not-seeded log variants; the toolbar line; the no-WM line carries the fake-manager hint.

### 6. The stamp and the stream — `internal/daemon/gui.go`, `api/sse.go`, `internal/gui/status.go`, `internal/gui/assemble.go`

G-D4.

- `internal/daemon/gui.go`: `GUIOptionWM = "@rk_gui_wm"` beside `GUIOptionDisplay`/`GUIOptionBackend`. `GUISessionOptions` widens to `(display, backend, wm string, ok bool)`: `ok` still requires display and backend non-empty (unchanged semantics); `wm` is read best-effort and an unset/empty option reads as `""`. The `guiSessionOption` read of an option stamped to the empty string returns `""` (tmux prints an empty line) — same outcome.
- Every seam typed `func(ctx) (display, backend string, ok bool)` widens to carry `wm`: `api/sse.go` hub `guiSessionOptionsFn`, `api/router.go` Server `guiSessionOptionsFn` + `api/gui.go guiSessionOptions`, `cmd/rk/gui.go guiSessionOptionsFn`, `cmd/rk/doctor.go`'s use, and `gui.StatusDeps.SessionOptions`. Tests that stub these seams gain the extra return.
- `gui.StreamEntry` gains `WM string \`json:"wm"\`` as the ninth field (always present; `""` when bare or disabled). `gui.Status` gains `WM string \`json:"wm"\`` (after `Viewers`, keeping stream order first) and `WMHint string \`json:"wm_hint,omitempty"\`` among the document-only fields.
- `api/sse.go guiTick`: on the probe branch store `h.guiWM = wm` beside `guiDisplay`/`guiBackend`; `guiPayloadLocked` sets `entry.WM = h.guiWM` when enabled. Example payload: `[{"id":"host","enabled":true,"backend":"Xtigervnc","reachable":true,"display":":10","width":1920,"height":1080,"viewers":1,"wm":"icewm-session"}]`. Note the viewers>0 short-circuit (no dial) keeps the last `guiWM` — correct, the stamp does not change while the session lives.
- `gui.Assemble`: after the stamps, `st.WM = wm`; after the reachability check, `if st.Reachable && st.WM == "" { st.WMHint = WMInstallHint(d.LookPath) }`. Disabled/unreachable documents carry no `wm_hint` (the unreachable reason already carries the backend hint).
- Tests: `assemble_test.go` (wm set, hint only when reachable+bare), `sse_test` for the payload's `wm`, `api/gui_test.go` for the document.

### 7. Running-apps name exclusion — `internal/gui/apps_linux.go`

G-D7. A fixed exclusion set applied after the pid excludes:

```go
// wmHelperComms are window-manager processes excluded from RunningApps by
// comm name (on top of the pid-tree exclude). By name, not ancestry: apps
// launched from the IceWM toolbar are children of icewm and must stay
// listed.
var wmHelperComms = map[string]bool{
    "icewm-session": true, "icewm": true, "icewmbg": true, "icewmtray": true,
    "icesound": true, "icewmhint": true, "openbox": true, "xfwm4": true,
    "i3": true, "kwin_x11": true, "xsetroot": true,
}
```

The filter runs on the trimmed `comm` before counting. Test with a fake `procRoot` carrying `icewm`, `icewm-session`, and `xterm` all with `DISPLAY=:N` and no pid excludes → `[{xterm 1}]`.

### 8. The CLI — `cmd/rk/gui.go` (+ new `cmd/rk/gui_launch.go`)

**`rk gui on` / `rk gui restart`**: `guiAwaitStamps` returns `(bin, display, wm string, ok bool)` via the widened `GUISessionOptions`. Because § 5 stamps `@rk_gui_wm` in the same burst as display/backend, a successful await already carries `wm`. Output (§ UX):

```
$ rk gui on
started (Xtigervnc :10)
  window manager: icewm-session
```
```
$ rk gui on                         # no WM installed
started (Xtigervnc :10)
  no window manager — running bare. Install one: sudo apt install --no-install-recommends icewm
  then: rk gui restart
```
```
$ rk gui on                         # no backend at all (existing branch, new hint)
enabled — no VNC backend installed: sudo apt install --no-install-recommends tigervnc-standalone-server icewm
```

The WM lines are `Notef` (stderr-class, indented two spaces) after the `Dataf` `started (…)` line so `--quiet` and scripts keep the one-line datum; when the await times out the verb prints `started` only (existing fallback — nothing new). `restart` prints the same WM lines after `restarted (…)`.

**`rk gui status`**: `guiOnSummary(bin, display, w, h, viewers, wm)` renders `on (Xtigervnc, :10, 1920x1080, 1 viewer, icewm-session)` or `on (Xtigervnc, :10, 1920x1080, 1 viewer, no window manager)`. The viewer count pluralizes (`0 viewers`, `1 viewer`, `2 viewers`) — the § UX copy is singular at 1 and the current `%d viewers` is not; the fix rides `guiOnSummary` so the doctor row inherits it. The `apps:` line is unchanged. `--json` carries `wm`/`wm_hint` from § 6.

**`rk gui launch <terminal|browser>`** (new file `gui_launch.go`, registered in the `guiCmd` family with the `usageArgs` wrap; the `Subcommands:` list in `guiCmd.Long` gains `launch   Open a terminal or browser on the GUI display (the allowlisted launcher)`):

- Gate order per the memory's "One gate, one hint vocabulary" requirement: `guiDarwinRefusal("launch")` first, then `guiRequireReachable(ctx)` (`guiErrOff` / `guiErrNotRunning`, exit 1).
- `role, err := gui.ParseAppRole(args[0])` — a bad role is a usage error (exit 2, cobra `ExactArgs(1)` + the parse error re-wrapped with `usageArgs` semantics: `error: app must be terminal or browser`).
- `name, path, ok := gui.ResolveApp(role, guiLookPathFn, guiStatFn)`; `!ok` ⇒ stderr `gui.LaunchHint(role, guiLookPathFn)`, exit 1.
- `pid, err := guiLaunchStartFn([]string{path}, gui.LaunchEnv(os.Environ(), st.Display, st.Socket))` (seam over `gui.StartDetached`); success prints `started <name> (pid <pid>) on :N` via `Dataf`, exit 0; a start failure is `error: <name>: <reason>`, exit 1.
- `rk gui env` / `exec` / `shot` unchanged.

### 9. The HTTP launcher — `api/gui.go` + `api/router.go`

`POST /api/gui/{id}/launch`, body `{"app":"terminal"|"browser"}` (G-D5; Constitution IX — POST; no new route family):

| Condition | Response |
|---|---|
| `validate.ValidateGUIID(id)` fails | 400 `{"error":"gui id must be \"host\""}` |
| body unparsable or `app` not `terminal`/`browser` | 400 `{"error":"app must be terminal or browser"}` |
| `!settings.Load().GUIEnabled` | 409 `{"error":"gui disabled"}` (the restart handler's shape) |
| enabled but `buildGuiStatus` says unreachable | 409 `{"error":"gui is on but not running — see 'rk gui status'"}` |
| ladder miss | 200 `{"ok":false,"app":"browser","hint":"no browser on the GUI host — sudo apt install chromium-browser"}` |
| start failure | 500 `{"error":"<name>: <reason>"}` |
| success | 200 `{"ok":true,"app":"terminal","argv0":"x-terminal-emulator","pid":12345}` |

`ok:false` is a 200 on purpose: G2's palette toasts `hint` on `ok:false` through the normal success path (the frontend client throws on non-2xx). The handler resolves with the Server's `guiLookPath` seam plus a new `guiStatFn` seam (`os.Stat`), starts with a new `guiLaunchFn` seam (`gui.StartDetached`), and builds the env with `gui.LaunchEnv(os.Environ(), st.Display, st.Socket)` — the daemon's environ, the same shape the CLI uses. Handler tests with seams cover every row above. **No arbitrary command over HTTP**: the body carries a role, never argv; `rk gui exec` stays CLI-only.

### 10. The doctor row — `cmd/rk/doctor.go`

`guiCheck` receives `wm` and `lookPath` and renders (§ UX):

```
gui    on (Xtigervnc, :10, 1920x1080, 1 viewer, icewm-session)
gui    on (Xtigervnc, :10, 1920x1080, 0 viewers, no window manager — sudo apt install --no-install-recommends icewm)
gui    on — not running (no VNC backend: sudo apt install --no-install-recommends tigervnc-standalone-server icewm)
```

The reachable+bare note appends ` — <pm-line>` after `no window manager` (the doctor is the diagnostic surface; `rk gui status` keeps the bare `no window manager` without the hint). `guiDoctorCheck` reads the widened `guiSessionOptionsFn`. Tests updated for the three notes.

### 11. The `gui.wm` settings key — `internal/settings/settings.go`

G-D6. Row placed immediately after `gui.enabled`:

```go
{
    key: "gui.wm", kind: "string", def: "",
    desc:     "Pin the window manager the GUI supervisor starts. Empty picks the first installed one from the ladder (icewm-session → openbox → xfwm4 → i3 → kwin_x11 → x-session-manager). Takes effect on rk gui restart.",
    category: "behavior", ui: true, live: false,
    parse:     quoteTrimmedScalar(func(s *Settings) *string { return &s.GUIWM }),
    serialize: quotedScalar("gui.wm", func(s *Settings) *string { return &s.GUIWM }),
    read:  func(s *Settings) any { return s.GUIWM },
    apply: <the string-scalar apply helper the ssh_host/instance_name rows use>,
},
```

`Settings.GUIWM string` beside `GUIEnabled`. Serialized as the flat dotted line `gui.wm: "xfwm4"`, omitted when empty (round-trips byte-identically). The value is a binary name resolved by `LookPath` in the supervisor; `x-session-manager` keeps its `dbus-run-session` wrap; an unresolvable value logs and falls back to the ladder (§ 5). No env form (Constitution IV). The registry's `ui: true` means the **All-settings panel** (`settings-all-panel.tsx`, which renders every `ui: true` string row generically with the registry description) shows a text field for it with no frontend change; the plan's dedicated `Window manager` field with the `auto (icewm-session → openbox → …)` placeholder in the main dialog is frontend work and belongs to G2. Round-trip tests: set/omit-when-empty/`null` unsets; the settings inventory count (14 → 15) in any test that asserts it.

### 12. Integration test — `cmd/rk/gui_supervise_integration_test.go` (new, `//go:build linux`)

The plan places this in `internal/gui/xvnc_integration_test.go`, but the stamp is a `cmd/rk` seam (`guiSuperviseTmuxRun`) and `runGuiSuperviseLinux` lives in `package main`, so the test lives beside the supervisor instead (the existing `TestXtigervncProbeIntegration` in `internal/gui` stays as-is). Capability-gated: skip unless both `Xtigervnc` and `icewm-session` resolve on PATH. Body: `t.Setenv("XDG_STATE_HOME", t.TempDir())`; `RK_CONFIG_DIR` at a temp dir (empty pin); a high display from `gui.FreeDisplay(90)`; capture stamps by replacing `guiSuperviseTmuxRun` with a recorder; run `runGuiSuperviseLinux` under a cancelable ctx in a goroutine; wait for the `@rk_gui_wm` stamp; assert it equals `icewm-session`, the profile dir holds `preferences`/`toolbar`/`menu` with `0600`, and `gui.RunningApps("/proc", display, nil)` is empty (icewm excluded by name — no pid excludes needed); cancel the ctx and wait for a clean return (no `icewm*` process with that `DISPLAY` survives). Never touches the live `rk-gui` session or the `rk-daemon` socket (stamps are captured, not sent).

### 13. Docs

- `docs/specs/gui.md`: § The supervisor — the new ladder head, `--nobg --notray`, the seeded profile dir and its two file classes, the `@rk_gui_wm` stamp; § Agent verbs — `rk gui launch <terminal|browser>` (and its HTTP twin in § Protocol and relay's route list: `POST /api/gui/{id}/launch`); § The switch — the new hint lines; the diagram's `WM (openbox | xfwm4 | kwin_x11 …)` line becomes `WM (icewm-session --nobg --notray | openbox | …) ICEWM_PRIVCFG=…/gui/icewm`; § Phasing — strike the "WM probe order … proposed — C2" clause in the closing paragraph and point at the child plan; a pointer to `fab/plans/sahil/26-09-10-gui-desktop.md` beside the parent plan link. `gui.wm` joins § The switch's settings mention.
- `docs/site/skill/gui.md` (≤150 lines, currently 79) — a `rk gui launch` section (the allowlisted launcher, when to prefer it over `exec --detach`, the `ok:false` hint), and the profile directory with its two file classes (delete-to-reset); synced to `cmd/rk/skill/gui.md` with `scripts/sync-skill.sh` (the `skill_test.go` drift guard enforces it).
- `fab/plans/sahil/26-09-09-gui-surface.md` § Change breakdown: one pointer row to the child plan (`G1/G2 — see 26-09-10-gui-desktop.md`); no other edit to the parent.
- `fab/plans/sahil/26-09-10-gui-desktop.md` § Change breakdown: G1's PR column at ship; Status → Done at merge.
- Toolkit standards (Constitution § Toolkit Standards): `rk gui launch` is a new CLI surface — run the help-dump + Principle 9 new-surface check (`shll standards help-dump`, `shll standards principles`) during apply; the `toolkit-standards` memory's audited-surface list gains `gui launch`.
- Memory via hydrate (§ Affected Memory).

### Acceptance (from the plan, binding)

- On this VM with `icewm` installed: `rk gui restart` → the tile shows the NanoBlue taskbar over `#3b4252`, no wallpaper; `rk gui status` names `icewm-session`; `rk doctor` shows it; `rk gui launch terminal` opens a terminal that appears in `apps:`; `rk gui launch browser` exits 1 with the chromium hint; `GET /api/gui/host` carries `"wm":"icewm-session"`.
- With `icewm-session` hidden from PATH (test seam, or a `PATH` without it *and* without openbox for a live check): the supervisor logs the no-WM line naming the install command, the stamp is `""`, the stream entry carries `"wm":""`, `rk gui on` prints the two-line hint, doctor shows the install line.
- `go test ./...` green; `just test` green; the seeded `preferences` survives a `rk gui restart` after a manual edit.
- Do not touch the live `rk-gui` session while a C6 measurement is running (`tmux -L rk-daemon list-windows -t rk-jobs` shows a perf job) — plan § Pickup protocol step 3.

## Affected Memory

- `run-kit/gui`: (modify) the ladder head (`icewm-session --nobg --notray`) and the `gui.wm` pin; the seeded profile (`<StateDir>/icewm/`, write-once `preferences` vs regenerated `toolbar`/`menu`, `ICEWM_PRIVCFG`); the `@rk_gui_wm` stamp and its readers; `wm`/`wm_hint` on the status document and `wm` on the stream entry; the package-manager-aware hints (`InstallHint(lookPath)`, `WMInstallHint`, `NoBackendReason` as a function); `rk gui launch` + `POST /api/gui/{id}/launch` and the two ladders; the WM-helper name exclusion in `RunningApps`; the new `rk gui on`/`status`/doctor copy; new Design Decisions (IceWM as the recommended rung; rk owns the look via a seeded profile; one two-role launcher, never arbitrary argv over HTTP; WM helpers excluded by name not ancestry; stamps land in one burst before the WM starts)
- `run-kit/tmux-sessions`: (modify) § Server-Scoped User Options registry — a `@rk_gui_wm` row (session-scoped on `rk-gui`, written by `rk gui supervise`, `""` when bare, read by `daemon.GUISessionOptions`)
- `run-kit/configuration`: (modify) § Settings Registry — the `gui.wm` row (string, `""`, behavior, ui yes, live no, no env form); the inventory count 14 → 15
- `run-kit/api-and-sockets`: (modify) the `/api/gui/*` route list gains `POST /api/gui/{id}/launch` with its status-code table; the `event: gui` slot's payload gains `wm`
- `run-kit/daemon-lifecycle`: (modify) the ensure ladder's no-backend warning now uses the package-manager-aware hint (one sentence)
- `run-kit/toolkit-standards`: (modify) the help-dump / P9 new-surface audit list gains `gui launch`

## Impact

**Code (`app/backend/`)**

- `internal/gui/`: `backend.go` (ladder, `WMArgv`, `ResolveWM` signature), `seed.go` + `seed/preferences` (new), `launch.go` (new), `hint.go` (new; `InstallHint` moves out of `state.go`), `status.go` (`WM`/`WMHint` fields, `NoBackendReason` → func), `assemble.go` (wm + hint fill), `apps_linux.go` (name exclusion) — with tests for each.
- `internal/daemon/gui.go`: `GUIOptionWM`; `GUISessionOptions` widened.
- `cmd/rk/`: `gui_supervise.go` (resolve/seed/stamp/log/env), `gui.go` (`on`/`restart` WM lines, `guiOnSummary` wm + pluralization, `guiAwaitStamps`, family registration), `gui_launch.go` (new), `gui_exec.go` (delegate env/detach to `internal/gui`), `doctor.go` (wm segment), `gui_supervise_integration_test.go` (new), `skill/gui.md` (synced copy).
- `api/`: `gui.go` (launch handler + seams), `router.go` (route + seam fields), `sse.go` (`guiWM`, payload).
- `internal/settings/settings.go`: `gui.wm` row + `Settings.GUIWM`.

**Contracts that change shape** (all additive except the two signature changes): `gui.StreamEntry` gains `wm`; `gui.Status` gains `wm`, `wm_hint`; `GUISessionOptions` and every `guiSessionOptionsFn` seam gain a return value; `gui.InstallHint` gains a parameter; `gui.NoBackendReason` const → func; `gui.ResolveWM` gains `pin` and `pinMissed`. Existing frontend consumers ignore unknown JSON fields, so the stream change is safe before G2 lands.

**Behavior change for existing hosts**: a host with both openbox and icewm installed switches from openbox to IceWM on its next `rk gui restart` (plan Risk 6 — the intent; `gui.wm: "openbox"` pins the old behavior). Hosts with only openbox are unchanged except for the new stamps, log lines, and hints.

**Tests**: Go unit tests throughout; one capability-gated integration test (skips without `Xtigervnc` + `icewm-session`); no frontend or Playwright changes (G2 owns those). Gates: `cd app/backend && go test ./...`, `just test`, `just build`. Existing tests asserting the old hint strings, the old `%d viewers` copy, the old ladder head, or the three-return seams are updated to the spec (Test Integrity: tests follow the spec).

**Docs**: `docs/specs/gui.md`, `docs/site/skill/gui.md` (+ synced embed), the two plan files' breakdown tables, memory via hydrate.

**Dependencies**: none new. `icewm` is a host package the user installs; the change works (bare, with hints) without it.

## Open Questions

None. The plan's § Decision log resolves every design point and its § UX fixes the copy; the two items that need a look during apply (whether `ICEWM_PRIVCFG` also relocates `startup`/`shutdown`, and the exact non-apt package names) are recorded as Confident assumptions below with their fallbacks, not as questions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Ladder becomes `icewm-session → openbox → xfwm4 → i3 → kwin_x11 → x-session-manager`; icewm runs `--nobg --notray`; `xsetroot -solid #3b4252` stays the ground | Plan G-D1, spike-verified (29 MB, no D-Bus, `--nobg` is the only way to keep rk's ground) | S:95 R:70 A:95 D:95 |
| 2 | Certain | rk never runs a package manager; install stays host-owned — probe with `LookPath`, degrade to bare, print one line per surface; apt wording `sudo apt install --no-install-recommends icewm` / `… tigervnc-standalone-server icewm` | Plan G-D2; toolkit `install-composition` standard; the Xvnc/tmux precedent | S:95 R:90 A:95 D:95 |
| 3 | Confident | Non-apt package names: dnf `tigervnc-server icewm` / `chromium` / `xterm`; pacman `tigervnc icewm` / `chromium` / `xterm` | Plan marks these Likely — from packaging knowledge, unverified on a dnf/pacman host; wording only, never executed; the no-manager case falls back to a generic sentence | S:70 R:95 A:55 D:70 |
| 4 | Certain | rk owns the look via a seeded profile at `$XDG_STATE_HOME/run-kit/gui/icewm/` passed as `ICEWM_PRIVCFG`; `preferences` write-once, `toolbar`/`menu` regenerated every start; seed `go:embed`ded; dir 0700, files 0600 | Plan G-D3; the code-server `settings.json` precedent; spike showed the toolbar must be conditional | S:95 R:75 A:90 D:90 |
| 5 | Certain | The supervisor stamps `@rk_gui_wm <argv[0]>` (`""` when bare); hub reads it on the same tick; `event: gui`, `GET /api/gui/{id}`, `rk gui status`, doctor all carry `wm` | Plan G-D4; Constitution II/X; the existing `@rk_gui_*` idiom | S:95 R:70 A:95 D:95 |
| 6 | Certain | One launcher, two roles (`terminal`/`browser`), fixed ladders, `LookPath` + dangling-alternative stat, `rk gui launch` + `POST /api/gui/{id}/launch`; missing ⇒ `{ok:false, hint}`; no arbitrary command over HTTP (`exec` stays CLI-only) | Plan G-D5; Constitution I; one ladder shared by CLI, HTTP, toolbar | S:95 R:65 A:95 D:95 |
| 7 | Certain | `gui.wm` settings key — string, default `""`, registry-backed, `ui: true`, `live: false`, takes effect on `rk gui restart`; unresolvable value logs and falls back to the ladder; `x-session-manager` keeps its dbus wrap | Plan G-D6; Constitution VII | S:95 R:85 A:95 D:95 |
| 8 | Certain | Running-apps list excludes WM helpers by comm name (`icewm-session, icewm, icewmbg, icewmtray, icesound, icewmhint, openbox, xfwm4, i3, kwin_x11, xsetroot`) after the pid excludes — never by ancestry | Plan G-D7; toolbar-launched apps are icewm children and must stay listed | S:95 R:90 A:95 D:95 |
| 9 | Certain | Out of scope: auto-install, theme editor, XFCE/LXQt as recommended rungs, per-viewer WMs, the macOS branch; the tile strip and palette rows (G-D8) are G2 | Plan G-D9 and the G1/G2 split | S:95 R:90 A:90 D:95 |
| 10 | Confident | `daemon.GUISessionOptions` and every `guiSessionOptionsFn` seam widen to `(display, backend, wm, ok)` rather than adding a separate WM reader | "Read on the same tick" per G-D4 with one seam shape; touches ~6 seam sites + tests but each is mechanical; a separate reader would double the seam surface | S:75 R:75 A:85 D:65 |
| 11 | Certain | Supervisor order: backend up → resolve WM (pin/ladder) → resolve apps → seed profile → stamp display/backend/wm in one burst → log → start WM → paint root | Lets `rk gui on`'s single `guiAwaitStamps` read carry `wm` with no race; seeding needs no X server | S:70 R:90 A:85 D:75 |
| 12 | Certain | The detached-start and env primitives move to `internal/gui` (`StartDetached`, `LaunchEnv`); `gui_exec.go` delegates to them | `api/` cannot import `cmd/rk`; duplicating the Setsid/env logic is the code-quality anti-pattern | S:65 R:85 A:90 D:80 |
| 13 | Confident | Launch endpoint codes: 400 bad id/app, 409 `gui disabled` and 409 not-running, 200 `{ok:false,hint}` on a ladder miss, 500 on start failure, 200 `{ok:true,app,argv0,pid}` | Mirrors the restart handler; `ok:false` as 200 so G2's palette toasts through the success path (the client throws on non-2xx) | S:65 R:90 A:75 D:60 |
| 14 | Certain | `gui.InstallHint` gains a `lookPath` parameter and moves to `hint.go`; `NoBackendReason` becomes a function; the Linux hint drops the `install a VNC X server and a window manager:` prefix | Package-manager detection needs `LookPath`; § UX line is `enabled — no VNC backend installed: <pm-line-backend>` | S:80 R:90 A:90 D:85 |
| 15 | Confident | `guiOnSummary` pluralizes `viewer`/`viewers` (and gains the wm segment) | § UX copy shows `1 viewer` / `0 viewers`; the current `%d viewers` contradicts it; the doctor row inherits via the shared helper | S:55 R:95 A:80 D:70 |
| 16 | Confident | `rk gui launch` success line is `started <name> (pid <pid>) on :N` on stdout (`Dataf`) | Plan gives no exact line; mirrors `exec --detach`'s `started <pid> on :N` and names the resolved binary the ladder chose | S:40 R:95 A:75 D:55 |
| 17 | Confident | Terminal-missing hint: `no terminal on the GUI host — sudo apt install xterm` (per-manager variants) | Plan spells out only the browser line; the terminal line follows its shape with the ladder's plainest X terminal | S:55 R:95 A:70 D:70 |
| 18 | Confident | The integration test lives in `cmd/rk/gui_supervise_integration_test.go` (not `internal/gui/xvnc_integration_test.go` as the plan wrote) with stamps captured via the `guiSuperviseTmuxRun` seam | The stamp and `runGuiSuperviseLinux` are `package main`; `internal/gui` cannot observe them; capturing stamps keeps the test off the live `rk-daemon` socket | S:65 R:90 A:85 D:70 |
| 19 | Confident | `ICEWM_PRIVCFG` relocates `startup`/`shutdown` along with `preferences`/`toolbar`/`menu`; if apply finds otherwise, pass `--config`/`--theme` explicitly on the icewm rung | Plan Risk 3 with its stated fallback; IceWM docs say the private dir is the one home; verified at apply on this VM | S:60 R:85 A:50 D:60 |
| 20 | Certain | Seeded `preferences` content is the § UX block verbatim (NanoBlue, meters/workspaces/LEDs/desktop-button/window-list off, `WorkspaceNames=" run-kit "`); no menu-curation keys | Plan § UX is quotable copy; `ShowSettingsMenu`/`ShowThemesMenu` had no effect on 2.9.6 (Risk 2) so the `Settings` row is accepted; unknown keys are ignored by IceWM | S:90 R:95 A:80 D:85 |
| 21 | Certain | The `gui.wm` row appears in the All-settings panel generically (it renders `ui: true` string rows); the dedicated `Window manager` field with the `auto (…)` placeholder is frontend work for G2 | G1 is backend-only per the plan's split; `settings-all-panel.tsx` renders registry string rows with the description already | S:70 R:90 A:85 D:75 |
| 22 | Certain | `PackageManager` probes `apt-get → dnf → pacman` on PATH; `""` otherwise → generic wording | Detection by binary presence only, never executed; apt-get is universal on Debian/Ubuntu | S:80 R:95 A:85 D:80 |
| 23 | Certain | `Status.wm` always present; `wm_hint` `omitempty`, filled only when enabled ∧ reachable ∧ `wm == ""`; `StreamEntry.wm` always present | Plan § UX: "gains `wm` and, when bare, `wm_hint`"; the unreachable reason already carries the backend hint | S:85 R:95 A:90 D:85 |
| 24 | Certain | Launched app env = caller/daemon environ with `DISPLAY` and `RK_GUI_SOCKET` set (replace, never duplicate) via `gui.LaunchEnv` | The `guiExecEnv` rule, shared; the rk display is the point of the verb | S:70 R:90 A:90 D:80 |
| 25 | Certain | `WMArgv(name)` owns per-binary flags: a pinned `icewm-session` gets `--nobg --notray` exactly like the ladder rung; pinned `x-session-manager` keeps `dbus-run-session --` | The flags belong to the binary, not to how it was chosen; G-D6 says the wrap is preserved | S:85 R:90 A:90 D:85 |

25 assumptions (17 certain, 8 confident, 0 tentative, 0 unresolved).
