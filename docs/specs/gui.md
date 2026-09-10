# GUI Surface — The Host's Desktop as a Fourth Tile

> The `gui` surface renders the host's graphical desktop as a fourth surface
> kind beside `tty` / `code` / `web` — a human watches and drives it from any
> tab (phone included); agents launch apps into it and screenshot it. It
> exists only when the user has explicitly turned it on.
>
> **Status**: C2 (the backend — switch, supervisor, relay, state slot), C3
> (the frontend tile), C4 (§ Agent verbs), and C5 (§ Smoothness targets —
> measured 2026-09-10) are shipped. C5's verdict picks up C6 as a
> bandwidth-efficiency change (the fps target is met on loopback and on a
> latency-only link, missed at ≤ 40 Mbit/s — see the memory table).
>
> Design authority: the design study
> [`docs/wiki/gui-surface-design-study.html`](../wiki/gui-surface-design-study.html)
> (protocol matrix, OS split, rationale, alternatives). Execution plan:
> [`fab/plans/sahil/26-09-09-gui-surface.md`](../../fab/plans/sahil/26-09-09-gui-surface.md)
> — its decision log D1–D10 is binding and is what this page carries.
> Companions: [`window-views.md`](window-views.md) (the View Registry row,
> R3/R6), [`surface-layout.md`](surface-layout.md) (the tile),
> [`ui-state.md`](ui-state.md) (the `@N/gui` address).
>
> **Succession note (2026-09-09)**: this spec supersedes PR #71 and
> [`fab/plans/sahil/26-07-14-desktop-view.md`](../../fab/plans/sahil/26-07-14-desktop-view.md).

---

## Name

Surface kind `gui`, label "GUI", CLI `rk gui` (D1). In a tty-centric tool it
is the honest antonym: tty vs gui. Not "desktop" — the name already means
three things in this repo: the Electron viewer shell (`app/desktop`,
`rk desktop install`, the `rk-desktop` session), the wide-viewport branch in
UI prose ("desktop vs mobile"), and the historical lens this page succeeds.
Not `screen` (collides with viewport/screen-size prose and GNU screen), not
`display` (collides with `rk skill display`).

---

## The substrate

**One GUI session per host** (`id = host`) — D2. The substrate is a host
service like code-server, not a window row: it is supervised in the `rk-gui`
sibling tmux session on the `rk-daemon` socket, pane command `rk gui
supervise host`, and that pane's tty IS the supervisor log (R3 for a host
singleton — D8). The relay path and the state payload are list-shaped
(`/ws/gui/{id}`, `gui: [{id, enabled, backend, reachable, display, width,
height, viewers, wm}]`) so per-session displays can land later without reshaping.

```
 browser tile (GuiSurface: noVNC RFB → <canvas>)         state stream: gui[{id:"host", enabled, backend, reachable, display, width, height, viewers, wm}]
        │  wss  /ws/gui/host                                      ▲
        ▼                                                         │ probe (dial socket, TTL-cached like codeServerReachable; skipped while a relay viewer is live)
 rk daemon ── WS⇄stream relay (api/gui_ws.go, sibling of terminals_ws.go) ── Linux: unix  $XDG_STATE_HOME/run-kit/gui/host.sock
        │                                                                  └─ macOS: tcp 127.0.0.1:5900 (Apple Screen Sharing)
        │ GET /api/gui/{id} (the status document: reason, apps, uptime_seconds)
        │ POST /api/gui/{id}/restart; on/off via POST /api/settings {"gui.enabled": …}
        ▼
 tmux server rk-daemon
   ├─ rk-code-server   (existing sibling)
   └─ rk-gui           (new sibling; window "host")
         └─ rk gui supervise host        ← the pane command; its tty IS the supervisor log (R3)
               ├─ Xtigervnc :N -rfbunixpath …/host.sock -rfbport -1 -SecurityTypes None -AlwaysShared -AcceptSetDesktopSize -geometry 1920x1080 -FrameRate=60
               └─ WM (icewm-session --nobg --notray | openbox | …) ICEWM_PRIVCFG=…/gui/icewm
```

