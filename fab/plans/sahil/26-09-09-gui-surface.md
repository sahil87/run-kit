# GUI surface execution plan — remote desktop as the fourth tile

> Plan doc — written 2026-09-09 from the balmy-frog `/fab-discuss` thread.
> Authority for design: [`docs/wiki/gui-surface-design-study.html`](../../../docs/wiki/gui-surface-design-study.html)
> (the study — protocol matrix, OS split, on/off switch, mobile, agent verbs,
> recorded decisions in its §16) plus [`docs/specs/window-views.md`](../../../docs/specs/window-views.md)
> and [`docs/specs/surface-layout.md`](../../../docs/specs/surface-layout.md)
> (the lens/tile model this rides). This doc owns only the execution shape:
> decisions the intakes treat as Certain, the change breakdown, gates,
> acceptance, and the pickup protocol. Supersedes
> [`26-07-14-desktop-view.md`](26-07-14-desktop-view.md) and PR #71
> (`260323-a805-web-based-remote-desktop`).

**Goal**: a `gui` surface — the host's graphical desktop rendered as a fourth
tile kind beside `tty` / `code` / `web` — that a human can watch and drive
from any tab (phone included), that agents can launch apps into and
screenshot, and that exists only when the user has explicitly turned it on.

**Status (2026-09-10)**: C1 (`260909-5nvd-gui-spec-and-registry-rename`) is
Done (PR #888 merged). C0 verdict is in (Xvnc stands — § C0 verdict). C2
(`260909-fkh1-gui-backend-switch-and-relay`, PR #892) is Done. C3
(`260909-o2sp-gui-surface-tile`, PR #895) is Done. C4
(`260909-bbv1-gui-agent-verbs`, PR #894) is Done. C5
(`260910-xy7q-gui-perf-measure`) is Done — verdict in § C5 verdict: the fps
target is missed at ≤ 40 Mbit/s for byte-budget reasons, so **C6 is picked
up**, scoped as a bandwidth-efficiency change. C6 is the next pickup.

---

## Decision log (Certain — intakes do not re-open these)

| # | Decision | Why |
|---|----------|-----|
| D1 | **Surface kind `gui`**, label "GUI", CLI `rk gui`. Not `desktop` (collides with the Electron shell `rk desktop` / `app/desktop` and the viewport prose everywhere), not `screen`/`display` (collide with viewport prose / `rk skill display`) | study §2 |
| D2 | **One GUI session per host** (`id = host`). Substrate is a host service like code-server, not a window row. The relay path and the state payload are list-shaped (`/ws/gui/{id}`, `gui: [...]`) so per-session displays can land later without reshaping | study §3 |
| D3 | **Off by default. One switch, `gui.enabled`** (settings registry bool, `~/.config/run-kit/config.yaml`, no env form). On ⇒ supervisor ensured (and re-ensured on daemon boot); the 4th toggle button exists **iff** enabled. Off ⇒ button gone on every tab, session killed after a confirm that lists running apps. No install/update/probe ever flips it | study §14 |
| D4 | **Protocol: RFB over rk's own WebSocket relay; renderer: stock noVNC (`@novnc/novnc`) canvas in the tile.** VNC never on TCP on Linux — unix socket by convention under `$XDG_STATE_HOME/run-kit/gui/`; auth `None` (same trust boundary as code-server `--auth none`) | study §5–6 |
| D5 | **Linux backend v1 = TigerVNC `Xvnc`** (`-rfbunixpath … -SecurityTypes None -AlwaysShared -AcceptSetDesktopSize -geometry 1920x1080 FrameRate=60`) + a window manager, X11 not Wayland. **Unless C0 says KasmVNC** — then KasmVNC is the Linux default and Xvnc the no-install fallback | study §4, §15 |
| D6 | **macOS v1 = mirror the live session via Apple Screen Sharing, view-only.** Relay dials `127.0.0.1:5900`; noVNC negotiates ARD (security type 30); password from the login Keychain (`security find-generic-password`), never config.yaml. "Take control" is a later, deliberate toggle. XQuartz path dropped; the CGVirtualDisplay tool is an optional later backend | study §4 |
| D7 | **Resize policy**: the desktop follows the **last-focused fine-pointer viewer's** tile size via SetDesktopSize; other viewers scale client-side; **coarse-pointer viewers never drive resize**; palette `GUI: Lock resolution` pins it. HiDPI renders 1× by default | study §7 |
| D8 | **R3 for a host singleton**: the supervisor's tty is the `rk-gui` window on the rk-daemon server; palette/empty-state action `GUI: Open supervisor logs` navigates there. No relay sniffing, no window-name typing, no `@rk_vnc_port`-style per-window option | window-views R1/R3 |
| D9 | Smoothness targets are **measured after C3**, not assumed: click-to-pixel < 100 ms, ≥ 30 fps scrolling a browser page at 1080p over Tailscale, < 1 core Xvnc CPU. KasmVNC (Linux only, its own client, iframe via the `/code/` proxy shape) is the upgrade lane | study §7, §15 |
| D10 | Out of scope for the whole plan: audio, multi-monitor, per-session displays, Wayland, macOS "take control", the macOS virtual-display backend, board pins of `(window, gui)` | study §11 |

---

## Change breakdown

Each row is one fab change / one PR in run-kit. Sizes are pipeline gut-feel.
Agents: fill your row when you create the change; mark Done when merged.

| # | Slug (suggested) | Depends on | Size | Change folder | PR | Status |
|---|------------------|-----------|------|---------------|----|--------|
| C0 | *(spike — no fab change; written verdict only)* | — | S | — | — | **Done 2026-09-09** — see § C0 verdict |
| C1 | `gui-spec-and-registry-rename` | — | S | 260909-5nvd-gui-spec-and-registry-rename | https://github.com/sahil87/run-kit/pull/888 | Done |
| C2 | `gui-backend-switch-and-relay` | C0 verdict, C1 | L | 260909-fkh1-gui-backend-switch-and-relay | https://github.com/sahil87/run-kit/pull/892 | Done |
| C3 | `gui-surface-tile` | C2 merged | L | 260909-o2sp-gui-surface-tile | https://github.com/sahil87/run-kit/pull/895 | Done |
| C4 | `gui-agent-verbs` | C2 merged (∥ C3) | M | 260909-bbv1-gui-agent-verbs | https://github.com/sahil87/run-kit/pull/894 | Done |
| C5 | `gui-perf-measure` | C3, C4 merged | S | 260910-xy7q-gui-perf-measure | (this PR — fill on merge) | Done — see § C5 verdict |
| C6 | `gui-kasm-backend` *(picked up by C5's verdict)* | C5 verdict | M | | | not started — scope note in § C5 verdict |

C1 ∥ C0. C3 ∥ C4 after C2. C6 only if C5 misses D9's targets and C0 did not already make KasmVNC the default — C5 missed the fps target on a bandwidth-capped link (§ C5 verdict), so C6 proceeds.

---

### C0 — KasmVNC spike (half a day, this VM, nothing merged)

**Purpose**: decide C2's Linux default before it is built (D5).

**Do**: install the KasmVNC 1.5.x jammy deb from its GitHub releases; run it
under the current user bound to a unix socket with basic auth and TLS off;
put its HTTP + WS behind `/proxy/{port}/` (or a throwaway route if the
unix-socket form needs one); open it in a web tile via `rk present`. Judge
three things against Xvnc + stock noVNC (`npx novnc` or the PR #71 branch
client) over Tailscale from a laptop and a phone:

1. Can its control bar / side panel be hidden so an iframe reads as a bare
   screen (YAML `ui` keys or URL params)?
2. Does its client behave on a phone (tap, two-finger scroll, pinch, soft
   keyboard)?
3. Scrolling a browser page at 1080p — perceived smoothness, Xvnc/Kasm CPU,
   bandwidth.

Also confirm: does the Kasm client fork still connect to a *standard* RFB
server (matters for whether macOS could share one renderer)?

**Output**: a dated verdict section appended to this plan (§ C0 verdict)
naming C2's Linux default. Write it even if the answer is "Xvnc stands".

---

### C1 — Spec amendments + registry rename

**Purpose**: make the specs say `gui` before code does.

**Scope**:
- `docs/specs/window-views.md` — View Registry row `desktop` → `gui`:
  available when `gui.enabled`; renderer noVNC canvas; status target; pointer
  to this plan. Migration-map `desktop` row → "superseded by `gui` per
  26-09-09 plan". R3 gains the host-singleton clause (D8). R6 dot = VNC WS.
- `docs/specs/surface-layout.md` — "One tile per surface kind" list gains
  `gui`; § Mobile note that coarse viewers never drive GUI resize.
- `docs/specs/right-panel.md` surface registry mention if any names
  `desktop`.
- New `docs/specs/gui.md` — short: the substrate (host service in `rk-gui`),
  the switch (D3), the relay path, availability-vs-reachability table (study
  §1), resize policy (D7), OS split (D5/D6), agent verbs (C4), constitution
  mapping. Link the study as design authority.
- `docs/specs/index.md` row for `gui.md`.
- Close PR #71 with a comment linking the study and this plan.

**Acceptance**: docs only; `fab docs-index` byte-stable; grep for the
literal `desktop` lens in specs returns only historical notes.

---

### C2 — Backend: the switch, the supervisor, the relay

**Purpose**: everything Go. After this change `rk gui on` yields a live RFB
socket reachable over an rk WebSocket, and the state stream says so.

**Scope**:

*Settings* — `internal/settings/settings.go`: registry entry `gui.enabled`
(`boolValue`, default `false`). Appears in `GET/POST /api/settings` and the
settings dialog automatically. Doctor row `gui: off | on (<backend>, :N,
WxH, k viewers) | on — not running (<reason>)`.

*Supervisor* — `internal/gui/` (new package) + `cmd/rk/gui.go`:
- `rk gui on` — writes the setting, then `EnsureGUI()`; on a host with no
  backend it still enables and prints the install hint (apt
  `tigervnc-standalone-server` + a WM; macOS: System Settings › General ›
  Sharing › Screen Sharing).
- `rk gui off [--yes]` — lists what is running on the display (`ps` filtered
  by the display's env, or Xvnc's client list) and asks; kills the `rk-gui`
  session; clears the setting. `--yes` skips the prompt.
- `rk gui status [--json]`, `rk gui env` (prints `DISPLAY=:N` and the socket
  path for `eval`).
- `rk gui supervise host` — the **pane command** of the `rk-gui` sibling
  session on the rk-daemon socket (mirror `internal/daemon/codeserver.go`:
  `ensureCodeServerCore`, `CodeServerSessionName`, the exists/externally-managed
  /spawn ladder, `KillCodeServerSession`). Linux: pick a free display number,
  create `$XDG_STATE_HOME/run-kit/gui/` 0700, launch `Xvnc` with the D5 flags
  on `host.sock` (0600), then the WM (probe order: `openbox`, `xfwm4`,
  `i3`, `kwin_x11`, `x-session-manager`; full DEs wrapped in
  `dbus-run-session` — the PR #71 ladder), log to the pane, trap and clean the
  socket on exit. macOS: `supervise` is a no-op sleeper that only logs the
  Screen Sharing probe result (nothing to spawn; D6).
- `EnsureGUI()` runs on daemon start **only when `gui.enabled`** (the
  `ensureCodeServer` boot hook, gated). Never-on-by-default is a unit test.

*Relay* — `api/gui_ws.go`, sibling of `terminals_ws.go`: `GET /ws/gui/{id}`
upgrades and pipes binary frames ⇄ the backend stream (Linux unix socket;
macOS `127.0.0.1:5900`). Same discipline as the terminal relay: context
cancel on disconnect, read/write deadlines, close codes for "disabled",
"not running", "dial failed"; a Go test that a client disconnect closes the
backend conn (no orphaned sockets).

*State* — `api/sse.go` gains `gui: [{id, enabled, backend, reachable,
display, width, height, viewers}]` with a TTL-cached dial probe exactly like
`codeServerReachable`; `enabled` flips synchronously on the settings POST so
every tab re-renders the toggle group within one state event.

*Validation* — `id` validated (`host` only in v1) via `internal/validate`.

**Salvage** (reference only): PR #71 `relay.go` VNC proxy loop, WM detection +
`dbus-run-session` traps, `docs/desktop-streaming.md` troubleshooting table.

**Acceptance** (curl-level, no frontend):
- fresh host, `rk gui status` → off; `rk doctor` → `gui: off`; state stream
  has `enabled:false`; no `rk-gui` session exists.
- `rk gui on` → within 5 s `host.sock` exists, `websocat`/Go test dial to
  `/ws/gui/host` receives the `RFB 003.008` banner; state stream
  `enabled:true, reachable:true`.
- `kill` Xvnc → `reachable:false` within the TTL; supervisor pane shows the
  exit; `rk gui status` says not running.
- `rk daemon restart` → session re-ensured, socket answers again.
- `rk gui off --yes` → session gone, socket gone, `enabled:false`.
- macOS (manual): with Screen Sharing on, `/ws/gui/host` reaches the ARD
  handshake; with it off, `reachable:false` and the status names the setting.
- Go tests: settings default false; boot hook skipped when disabled; relay
  teardown; probe TTL; `off` refuses without `--yes` when apps are running.

---

### C3 — Frontend: the tile

**Purpose**: the user-facing surface.

**Scope**:
- `lib/surface-layout.ts`: `gui` in `SurfaceKind`/`ViewName`, `SURFACE_GLYPH`
  (placeholder `▣` — pick with the user), `SURFACE_LABEL` "GUI",
  `availableTiles` pushes `gui` **iff** `gui[0]?.enabled` (the payload, not a
  probe). `degradeLayout` then drops `gui` tiles while off and restores them
  on re-enable with the option untouched.
- `lib/keybindings.ts`: `gui-toggle` on `Digit4` (same tiers as 1–3);
  `lib/window-view.ts` capability helper `hasGui(win, guiState)`.
- Top bar: `SurfaceToggleGroup` renders the 4th button and menu row from the
  registry (no special-casing); mobile switch group inherits.
- Palette: `Toggle GUI`, `Tile: Switch to GUI`, `GUI: Turn on`, `GUI: Turn
  off` (confirm dialog listing running apps — from `gui[0]` payload fields),
  `GUI: Fullscreen`, `GUI: Paste clipboard`, `GUI: Lock resolution`,
  `GUI: Open supervisor logs`, `GUI: Fit / 1:1`.
- Settings dialog: the registry-driven **GUI** row; the off direction routes
  through the same confirm.
- `components/gui-surface.tsx` — peer of `code-surface.tsx`: `@novnc/novnc`
  `RFB` on a `<canvas>` connecting to `/ws/gui/host`; `scaleViewport` +
  `resizeSession` per D7 (fine pointer + focused ⇒ `resizeSession`; coarse ⇒
  `scaleViewport` fit, or `clipViewport` for 1:1 with drag-pan);
  `qualityLevel`/`compressionLevel` lower on coarse; local cursor on; stop
  framebuffer requests when the tile is unfocused/hidden. Content states:
  enabled+reachable ⇒ canvas; enabled+unreachable ⇒ empty state (restart
  supervisor · open logs · install hint from payload). Connection dot = RFB
  `connect`/`disconnect` events (R6).
- Fullscreen verb: `requestFullscreen()` on the tile + `navigator.keyboard
  .lock()` where present; iPhone falls back to zen (document it in the
  empty-state tooltip, not a modal).
- Focus/chords: reuse the code tile's steal-guard and `focus-hop` seams; ⌘K,
  ⌘1–4, ⌘; stay rk's inside the tile; everything else to the guest.
- Clipboard: RFB cut-text both ways; paste via palette (user gesture).
- Tests: Vitest for registry/availability/degradation against mocked `gui`
  payloads; Playwright capability-gated on `Xvnc` presence (skip cleanly),
  ungated assertions for button absence/presence off a stubbed stream,
  375 px + desktop viewports; intent comments per constitution.

**Acceptance**:
- switch off: no 4th button on any tab, no menu row, ⌘4 inert, `split-h:tty,
  gui` renders `single:tty`.
- `rk gui on` from a shell → button appears on the open tab within one state
  event without reload; toggling it opens a live desktop; zen zooms it; zoom
  ⛶ works; phone viewport fits without a SetDesktopSize going out (assert on
  the payload's `width/height`).
- turn off from the palette → confirm lists apps → button gone, tiles
  degrade; turn on → layout restored.
- fullscreen verb enters/exits on Chrome desktop; iPhone shows the zen hint.

---

### C4 — Agent verbs

**Purpose**: agents get a screen they can drive and see.

**Scope** (`cmd/rk/gui.go` additions, all gated on enabled+reachable with
exit 1 + hint otherwise):
- `rk gui exec <cmd…>` — run with `DISPLAY` (and `XAUTHORITY` if used) set,
  inheriting cwd; the `rk code exec` shape.
- `rk gui shot [--out <png>]` — screenshot the display (`import -window root`
  or `xwd | convert`; probe what's installed; print the path). macOS: refuse
  in v1 (view-only mirror of the human's session — D6).
- `rk agent setup` exports `DISPLAY` into managed panes when enabled
  (read-time derivation from the supervisor's stamped display, never a hook
  push — Constitution X).
- `rk skill gui` topic page (target forms, gating, the screenshot loop,
  fail-silent rules) + the core-bundle line.
- `docs/memory` hydrate: new `gui.md` memory file.

**Acceptance**: from a plain pane with the switch on, `rk gui exec chromium
https://example.com` shows the page in the tile and `rk gui shot` writes a
PNG of it; with the switch off both exit 1 with the `rk gui on` hint.

---

### C5 — Measure (GATE for C6)

**Purpose**: turn D9 into numbers before spending on a second backend.

**Do**: a Playwright perf spec (skipped on CI without Xvnc) that loads a
long page in the guest browser, scrolls it via `rk gui exec xdotool`, and
samples noVNC's frame counter + the relay's bytes/s; record Xvnc CPU from
`ps`. Run from a laptop and a phone over Tailscale. Write the numbers into the
`gui.md` memory file with the D9 targets beside them.

**Verdict**: targets met ⇒ C6 is not picked up; missed ⇒ C6.

---

### C6 — KasmVNC backend (conditional)

**Scope**: `backend: kasm` in `internal/gui` — installer rung (`rk gui
install-kasm`, GitHub release deb, like `rk code-server install`), launch on a
unix socket with auth + TLS off, a fixed proxied route using the `/code/`
handler machinery (`api/proxy.go handleCode`), and a `GuiSurface` iframe
variant selected by the payload's `backend`. Xvnc stays the fallback when the
deb is absent. macOS unaffected (noVNC canvas).

**Acceptance**: same C3 acceptance on Linux with the iframe variant; C5 spec
re-run shows the delta.

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

## Risks

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Someone builds a "Start" button on a disabled host | D3 is binding: availability keys off `enabled` in the payload, never off backend presence; C2 unit-tests never-on-by-default |
| 2 | Two viewers fight over SetDesktopSize | D7 (last-focused fine pointer; coarse never); `Lock resolution` escape hatch |
| 3 | Kasm spike eats the week | C0 is time-boxed to a day and its output is a paragraph, not code |
| 4 | Turning off silently kills a user's browser session | Confirm lists running apps; CLI needs `--yes`; supervisor logs the kill |
| 5 | macOS mirror injects input into the human's session | View-only in v1 (D6): the relay drops RFB pointer/key messages client-side **and** server-side on the macOS backend |
| 6 | Iframe/canvas swallows rk chords | Reuse code tile's steal-guard + focus-hop; fullscreen + keyboard lock is the deliberate "all keys to guest" mode |
| 7 | CI lacks Xvnc | Capability-gated e2e (clean skip) + stubbed-stream assertions for the button gate; Go tests carry the relay/probe/switch |
| 8 | noVNC API drift since PR #71 (1.6 now) | C3 starts with a typings re-derive against the installed version |

---

## Pickup protocol (for the agent taking the next change)

1. Read this plan, the study (`docs/wiki/gui-surface-design-study.html` —
   open it in a browser or read the HTML), `docs/specs/window-views.md`,
   `docs/specs/surface-layout.md`, `fab/project/constitution.md`, and the
   `lenses-and-layout`, `configuration`, `daemon-lifecycle` memory files.
2. Skim PR #71's branch for the salvage list only — reference, not a base.
3. Take the lowest-numbered row whose dependencies are **merged** (C0 is a
   spike: do it in a scratch dir, append the verdict here, no fab change).
4. `/fab-new <slug>`; cite this plan in the intake; treat the decision log as
   Certain in SRAD scoring — clarification effort goes to the per-change
   "pick with the user" items (glyph, WM probe order, confirm copy).
5. Fill in your row in the tracking table in the same PR; mark Done on merge.
6. Normal pipeline (`/fab-fff` or stage-by-stage `/fab-continue`).

---

## C0 verdict

> Appended 2026-09-09 by the spike agent (worktree `bold-anole`, this VM:
> `dev-ws-sahil01`, Ubuntu 22.04, 16 vCPU, no GPU). Nothing merged, no fab
> change. Both stacks were left running for hands-on judging — see § Hands-on.

**Verdict: Xvnc stands. C2's Linux default backend (D5) is TigerVNC `Xtigervnc`
+ stock noVNC canvas; KasmVNC stays the C6 upgrade lane gated on C5.**

**Hands-on pass (2026-09-09, Sahil, from India over Tailscale, ~270 ms RTT to
this VM): Xvnc + noVNC felt better than KasmVNC side by side.** The reopen
clause below is therefore closed; D5 is final for C2.

### What was run

| | Xvnc lane | Kasm lane |
|---|---|---|
| Server | TigerVNC 1.12 `Xtigervnc :10 -rfbunixpath …/host.sock -SecurityTypes None -AlwaysShared -AcceptSetDesktopSize -geometry 1920x1080 -FrameRate=60` + openbox | KasmVNC 1.5.0 jammy deb, `Xkasmvnc :11 -websocketPort 6901 -interface 127.0.0.1 -DisableBasicAuth 1 -sslOnly 0 -httpd /usr/share/kasmvnc/www -SecurityTypes None -AlwaysShared -AcceptSetDesktopSize -FrameRate 60 -geometry 1920x1080` + openbox |
| Client path | websockify (`--unix-target`) on :6081 serving noVNC 1.7.0 (git `v1.7.0`), reached at `/proxy/6081/…` | Kasm's embedded HTTP+WS server, reached at `/proxy/6901/index.html?autoconnect=1&path=proxy/6901/websockify` |
| Guest content | Playwright's Chromium 147 (`--kiosk`, 1920×1080) on a 270 KB long text/tile page | same |
| Measuring client | headless Chromium 1920×1080 via the rk proxy on loopback; WS bytes via Playwright `framereceived`; server CPU from `/proc/<pid>/stat`; xdotool wheel scroll 30 notches/s for 10 s | same; Kasm fps from its own `enable_perf_stats=1` overlay |

rk's `/proxy/{port}/` passed the WebSocket upgrade (101) for both with no code
change, so the C6 "fixed proxied route" shape is confirmed viable.

### Criterion 1 — can Kasm's chrome be hidden so an iframe reads as a bare screen?

**Yes, and it is the default when embedded.** The client checks
`window.self !== window.top`; inside an iframe it hides the control bar,
side panel and handle unless `show_control_bar=1` is passed (query or `#hash`
param). Probe inside a same-origin iframe: the only visible elements were the
`noVNC_container` canvas and the 4×4 px hidden keyboard sink. Top-level it
shows a collapsed left-edge handle (Kasm's own UI). Embedded mode expects the
parent to drive it via `postMessage({action, value})` — verbs seen in the
1.5.0 bundle: `show_keyboard_controls` / `hide_keyboard_controls`,
`enable_ime_mode`, `clipboardsnd`, `setvideoquality`, `set_resolution`,
`set_streaming_mode`, `set_perf_stats`, `set_idle_timeout`,
`enable_pointer_lock`, `translate_shortcuts`, `disconnect`, `terminate`; it
posts `connected` / `disconnected` / `reconnecting` back. So an iframe variant
gets keyboard, clipboard and quality control without touching Kasm's UI, but
rk must implement that plumbing (C6 scope, not free).

Stock noVNC's `vnc.html` UI has no hide switch (control bar visible top-level
and in an iframe) — irrelevant for C3, which uses the `@novnc/novnc` library
on a bare `<canvas>`; the spike's `perf.html` harness (RFB + one div, ~30
lines) is exactly that shape and rendered fine.

### Criterion 2 — does Kasm's client behave on a phone?

Judged by code reading and iPhone-14 emulation (Playwright: touch, 390×664,
mobile UA); **real-device gestures not judged by the agent** — see § Hands-on.

- Gesture set is identical to noVNC 1.7's: both dispatch `onetap` (left),
  `twotap` (right), `threetap` (middle), `drag`, `longpress`, `twodrag`
  (scroll), `pinch` — Kasm inherited noVNC's GestureHandler. No advantage
  either way.
- Kasm adds `noVNC_touch` on touch devices and a virtual-keyboard control
  (`virtual_keyboard_visible`, driven by `show_keyboard_controls`); stock noVNC
  shows its keyboard button on touch devices (visible 35×35 in emulation).
- **D7 hazard, confirmed:** Kasm's client defaults to `resize=remote`. A
  phone connecting with defaults resized the shared 1920×1080 desktop to
  **585×996** within seconds. `resize=scale` (fit) or `resize=off` (1:1 clip)
  prevents it; rk would have to compose the iframe URL per viewer pointer
  type. noVNC-lib does nothing unless `resizeSession` is set, so D7 is a
  one-line decision there.
- Both fit a 390 px viewport without horizontal scroll (canvas 1920×1080 →
  390×219 CSS in fit mode).

### Criterion 3 — scrolling a browser page at 1080p

Loopback (client on this VM), 10 s wheel scroll, two runs each, stable to ±2 %:

| | Xvnc + noVNC lib | KasmVNC + Kasm client |
|---|---|---|
| Client frame rate | ~101 framebuffer updates/s (noVNC `flip`s) | 24.4 fps max, 13.7 avg (Kasm overlay; WebP, software decode in headless Chromium) |
| Bandwidth | **121 Mbit/s** (Tight/JPEG q6, ~1:6 ratio per server log) | **42 Mbit/s** (dynamic quality pinned at max — its overlay read "CPU 10/10 · Network 10/10") |
| Server CPU | 0.31 core | 0.99 core (multithreaded WebP) |
| Server RSS (Chromium running) | 108 MB | 151 MB |
| Guest Chromium CPU | 0.17 core | 0.16 core |

Read: at the same content Kasm ships ~3× fewer bytes for ~3× more CPU, and the
picture it ships is higher quality (WebP, lossless refresh). Neither is
"smoother" on loopback — both are limited by the guest's scroll, not the
encoder. D9's < 1 core target: both pass; Kasm only just.

Emulated slow link (CDP throttle, 25 Mbit/s down, 30 ms): Kasm 7.5 Mbit/s at
1.8 fps, Xvnc 7.8 Mbit/s at 6.1 updates/s — **low confidence**: both
collapsed to the same ~7.7 Mbit/s, which points at the throttle mechanism
(per-message latency starving the RFB request loop) rather than at either
encoder. Do not cite these numbers; C5 must measure on real devices.

Not measurable here: Kasm's H.264/AV1 streaming lane (no GPU → software
encode; Chromium-for-Testing has no AVC decoder — the client logged
`AVC/HEVC/AV1 … Unsupported configuration` and fell back to WebP). Real
context for D9: `tailscale ping` from this VM to the user's MacBook is
**274 ms** RTT (direct) and to the iPhone **266 ms** (DERP blr). Click-to-pixel
< 100 ms is unreachable from this host for *any* backend; latency, not the
encoder, is the smoothness ceiling on this link.

### Does the Kasm client still talk to a standard RFB server?

**No.** Kasm client → `Xtigervnc` (via websockify): protocol 3.8 + security
None handshake completes, then "Something went wrong, connection is closed",
0 framebuffer updates. So the Kasm client cannot be the shared renderer for
the macOS Screen Sharing path; two renderers is a hard requirement of C6.

**The reverse works, which the study assumed it did not:** stock noVNC 1.7
*library* → KasmVNC 1.5 server (its websocket port, `DisableBasicAuth`,
`wsProtocols: ['binary']`) connected and rendered the desktop (5 flips, 36 KB
in 5 s). Two caveats: noVNC's own `vnc.html` UI failed with a 404 because 1.7
dropped the `binary` subprotocol from the UI path, and Kasm on `-rfbunixpath`
+ `SecurityTypes None` accepted the socket but granted a permission-less user
("User has no read permissions … kasmvncpasswd") — 0 updates, disconnect at
10 s. Kasm therefore cannot ride rk's unix-socket relay as configured; it is
proxy-to-TCP or nothing. Kasm's web listener is also disabled when
`-rfbunixpath` is given.

### Findings that bind C2 regardless of the verdict

1. **Installing the KasmVNC deb hijacks the `Xvnc` and `vncserver` names** via
   `update-alternatives` (priority 90 → `/usr/bin/Xkasmvnc`). Half this spike
   ran against Kasm by accident before noticing. C2 MUST exec **`Xtigervnc`**
   by name (fallback `Xvnc` only when `Xtigervnc` is absent), and the doctor
   row should print the resolved binary.
2. TigerVNC with `-rfbunixpath` **still opens TCP 5900+N** on all interfaces
   unless **`-rfbport -1`** is passed (verified: with it, only the socket
   listens). Add `-rfbport -1` to the D5 flag set — "VNC never on TCP on
   Linux" is otherwise false.
3. Unix socket paths are capped at ~107 bytes (`vncExtInit: socket path is
   too long`); `$XDG_STATE_HOME/run-kit/gui/host.sock` is fine, deep scratch
   paths are not. Validate the length in `EnsureGUI()`.
4. `-FrameRate=60` and `-FrameRate 60` are both accepted by both servers.
5. noVNC 1.7's UI resolves `path=` relative to the page URL (it produced
   `/proxy/6081/proxy/6081/websockify`, which only worked because websockify
   ignores the path). C3 uses the library with an explicit `ws(s)://` URL, so
   this is a trap only for ad-hoc testing.

### Why Xvnc stands

- macOS view-only (D6) already forces the noVNC canvas renderer to exist; the
  Kasm client cannot replace it (above), so Kasm is strictly additive: a second
  renderer, an iframe with postMessage plumbing, an installer rung, an
  alternatives hijack to defend against, a TCP web server + TLS + auth to
  neutralise, per-viewer `resize` URL composition for D7.
- Its measurable win on this VM is bandwidth (3×), not frame rate, at 3× the
  CPU; on the user's ~270 ms link the ceiling is latency, which no encoder
  fixes. That is not "clearly better" — the bar §15 set for flipping D5.
- Everything Kasm-specific learned here is banked for C6: bare-by-default
  iframe, the postMessage verb list, `resize=scale|off` per pointer type,
  proxy-to-TCP only, `DisableBasicAuth 1 -sslOnly 0`, and rk's `/proxy/` WS
  pass-through already works.

### Hands-on (result recorded above; stacks left running until torn down)

Both desktops were presented into this window's web tile (`rk present`),
reachable over Tailscale via the rk origin (`https://runner1.bat-ordinal.ts.net`):

- `/proxy/6081/vnc.html?autoconnect=1&path=proxy/6081/websockify&resize=scale` — Xvnc + stock noVNC UI
- `/proxy/6901/index.html?autoconnect=1&path=proxy/6901/websockify&resize=scale` — KasmVNC (add `&show_control_bar=1` to see its panel; drop `resize=scale` to feel `remote` resize)

Both show kiosk Chromium on the same scroll page. Judged 2026-09-09 from
India (laptop + phone, ~270 ms RTT): the Xvnc + noVNC tile read as the better
of the two. Verdict holds; D5 is not reopened. Teardown: the spike agent left a `stop-spike.sh` in its
scratch dir (kills both X servers, WMs, browsers, websockify); `sudo apt-get
remove kasmvncserver` also restores the `Xvnc` alternative to TigerVNC.

---

## C5 verdict

> Appended 2026-09-10 by the C5 agent (change `260910-xy7q-gui-perf-measure`,
> this VM: `dev-ws-sahil01`, 16 vCPU, no GPU; Xtigervnc 1.12 + openbox,
> noVNC 1.7.0). Full table, method, and re-run recipe:
> `docs/memory/run-kit/gui.md` § Smoothness (C5).

**Verdict: D9 partially met; the fps target is missed on a bandwidth-capped
link for encoder byte-budget reasons ⇒ C6 is picked up**, scoped as a
bandwidth-efficiency change (below), not as "a smoother backend".

### Preliminary: the black tile

The report that opened this change ("opening the GUI shows only a blank/black
screen") was reproduced and was **not** a relay or renderer bug: the tile
faithfully showed an empty openbox desktop whose X root is black on Xvnc, with
no app running — indistinguishable from a dead canvas. Fixed in the same
change: the supervisor paints the root `#3b4252` (`xsetroot -solid`) after the
WM, best-effort with an install hint when `xsetroot` is missing.

### What was measured

`app/frontend/tests/e2e/gui-perf.spec.ts` (`@perf`, `just pw test gui-perf`;
skips without Xtigervnc/xdotool): a kiosk Chromium on the rk display scrolling
a ~300 KB page at 30 wheel notches/s for 10 s; fps = noVNC `Display.flip`
count on the tile canvas; relay Mbit/s = bytes on `/ws/gui/host` in the
browser; Xvnc/guest cores from `/proc`; click-to-pixel = pointerdown → color
flip of a guest square, 20 trials. Viewers: a fine-pointer tile fitted to an
exact 1920×1080 desktop, and a coarse 390×844 touch viewer alongside (desktop
locked, D7 held). Links: loopback, and `tc netem` emulation on the rig's
backend port (`scripts/gui-perf-link.sh`) at the 260 ms RTT `tailscale ping`
measures from this VM to the user's laptop and phone (DERP-relayed), with and
without a 40 Mbit/s cap, plus 0/50/120 ms and 20 Mbit/s points.

| Link | fps (fine 1080p) | Relay Mbit/s | Xvnc cores | Click→pixel p50 |
|---|---|---|---|---|
| loopback | 59.2 | 109.3 | 0.29 | 29 ms |
| 260 ms RTT, uncapped | 33.7 | 75.8 | 0.23 | 279 ms |
| 0 ms, 40 Mbit/s | 16.6 | 37.6 | 0.14 | 29 ms |
| 0 ms, 20 Mbit/s | 8.5 | 19.4 | 0.11 | 29 ms |
| **260 ms, 40 Mbit/s** (the Tailscale proxy) | **11.1** | 25.0 | 0.12 | **280 ms** |

### Against D9

- **< 1 core Xvnc CPU — met** everywhere (peak 0.52 cores with two viewers on
  loopback).
- **Click-to-pixel < 100 ms — met net of the link**: the pipeline itself adds
  ~29 ms p50 (loopback) and RTT + ~20 ms on every emulated link. From the
  user's ~260 ms link no backend can reach 100 ms (the C0 verdict's point);
  this target says nothing about the encoder.
- **≥ 30 fps scrolling at 1080p over Tailscale — met with bandwidth, missed
  without it**: 59 fps on loopback and 34 fps at 260 ms RTT with no cap show
  that latency alone is not the limiter (noVNC pipelines its update requests).
  A full-screen 1080p scroll at the fine preset costs ~1.85 Mbit per update
  (109 Mbit/s ÷ 59 fps), so a 40 Mbit/s link caps the rate near 17 fps and a
  20 Mbit/s link near 8, independent of RTT. At the 260 ms / 40 Mbit/s proxy
  for the user's link the tile updates at **11 fps**. The miss is
  **encoder-attributable** (bytes per frame), which is exactly the case the
  plan's rule sends to C6.

### C6 scope note (for its intake)

1. **Measure the real link first**: the 40 Mbit/s figure is an assumed
   DERP-relay budget; run the recipe from the user's laptop (`rk gui exec --
   …` + the spec's probes) and record the actual Mbit/s. If the link carries
   ≥ 60 Mbit/s, the fps target is already met and C6 can stop at a paragraph.
2. **Weigh the in-tree lever before the second renderer**: noVNC's Tight
   `qualityLevel`/`compressionLevel` for fine viewers (the coarse preset 4/6
   already ships ~40 % fewer bytes at the same content), possibly adaptive on
   the measured update rate. That is a `gui-surface.tsx` change, not a
   backend.
3. **KasmVNC** is the plan's upgrade lane and the C0 spike measured it at ~3×
   fewer bytes (42 vs 121 Mbit/s) for ~3× the CPU with a lossless refresh —
   the right tool if the quality lever cannot reach 30 fps on the real link.

### Incidental findings (not fixed here)

- `rk gui status` / `GET /api/gui/host` report `reachable: true` a beat
  before the supervisor's `@rk_gui_display` stamp lands, so a caller that
  reads `display` on the first reachable tick can see `""` (the perf spec
  waits for both).
- On a slow link the first render of a window route can show the gui tile
  pressed and connecting for ~2 s before the window's stored layout lands and
  hides it again (observed at 260 ms RTT; too fast to see on loopback).
- On a host running the live daemon, the e2e rig's backend shares the
  `rk-daemon` tmux socket, so any real-rig gui spec kills and respawns the
  host's own `rk-gui` session and leaves it `on — not running` afterwards
  (`rk gui restart` recovers it).
- `expect(tile).toHaveClass(/hidden/)` in `gui-surface.spec.ts`'s zen step is
  satisfied by `overflow-hidden` on every tile; the perf spec uses
  `toBeHidden()` instead.
