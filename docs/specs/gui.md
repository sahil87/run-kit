# GUI Surface — The Host's Desktop as a Fourth Tile

> The `gui` surface renders the host's graphical desktop as a fourth surface
> kind beside `tty` / `code` / `web` — a human watches and drives it from any
> tab (phone included); agents launch apps into it and screenshot it. It
> exists only when the user has explicitly turned it on.
>
> **Status**: C2 (the backend — switch, supervisor, relay, state slot) and C3
> (the frontend tile) are shipped; § Agent verbs (C4) and § Smoothness
> targets (C5) remain **[target]**.
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
height, viewers}]`) so per-session displays can land later without reshaping.

```
 browser tile (GuiSurface: noVNC RFB → <canvas>)         state stream: gui[{id:"host", enabled, backend, reachable, display, width, height, viewers}]
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
               └─ WM (openbox | xfwm4 | kwin_x11 …) with DISPLAY=:N
```

---

## The switch

**Off by default. One switch, `gui.enabled`** — a settings-registry bool,
default `false`, home `~/.config/run-kit/config.yaml`, **no env form** (env
stays the three binding keys — Constitution IV) — D3.

| Entry point | Form | Notes |
|-------------|------|-------|
| CLI | `rk gui on` / `rk gui off [--yes]` / `rk gui status` | writes the setting, then ensures or kills the session; `on` on a host with no backend prints the install hint and still enables (the tile then shows the hint — the code tile's not-running state) |
| Settings dialog | a **GUI** row with a toggle | registry-driven; the off direction opens the confirm listing running apps |
| Palette | `GUI: Turn on` / `GUI: Turn off` | Constitution V parity for the dialog toggle; same confirm |
| Tile empty state | appears only when enabled but unreachable | "GUI is on but not running" → Restart supervisor · Open supervisor logs · install hint; there is deliberately **no Start button on a disabled host** — the button itself doesn't exist there |

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

## Protocol and relay

**RFB (VNC) over rk's own WebSocket relay; renderer stock noVNC
(`@novnc/novnc`) on a `<canvas>`** — D4. `GET /ws/gui/{id}` upgrades and pipes
binary frames ⇄ the backend stream, a sibling of the terminal relay. VNC is
never on TCP on Linux — a unix socket by convention under
`$XDG_STATE_HOME/run-kit/gui/` (`host.sock`; dir 0700, socket 0600); auth
`None` (the same trust boundary as code-server's `--auth none`: the only
client is rk on the same user). Mutations are `POST /api/gui/{id}/restart`
plus the `gui.enabled` key on `POST /api/settings`; there is no route family
beyond `/ws/gui/*` and `/api/gui/*`.

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

---

## Agent verbs

All gated on enabled+reachable with exit 1 plus the `rk gui on` hint
otherwise (plan C4, study §10):

- `rk gui env` — prints `DISPLAY=:N` and the socket path for `eval`.
- `rk gui exec <cmd…>` — runs a command on the display (the `rk code exec`
  shape).
- `rk gui shot [--out <png>]` — screenshots the display; macOS refuses in v1
  (view-only mirror).
- `rk agent setup` — exports `DISPLAY` into managed panes when enabled
  (read-time derivation from the supervisor's stamped display, never a hook
  push — Constitution X).
- `rk skill gui` — the briefing page.

---

## Smoothness targets

Measured after C3, not assumed — D9: click-to-pixel < 100 ms; ≥ 30 fps
scrolling a browser page at 1080p over Tailscale; < 1 core of Xvnc CPU.
KasmVNC (Linux only, its own client, iframe via the `/code/` proxy shape) is
the upgrade lane, gated on C5's numbers.

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
[`fab/plans/sahil/26-09-09-gui-surface.md`](../../fab/plans/sahil/26-09-09-gui-surface.md)):

| # | Change | One line |
|---|--------|----------|
| C0 | KasmVNC spike | Half a day, nothing merged: a written verdict that picks C2's Linux default |
| C1 | Spec amendments + registry rename | This page and its satellites say `gui`; PR #71 closed (docs only) |
| C2 | Backend: the switch, the supervisor, the relay | `gui.enabled`, `rk gui on\|off\|status\|env\|supervise`, the `rk-gui` session, the `/ws/gui/{id}` relay, `gui[]` on the state stream, the doctor row |
| C3 | Frontend: the tile | The registry row gated on `enabled`, the `GuiSurface` noVNC canvas, the empty state, resize policy, palette and settings rows |
| C4 | Agent verbs | `rk gui exec\|shot`, `DISPLAY` export in `rk agent setup`, `rk skill gui`, the `gui.md` memory file |
| C5 | Measure | The perf spec that turns D9 into numbers — the GATE for C6 |
| C6 | KasmVNC backend | Conditional on C5 missing D9's targets and C0 not having made Kasm the default |

Picked with the user at C2/C3 (recorded as open, not decided here): the 4th
toggle's glyph (`▣` placeholder — C3); the WM probe order (`openbox`,
`xfwm4`, `i3`, `kwin_x11`, `x-session-manager` proposed — C2); the
off-confirm dialog copy listing running apps (C2/C3).
