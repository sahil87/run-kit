# GUI viewer ergonomics plan — a fixed desktop, a zoomable tile, a usable phone

> Plan doc — written 2026-09-10 from the azure-eagle thread (after G2 merged
> as PR #908 and G3 as PR #912). Child of
> [`26-09-09-gui-surface.md`](26-09-09-gui-surface.md) (the parent — protocol,
> switch, relay, tile, agent verbs, perf) and sibling of
> [`26-09-10-gui-desktop.md`](26-09-10-gui-desktop.md) (the desktop leg). This
> doc owns one thing the parent decided too early: **D7, the resize policy**,
> and the viewer-side ergonomics that hang off it — how big the desktop is,
> how the tile scales it, how a phone drives it, and which knobs a person
> reaches for while watching an agent work. It does not reopen D1–D6 or
> D8–D10, and it does not touch C6 (bandwidth) except to hand it a user-facing
> quality preset to sit behind.
> Authority for design: § Decision log below, plus `docs/specs/gui.md`
> § Resize policy (which this plan amends when V1 ships) and the C5 numbers in
> `docs/memory/run-kit/gui.md` § Smoothness.

**Goal**: the desktop has a size a person chose and keeps it; the tile shows
that desktop at any zoom without distorting it; a phone can hit a 12-px
target, type Ctrl-C, and pinch to read; and the viewer's few knobs — size,
zoom, pointer mode, quality — are one palette row or one toolbar tap away.

**Problem (2026-09-10)**: D7 makes the desktop *follow* the focused
fine-pointer viewer's tile size through SetDesktopSize, recomputed on every
layout change. Toggling the sidebar, splitting a tile, or zen-zooming resizes
the guest desktop, so windows reflow, IceWM's taskbar re-wraps, and anything
an agent measured with `rk gui shot` moves under it. `GUI: Lock resolution`
(viewer-local) and `rk gui lock` (host-side, G3) pin *whatever size is
current*, which is a stopgap. On a phone the coarse viewer never resizes (by
design), so it shows a 1920×1080 desktop scaled into 375 px — unreadable and
untappable — and there is no way to type a modifier key. Quality is two
hardcoded presets (fine 6/2, coarse 4/6) nobody can change, even though the
C5 verdict says bytes per frame are what cap the frame rate on the user's
Tailscale link.

**Status (2026-09-10)**: plan written; V1 not started. Execution order and operator handover: [`26-09-10-gui-combined-execution.md`](26-09-10-gui-combined-execution.md) (stages S2, S4, S6, S7).

---

## What exists today (so intakes do not re-derive it)

| Piece | Where | Behavior |
|---|---|---|
| Desktop size at start | `internal/gui/backend.go` Xvnc argv | fixed `-geometry 1920x1080`, `-AcceptSetDesktopSize` on |
| Live resize | `gui-surface.tsx` `applyRfbProps` | `rfb.resizeSession = !coarsePointer && focused && !resizeLocked && !hostLocked` — noVNC sends SetDesktopSize to the tile's pixel size |
| Viewer pin | palette `GUI: Lock resolution` / `Unlock resolution` | localStorage `rk-gui-lock` (`lib/gui-posture.ts`) |
| Host pin | `rk gui lock` / `unlock` (G3) | `@rk_gui_lock` on the `rk-gui` session, streamed as the entry's `locked`; dies with the session |
| View modes | palette `GUI: Fit` / `GUI: 1:1` | `rk-gui-view`; fit = `scaleViewport` (uniform, letterboxed), 1:1 = `clipViewport` + `dragViewport` |
| Quality | `applyRfbProps` | `qualityLevel`/`compressionLevel` = 6/2 fine, 4/6 coarse; not user-settable |
| Fullscreen | `GUI: Fullscreen` | element fullscreen + `navigator.keyboard.lock`; zen fallback |
| Touch | noVNC defaults | direct tap = left click; no right-click, no scroll gesture, no pinch, no modifier keys |
| Perf probes | `tests/e2e/gui-perf.spec.ts` | fps via a `drawImage` wrap, Mbit/s via a `WebSocket` wrap, click-to-pixel; test-only, no product overlay |
| Host geometry tools | this VM | `xrandr` and `xdotool` on PATH; the desktop spike verified `xrandr --output VNC-0 --mode WxH` reflows IceWM live |

---

## Decision log (decided in the 2026-09-10 azure-eagle thread — intakes treat these as Certain unless marked Likely)

| # | Decision | Why |
|---|----------|-----|
| V-D1 | **The desktop size is a host preference, fixed by default; following the tile becomes opt-in.** New registry key `gui.geometry` (string, default `1920x1080`, `ui: true`, `live: true`), values `WxH` or `auto`. `auto` is today's D7 behavior exactly; every other value is a fixed desktop. The Xvnc `-geometry` argv reads the key at supervise start | the desktop is shared by every viewer and every agent, so its size cannot belong to one viewer's tile; a guest that never reflows is what makes screenshots and `rk gui click` coordinates stable |
| V-D2 | **Presets, plus custom.** `1280x720`, `1600x900`, `1920x1080`, `2560x1440`, and one portrait preset `1080x1920`; `Custom W×H` accepts any `WxH` with W,H in 320–7680. Presets are a frontend list; the backend validates only the shape and bounds | 16:9 covers every laptop and external monitor; the portrait preset is the phone-first session; custom keeps power users off the ladder |
| V-D3 | **Live apply via RandR, not restart.** `rk gui resize <WxH\|auto>` and `POST /api/gui/{id}/resize {"geometry":"WxH"\|"auto"}` run `xrandr` on the display (`--newmode`/`--addmode` when the mode is absent, then `--output <first-connected> --mode WxH`), then persist `gui.geometry`. `auto` persists only and lets the tile take over. The supervisor's `-geometry` follows the key so a restart lands on the same size. Xvnc's output name is probed from `xrandr --query` (`VNC-0` on TigerVNC), never hardcoded — **Likely**: the exact `xrandr` incantation for arbitrary custom modes on Xtigervnc is spike-verified for 536×799 only; V1 re-verifies 1080×1920 and 2560×1440 before shipping | `-AcceptSetDesktopSize` is already on and the spike proved RandR reflows the WM live; a restart kills every app on the display, which is the wrong price for a size change |
| V-D4 | **When `gui.geometry` is not `auto`, `resizeSession` is false for every viewer.** The viewer-local `GUI: Lock resolution` pair and the host `rk gui lock` pin remain and keep their meaning under `auto` (they are D7's escape hatches); under a fixed geometry they are inert and the palette rows read `GUI: Resolution is fixed (1920×1080)` as a disabled description row rather than disappearing | one model, no surprise: a fixed desktop is fixed; the pins stay so `auto` users lose nothing and the agent-loop lock keeps working |
| V-D5 | **Aspect ratio is preserved by construction.** The tile keeps noVNC `scaleViewport` in fit mode (uniform scale, letterboxed on the tile's `bg-bg-inset` ground) and never stretches. A palette row `GUI: Resolution → Match this tile` picks the preset whose aspect is closest to the tile's and applies it (a one-shot resize, not a follow) | letterboxing is the honest rendering of a fixed desktop in an arbitrary tile; "match" gives the sidebar-toggler a one-tap fix without re-enabling continuous resize |
| V-D6 | **Zoom is per-viewer, stepped, and pinchable.** A `zoom` posture beside `rk-gui-view`: `fit` (default) or a percentage from `{50, 75, 100, 125, 150, 200}`; `GUI: Zoom in` / `GUI: Zoom out` / `GUI: Zoom to fit` palette rows, Ctrl+wheel and Ctrl+= / Ctrl+- while the tile is focused, pinch on touch. Any zoom other than fit pans by drag (fine) or two-finger drag (coarse), reusing noVNC's clip/drag viewport for the pan. Implementation — **Likely**: noVNC's public API has only `scaleViewport` (fit) and `clipViewport` (1:1); arbitrary zoom drives `Display.scale` through the RFB instance's display, falling back to a CSS `transform: scale()` on the canvas wrapper with our own pan if that seam proves unstable across noVNC minors. The intake spikes both and picks one; the posture contract is the same either way | `1:1` at 1080p on a phone is a 5-screen pan; fit is unreadable; 150–200% is the reading zoom every remote viewer ships. Stored per viewer like the view mode because zoom is how *this* screen shows the shared desktop |
| V-D7 | **Touch gets two pointer modes.** `touch` (today: tap = click where you tap) and `trackpad` (relative cursor: one-finger drag moves the pointer, tap clicks, two-finger tap right-clicks, two-finger drag scrolls, long-press = press-and-hold). Default `trackpad` on coarse pointers, `touch` on fine (where it is moot). Posture `rk-gui-pointer`, palette `GUI: Pointer → Trackpad` / `→ Touch`, and a tap target in the session toolbar (V-D10). Implemented as a translation layer in front of noVNC's pointer handler (noVNC's own `dragViewport` gesture handling is disabled while trackpad mode is on) | the single biggest phone gap: a 12-px close button cannot be hit by direct tap, and there is no right-click or scroll at all today; Chrome Remote Desktop, RustDesk, and Jump Desktop all converge on this pair |
| V-D8 | **A modifier and special-key bar on touch.** A one-row strip docked under the tile on coarse pointers (hidden on fine): `Esc` `Tab` `Ctrl` `Alt` `⇧` `←` `↑` `↓` `→` `⌨` (toggles the on-screen keyboard by focusing a hidden input, the noVNC-UI trick). Modifier keys are latching (one tap = held for the next key, two taps = locked, tap again = released), rendered with the pressed Control state. Keys ride noVNC `sendKey` | a phone cannot send Ctrl-C to a terminal on the desktop today; every mobile remote viewer ships this bar |
| V-D9 | **Quality is a user choice with three names.** `GUI: Quality → Sharp / Balanced / Smooth` mapping to noVNC (`qualityLevel`, `compressionLevel`) = `(8,1)` / `(6,2)` / `(3,7)`; default `Balanced` on fine, `Smooth` on coarse (today's presets, renamed). Posture `rk-gui-quality`, per viewer. The names are what C6 later swaps a Kasm or Tight-tuned encoder behind — the row survives the backend | the C5 verdict says bytes per frame cap fps at ≤ 40 Mbit/s and the coarse preset already ships ~40% fewer bytes; a person on a slow link should be able to trade sharpness for motion without a code change |
| V-D10 | **A floating session toolbar on touch and in fullscreen; the palette everywhere.** A small auto-hiding pill (top-center of the tile, shown on tap or on hover in fullscreen, hidden after 3 s): zoom −/fit/+, pointer mode, quality, key bar toggle, stats, exit fullscreen. Every control is also a palette row (Constitution V); the pill is the *coarse and fullscreen* mirror, since the palette is unreachable in fullscreen and clumsy on a phone. Fine-pointer non-fullscreen viewers never see it | the two contexts where the palette does not work are exactly the two where these knobs are needed |
| V-D11 | **A stats overlay, off by default.** `GUI: Show stats` / `Hide stats` toggles a monospace corner overlay: fps (framebuffer updates/s), relay Mbit/s, RTT (a periodic tiny `POST /api/gui/{id}/ping` round trip, or the WS ping frame if the relay grows one), desktop size, zoom. The counters are the perf spec's three probes lifted into the tile behind a product seam (`GuiSurface` exposes `stats` to the overlay; the spec keeps its own wraps) | Parsec and Moonlight taught everyone to read the numbers when tuning a link; C6's intake and the user's Tailscale question both need them live |
| V-D12 | **HiDPI is an opt-in posture.** `GUI: HiDPI on/off` (`rk-gui-hidpi`, default off) renders the canvas at `devicePixelRatio` so a 1:1 view is crisp on a Retina laptop; under a fixed geometry it changes only the client-side rendering, never the desktop size | doubling bytes by default would undo V-D9; opt-in matches Jump Desktop and the Windows App |
| V-D13 | **`GUI: Send key…`** opens a tiny prompt (`Ctrl+Alt+Del`, `Ctrl+Alt+T`, `Alt+F4`, `Super`, `Print`, or a typed chord) and sends it through noVNC `sendKey` — viewer-side, no server round trip, so it works on macOS view-only too (where it is refused with the mirror's message) | the key bar (V-D8) covers modifiers; chords a keyboard cannot express in a browser (Alt+F4, Ctrl+Alt+Del) need a menu |
| V-D14 | **Out of scope**: file transfer, audio, multi-monitor, per-session displays, a second renderer (C6), macOS take-control, changing the WM's own scaling (`Xft.dpi`), recording (backlog `rk gui record`), and any server-side scaling of the framebuffer | the parent's D10; keep the surface to postures and one settings key |

---

## UX (final for V1–V2; V3–V4 copy is indicative)

Every line below is copy the intakes may quote.

### Resolution (V1)

Palette rows (terminal route, `enabled && reachable`, hidden on the mirror backend):

| Row | Does |
|---|---|
| `GUI: Resolution → 1280×720` … `→ 2560×1440`, `→ 1080×1920 (portrait)` | `POST /api/gui/host/resize {"geometry":"1280x720"}`; the current one carries the description `current` |
| `GUI: Resolution → Match this tile` | picks the closest-aspect preset to the focused gui tile's pixel size and posts it |
| `GUI: Resolution → Custom…` | a one-field prompt `Width×Height` (accepts `1440x900`, `1440×900`, `1440 900`); validates 320–7680 |
| `GUI: Resolution → Auto (follow this tile)` | posts `auto`; description `today's behavior — the desktop follows the focused fine-pointer viewer` |
| `GUI: Lock resolution` / `Unlock resolution` | unchanged under `auto`; under a fixed geometry the row is disabled with description `resolution is fixed (1920×1080) — pick Auto to follow the tile` |

Settings dialog: `Desktop size` select (`1280×720` … `Custom…`, `Auto`) for `gui.geometry`, description `The GUI desktop's pixel size. Fixed sizes keep windows where they are; Auto follows the focused desktop viewer's tile. Applies live.`

CLI:
```
$ rk gui resize 1600x900
resized :10 to 1600x900 (was 1920x1080)
$ rk gui resize auto
desktop follows the focused viewer (gui.geometry=auto)
$ rk gui resize 100x100
Error: geometry 100x100 out of range (320–7680 per side)
$ rk gui status
gui: on (Xtigervnc, :10, 1600x900 fixed, 1 viewer, icewm-session)
```
(`fixed` / `auto` is appended to the geometry segment; the stream entry gains `"geometry":"1600x900"` — `"auto"` when following.)

Tile: with a fixed desktop, fit mode letterboxes on the stage ground; nothing else is drawn. No toast on resize; the desktop visibly reflows.

### Zoom (V2)

| Row / gesture | Does |
|---|---|
| `GUI: Zoom in` (Ctrl+= on the focused tile, pinch out) | next step up in `{fit→100, 100→125→150→200}`; from fit, 100% means 1:1 |
| `GUI: Zoom out` (Ctrl+-, pinch in) | previous step; below 100% → 75 → 50 → fit |
| `GUI: Zoom to fit` (Ctrl+0) | back to fit |
| `GUI: 1:1` | alias of 100% (kept for continuity) |

The zoom level shows as a 1.5 s corner badge `150%` on change. Pan: drag (fine) / two-finger drag (coarse) when the desktop exceeds the tile.

### Pointer modes and key bar (V2)

| Row | Does |
|---|---|
| `GUI: Pointer → Trackpad` | relative cursor; description `one finger moves, tap clicks, two-finger tap right-clicks, two-finger drag scrolls` |
| `GUI: Pointer → Touch` | direct; description `tap where you touch` |

Key bar (coarse only, docked under the tile): `Esc  Tab  Ctrl  Alt  ⇧  ←  ↑  ↓  →  ⌨`. A latched modifier renders pressed; a double-tap locks it (`Ctrl ●`).

### Quality, toolbar, stats, HiDPI, Send key (V3–V4)

`GUI: Quality → Sharp | Balanced | Smooth` (description on each: `more detail, more bytes` / `default` / `fewer bytes, smoother motion on slow links`). Toolbar pill: `−  fit  +   ⌖ Trackpad   ◐ Balanced   ⌨   ∿   ⤢`. Stats overlay (monospace, top-right): `59 fps · 41 Mbit/s · 262 ms · 1920×1080 · fit`. `GUI: HiDPI on` / `off`. `GUI: Send key…` prompt with the five chords listed first.

---

## Change breakdown

Four fab changes, sequential where noted. V1 is the one that changes a
decision (D7) and is worth shipping alone; V2 is the phone; V3 and V4 are
polish that can wait for a second sitting.

| # | Slug (suggested) | Depends on | Size | Change folder | PR | Status |
|---|------------------|-----------|------|---------------|----|--------|
| V1 | `gui-fixed-geometry-and-resize` | G3 merged (it is) | M | 260910-zuci-gui-fixed-geometry-and-resize | | in progress |
| V2 | `gui-zoom-and-touch-pointer` | V1 merged | M | 260910-0aur-gui-zoom-and-touch-pointer | | in progress |
| V3 | `gui-quality-presets-and-stats` | V2 merged (shares the posture module and toolbar seam) | S | | | not started |
| V4 | `gui-toolbar-keybar-hidpi-sendkey` | V2 merged (∥ V3) | M | | | not started |

---

### V1 — Fixed geometry: `gui.geometry`, `rk gui resize`, the resize endpoint, the palette rows

**Purpose**: V-D1 through V-D5. After this change the desktop is 1920×1080
until someone changes it, changing it is one palette row or one CLI verb, and
D7's follow-the-tile behavior is the `auto` value.

**Do**:
1. `app/backend/internal/settings/settings.go` — `gui.geometry` after `gui.wm` (string, default `1920x1080`, category `behavior`, `ui: true`, `live: true`); validator accepts `auto` or `WxH` with 320–7680 per side; round-trip tests (omitted when default).
2. `internal/gui/geometry.go` (new) — `ParseGeometry(s) (w, h int, auto bool, err)`, `XrandrResizeArgv(display, output, w, h)`, `XrandrQueryOutput(ctx, display)` (parses `xrandr --query` for the first `connected` output — **Likely** `VNC-0`), the `--newmode`/`--addmode` fallback for a mode Xvnc does not list. Tests with fixture `xrandr` output.
3. `cmd/rk/gui_supervise.go` — `-geometry` reads the key at start (`auto` ⇒ `1920x1080`, today's default); log `gui: desktop 1600x900 (gui.geometry)` / `gui: desktop 1920x1080 (auto — follows the focused viewer)`.
4. `internal/daemon/gui.go` + `api/sse.go` — stream entry and status document gain `geometry` (`"WxH"` or `"auto"`), read from the setting each tick (no new stamp: the setting is the source of truth; the actual size still rides `width`/`height` from the probe).
5. `api/gui.go` + `router.go` — `POST /api/gui/{id}/resize` (`{"geometry":"WxH"|"auto"}`; 400 on shape/range; 409 disabled/not running; runs xrandr under a 10 s bound when not `auto`; persists the setting; `200 {"ok":true,"geometry":…,"was":"WxH"}`). Handler test with seams.
6. `cmd/rk/gui.go` — `rk gui resize <WxH|auto>` (§ UX copy; gated like `launch`); `guiStatusSummary` appends `fixed`/`auto` to the geometry segment; doctor row likewise.
7. `app/frontend/src/api/client.ts` — `GuiSignal.geometry`, `GuiStatus.geometry`, `resizeGui(geometry)`.
8. `src/components/gui-surface.tsx` — `resizeSession` gains `&& geometry === "auto"`; header doc updated; nothing else changes (fit already letterboxes).
9. `src/lib/palette/gui.ts` + `app.tsx` — the `GUI: Resolution →` rows (presets, Match this tile, Custom…, Auto) and the disabled-with-description Lock rows under a fixed geometry; `Custom…` uses the existing one-field prompt component (the session-name prompt shape).
10. Settings dialog: the `Desktop size` select rides the registry (`ui: true`) — verify the string-with-options rendering exists or add a `options:` hint to the registry row.
11. Tests: Go tests above; vitest for the palette rows and the `resizeSession` truth table with `geometry`; Playwright `gui-surface.spec.ts` ungated: stream `geometry:"1600x900"` ⇒ the Lock row disabled with the copy, `GUI: Resolution → 1280×720` posts the right body; real-rig (Xtigervnc-gated): `rk gui resize 1280x720` ⇒ the status document's `width/height` follow within 5 s and the tile canvas letterboxes (intent comments per the constitution).
12. Docs: `docs/specs/gui.md` § Resize policy rewritten (D7 becomes the `auto` value; the pins' meaning under each value); § Agent verbs gains `resize`; § The switch's settings row; `docs/site/skill/gui.md` (`rk gui resize`, and the note that a fixed desktop is what makes `shot`/`click` coordinates stable); the parent plan's D7 row gets a pointer to this plan; memory via hydrate.

**Acceptance**: on this VM, `rk gui resize 1600x900` reflows IceWM live with no app killed, `rk gui status` reads `1600x900 fixed`, the tile letterboxes, toggling the sidebar no longer changes the desktop; `GUI: Resolution → Auto` restores the follow behavior and the Lock rows re-enable; `rk gui restart` comes back at the chosen size; the portrait preset renders on a 375-px phone as a readable full-width desktop; `just test` green.

### V2 — Zoom and touch pointer modes

**Purpose**: V-D6, V-D7, V-D8 (the key bar is here because trackpad mode without modifiers is half a phone).

**Do** (`app/frontend/`):
1. `src/lib/gui-posture.ts` — `rk-gui-zoom` (`fit` | `50|75|100|125|150|200`), `rk-gui-pointer` (`touch` | `trackpad`), read/write helpers.
2. `src/components/gui-surface.tsx` — zoom application (spike `Display.scale` via the RFB instance vs a CSS transform + own pan on the host div; pick one, record the decision in the plan's Design Decisions), pan gestures, the 1.5 s zoom badge, Ctrl+wheel / Ctrl+= / Ctrl+- / Ctrl+0 on the focused tile (registered through the keybinding registry so they show in the Shortcuts tab and reclaim over noVNC's canvas handler like the other chords), pinch on coarse.
3. `src/components/gui-pointer.ts` (new) — the trackpad translation layer: pointer/touch events → synthetic noVNC pointer moves/clicks (relative delta with a 1.0–1.5 gain, tap-to-click with a 180 ms/10 px threshold, two-finger tap = button 3, two-finger drag = wheel with momentum-less 1:1 scroll, long-press 500 ms = press-and-hold); disables noVNC's own `dragViewport` gesture while active. Unit-tested with synthetic events.
4. `src/components/gui-keybar.tsx` (new) — the coarse-only docked strip (§ UX), latching modifiers, `⌨` focusing a hidden input to raise the OS keyboard and forwarding its keys through `sendKey`.
5. Palette rows `GUI: Zoom in/out/to fit`, `GUI: Pointer → Trackpad/Touch`; `GUI: 1:1` becomes the 100% alias.
6. Tests: vitest for the posture helpers, the zoom step table, the pointer translation (tap, two-finger tap, drag → wheel), the key bar's latch states; Playwright mobile 375 px (hasTouch): the key bar renders, tapping `Ctrl` then a letter sends one chord (assert via the RFB mock's `sendKey` calls in the ungated half), pinch changes the zoom badge; desktop: Ctrl+wheel steps zoom, the badge shows `125%`.
7. Docs: spec § The tile (zoom, pointer modes, key bar); memory via hydrate.

**Acceptance**: on a phone against this VM's daemon, trackpad mode hits a 12-px IceWM close button, two-finger drag scrolls a terminal, `Ctrl` + `c` interrupts a running command, pinch reaches 200% and pans; on the laptop Ctrl+= steps to 125% with the badge; `just test` green.

### V3 — Quality presets and the stats overlay

**Purpose**: V-D9, V-D11.

**Do**: `rk-gui-quality` posture and `GUI: Quality →` rows mapping to `(qualityLevel, compressionLevel)`; a `stats` seam on `GuiSurface` (framebuffer-update counter via the `Display.flip` hook the perf spec uses, bytes via the RFB's WebSocket, RTT via a 5 s `POST /api/gui/{id}/ping` no-op — or the relay's WS ping if C6 adds one) feeding `GuiStatsOverlay`; `GUI: Show/Hide stats`; the perf spec keeps its own probes. Playwright: the overlay renders and its fps counter increments against the real rig. Docs: spec § Smoothness (the presets are the user lever C6 sits behind); memory.

**Acceptance**: switching to `Smooth` on the 260 ms/40 Mbit netem link (the C5 recipe) raises fps measurably over `Balanced`; the overlay's Mbit/s agrees with the perf spec's within 10%.

### V4 — Session toolbar, HiDPI, Send key

**Purpose**: V-D10, V-D12, V-D13.

**Do**: `GuiToolbar` pill (coarse or fullscreen only; auto-hide 3 s; the six controls per § UX) wired to the same callbacks the palette rows use; `rk-gui-hidpi` posture setting the canvas backing scale; `GUI: Send key…` prompt reusing the one-field prompt shape with the five chords as suggestions, sent through `sendKey` (refused on the mirror backend with the existing view-only message). Tests per surface; Playwright mobile for the pill's show/hide and one tap-through; docs and memory.

**Acceptance**: in fullscreen on the laptop, hovering the top edge shows the pill and `⤢` exits; on the phone the pill's `−`/`+` step zoom; `Alt+F4` from Send key closes the focused IceWM window; HiDPI on a `devicePixelRatio` 2 laptop renders 1:1 text crisp and doubles the overlay's Mbit/s (expected, documented).

---

## Constitution mapping

| Principle | How this plan honors it |
|---|---|
| I Security First | `resize` takes `WxH` validated to 320–7680, runs `xrandr` as an argv slice under a 10 s bound; `Send key` is viewer-side (`sendKey`), no server route |
| II No Database | `gui.geometry` is a preference in the registry; every viewer knob is localStorage; the actual size still derives from the RFB probe each tick |
| III Wrap, Don't Reinvent | RandR does the resize, noVNC does the scaling and key sending; the pointer layer translates gestures, it does not reimplement RFB |
| IV Minimal Surface Area | one settings key, one POST route (`/api/gui/{id}/resize`), one CLI verb; the toolbar pill is coarse/fullscreen-only and mirrors palette rows; the key bar is coarse-only |
| V Keyboard-First | every knob is a palette row; zoom has registry chords; the pill and key bar are mirrors for the two contexts where the palette cannot reach |
| VII Convention Over Configuration | `gui.geometry` defaults to `1920x1080`, the size Xvnc already used; every posture defaults to today's behavior |
| IX Uniform HTTP Verb | `resize` and `ping` are POSTs |
| Test Intent Comments | every new Playwright `test()` carries Proves/Steps |

## Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | `xrandr` on Xtigervnc rejects an arbitrary custom mode, or the output is not `VNC-0` on some install | probe the output from `xrandr --query`; `--newmode` + `--addmode` fallback; V1 re-verifies the two presets the spike did not (1080×1920, 2560×1440); a failed xrandr leaves the setting unwritten and returns 500 with the tail |
| 2 | Arbitrary zoom through noVNC's internal `Display.scale` breaks on a noVNC minor | the intake spikes the CSS-transform alternative first; the posture contract is renderer-independent |
| 3 | Trackpad mode fights noVNC's own touch handling (it maps touches to pointer events internally) | disable noVNC's gesture handler while the layer is on; the layer feeds noVNC synthetic pointer events only |
| 4 | A fixed geometry makes the first laptop experience worse than today (letterbox bars where the desktop used to fill the tile) | `Match this tile` is one row away and `Auto` restores D7; the default stays 1920×1080, which today's tiles mostly reach anyway |
| 5 | HiDPI doubles bytes on exactly the links C5 flagged | opt-in, off by default, and the stats overlay makes the cost visible |
| 6 | Two viewers with different presets fight | they cannot: the geometry is a host setting; the last write wins and the stream tells every tile; there is no per-viewer follow except under `auto` (D7's existing rule) |

## Pickup protocol (for the agent taking V1–V4)

1. Read this file in full, then the parent plan's § Decision log (D7 especially) and § C5 verdict, the desktop plan's § Decision log, `docs/specs/gui.md` (§ Resize policy, § The tile, § Agent verbs), `fab/project/constitution.md`, and the memory files `gui`, `ui/lenses-and-layout` (§ GUI Surface), `ui/keyboard-and-palette` (§ The `GUI:` palette family), `ui/dialogs-and-state` (the posture keys), `configuration` (§ Settings Registry).
2. Treat § Decision log as Certain in SRAD scoring except the two rows marked Likely (V-D3's exact xrandr incantation and V-D6's zoom mechanism), which the V1/V2 intakes resolve with a spike before planning.
3. Do not touch the live `rk-gui` session while a perf job is running (`tmux -L rk-daemon list-windows -t rk-jobs`).
4. Fill your row in § Change breakdown when you create the change; mark Done when merged; V1 also adds the D7 pointer to the parent plan.