---

## The supervisor

The pane command `rk gui supervise host` owns the desktop end to end. The
window manager comes from a fixed ladder — `icewm-session`, `openbox`,
`xfwm4`, `i3`, `kwin_x11`, `x-session-manager` — first on PATH wins, or the
`gui.wm` pin when set (an unresolvable pin logs and falls back to the
ladder). `icewm-session` runs `--nobg --notray`: icewmbg would paint a theme
wallpaper over the `xsetroot -solid #3b4252` ground, and the tray is dead
weight on a single-user display. Every session starter — `startlxqt`,
`lxqt-session`, `startxfce4`, `xfce4-session`, `startplasma-x11`,
`x-session-manager` — runs under `dbus-run-session -- <name>`: a desktop
environment without a session bus fails its panel, tray, and policy agents
silently, and libdbus autolaunch on a headless X display is not dependable.
Bare window managers run unwrapped. A session starter also runs in its own
process group, and teardown signals the group — SIGTERM first, then SIGKILL
after 5 s — because signalling only the `dbus-run-session` child orphans
`dbus-daemon` and the whole session.

For the icewm rung the supervisor seeds a private profile at
`$XDG_STATE_HOME/run-kit/gui/icewm/` (dir 0700, files 0600), passed as
`ICEWM_PRIVCFG` — two file classes: `preferences` is write-once (seeded when
absent; user edits persist; delete to re-seed), `toolbar` and `menu` are
regenerated on every start from the launcher ladders (rows only for resolved
binaries). `~/.icewm` is never touched. Before starting the WM the supervisor
stamps `@rk_gui_display`, `@rk_gui_backend`, and `@rk_gui_wm` (the resolved
WM name — never the `dbus-run-session` wrapper — or `""` when bare) on the
`rk-gui` session in one burst; every reader — the status document (`wm`,
`wm_hint`), the `event: gui` stream entry, `rk gui status`, doctor — derives
the WM from that stamp.

---

## Switching desktops

`rk gui wm [auto|icewm|lxqt|xfce|<binary>] [--restart] [--force]` is the CLI
face of the `gui.wm` pin (§ The switch). With no argument it reports the pin
and the live rung (`wm: auto → icewm-session (running)`, `wm: startlxqt
(pinned; not running)`) — state, exit 0 always. The aliases map `auto` ⇒ the
ladder, `icewm` ⇒ `icewm-session`, `lxqt` ⇒ `startlxqt`, `xfce` ⇒
`startxfce4`; anything else is a literal binary name. A name not on PATH is
refused with the package-manager-aware install line (the desktop's packages
for a session starter, the icewm line for a bare WM) unless `--force` pins
anyway — the supervisor then logs the miss and falls back to the ladder. The
pin takes effect on `rk gui restart`; `--restart` chains into that verb and
inherits its refusals (gui off, daemon down).

```
$ rk gui wm lxqt
error: startlxqt not on PATH — sudo apt install --no-install-recommends lxqt-core (pass --force to pin anyway)
$ rk gui wm lxqt --restart
set gui.wm=startlxqt
restarted (Xtigervnc :10)
  window manager: startlxqt (session)
$ rk gui wm auto --restart
set gui.wm= (ladder)
restarted (Xtigervnc :10)
  window manager: icewm-session
```

---

## The switch

**Off by default. One switch, `gui.enabled`** — a settings-registry bool,
default `false`, home `~/.config/run-kit/config.yaml`, **no env form** (env
stays the three binding keys — Constitution IV) — D3. A second registry key,
**`gui.wm`** (string, default `""`, no env form), pins the window manager;
empty picks the first ladder rung on PATH (§ The supervisor). It takes effect
on `rk gui restart`.

