# GUI desktop execution plan — a legible desktop in the gui tile

> Plan doc — written 2026-09-10 from the bronze-crane `/fab-discuss` thread.
> Child of [`26-09-09-gui-surface.md`](26-09-09-gui-surface.md) (the parent
> plan — protocol, switch, relay, tile, agent verbs, perf). This doc owns one
> thing the parent left open ("the WM probe order … proposed — C2"): what a
> person sees when the tile opens on a host with no apps running, how the
> host gets there, and (G3) how an agent drives that desktop from a shell the
> way it drives the code and web surfaces. It does not reopen D1–D10 of the
> parent; it sits beside C6 (bandwidth) and shares no files with it except
> `docs/specs/gui.md`.
> Authority for design: the spike results in § Spike verdict below, plus
> [`docs/specs/gui.md`](../../../docs/specs/gui.md) § The supervisor.

**Goal**: opening the gui tile on a fresh host shows a desktop a person can
read and drive — a taskbar, a start menu, a clock, terminal and browser
buttons — on desktop and phone alike, at no meaningful idle cost, with rk
owning the look and the host owning the packages. When the window manager is
missing, every surface says the one install line and what to do after it.

**Problem (2026-09-10)**: the supervisor's ladder puts `openbox` first and
this host has it, so the tile shows a bare openbox root: a solid `#3b4252`
ground (C5 painted it) and a right-click menu whose entries point at
`x-terminal-emulator` / `x-www-browser`. Nothing on screen says it is a
desktop, nothing is reachable by tap on a phone, and a missing browser fails
silently.