| Entry point | Form | Notes |
|-------------|------|-------|
| CLI | `rk gui on` / `rk gui off [--yes]` / `rk gui status` | writes the setting, then ensures or kills the session; `on` on a host with no backend prints the install hint and still enables (the tile then shows the hint — the code tile's not-running state) |
| Settings dialog | a **GUI** row with a toggle | registry-driven; the off direction opens the confirm listing running apps |
| Palette | `GUI: Turn on` / `GUI: Turn off` | Constitution V parity for the dialog toggle; same confirm. On a live display (enabled ∧ reachable, never on the macOS mirror) the palette also carries `GUI: Open terminal` / `GUI: Open browser`, calling the § Agent verbs launcher over HTTP |
| Tile empty state | appears only when enabled but unreachable | "GUI is on but not running" → Restart supervisor · Open supervisor logs · install hint; there is deliberately **no Start button on a disabled host** — the button itself doesn't exist there |

Install hints are package-manager-aware (apt/dnf/pacman probed by presence —
wording only, never executed). `rk gui on` on a host with no backend prints
`enabled — no VNC backend installed: <pm-line-backend>` (backend + WM, e.g.
`sudo apt install --no-install-recommends tigervnc-standalone-server icewm`);
on a backend with no WM it starts, then notes `no window manager — running
bare. Install one: <pm-line>` and `then: rk gui restart`.

**On** ⇒ the supervisor is ensured now and re-ensured on daemon boot (the
`ensureCodeServer` boot-hook shape, gated on the setting); the 4th toggle
button exists **iff** enabled. **Off** ⇒ the button is gone on every tab,
open `gui` tiles degrade out of `@rk_win_layout` via the existing ladder (the
option is left as written, so re-enabling restores them), and the session is
killed after a confirm that lists running apps; the CLI needs `--yes`.

**Never on by default**: no install, update, or backend probe flips the
switch; `rk doctor` shows `gui: off`. A host with Xvnc installed still shows
no button until someone turns it on.

---

## Availability vs reachability

Availability and reachability are separate facts (study §1):

| | code (shipped) | gui (target) |
|---|---|---|
| **Available** (button exists) | a code folder derives (git root / latch) | `gui.enabled` is on — a user choice, never a probe result; a host with Xvnc installed but the switch off shows no button |
| **Reachable** (live content) | code-server answers on its conventional port | the GUI socket answers; otherwise an empty state: restart supervisor · open supervisor logs · install hint when the backend is missing |
| **Content selector** | `@rk_win_code_root` | none in v1 — the tile shows the host's screen (a per-session display option becomes the selector if per-session GUIs ever land) |
| **Dot** | reachability | VNC WS health (window-views R6) |

---

## The tile

Three content states, driven by the stream entry alone (no polling):

- **Reachable, WM present** (`wm` non-empty): the canvas, nothing else. The
  desktop's own affordances (the IceWM taskbar: start menu · Terminal ·
  Browser-if-installed · task buttons · clock) are the UI.
- **Reachable, bare** (`wm === ""`): a one-line strip pinned above the canvas
  (a flex sibling, so the canvas fit subtracts the strip's height — never an
  overlay), monospace, wrapping to two lines at phone width:
  `No window manager on the GUI host — <pm-line> · then Restart supervisor`
  with a `Copy` button (copies only the install line; reads `Copied` for
  1.5 s on success) and a `×` dismiss. The install line is the status
  document's `wm_hint`, fetched once per bare transition (the empty state's
  reason-fetch grammar — a failed GET leaves the strip without the line and
  without Copy; the frontend never hardcodes a package name). `Restart
  supervisor` is the empty state's action, reused. `×` dismisses for this
  viewer only (localStorage `runkit-gui-wm-strip-dismissed`; a later
  `wm != ""` clears it, a `reachable` flip never does). The macOS mirror
  backend is excluded by construction — it stamps no WM and has no display to
  install one into, so the strip never renders there.
- **Unreachable**: the existing empty state; the reason line already carries
  the backend hint via `reason`.