**Status (2026-09-10)**: spike done (§ Spike verdict). G1 Done (`260910-2jl3-gui-desktop-icewm-and-launcher`, PR #905 merged). G2 Done (`260910-vu4p-gui-desktop-tile-strip-and-palette`, PR #908 merged). G3 (agent verbs) added 2026-09-10 from the bronze-crane thread — in progress (`260910-d0za-gui-agent-verbs-input-and-windows`, intake 2026-09-10).

---

## Spike verdict (2026-09-10, this VM — `dev-ws-sahil01`, Ubuntu 22.04)

Run on throwaway displays `:96`–`:99` (TigerVNC 1.12 `Xtigervnc` with the
production argv minus `-FrameRate`), never on the live `rk-gui` session.
Screenshots were viewed, not committed. Re-run recipe at the end.

### Install

- `apt-get install --dry-run icewm` pulls **49** packages (perl/GTK2
  recommends for `icewm-menu-gnome2`-era helpers). With
  `--no-install-recommends` it is **4**: `icewm`, `icewm-common`, `libao4`,
  `libao-common` — IceWM 2.9.6, ~2.4 MB installed. The hint uses the
  no-recommends form.
- The package ships `icewm`, `icewm-session`, `icewmbg`, `icewmtray`,
  `icewm-menu-fdo`, `icewm-menu-xrandr`, `icewmhint`, nine themes
  (`default CrystalBlue Helix Infadel2 NanoBlue icedesert metal2 motif
  win95`), and system defaults under `/usr/share/icewm/`.
- No D-Bus, no session manager, no compositor, nothing to disable.

### Runtime

| Measure | Result |
|---|---|
| Idle RSS, `icewm-session --nobg --notray` (2 procs) | **29 MB** (icewm 25.7 + session 3.4); Xtigervnc itself 82 MB |
| Stock look on first start | taskbar (start menu · workspaces 1–4 · CPU/net meters · LED clock) over the shipped penguin wallpaper; start menu auto-populated from `/usr/share/applications` via `icewm-menu-fdo` |
| Private config | `ICEWM_PRIVCFG=<dir>` is honored for `preferences`, `toolbar`, `menu`; IceWM never writes into it on start — the dir is rk's to seed |
| Seeded `preferences` | `Theme="NanoBlue/default.theme"` + meters/workspaces/LEDs off applied on first start; toolbar file with two `prog` rows rendered as two icon buttons |
| Background | a theme's `DesktopBackgroundImage` beats both `preferences` and `prefoverride` (icewmbg paints the theme wallpaper regardless). `--nobg` skips icewmbg entirely and the root keeps whatever `xsetroot` painted: verified pixel `#3b4252` at (640,300) |
| Toolbar launch | clicking the Terminal button started `uxterm` (via the `x-terminal-emulator` alternative → `lxterm`); it appeared as an `xterm` task button |
| Resize | `xrandr --output VNC-0 --mode 536x799` on Xvnc works; the taskbar reflows to the new width (workspace buttons trimmed) — the tile's SetDesktopSize path will behave the same |
| Teardown | `SIGTERM` to `icewm-session` exits icewm and leaves no icewm process behind; the launched terminal survives (an X client, killed later by the backend's exit) |
| Menu curation | `ShowSettingsMenu=0` / `ShowThemesMenu=0` in `preferences` did not remove the bottom `Settings` row on 2.9.6 — verify the key names during G1, or accept the row |
| Browser | `x-www-browser` has **no alternative** on this host (`update-alternatives --display` errors); no chromium/firefox on PATH. A browser button must be conditional |

### What the numbers decide

IceWM is the right default rung: it delivers the whole "this is a desktop"
affordance in one 29 MB process pair with no session plumbing, its private
config dir is a first-class feature, and it costs nothing against the parent
plan's D9 budget. XFCE/LXQt stay reachable through `x-session-manager` or the
`gui.wm` pin for users who install them, but rk recommends neither.

---

## Decision log (Certain — intakes do not re-open these)

| # | Decision | Why |
|---|----------|-----|
| G-D1 | **IceWM is the recommended window manager.** The ladder becomes `icewm-session → openbox → xfwm4 → i3 → kwin_x11 → x-session-manager`. `icewm-session` runs with `--nobg --notray`; the supervisor's existing `xsetroot -solid #3b4252` paint stays the ground | § Spike verdict: 29 MB, no D-Bus, taskbar+menu+clock built in, private config via env var, `--nobg` is the only way to keep rk's ground |
| G-D2 | **rk never runs the package manager.** Install stays host-owned: probe with `LookPath`, degrade to bare, and print one actionable line on every surface. The line is package-manager-aware for wording only: `apt` → `sudo apt install --no-install-recommends icewm`; `dnf` → `sudo dnf install icewm`; `pacman` → `sudo pacman -S icewm`; otherwise `install icewm with your package manager`. The backend hint (`gui.InstallHint`) becomes `sudo apt install --no-install-recommends tigervnc-standalone-server icewm` (apt) with the same per-manager variants (`tigervnc-server` on dnf, `tigervnc` on pacman). Non-apt package names are from packaging knowledge, unverified here — the intake marks them Likely, not Certain | toolkit `install-composition` standard (probe, degrade, hint — no package edges); the Xvnc/tmux precedent; code-server's self-install is for a single static binary, which a WM is not |
| G-D3 | **rk owns the look via a seeded IceWM profile** at `$XDG_STATE_HOME/run-kit/gui/icewm/` (beside `host.sock`), passed as `ICEWM_PRIVCFG`. Two file classes: `preferences` is **write-once** (seeded when absent, user edits persist; deleting the file resets — the code-server `settings.json` rule); `toolbar` and `menu` are **regenerated on every supervise start** from runtime probes (header comment says so) so the buttons always name binaries that exist. Seed content is `go:embed`ded in `internal/gui` | the code-server seeded-profile precedent; the spike showed the toolbar must be conditional (no browser here); regenerating avoids baking an rk binary path into user files |
| G-D4 | **The window manager is stamped and streamed.** The supervisor stamps `@rk_gui_wm <argv[0]>` on the `rk-gui` session beside `@rk_gui_display`/`@rk_gui_backend` (`""` when bare); the hub reads it on the same tick and the `event: gui` entry, the `GET /api/gui/{id}` document, `rk gui status`, and the doctor row all carry `wm` | Constitution II/X: the supervisor is the only place that knows which rung won; a stamp is the existing `@rk_gui_*` idiom; the tile needs it to render the bare-WM strip without polling |
| G-D5 | **One launcher, two roles**: `rk gui launch <terminal\|browser>` and `POST /api/gui/{id}/launch {"app":"terminal"\|"browser"}`. Ladders resolved server-side with `LookPath` + a dangling-symlink check on Debian alternatives: terminal `x-terminal-emulator, xterm, uxterm, lxterm, foot, alacritty, kitty, gnome-terminal, xfce4-terminal`; browser `chromium, chromium-browser, google-chrome, google-chrome-stable, firefox, x-www-browser`. Missing ⇒ `{ok:false, hint}` with `no browser on the GUI host — sudo apt install chromium-browser` (per-manager wording as G-D2). The seeded toolbar/menu rows and the palette rows both go through this launcher. **No arbitrary command over HTTP** — `rk gui exec` stays CLI-only | Constitution I (allowlist, argv slices); the tile and the phone need a tap-reachable launch; one ladder shared by CLI, HTTP, toolbar |
| G-D6 | **`gui.wm` settings key** — string, default `""` (= ladder), registry-backed, `ui: true`, `live: false` (takes effect on `rk gui restart`). A value is a binary name resolved via `LookPath`; `x-session-manager` keeps its `dbus-run-session` wrap; an unresolvable value logs and falls back to the ladder | Constitution VII (nothing required, every key has a default); users with several WMs installed get a pin without editing the ladder |
| G-D7 | **Running-apps list excludes WM helpers by name**: `icewm-session, icewm, icewmbg, icewmtray, icesound, icewmhint, openbox, xfwm4, i3, kwin_x11, xsetroot` on top of the existing pid excludes. Not by ancestry — apps launched from the IceWM toolbar are children of `icewm` and must stay listed | the off-confirm dialog and `rk gui status` list apps; `icewm ×1` in that list is noise, and ancestry-based exclusion would hide real apps |
| G-D8 | **Tile behavior**: while `reachable && wm == ""`, a one-line strip above the canvas — `No window manager on the GUI host · <install line> · then Restart supervisor` — with a Copy button (fine and coarse) and a per-viewer dismiss (localStorage). No "no apps yet" overlay: with IceWM the taskbar and toolbar are the affordance. Palette gains `GUI: Open terminal` and `GUI: Open browser` (visible when `enabled && reachable`), calling G-D5 and toasting the hint on `ok:false` | Constitution IV/V: the strip is the only new UI, keyboard/palette parity for the launch actions; a phone gets a tappable route that does not depend on a 536-px taskbar |
| G-D9 | **Out of scope**: auto-installing anything; a theme editor; XFCE/LXQt as recommended rungs (they remain reachable via `x-session-manager` or `gui.wm`); per-viewer window managers; touching the ladder's macOS branch (mirror mode has no WM) | keep the surface minimal; the parent's D10 |
| G-D10 | **Agent verbs wrap X11 tools, they do not reimplement them.** `xdotool` is the input and window engine, `import`/`scrot`/`xwd` stay the capture ladder, `xclip`/`xsel` the clipboard, `xdg-open` the opener. Every verb probes with `LookPath` and refuses with the existing apt hint when the tool is missing; rk installs nothing. What rk adds is one gate, one exit-code contract, one coordinate space, and the semantics xdotool lacks (window inventory as rows, wait-for, scaled capture) | Constitution III; the `code`/`web` surfaces got first-class verbs because they had no native channel — X11 has one; the toolkit `install-composition` standard |
| G-D11 | **One coordinate space: display pixels.** Input verbs take display-pixel coordinates. `rk gui shot` prints the PNG path on stdout (unchanged contract) and, when `--scale`/`--max-width` shrinks the capture, the capture geometry and scale factor on stderr (`geometry 1920x1080 scale 0.5`). The agent maps back by dividing; rk never guesses which screenshot a click refers to | the datum-only stdout rule; a full 1080p PNG per loop iteration is the dominant token cost for a vision loop, and a hidden implicit scale would make clicks silently wrong |
| G-D12 | **Resize is a loop hazard, so the agent can lock it.** `rk gui lock` / `rk gui unlock` set the same pin the palette's `GUI: Lock resolution` sets (parent D7), so a fine-pointer viewer resizing the tile mid-loop cannot move the agent's coordinates. `rk gui status` shows `locked` | parent D7 makes the desktop follow the last fine-pointer viewer; a loop that screenshots, thinks, then clicks is exactly the window where that resize lands |
| G-D13 | **The human's pointer wins.** The relay already parses RFB client messages (`gui_filter.go`); it records the last human `PointerEvent`/`KeyEvent` time per display. Input verbs (`click`, `type`, `key`, `scroll`, `move`, `focus`) refuse with exit 1 and `human input <N>s ago — retry or pass --force` when a human drove the display within the last `guiHumanInputGrace = 3s`. `--force` overrides. Reads and launches never refuse | the skill page's "don't fight their pointer" gotcha becomes mechanical; the human is watching the same pixels and a fight is the worst failure mode |
| G-D14 | **Out of scope for G3**: session recording (ffmpeg `x11grab`), an accessibility-tree reader (AT-SPI) for element-level targeting, browser automation inside rk (the agent uses Playwright/CDP against a browser `launch --cdp` started), OCR, and any per-agent virtual display. Each is a later plan if the loop proves it necessary | keep G3 to what the recipe needs today; the parent's D10 |

---

## UX (final)

Every line below is copy the intakes may quote. `<pm-line>` is the
package-manager-aware install line from G-D2; `<pm-line-backend>` its
backend+WM form.

### `rk gui on` (CLI) and the settings toggle

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
The WM lines are read from the `@rk_gui_wm` stamp after the supervisor's
socket wait (bounded like the existing `started (…)` read); when the stamp is
not yet there the verb prints `started (Xtigervnc :10)` only, as today.

### Supervisor pane (`rk-gui` window)

```
gui: Xtigervnc up on :10 (socket …/host.sock)
gui: window manager icewm-session (config …/run-kit/gui/icewm, seeded preferences)   ← "seeded preferences" only on the first start
gui: toolbar: terminal=x-terminal-emulator browser=none
```
```
gui: no window manager found (tried icewm-session, openbox, xfwm4, i3, kwin_x11, x-session-manager); running bare — sudo apt install --no-install-recommends icewm, then rk gui restart
```
```
gui: gui.wm=xfwm4 not on PATH; falling back to the ladder
```

### `rk gui status` / `GET /api/gui/{id}` / `event: gui`

```
gui: on (Xtigervnc, :10, 1920x1080, 1 viewer, icewm-session)
  apps: xterm ×1
```
Bare: `gui: on (Xtigervnc, :10, 1920x1080, 1 viewer, no window manager)`.
Stream entry gains `"wm":"icewm-session"` (`""` when bare); the status
document gains `wm` and, when bare, `wm_hint` (the install line).

### `rk doctor`

```
gui    on (Xtigervnc, :10, 1920x1080, 1 viewer, icewm-session)
gui    on (Xtigervnc, :10, 1920x1080, 0 viewers, no window manager — sudo apt install --no-install-recommends icewm)
gui    on — not running (no VNC backend: sudo apt install --no-install-recommends tigervnc-standalone-server icewm)
```

### The tile

- **Reachable, WM present**: the canvas, exactly as today. The desktop shows
  the IceWM taskbar (start menu · Terminal · Browser-if-installed · task
  buttons · clock) over the `#3b4252` ground.
- **Reachable, bare**: a strip pinned above the canvas, monospace, one line
  (wraps to two at phone width):
  `No window manager on the GUI host — sudo apt install --no-install-recommends icewm · then Restart supervisor` `[Copy]` `[×]`.
  `Copy` copies the install line only. `×` dismisses for this viewer
  (localStorage `runkit-gui-wm-strip-dismissed`; a later `wm != ""` clears
  it). `Restart supervisor` is the existing empty-state action, reused.
- **Unreachable**: the existing empty state; the reason line already carries
  the backend hint via `reason`.

### Palette

| Row | When | Does |
|---|---|---|
| `GUI: Open terminal` | `enabled && reachable` | `POST /api/gui/host/launch {"app":"terminal"}`; on `ok:false` a toast with `hint` |
| `GUI: Open browser` | `enabled && reachable` | same with `"browser"` |

### Settings dialog

`Window manager` text field (`gui.wm`), placeholder `auto (icewm-session → openbox → …)`,
description: `Pin the window manager the GUI supervisor starts. Empty picks the first installed one from the ladder. Takes effect on rk gui restart.`

### Seeded profile (`$XDG_STATE_HOME/run-kit/gui/icewm/`)

`preferences` (write-once):
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
`toolbar` (regenerated each start; rows only for resolved binaries):
```
# generated by rk gui supervise on every start — edit preferences instead
prog Terminal terminal <resolved-terminal>
prog Browser web-browser <resolved-browser>
```
`menu` (regenerated each start):
```
# generated by rk gui supervise on every start
prog Terminal terminal <resolved-terminal>
prog Browser web-browser <resolved-browser>
separator
includeprog icewm-menu-fdo --no-sep-others --seps
```
Deleting the directory restores every default on the next start. The `rk
skill gui` topic page documents the directory and the two file classes.

### Agent verbs (G3)

All verbs share the existing gate (`gui is off` / `gui is on but not running`
⇒ exit 1 with the hint), the datum-only stdout rule, and exit `2` for usage.
Coordinates are display pixels (G-D11). Every verb that needs an X tool
probes it first and fails with the tool's apt hint (`sudo apt install xdotool`,
`imagemagick`, `xclip`).

```sh
rk gui windows                       # ID  PID  GEOMETRY      TITLE            (active window marked *)
rk gui windows --json                # [{id, pid, x, y, width, height, title, active, app}]
rk gui focus <id|--title <substr>>   # raise + focus; exit 1 when no match / ambiguous
rk gui click <x> <y> [--right|--middle|--double] [--window <id>]   # --window makes x y window-relative
rk gui move <x> <y>
rk gui scroll <up|down|left|right> [--n 3] [--at x y]
rk gui type <text> | --stdin         # unicode-safe (xdotool type --delay 12 via stdin), newline = Return
rk gui key <chord> [<chord>…]        # xdotool keysym spelling: ctrl+l, Return, alt+F4
rk gui shot [--out p.png] [--scale 0.5 | --max-width 1280] [--window <id>]   # stdout: path; stderr: geometry WxH scale S
rk gui wait --window <title-substr> [--timeout 10s]   # exit 0 when a window matches, 1 on timeout
rk gui wait --stable [--interval 500ms] [--timeout 10s]  # two consecutive captures identical (hash)
rk gui clip get | set <text> | set --stdin              # CLIPBOARD selection via xclip/xsel
rk gui open <url|file>               # xdg-open on the display, detached; prints `started <pid> on :N`
rk gui launch browser --cdp [--port 9222]   # G1's launcher + --remote-debugging-port; prints the port
rk gui lock | unlock                 # the D7 resolution pin; `rk gui status` shows `locked`
```

Refusals specific to G3 (all exit 1, stderr): `human input 2s ago — retry or
pass --force` (G-D13, input verbs only); `xdotool not found — sudo apt install
xdotool`; `no window matches "…"`; `--window <id>: not a window`.

`rk gui status` gains `locked` and, when a human drove the display within the
grace window, `human input 1s ago`.

The `rk skill gui` topic page rewrites the § Recipe around these verbs:
`launch browser --cdp` + Playwright/CDP for browser work, `windows` →
`focus` → `click`/`type`/`key` → `wait --stable` → `shot --scale 0.5` for
everything else, `lock` for the loop's duration, `clip set` + `key ctrl+v`
instead of typing paragraphs.

---

## Change breakdown

Three fab changes, sequential. G2 depends on G1's `wm` stream field and the
launch endpoint, so it cannot start until G1 is on `main`; it is small enough
that a single change would also fit, but the parent plan's backend/frontend
split (C2/C3) kept reviews focused and the Playwright half is verifiable
against a stubbed stream alone. G3 (agent verbs) waits for G2 only to keep
the `gui` CLI file set and the spec's § Agent verbs from being edited by two
changes at once; it has no code dependency on G2.

| # | Slug (suggested) | Depends on | Size | Change folder | PR | Status |
|---|------------------|-----------|------|---------------|----|--------|
| G1 | `gui-desktop-icewm-and-launcher` | parent C5 merged (it is) | M | 260910-2jl3-gui-desktop-icewm-and-launcher | https://github.com/sahil87/run-kit/pull/905 | Done |
| G2 | `gui-desktop-tile-strip-and-palette` | G1 merged | S | 260910-vu4p-gui-desktop-tile-strip-and-palette | https://github.com/sahil87/run-kit/pull/908 | Done |
| G3 | `gui-agent-verbs-input-and-windows` | G2 merged | M | 260910-d0za-gui-agent-verbs-input-and-windows | | in progress (intake) |

---

### G1 — Backend: the IceWM rung, the seeded profile, the stamp, the launcher

**Purpose**: G-D1 through G-D7. After this change a host with `icewm`
installed shows the seeded desktop, a host without it says the install line
everywhere the CLI looks, and agents/palette can launch a terminal or browser
through one allowlisted door.

**Do** (`app/backend/`):
1. `internal/gui/backend.go` — `wmLadder` gains `icewm-session` at index 0;
   `ResolveWM` returns `[]string{"icewm-session", "--nobg", "--notray"}` for
   it and accepts an optional pin (`gui.wm`) ahead of the ladder, with the
   `x-session-manager` wrap preserved. Table test for order, pin, pin-miss.
2. `internal/gui/seed.go` (new) — `go:embed` `seed/preferences`; `SeedProfile(dir, resolved)`
   writes `preferences` when absent, always rewrites `toolbar` and `menu`
   from the resolved terminal/browser (rows omitted when unresolved); returns
   `(seeded bool, err)`. Directory 0700, files 0600. Tests on a temp dir:
   first run seeds, second run leaves `preferences` byte-identical after a
   user edit, toolbar tracks a changed resolution.
3. `internal/gui/launch.go` (new) — `ResolveApp(role, lookPath, stat)` with
   the G-D5 ladders and the dangling-alternative check; `LaunchHint(role)`
   per-manager wording. Tests with fake lookPath/stat.
4. `internal/gui/hint.go` (new) — `PackageManager(lookPath)` → `apt|dnf|pacman|""`;
   `InstallHint()` and `WMInstallHint()` built from it (G-D2 wording).
   Existing `InstallHint` tests updated; doctor/status tests updated for the
   new strings.
5. `cmd/rk/gui_supervise.go` — resolve `gui.wm` from settings; call
   `SeedProfile` before the WM start; set `ICEWM_PRIVCFG` in the WM env
   (only for the icewm rung); stamp `daemon.GUIOptionWM` (`@rk_gui_wm`, new
   const in `internal/daemon/gui.go`) with `argv[0]` or `""`; new log lines
   per § UX. `guiNoWMLine` names `icewm-session` first and carries the hint.
   Seams for settings read and seed so tests stay X-free.
6. `internal/daemon/gui.go` + `api/sse.go` — read `@rk_gui_wm` on the same
   tick as display/backend; `gui.StreamEntry.WM` and `gui.Status.WM` /
   `WMHint`; `Assemble` fills `WMHint` when enabled, reachable, and `WM == ""`.
7. `internal/gui/apps_linux.go` — name exclusion set (G-D7) applied after
   the pid excludes; test with a fake procRoot carrying `icewm` and `xterm`.
8. `cmd/rk/gui.go` — `rk gui on` prints the WM lines after `started (…)`
   (bounded stamp read, silent when absent); `guiStatusSummary` appends the
   WM name or `no window manager`; `rk gui launch <terminal|browser>` verb
   (detached start via the existing `gui_exec.go` detach seam; `ok:false`
   path prints the hint, exit 1). `rk gui env`/`exec`/`shot` unchanged.
9. `api/gui.go` + `router.go` — `POST /api/gui/{id}/launch` (body
   `{"app":"terminal"|"browser"}`, 400 on anything else, gated like restart
   on `id == host` and `enabled`; response `{ok, app, argv0}` or
   `{ok:false, hint}`). Handler test with seams.
10. `cmd/rk/doctor.go` — the gui Note gains the WM segment (§ UX).
11. `internal/settings/settings.go` — `gui.wm` row after `gui.enabled`
    (string, default `""`, category `behavior`, `ui: true`, `live: false`);
    round-trip tests (omitted when empty).
12. `internal/gui/xvnc_integration_test.go` — when `Xtigervnc` **and**
    `icewm-session` are on PATH: supervise on a temp state dir, assert the
    `@rk_gui_wm` stamp equals `icewm-session`, the profile dir has the three
    files, `RunningApps` is empty after the exclusion; skip cleanly otherwise.
13. Docs: `docs/specs/gui.md` (§ The supervisor: the ladder, the profile,
    the stamp; § Agent verbs: `launch`; § The switch: the hint lines) —
    strike the parent's "WM probe order … proposed" note; `docs/site/skill/gui.md`
    (`rk gui launch`, the profile dir); memory `docs/memory/run-kit/gui.md`
    via hydrate; the parent plan's § Change breakdown gets a pointer row to
    this plan (no other edit to the parent).

**Acceptance**:
- On this VM with `icewm` installed: `rk gui restart` → the tile shows the
  NanoBlue taskbar over `#3b4252`, no wallpaper; `rk gui status` names
  `icewm-session`; `rk doctor` shows it; `rk gui launch terminal` opens a
  terminal that appears in `apps:`; `rk gui launch browser` exits 1 with the
  chromium hint; `GET /api/gui/host` carries `"wm":"icewm-session"`.
- With `icewm-session` temporarily hidden from PATH (test seam or a `PATH`
  without it): the supervisor logs the no-WM line naming the install
  command, the stamp is `""`, the stream entry carries `"wm":""`, `rk gui on`
  prints the two-line hint, doctor shows the install line.
- `go test ./...` green; `just test` green; the seeded `preferences` survives
  a `rk gui restart` after a manual edit.

### G2 — Frontend: the bare-WM strip and the launch palette rows

**Purpose**: G-D8.

**Do** (`app/frontend/`):
1. `src/api/client.ts` — `GuiEntry.wm: string`; `launchGuiApp(id, app)` →
   `POST /api/gui/{id}/launch`; `GuiStatus.wm`/`wm_hint`.
2. `src/components/gui-surface.tsx` — when `reachable && gui.wm === ""` and
   not dismissed, render the strip above the canvas (`data-testid="gui-wm-strip"`):
   text per § UX, `Copy` (clipboard write of the install line, falls back to
   a select-all on failure), `×` dismiss persisted to localStorage (guarded
   try/catch), cleared when `wm` becomes non-empty. The strip's height is
   subtracted from the canvas fit so SetDesktopSize (parent D7) is unaffected.
   Coarse-pointer sizing via the shared button token.
3. `src/lib/palette/gui.ts` — `gui-open-terminal` / `gui-open-browser` rows
   when `enabled && reachable`; `onSelect` calls `launchGuiApp` and toasts
   `hint` on `ok:false` (the existing toast seam).
4. Tests: vitest for the strip's three states (present / bare / bare+dismissed)
   and the palette rows' gating; Playwright `gui-surface.spec.ts` step with
   the stubbed stream `wm: ""` → strip visible with the exact install text,
   `Copy` puts it on the clipboard, `wm: "icewm-session"` → strip gone
   (intent comments per the constitution's Test Intent rule).
5. Docs: `docs/specs/gui.md` § The tile gains the strip and the palette rows;
   memory via hydrate.

**Acceptance**: with the live daemon on this VM, hide `icewm-session` from
the supervisor (G1's seam via `gui.wm=nonexistent` is *not* enough — that
falls back to openbox; use a `PATH` without both), `rk gui restart` → the
strip appears on desktop and at 375 px, `Copy` yields the apt line, `×`
hides it and it stays hidden across reload; restore PATH, `rk gui restart` →
strip gone, `GUI: Open terminal` from the palette opens a terminal on the
desktop; `GUI: Open browser` toasts the chromium hint. `just test` green.

### G3 — Agent verbs: windows, input, wait, capture upgrades, clipboard, open, lock

**Purpose**: G-D10 through G-D13. After this change an agent drives the host
desktop from a shell with the same shape it drives the code and web surfaces:
a gate, a few verbs with one contract, and a recipe that does not depend on
blind sleeps or knowing xdotool.

**Do** (`app/backend/`, `docs/`):
1. `internal/gui/xdo.go` (new) — argv builders for every xdotool call
   (`search --onlyvisible`, `getwindowname`, `getwindowgeometry --shell`,
   `getwindowpid`, `getactivewindow`, `windowactivate --sync`, `mousemove`,
   `click`, `type --delay 12 --file -`, `key --clearmodifiers`) plus the
   `Windows` parser (rows from the search/geometry output). Pure functions,
   table-tested; no X server in unit tests.
2. `cmd/rk/gui_windows.go` — `rk gui windows [--json]` (columns
   `ID PID GEOMETRY TITLE`, active row marked, `app` from `/proc/<pid>/comm`)
   and `rk gui focus <id|--title>` (ambiguous substring ⇒ exit 1 listing the
   matches). Reuses `gui_exec.go`'s display/env seams.
3. `cmd/rk/gui_input.go` — `click`, `move`, `scroll`, `type`, `key`. `type`
   feeds xdotool via stdin (unicode-safe, no argv quoting), translates `\n`
   to `Return`; `--window <id>` on `click` makes coordinates window-relative
   via `getwindowgeometry`. All run through `exec.CommandContext` with the
   existing 10 s tmux-class timeout. G-D13 guard before every input verb:
   `GET /api/gui/{id}` (or the tmux option, see 6) → `human_input_ago`;
   refuse under `guiHumanInputGrace` unless `--force`.
4. `cmd/rk/gui_shot.go` — `--scale <f>` / `--max-width <px>` (mutually
   exclusive; ImageMagick `-resize`, `scrot`'s `-t` is not used — resize is a
   post-step via `convert` when `import` is absent), `--window <id>`
   (`import -window <id>` / `xwd -id`); stderr line `geometry WxH scale S`
   always printed. stdout stays the path only.
5. `cmd/rk/gui_wait.go` — `wait --window <substr>` (poll `search --name`
   every 250 ms) and `wait --stable` (two consecutive captures with equal
   SHA-256, captured at `--scale 0.25` to keep it cheap). `--timeout`
   default 10 s; exit 1 with `timed out after 10s` on expiry.
6. Relay: `api/gui_filter.go` / `gui_ws.go` — on each parsed client
   `PointerEvent`/`KeyEvent` update `hub.guiHumanInputAt[id]` (an in-memory
   timestamp — ephemeral, in-flight, exactly Constitution X's carve-out).
   Expose as `human_input_ago_ms` on `GET /api/gui/{id}` and the `event: gui`
   entry; `rk gui status` renders `human input 1s ago`. Zero when no viewer
   has driven the display or the relay restarted.
7. `cmd/rk/gui_clip.go` — `clip get|set` via `xclip -selection clipboard`
   then `xsel --clipboard`; `set --stdin`. Missing both ⇒ `sudo apt install
   xclip`.
8. `cmd/rk/gui_open.go` — `open <url|file>` = `xdg-open` detached (the
   `exec --detach` path); file paths are made absolute first.
9. `cmd/rk/gui_launch.go` — `--cdp [--port N]` for the browser role: appends
   `--remote-debugging-port=N` (and `--user-data-dir` under
   `$XDG_STATE_HOME/run-kit/gui/cdp-<N>/` so a running profile does not
   swallow the flag), waits ≤ 5 s for the port to accept, prints
   `cdp http://127.0.0.1:N` on stdout after the `started` line. Refuses for
   the terminal role (usage).
10. `cmd/rk/gui.go` — `lock` / `unlock` set and clear the D7 pin the
    palette uses (whatever state the tile reads — the `@rk_gui_*` option or
    the settings key C3 chose; the intake confirms which), `status` shows
    `locked`.
11. Tests: Go unit for every argv builder, the windows parser, the guard
    (fake `human_input_ago`), the scale flag arithmetic, `type` stdin
    translation; integration (`xvnc_integration_test.go`, gated on
    `Xtigervnc` + `xdotool` + `icewm-session`): launch `xterm`, `windows`
    lists it, `focus` + `type "echo hi"` + `key Return`, `wait --stable`,
    `shot --scale 0.5 --window` yields a PNG of the window's scaled size.
12. Docs: `docs/site/skill/gui.md` (the new verbs, the rewritten recipe, the
    guard gotcha, the coordinate rule), `docs/specs/gui.md` § Agent verbs,
    `rk gui --help` groups the verbs (`display: env exec launch open`,
    `look: shot windows wait`, `drive: focus click move scroll type key clip`,
    `guard: lock unlock`), memory via hydrate.

**Acceptance** (this VM, IceWM desktop from G1):
- `rk gui launch terminal` → `rk gui windows` lists the xterm with a pid and
  geometry; `rk gui focus --title xterm`; `rk gui type 'echo hello'`;
  `rk gui key Return`; `rk gui wait --stable`; `rk gui shot --scale 0.5`
  prints a path and `geometry 1920x1080 scale 0.5` on stderr; the PNG is
  960×540 and shows `hello`.
- With a browser tab open in the tile, move the mouse over the desktop, then
  within 3 s run `rk gui click 10 10` → exit 1 `human input 1s ago — retry or
  pass --force`; `--force` clicks.
- `rk gui lock` → resizing the tile from a laptop no longer changes
  `rk gui status` geometry; `unlock` restores D7.
- `rk gui clip set 'a long paragraph'` then `key ctrl+v` in the terminal pastes
  it; `rk gui open https://example.com` starts the browser (or exits 1 with
  the browser hint when none is installed).
- `PATH` without `xdotool` → every drive verb exits 1 with the apt hint;
  `shot` and `launch` still work.
- `go test ./...` and `just test` green.

---

## Constitution mapping

| Principle | How this plan honors it |
|---|---|
| I Security First | launcher is a two-role allowlist over `LookPath`-resolved argv slices; no shell strings; `exec` stays CLI-only; profile dir 0700 |
| II No Database | the WM name is a tmux session option stamped by the one process that knows it; the profile dir is a seeded artifact whose deletion changes only the look (the code-server profile carve-out) |
| III Wrap, Don't Reinvent | IceWM draws the desktop; rk seeds a config and points at packages, it does not build a panel |
| IV Minimal Surface Area | one strip, two palette rows, one settings key; no new routes/pages; `gui.wm` lives in the registry with no env form |
| V Keyboard-First | both launch actions are palette rows; the strip's actions are buttons reachable by Tab |
| VII Convention Over Configuration | the ladder needs nothing; `gui.wm` defaults to `""`; the profile seeds itself |
| X Hooks Carry Only the Underivable | `@rk_gui_wm` is written by the supervisor (rk's own process), not an agent hook; everything else derives per tick |
| Toolkit `install-composition` | probe, degrade, hint — no package edge, no `apt` run by rk; G3's xdotool/xclip are probed the same way |
| X (G3) | the only new pushed fact is the relay's last-human-input timestamp — in-flight, in-memory, exists nowhere on disk; window inventory, geometry, and pids derive from X at call time |

## Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | Non-apt package names (`tigervnc-server`, `icewm` on dnf/pacman) are unverified | wording only, never executed; the intake marks them Likely; the hint falls back to a generic sentence when no manager is detected |
| 2 | IceWM 2.9's menu-curation keys differ from the docs (`ShowSettingsMenu=0` had no effect in the spike) | the seeded `preferences` carries only keys the spike verified; curation keys are added when verified, otherwise the bottom `Settings` row is accepted |
| 3 | A user who already runs IceWM on their own desktop shares `~/.icewm` — not touched, because `ICEWM_PRIVCFG` points elsewhere; but `icewm-session` also reads `~/.icewm/startup` | verify in G1 that `ICEWM_PRIVCFG` moves `startup`/`shutdown` too (IceWM docs say the private dir is the one home); if not, pass `--config` and `--theme` explicitly |
| 4 | The strip steals vertical space from the canvas and shifts SetDesktopSize | the fit subtracts the strip; the strip only exists in the bare case, which is the state we are steering users out of |
| 5 | `x-terminal-emulator` resolves to a terminal that ignores `DISPLAY` env or needs D-Bus (gnome-terminal) | the ladder prefers plain X terminals first; gnome-terminal is last |
| 6 | Reordering the ladder changes the desktop for existing hosts that have both openbox and icewm | that is the intent; `gui.wm=openbox` pins the old behavior |
| 7 | (G3) `xdotool type` mangles non-ASCII or fast input in some apps | stdin feed with `--delay 12`; `clip set` + `key ctrl+v` is the documented path for anything longer than a line |
| 8 | (G3) window titles change while the agent works (browser tabs), so `--title` matches drift | `windows --json` returns stable X ids; the recipe resolves once and uses the id |
| 9 | (G3) the human-input guard has false positives from a viewer's idle mouse drift | 3 s grace is short; `--force` exists; the guard never applies to reads or launches |
| 10 | (G3) `--cdp` on an already-running browser profile is ignored by Chromium | a dedicated `--user-data-dir` per port; the verb waits for the port and fails loudly otherwise |

## Pickup protocol (for the agent taking G2 or G3)

1. Read this file in full, then the parent plan's § Decision log and § C5
   verdict, `docs/specs/gui.md`, `fab/project/constitution.md`, and the
   memory files `gui`, `daemon-lifecycle`, `configuration`, `tmux-sessions`.
2. Treat § Decision log here as Certain in SRAD scoring; the non-apt package
   names in G-D2 are Likely.
3. Do not touch the live `rk-gui` session while a C6 measurement is running
   (`tmux -L rk-daemon list-windows -t rk-jobs` shows a perf job).
4. Fill your row in § Change breakdown when you create the change; mark Done
   when merged; add the pointer row to the parent plan in the same PR.
5. G3 starts only after G2 is merged (shared `gui` CLI files and spec
   section). Before G3's input verbs, read `docs/site/skill/gui.md` as it
   stands — the rewritten recipe must keep every existing verb's contract
   (`env`, `exec`, `shot` stdout, exit codes) byte-compatible.

## Spike re-run recipe

```
sudo apt install --no-install-recommends icewm
D=:99; SOCK=$XDG_RUNTIME_DIR/rk-spike.sock      # sun_path cap: keep it short
Xtigervnc $D -rfbunixpath $SOCK -rfbport -1 -SecurityTypes None -AlwaysShared -AcceptSetDesktopSize -geometry 1280x800 -desktop spike &
mkdir -p /tmp/icewm-seed && printf 'Theme="NanoBlue/default.theme"\nTaskBarShowCPUStatus=0\nTaskBarShowNetStatus=0\nTaskBarShowMailboxStatus=0\nTaskBarShowWorkspaces=0\nTaskBarClockLeds=0\n' > /tmp/icewm-seed/preferences
printf 'prog Terminal terminal x-terminal-emulator\n' > /tmp/icewm-seed/toolbar
DISPLAY=$D ICEWM_PRIVCFG=/tmp/icewm-seed icewm-session --nobg --notray &
DISPLAY=$D xsetroot -solid '#3b4252'
DISPLAY=$D import -window root shot.png                     # imagemagick
DISPLAY=$D xrandr --newmode 536x799 0 536 536 536 536 799 799 799 799; DISPLAY=$D xrandr --addmode VNC-0 536x799; DISPLAY=$D xrandr --output VNC-0 --mode 536x799
ps -o pid,rss,comm -C icewm,icewm-session
```