The palette gains two launch rows beside the strip (§ The switch): `GUI: Open
terminal` / `GUI: Open browser`, gated on `enabled && reachable && backend !==
"screen-sharing"` (a tile need not be open — a phone user may launch first,
then switch to the tile). They call `POST /api/gui/{id}/launch`; an `ok:false`
answer (a launcher-ladder miss — a 200 by design) toasts the server's `hint`
verbatim, a success toasts nothing, and a thrown error (409/500/network)
toasts the error message.

---

## Protocol and relay

**RFB (VNC) over rk's own WebSocket relay; renderer stock noVNC
(`@novnc/novnc`) on a `<canvas>`** — D4. `GET /ws/gui/{id}` upgrades and pipes
binary frames ⇄ the backend stream, a sibling of the terminal relay. VNC is
never on TCP on Linux — a unix socket by convention under
`$XDG_STATE_HOME/run-kit/gui/` (`host.sock`; dir 0700, socket 0600); auth
`None` (the same trust boundary as code-server's `--auth none`: the only
client is rk on the same user). Mutations are `POST /api/gui/{id}/restart`,
`POST /api/gui/{id}/launch` (the allowlisted two-role launcher; body
`{"app":"terminal"|"browser"}`, never argv), plus the `gui.enabled` key on
`POST /api/settings`; there is no route family
beyond `/ws/gui/*` and `/api/gui/*`.

The relay's RFB client-message parser runs on every backend: on `tcp` (the
macOS mirror) it drops KeyEvent, PointerEvent, and QEMU extended key (255/0)
messages after the handshake; on `unix` it runs in observe mode — every chunk
forwards verbatim regardless of parser state, and completed input messages
stamp the hub's in-memory last-human-input time (the agent-verb guard's
signal, § Agent verbs).

---

## OS split

**Linux v1 = TigerVNC `Xvnc`** (`-rfbunixpath … -SecurityTypes None
-AlwaysShared -AcceptSetDesktopSize -geometry 1920x1080 FrameRate=60`) plus a
window manager, X11 not Wayland — D5 — **unless C0 says KasmVNC**: then
KasmVNC is the Linux default and Xvnc the no-install fallback.

**macOS v1 = mirror the live session via Apple Screen Sharing, view-only** —
D6. The relay dials `127.0.0.1:5900`; noVNC negotiates ARD (security type
30); the password comes from the login Keychain (`security
find-generic-password`), never `config.yaml`. "Take control" is a later,
deliberate toggle. The XQuartz path is dropped; the CGVirtualDisplay tool is
an optional later backend.

---

## Resize policy

The desktop follows the **last-focused fine-pointer viewer's** tile size via
SetDesktopSize; other viewers scale client-side; **coarse-pointer viewers
never drive resize**; palette `GUI: Lock resolution` pins it — D7. HiDPI
renders 1× (CSS pixels) by default.

The host-side pin: `rk gui lock` sets the session-scoped tmux option
`@rk_gui_lock` on `rk-gui` (`rk gui unlock` unsets it; both gated,
idempotent, and the option dies with the session — `restart`/`off` clear it).
The hub reads it on the gui tick beside the stamps and streams it as the
entry's `locked`; the tile ANDs `!locked` into `resizeSession` beside the
viewer-local pin (an additional term, not a replacement), so an agent loop's
coordinates cannot move mid-loop; `rk gui status` and the doctor row render
`, locked` as the summary's last segment.

---

## Agent verbs

All gated on enabled+reachable with exit 1 plus the `rk gui on` hint
otherwise (plan C4, study §10):

- `rk gui env` — prints `DISPLAY=:N` and the socket path for `eval`.
- `rk gui exec <cmd…>` — runs a command on the display (the `rk code exec`
  shape).
- `rk gui launch <terminal|browser> [--cdp [--port 9222]]` — the allowlisted
  launcher: two roles resolved server-side over fixed ladders (first on PATH
  wins, dangling alternatives skipped); a miss exits 1 with the install hint
  (the HTTP twin returns `{"ok":false,"hint"}`). Prefer it over
  `exec --detach` for the two roles — one ladder shared by the CLI, HTTP, and
  the IceWM toolbar. `--cdp` (browser role only, Chromium-family only — a
  Firefox resolution refuses, exit 1) adds `--remote-debugging-port` with a
  dedicated profile dir, waits ≤ 5 s for the port, and prints a second datum
  line `cdp http://127.0.0.1:<N>` (the Playwright `connectOverCDP` endpoint).
- `rk gui shot [--out <png>] [--scale <f> | --max-width <px>] [--window <id>]`
  — screenshots the display; macOS refuses in v1 (view-only mirror). stdout
  stays the bare absolute path; stderr always carries `geometry WxH scale S`
  (the source geometry and applied scale). Resizing rides ImageMagick
  (`import -resize` inline; a `convert` post-stage for scrot/xwd); `--window`
  on the scrot rung and any scale without ImageMagick refuse with the
  imagemagick hint.
- `rk gui windows [--json]` — the visible-window inventory: `ID PID GEOMETRY
  TITLE` rows (`WxH+X+Y`, sorted by X id, the active row suffixed ` *`) or
  `[{id, pid, x, y, width, height, title, active, app}]`; pid 0 / no active
  mark / `[]` degrade, never error.
- `rk gui focus <id|--title <substr>>` — raise + focus exactly one window;
  zero matches, an ambiguous substring, or a non-window id all exit 1.
- `rk gui click <x> <y> [--right|--middle|--double] [--window <id>]`,
  `rk gui move <x> <y>`, `rk gui scroll <up|down|left|right> [--n 3] [--at x
  y]`, `rk gui type <text>|--stdin` (unicode-safe via stdin; newline =
  Return), `rk gui key <chord>…` (xdotool keysym spelling) — the input
  verbs, wrapping xdotool (a miss refuses `xdotool not found — sudo apt
  install xdotool`). Coordinates are display pixels.
- `rk gui wait --window <substr> [--timeout 10s]` (prints the first matching
  window id) / `rk gui wait --stable [--interval 500ms] [--timeout 10s]`
  (exits 0 once two consecutive scale-0.25 captures are pixel-identical —
  hashed over decoded pixels, never PNG bytes, because ImageMagick's date
  text chunks differ per capture). Expiry is `timed out after <d>`, exit 1.
- `rk gui clip get | set <text> | set --stdin` — the CLIPBOARD selection via
  xclip (xsel fallback; the apt hint when neither is installed). `set`
  attaches no stdout/stderr pipes and never kills the forked selection owner
  — on a desktop with no clipboard manager that child IS the clipboard.
- `rk gui open <url|file>` — `xdg-open` detached (`started <pid> on :N`);
  without it a URL falls back to the browser ladder and a file refuses with
  the xdg-utils hint.
- `rk gui lock` / `rk gui unlock` — the host resolution pin (§ Resize
  policy).
- `rk agent setup` — exports `DISPLAY` into managed panes when enabled
  (read-time derivation from the supervisor's stamped display, never a hook
  push — Constitution X).
- `rk skill gui` — the briefing page.

**The human-input guard**: the six input verbs (`click`, `move`, `scroll`,
`type`, `key`, `focus`) — and only those — fetch the daemon's status document
before acting and refuse with `human input <N>s ago — retry or pass --force`
(exit 1) when `human_input_ago_ms` is present and under 3 s; `--force`
overrides. The guard fails open when the daemon's HTTP origin does not answer
(with no daemon there is no relay viewer, so nobody can be driving).

**The coordinate rule**: one coordinate space — display pixels. `shot`'s
stderr line carries the source geometry and scale, so shot-derived
coordinates divide by S back into display pixels.

**The status document and stream entry** gain `locked` (always present, like
`wm`) and `human_input_ago_ms` (`omitempty`, clamped ≥ 1 ms when the hub has
seen relayed input; absent before any — the timestamp is in-memory and dies
with the daemon). `rk gui status` renders `  human input <N>s ago` under the
summary while the fetched document is inside the grace window, and `--json`
prints the fetched (live) document when the daemon answers.

---

## Smoothness targets

Measured after C3, not assumed — D9: click-to-pixel < 100 ms; ≥ 30 fps
scrolling a browser page at 1080p over Tailscale; < 1 core of Xvnc CPU.
KasmVNC (Linux only, its own client, iframe via the `/code/` proxy shape) is
the upgrade lane, gated on C5's numbers.

Measured (C5, 2026-09-10) by the `@perf` audit spec
`app/frontend/tests/e2e/gui-perf.spec.ts` on loopback and on port-scoped
`netem` links (`scripts/gui-perf-link.sh`): Xvnc CPU ≤ 0.52 cores and a
pipeline cost of ~29 ms click-to-pixel on every link (met; the remaining
latency is the link's own RTT); 59 fps on loopback and 34 fps at 260 ms RTT
uncapped (met), 11 fps at 260 ms / 40 Mbit/s (missed — bytes per frame, not
latency, bound the rate). The table, method, and re-run recipe live in
`docs/memory/run-kit/gui.md` § Smoothness (C5).

---

## Out of scope

D10: audio, multi-monitor, per-session displays, Wayland, macOS "take
control", the macOS virtual-display backend, board pins of `(window, gui)`.

---

## Constitution mapping

- **I** — argv slices + timeouts everywhere; `id` validated; sockets 0600.
- **II / X** — nothing stored: enabled is a preference, reachability is a dial
  probe, running is a session probe; deleting the socket file degrades to
  "not running".
- **IV** — no new env keys (socket + display are conventions; `rk gui env`
  prints them); no new route family beyond `/ws/gui/*` and `/api/gui/*`
  POSTs; the settings row rides the one registry-driven settings surface.
- **V** — every verb palette-reachable; ⌘4 is a chord, buttons are the mirror.
- **VI** — tmux owns Xvnc; the relay reattaches after rk restarts.
- **IX** — mutations are POST.

---

## Phasing

The execution plan's C0–C6, condensed (scope and acceptance live in
[`fab/plans/sahil/26-09-09-gui-surface.md`](../../fab/plans/sahil/26-09-09-gui-surface.md);
the desktop leg — the IceWM rung, the seeded profile, the WM stamp, the
launcher — lives in the child plan
[`fab/plans/sahil/26-09-10-gui-desktop.md`](../../fab/plans/sahil/26-09-10-gui-desktop.md)):

| # | Change | One line |
|---|--------|----------|
| C0 | KasmVNC spike | Half a day, nothing merged: a written verdict that picks C2's Linux default |
| C1 | Spec amendments + registry rename | This page and its satellites say `gui`; PR #71 closed (docs only) |
| C2 | Backend: the switch, the supervisor, the relay | `gui.enabled`, `rk gui on\|off\|status\|env\|supervise`, the `rk-gui` session, the `/ws/gui/{id}` relay, `gui[]` on the state stream, the doctor row |
| C3 | Frontend: the tile | The registry row gated on `enabled`, the `GuiSurface` noVNC canvas, the empty state, resize policy, palette and settings rows |
| C4 | Agent verbs | `rk gui exec\|shot`, `DISPLAY` export in `rk agent setup`, `rk skill gui`, the `gui.md` memory file |
| C5 | Measure | The perf spec that turns D9 into numbers — the GATE for C6; verdict: fps missed at ≤ 40 Mbit/s (bytes per frame), C6 picked up as a bandwidth-efficiency change |
| C6 | KasmVNC backend | Picked up by C5's verdict; its intake weighs the in-tree Tight quality lever against the Kasm backend's byte reduction before committing to a second renderer |

Picked with the user at C2/C3 (recorded as open, not decided here): the 4th
toggle's glyph (`▣` placeholder — C3); the off-confirm dialog copy listing
running apps (C2/C3). The WM probe order is decided — the child plan heads
the ladder with `icewm-session --nobg --notray` (G-D1).
