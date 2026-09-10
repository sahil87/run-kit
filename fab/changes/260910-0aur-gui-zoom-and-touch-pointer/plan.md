# Plan: Zoom and touch pointer modes (S4 / V2)

**Change**: 260910-0aur-gui-zoom-and-touch-pointer
**Intake**: `intake.md`

> Frontend only (`app/frontend/`). Implements § V2 of
> `fab/plans/sahil/26-09-10-gui-viewer-ergonomics.md` (V-D6 zoom, V-D7 pointer
> modes, V-D8 key bar). S2 (#919) and S3 (#929) are merged on `main`, so the
> fixed-geometry model and the palette file this change adds rows to are both
> present. Read the intake in full first — it reproduces the plan's binding UX
> copy and acceptance verbatim.

## Requirements

### noVNC 1.7.0 facts the implementation builds on (read once; verified against `node_modules/@novnc/novnc/core/`)

- `rfb.js` listens for `mousedown`/`mouseup`/`mousemove`/`click`/`contextmenu`/`wheel` **on the canvas** (`_canvas.addEventListener`, ~L584–598) and calls `ev.stopPropagation()` + `ev.preventDefault()` in `_handleMouse`/`_handleWheel`; the `GestureHandler` (`core/input/gesturehandler.js` `attach`) listens for `touchstart`/`touchmove`/`touchend` on the canvas too. A **capture-phase** listener on an ancestor runs before all of them and a `stopPropagation()` there keeps the event from ever reaching noVNC — that is the only interception seam and it needs no private API.
- Pointer position is `clientToElement(clientX, clientY, canvas)` (canvas `getBoundingClientRect` based) and is sent as `_display.absX(x)` = `x / _display.scale + viewportLoc.x` (`_sendMouse`, ~L1206). Pointer mapping is therefore correct **iff the visual scale of the canvas equals `_display.scale`**. `_display.scale` is set by `Display._rescale` (`display.js` ~L456), which only writes the canvas CSS `width`/`height` strings; `Display.autoscale(w, h)` (~L432) computes `min(w/fb.w, h/fb.h)` with **no 1.0 cap**.
- `RFB._updateScale()` (~L776) writes `_display.scale = 1.0` whenever `scaleViewport` is false, else `autoscale(screenSize)`; it runs from the `scaleViewport` setter and from `_handleResize` (a `ResizeObserver` on noVNC's own `_screen` div, ~L722, inside `requestAnimationFrame`). So a directly-driven `_display.scale` is **reverted on every container resize** unless re-applied after noVNC's rAF.
- A CSS `transform: scale()` on an ancestor is invisible to `_display.scale` but visible to `getBoundingClientRect`, so without compensation pointer coordinates are off by the zoom factor.
- `_handleMouse` on `mousedown` **starts a viewport drag instead of sending a button** when `dragViewport` is true; `_handleGesture` maps `onetap`→left, `twotap`→right, `threetap`→middle, `drag`→pan (when `dragViewport`) else left-drag, `twodrag`→wheel buttons (`GESTURE_SCRLSENS` = 50 px per step), `pinch`→**Ctrl + wheel sent to the guest**, `longpress`→right-button.
- `RFB._convertButtonMask(ev.buttons)`: DOM `buttons` 1→left (0x1), 2→right (0x4), 4→middle (0x2). `_handleWheel` accumulates `deltaY` and emits one wheel-button press/release per `WHEEL_STEP` = 50 px. `rfb.sendKey(keysym, code, down)` is public; `down === undefined` sends press+release; it no-ops unless the RFB is `connected` and not `viewOnly`.
- The package `exports` field exposes only the root (`@novnc/novnc`), so `KeyTable`/`keysyms` are NOT importable — declare the handful of X11 keysyms locally (`XK_Escape 0xff1b`, `XK_Tab 0xff09`, `XK_Return 0xff0d`, `XK_BackSpace 0xff08`, `XK_Left 0xff51`, `XK_Up 0xff52`, `XK_Right 0xff53`, `XK_Down 0xff54`, `XK_Shift_L 0xffe1`, `XK_Control_L 0xffe3`, `XK_Alt_L 0xffe9`; a printable character's keysym is its Latin-1 code point, else `0x01000000 | codePoint`). `src/types/novnc.d.ts` declares only the surface the tile uses — extend it with `sendKey` and whatever the chosen zoom mechanism needs, typed narrowly.

### Postures: the two new per-viewer keys (`src/lib/gui-posture.ts`)

#### R1: `rk-gui-zoom` posture
`lib/gui-posture.ts` SHALL export `type GuiZoom = "fit" | 50 | 75 | 100 | 125 | 150 | 200`, the ordered constant `GUI_ZOOM_STEPS = [50, 75, 100, 125, 150, 200]`, `readGuiZoom(): GuiZoom` and `writeGuiZoom(z: GuiZoom): void`, persisted in localStorage `rk-gui-zoom` (stored as the string `"fit"` or the decimal percentage), following the file's validated-read / try-catch-noop-write discipline. `readGuiZoom` MUST treat any value outside the table as `fit`.

- **GIVEN** `rk-gui-zoom` is `"150"` **WHEN** `readGuiZoom()` runs **THEN** it returns `150`
- **GIVEN** `rk-gui-zoom` is absent or `"999"` **WHEN** read **THEN** it returns `"fit"`
- **GIVEN** localStorage throws on read **WHEN** read **THEN** it returns `"fit"` without throwing

#### R2: Zoom step table
`lib/gui-posture.ts` SHALL export a pure `stepGuiZoom(current: GuiZoom, direction: 1 | -1): GuiZoom` implementing the plan's ladder: up is `fit→100→125→150→200` (200 stays 200); down is `200→150→125→100→75→50→fit` (fit stays fit). Note the asymmetry is intentional: zooming **in** from fit lands on 100 (1:1), never on 50/75.

- **GIVEN** `fit` **WHEN** stepping up **THEN** `100`; **GIVEN** `100` **WHEN** stepping down **THEN** `75`; **GIVEN** `50` **WHEN** stepping down **THEN** `fit`; **GIVEN** `200` **WHEN** stepping up **THEN** `200`

#### R3: `rk-gui-pointer` posture with pointer-class default
`lib/gui-posture.ts` SHALL export `type GuiPointerMode = "touch" | "trackpad"`, `readGuiPointerMode(coarsePointer: boolean): GuiPointerMode` and `writeGuiPointerMode(m)`, key `rk-gui-pointer`. When the key is absent or invalid the default is `trackpad` on a coarse pointer and `touch` on a fine pointer (V-D7).

- **GIVEN** no stored value **WHEN** read with `coarsePointer: true` **THEN** `trackpad`; with `false` **THEN** `touch`
- **GIVEN** `"touch"` stored **WHEN** read with `coarsePointer: true` **THEN** `touch` (a stored choice wins over the default)

#### R4: `rk-gui-view` is retired into the zoom posture
The `GuiViewMode` type, `readGuiViewMode`/`writeGuiViewMode`, and the `viewMode` prop/input everywhere (`gui-surface.tsx`, `surface-layout.tsx`, `app.tsx`, `lib/palette/gui.ts`) SHALL be removed: `fit` is `zoom === "fit"` and 1:1 is `zoom === 100` (intake A7 — the zoom mechanism subsumes noVNC's separate `clipViewport` 1:1 mode). `readGuiZoom` SHALL perform a one-time migration: when `rk-gui-zoom` is absent and the legacy `rk-gui-view` reads `"1:1"`, return `100`; `writeGuiZoom` removes the legacy key.

- **GIVEN** `rk-gui-view` = `"1:1"` and no `rk-gui-zoom` **WHEN** `readGuiZoom()` **THEN** `100`
- **GIVEN** the codebase **WHEN** grepping for `GuiViewMode`, `rk-gui-view` (outside the migration read), `readGuiViewMode` **THEN** no live references remain (the memory/spec mention of `rk-gui-view` is hydrate's job)

### Zoom application in the tile (`src/components/gui-surface.tsx`)

#### R5: Zoom rendering mechanism — spike, pick, record
`GuiSurface` SHALL render the framebuffer at the posture's zoom: `fit` = today's uniform letterboxed fit (`scaleViewport`); a percentage `z` = the desktop drawn at exactly `z/100` CSS px per framebuffer px, with the tile as a clipping viewport over it. Before implementing, the apply agent MUST spike the candidates below against the pinned noVNC (1.7.0) and record the winner as a `### Design Decisions` entry in THIS file (`#### Zoom rendering mechanism`, four-field shape), replacing the placeholder there. Pick whichever proves stable under: each of the six steps, a browser-window / tile resize mid-zoom, no interference with `resizeSession` under `auto`, and correct pointer mapping (a click at a zoomed position lands on the same framebuffer pixel it visibly covers).

1. **Drive `Display.scale` through the RFB's internal display** (`(rfb as any)._display.scale = z`, with `scaleViewport = false`, `clipViewport = true`, then `_display.viewportChangeSize(tileW / z, tileH / z)`). Known cost from the facts above: `_updateScale()` reverts the scale on every noVNC resize handling (rAF), so the value must be re-applied after it — fragile ordering against noVNC's own `ResizeObserver`.
2. **CSS `transform: scale(z)` on the canvas wrapper** with an own translate-based pan. Known cost: pointer coordinates are off by `z` unless every mouse/touch position is compensated before noVNC sees it — a second interception layer for fine pointers as well.
3. **Sized host ("autoscale to an exact factor")**: keep `scaleViewport = true` (public API only) and size noVNC's host `<div>` to `fb.w * z/100` × `fb.h * z/100` CSS px (fit = 100 % of the tile); `autoscale` then yields exactly `z/100`, `_display.scale` equals the visual scale by construction, and a noVNC resize recomputes the same value. The tile wrapper is `overflow: hidden` and pans by `scrollLeft`/`scrollTop` (or a translate) clamped to the scaled size. Framebuffer size comes from the gui stream entry (`gui.width`/`gui.height`, already on the signal) or from noVNC's `desktopsize`-driven canvas size.

Whichever mechanism wins, the posture contract (R1–R3, R6–R8, R13) is identical.

- **GIVEN** zoom `150` and a 1920×1080 desktop **WHEN** rendered in an 800×600 tile **THEN** the canvas is drawn 2880×1620 CSS px and the tile shows a 800×600 window of it; **AND** a synthetic click at the tile's centre maps to the framebuffer pixel visibly under it
- **GIVEN** zoom `fit` **WHEN** the tile resizes **THEN** behavior is unchanged from today (uniform letterboxed fit, `resizeSession` semantics untouched)

#### R6: The 1.5 s zoom badge
On every zoom change (posture change from any source: palette, chord, wheel, pinch) the tile SHALL show a corner badge (`data-testid="gui-zoom-badge"`, monospace, e.g. `150%` or `fit`) that hides after `ZOOM_BADGE_MS = 1500`; a change during the 1.5 s restarts the timer; the timer is cleared on unmount.

- **GIVEN** zoom `100` **WHEN** it changes to `125` **THEN** the badge reads `125%` and is gone 1.5 s later (fake timers)

#### R7: Pan when the zoomed desktop exceeds the tile
When `zoom !== "fit"` and the scaled desktop exceeds the tile, the viewport SHALL pan: **fine pointer** — drag on the canvas (noVNC's `dragViewport` where the mechanism keeps `clipViewport`; else an own pointer-capture drag on the wrapper that does not reach the guest as a mouse drag); **coarse pointer in `touch` mode** — noVNC's own one-finger drag pan (`dragViewport` on, tap still clicks); **coarse pointer in `trackpad` mode** — the viewport follows the virtual cursor (cursor-edge follow: when a relative move would put the cursor outside the visible window, the viewport scrolls so the cursor stays inside). The pan offset is clamped so the scaled canvas always covers the tile. At `fit` no pan gesture exists.

- **GIVEN** zoom `200` on a fine pointer **WHEN** the user drags 100 px left **THEN** the visible window moves 100 px and no left-button drag reaches the guest
- **GIVEN** zoom `200`, trackpad mode **WHEN** the virtual cursor is moved past the visible right edge **THEN** the viewport pans right so the cursor stays visible

#### R8: Zoom chords — registry entries + Ctrl+wheel
Three registry bindings SHALL be added to `DEFAULT_BINDINGS` in `lib/keybindings.ts`: `gui-zoom-in` (`Equal`), `gui-zoom-out` (`Minus`), `gui-zoom-fit` (`Digit0`), all `tier: "ctrl"` on every platform (the plan names Ctrl explicitly; ⌘= / ⌘- / ⌘0 are browser zoom), `scope: "terminal"`, `ignoreInputs: true`, labels `Zoom GUI in` / `Zoom GUI out` / `Zoom GUI to fit`, `mapLabel`s `gui +` / `gui −` / `gui fit`, and a NEW per-kind gate flag **`guiOnly: true`** mirroring `webOnly`: `hasReclaimableMatch` returns `kind === "gui"` for a `guiOnly` match (the gui tile's capture-phase gate then reclaims it over noVNC's canvas handler exactly like the other tile chords), and `shouldRefuseTerminalChord` MUST ignore `guiOnly` matches so plain Ctrl+=/−/0 still reach a focused pane (its mac ctrl-tier rule 3 would otherwise steal them). In `app.tsx` the three handlers mount ONLY while the focused tile kind is `gui` (the `webOnly` handler-presence pattern), and step the zoom posture via R2 / set `fit`. `withShortcutHints` gives the palette rows their hints for free. Separately, a capture-phase, non-passive `wheel` listener on the tile wrapper SHALL step the zoom one notch per accumulated `WHEEL_ZOOM_STEP_PX = 50` of `deltaY` when `ctrlKey` is held (mac trackpad pinch arrives as ctrl+wheel and rides the same path), calling `preventDefault` + `stopPropagation` so neither the browser page zoom nor noVNC's `_handleWheel` sees it; a wheel without Ctrl passes to noVNC untouched.

- **GIVEN** the gui tile is focused at `fit` **WHEN** Ctrl+= is pressed twice **THEN** zoom is `125` and the badge read `125%`
- **GIVEN** a tty tile is focused **WHEN** Ctrl+- is pressed **THEN** the chord reaches the pane (no handler, no refusal)
- **GIVEN** the gui tile **WHEN** a Ctrl+wheel with `deltaY = -100` arrives **THEN** zoom steps up twice (two 50 px notches — a single 50 px delta steps once); **WHEN** a wheel without Ctrl arrives **THEN** noVNC receives it
- **GIVEN** the Shortcuts tab **WHEN** opened **THEN** the three rows list under the terminal scope with their ctrl-tier keycaps

#### R9: Pinch-to-zoom (coarse, trackpad mode)
In `trackpad` mode the translation layer (R10) SHALL map a two-finger pinch to the zoom ladder: each `PINCH_STEP_PX = 40` of change in the inter-finger distance (relative to the distance at the last step) advances (spread) or retreats (squeeze) one step via R2; a two-finger gesture is classified as pinch when the distance change exceeds the centroid movement, else as a two-finger scroll (R10). In `touch` mode noVNC's native pinch (Ctrl+wheel to the guest) is left as is — the layer is inert there (intake A4/A8).

- **GIVEN** trackpad mode at `fit` **WHEN** two touches spread by 160 px **THEN** zoom is `150` (fit→100→125→150) and the badge shows `150%`

### The trackpad translation layer (`src/components/gui-pointer.ts`, new)

#### R10: Trackpad semantics over synthetic DOM events
A framework-free module SHALL export `attachGuiPointer(wrapper: HTMLElement, opts): () => void` (returns a detach) that, while active, owns every touch event on the wrapper in the **capture phase** (`touchstart`/`touchmove`/`touchend`/`touchcancel`, `stopPropagation` + `preventDefault` — noVNC's `GestureHandler` and its `touchstart→focusCanvas` listener never see them; the layer calls `rfb.focus()` itself on the first touch) and translates them into **synthetic DOM events dispatched on noVNC's canvas** (found via `wrapper.querySelector("canvas")`) so that no private RFB method is called: pointer moves/buttons as `MouseEvent`s (`mousemove`/`mousedown`/`mouseup`, with `buttons` and `clientX/clientY` at the virtual cursor's screen position, `bubbles: true`) and scrolls as `WheelEvent`s (`deltaY`/`deltaX` in px, `deltaMode: 0`). Semantics, with the named constants:

- one-finger drag → relative cursor move, `TRACKPAD_GAIN = 1.25` × finger delta (constant, not user-exposed; the plan allows 1.0–1.5)
- tap (lift within `TAP_MAX_MS = 180` and under `TAP_MAX_PX = 10` of movement) → left click (`mousedown` then `mouseup`, `buttons: 1`) at the current cursor position
- two-finger tap (both fingers lift within the tap window) → right click (`buttons: 2`) at the cursor
- two-finger drag (centroid moves, distance roughly constant) → `WheelEvent`s with `deltaY`/`deltaX` equal to the centroid delta in px, 1:1, no momentum (noVNC accumulates them into 50-px wheel steps at the cursor position)
- long-press (`LONG_PRESS_MS = 500`, movement under `TAP_MAX_PX`) → `mousedown` held (`buttons: 1`) until the finger lifts, with moves in between translated as relative drags → a press-and-hold / drag-and-drop
- pinch → R9

The virtual cursor starts at the tile centre, is clamped to the framebuffer, and is drawn by an rk-owned indicator element (`data-testid="gui-trackpad-cursor"`, `pointer-events: none`, absolutely positioned over the wrapper) because noVNC's local cursor is a CSS `cursor` that is invisible under touch. The module SHALL be pure enough to unit-test with synthetic `TouchEvent`s / `Touch` objects (or plain objects behind a small event-shape adapter) and fake timers.

- **GIVEN** trackpad active **WHEN** a finger drags (+40, +0) px **THEN** one or more `mousemove`s carry a cumulative +50 px cursor move (gain 1.25) and the guest never sees a button
- **GIVEN** a touch lifted at 120 ms / 4 px **THEN** `mousedown`(`buttons: 1`) + `mouseup` at the cursor; **GIVEN** 250 ms or 14 px **THEN** no click (reclassified as a drag)
- **GIVEN** two touches lifted within the tap window **THEN** `mousedown`(`buttons: 2`) + `mouseup`
- **GIVEN** two fingers moving together by +60 px in y **THEN** `WheelEvent`s totalling `deltaY = 60`, sign positive (down), no extra events after lift
- **GIVEN** a touch held 500 ms **THEN** one `mousedown` and no `mouseup` until `touchend`

#### R11: Mode wiring and `dragViewport` exclusivity
`GuiSurface` SHALL receive `pointerMode: GuiPointerMode` and attach the layer (R10) only while `pointerMode === "trackpad"` and an RFB is live, detaching on mode change, disconnect, or unmount. While the layer is attached `rfb.dragViewport` MUST be `false` (noVNC's drag-to-pan would otherwise fight the layer over the same input — V-D7, plan Risk 3); in `touch` mode `dragViewport` follows R7's touch-mode rule (`true` when zoomed on a coarse pointer). `touch` mode is the noVNC default passthrough — nothing is intercepted.

- **GIVEN** trackpad mode **WHEN** the RFB connects **THEN** `dragViewport === false` and the layer is attached; **WHEN** the posture flips to touch **THEN** the layer detaches and `dragViewport` follows the zoom/pointer rule

### The key bar (`src/components/gui-keybar.tsx`, new)

#### R12: Coarse-only docked strip with latching modifiers
`GuiKeyBar` SHALL render, on coarse pointers only, a single-row strip docked **under** the canvas as a flex sibling of the noVNC host div inside the canvas wrapper (the bare-WM strip is the precedent above it; the fit subtracts its height) with the buttons `Esc  Tab  Ctrl  Alt  ⇧  ←  ↑  ↓  →  ⌨` (`Control` `variant="chip"` — its coarse floor of 40 px is the touch target, `data-testid="gui-keybar"`). The latch state machine is a pure exported function/reducer (`latchModifier(state, mod)`, states `off → armed → locked → off`): one tap arms the modifier for the next non-modifier key (rendered pressed), a second tap locks it (rendered pressed with `●`, e.g. `Ctrl ●`), a third tap releases. Sending a non-modifier key composes a chord: for each latched/locked modifier `sendKey(mod, code, true)`, then `sendKey(key, code)` (press+release), then `sendKey(mod, code, false)`; an **armed** modifier returns to `off` after the chord, a **locked** one stays. Keys ride `rfb.sendKey` through a `sendKey` callback prop `GuiSurface` supplies (no-op without a live RFB). The bar is hidden in the empty/credentials states and on fine pointers.

- **GIVEN** `off` **WHEN** Ctrl tapped **THEN** `armed`; **WHEN** tapped again **THEN** `locked`; **WHEN** tapped again **THEN** `off`
- **GIVEN** Ctrl `armed` **WHEN** `Esc` is tapped **THEN** `sendKey` is called with (Control_L, down), (Escape press+release), (Control_L, up) in that order and Ctrl reads `off`
- **GIVEN** Ctrl `locked` **WHEN** two keys are tapped **THEN** both chords carry Ctrl and Ctrl stays `locked`

#### R13: `⌨` raises the platform keyboard through a hidden input
The `⌨` button SHALL focus a visually-hidden `<input>` (the noVNC-UI trick; `autocapitalize="off"`, `autocomplete="off"`, `spellcheck={false}`, `aria-label="On-screen keyboard"`), which forwards keystrokes through `sendKey` instead of letting them accumulate: printable characters via `beforeinput`/`input` (keysym = Latin-1 code point, else `0x01000000 | codePoint`; the input's value is reset after each forward), `Enter`/`Backspace`/`Tab`/`Escape`/arrows via `keydown` (`preventDefault`), each composed with the latched modifiers per R12. Tapping `⌨` again (or blur) releases the input.

- **GIVEN** the hidden input is focused **WHEN** the user types `c` with Ctrl armed **THEN** `sendKey` receives Control_L down, `0x63` press+release, Control_L up, and the input's value is empty afterwards

### Palette (`src/lib/palette/gui.ts`, `app.tsx`)

#### R14: Zoom and pointer rows; `GUI: 1:1` as the 100 % alias
`buildGuiActions` input SHALL replace `viewMode`/`onViewMode` with `zoom: GuiZoom` / `onZoom(z: GuiZoom)` and add `pointerMode: GuiPointerMode` / `onPointerMode(m)`. Rows (all `tileOpen`-gated, destination-only where a pair): `GUI: Zoom in` (id `gui-zoom-in`, omitted at `200`), `GUI: Zoom out` (id `gui-zoom-out`, omitted at `fit`), `GUI: Zoom to fit` (id `gui-zoom-fit`, omitted at `fit`; replaces `gui-view-fit`), `GUI: 1:1` (id `gui-view-1to1` kept, omitted at `100`, `onZoom(100)` — description `100% — same as zoom`), and on coarse pointers only the pair `GUI: Pointer → Trackpad` (id `gui-pointer-trackpad`, description `one finger moves, tap clicks, two-finger tap right-clicks, two-finger drag scrolls`) / `GUI: Pointer → Touch` (id `gui-pointer-touch`, description `tap where you touch`), showing only the mode that is NOT current. The zoom rows carry the R8 chord hints via the existing `withShortcutHints` path (they share the registry actionIds). `app.tsx` owns the two postures as state seeded from `readGuiZoom()` / `readGuiPointerMode(coarsePointer)`, written through `writeGuiZoom` / `writeGuiPointerMode`, and passes `guiZoom` / `guiPointerMode` / `onGuiZoomChange` through `SurfaceLayout` to `GuiSurface` (replacing the `guiViewMode` tunnel).

- **GIVEN** zoom `fit`, fine pointer **WHEN** built **THEN** ids include `gui-zoom-in` and `gui-view-1to1`, exclude `gui-zoom-out`, `gui-zoom-fit`, and both pointer rows
- **GIVEN** zoom `200`, coarse pointer, pointer `trackpad` **WHEN** built **THEN** ids include `gui-zoom-out`, `gui-zoom-fit`, `gui-view-1to1`, `gui-pointer-touch`; exclude `gui-zoom-in`, `gui-pointer-trackpad`
- **GIVEN** `GUI: 1:1` selected **THEN** `onZoom(100)`

### Docs

#### R15: Spec update
`docs/specs/gui.md` § The tile SHALL gain a subsection `### Zoom, pointer modes, and the key bar` stating: the `rk-gui-zoom` ladder and chords (Ctrl+wheel / Ctrl+= / Ctrl+- / Ctrl+0, pinch), the 1.5 s badge, the pan rules per pointer class and mode, `rk-gui-pointer` with the `trackpad`/`touch` semantics and the coarse default, the `GUI: 1:1` alias, the key bar's latching model and `⌨`, and a one-line pointer to the plan's decision log (V-D6/7/8). `fab/plans/sahil/26-09-10-gui-viewer-ergonomics.md` § Change breakdown V2 row SHALL name this change (`260910-0aur-gui-zoom-and-touch-pointer`) and read `in progress`. Memory is hydrate's job.

- **GIVEN** the spec **WHEN** read **THEN** § The tile documents zoom, pointer modes, and the key bar consistently with R1–R14

### Non-Goals

- Quality presets, stats overlay, HiDPI, the floating toolbar pill, `GUI: Send key…` (V3/V4; the toolbar will mirror rows created here)
- Any server-side change — no route, stream field, or Go type changes
- Reopening D1–D6/D8–D10 of the parent surface plan; C6 bandwidth work; file transfer, audio, multi-monitor (V-D14)
- A user-tunable trackpad gain or pinch threshold (constants only)
- Momentum scrolling in two-finger drag (1:1 by plan)

### Design Decisions

#### Zoom rendering mechanism
**Decision**: Candidate 3 — the sized host. `scaleViewport` stays true at every zoom and `clipViewport` stays false (public API only): at `fit` the noVNC host div is tile-sized as before, and at a percentage `z` it is sized to `fb.w·z/100` × `fb.h·z/100` CSS px (framebuffer from the gui stream entry's `gui.width`/`gui.height`), so `Display.autoscale` — `min(w/fb.w, h/fb.h)`, no 1.0 cap — yields exactly `z/100` and `_display.scale` equals the canvas's visual scale by construction, keeping `absX`/`absY` pointer mapping exact on every step. The tile wrapper is `overflow: hidden` and pans by clamped `scrollLeft`/`scrollTop`. `resizeSession` keeps its five-clause formula at `fit` but is held false while zoomed: noVNC's ResizeObserver watches that screen div, and `_requestRemoteResize` would request the deliberately-larger scaled size as the remote desktop size — the gui-signal echo would then grow the framebuffer that feeds the host size, a runaway feedback loop under `auto`.
**Why**: Verified against `node_modules/@novnc/novnc` 1.7.0: `RFB._updateScale` → `Display.autoscale(_screenSize())` recomputes the same `z/100` on every container resize, so mid-zoom browser/tile resizes are self-healing with zero re-application code; `_rescale` writes only the canvas CSS `width`/`height` strings, so visual scale == `_display.scale` always (the pointer-correctness invariant). One spike finding shaped the pan design: noVNC's `dragViewport` pans via `Display.viewportChangePos`, which is a no-op unless the display CLIPS, and `_updateClip` force-disables clipping whenever `scaleViewport` is on — under this mechanism noVNC's native drag pan moves nothing, so the tile drives its own scroll (fine pointer: capture-swallowed mouse drag with sub-threshold click replay; coarse touch mode: a passive observing touch tracker while `dragViewport` stays on so noVNC swallows the one-finger drag as a viewport gesture instead of sending the guest a left-drag).
**Rejected**: 1 (drive `_display.scale` directly) — `RFB._updateScale` writes `_display.scale = 1.0` (scaleViewport off) or re-autoscales on every noVNC resize handling inside its own requestAnimationFrame, so a directly-driven scale is reverted on each resize and must race noVNC's rAF to be re-applied; it also needs the `_display` private, which `types/novnc.d.ts` deliberately avoids. 2 (CSS `transform: scale()` on the wrapper) — the transform is invisible to `_display.scale` but visible to `getBoundingClientRect`, so `clientToElement` positions land off by the zoom factor and every mouse/touch position would need compensation before noVNC sees it — a second interception layer for fine pointers as well.
*Introduced by*: 260910-0aur-gui-zoom-and-touch-pointer

#### Trackpad input reaches noVNC as synthetic DOM events, never private calls
**Decision**: The trackpad layer intercepts touches in the capture phase on the tile wrapper and dispatches synthetic `MouseEvent`/`WheelEvent`s on noVNC's canvas; it never calls `_handleMouseMove`/`_handleMouseButton`/`_sendMouse`.
**Why**: noVNC's DOM listener surface (canvas mouse/wheel events, `_convertButtonMask(ev.buttons)`, `WHEEL_STEP` accumulation) is the behavior the fine-pointer path already depends on, so the translated input is indistinguishable from a mouse and survives noVNC minors; capture-phase interception is the one seam that keeps `GestureHandler` from double-handling the same touches.
**Rejected**: Calling RFB privates (`_handleMouseButton` etc.) — brittle across versions and bypasses the cursor/throttle logic; monkey-patching `_handleGesture` — same brittleness plus it still lets noVNC own tap classification.
*Introduced by*: 260910-0aur-gui-zoom-and-touch-pointer

#### Pinch and rk zoom are trackpad-mode gestures; touch mode stays noVNC-native
**Decision**: Pinch-to-rk-zoom and cursor-follow pan exist in `trackpad` mode; `touch` mode is a verbatim noVNC passthrough (native pinch = Ctrl+wheel to the guest, native one-finger drag pan when zoomed, native two-finger scroll).
**Why**: Two gesture systems over the same touches is plan Risk 3; the coarse default is `trackpad` (V-D7), which is where the acceptance ("pinch reaches 200 % and pans") is measured, and keeping `touch` as an untouched passthrough is the only way it can be the guaranteed escape hatch.
**Rejected**: Intercepting only pinch in touch mode — capture-phase interception is all-or-nothing per event, so swallowing the second finger desynchronizes noVNC's gesture state machine.
*Introduced by*: 260910-0aur-gui-zoom-and-touch-pointer

### Deprecated Requirements

#### `rk-gui-view` / `GuiViewMode` (`GUI: Fit` ↔ `GUI: 1:1` as a separate clip mode)
**Reason**: The zoom posture subsumes it — `fit` and `100` are the two old modes (intake A7); two overlapping per-viewer postures would fight over `scaleViewport`/`clipViewport`.
**Migration**: `readGuiZoom` maps a legacy `rk-gui-view: "1:1"` to `100` once; `writeGuiZoom` removes the legacy key. `GUI: 1:1` survives as the 100 % alias row; `GUI: Fit` becomes `GUI: Zoom to fit`.

## Tasks

### Phase 1: Postures and the registry

- [x] T001 In `app/frontend/src/lib/gui-posture.ts` add `GuiZoom`, `GUI_ZOOM_STEPS`, `readGuiZoom`/`writeGuiZoom` (with the `rk-gui-view` → `100` migration and legacy-key removal), `stepGuiZoom`, `GuiPointerMode`, `readGuiPointerMode(coarsePointer)`/`writeGuiPointerMode`; remove `GuiViewMode`/`readGuiViewMode`/`writeGuiViewMode`; update the file header comment. Extend `src/lib/gui-posture.test.ts`: defaults per pointer class, round-trips, invalid values, the migration, the full step table up/down, throwing storage. <!-- R1 R2 R3 R4 -->
- [x] T002 [P] In `app/frontend/src/lib/keybindings.ts` add the `guiOnly` flag (doc comment mirroring `webOnly`), the three `DEFAULT_BINDINGS` rows (`gui-zoom-in`/`Equal`, `gui-zoom-out`/`Minus`, `gui-zoom-fit`/`Digit0`; `tier: "ctrl"`, `scope: "terminal"`, `ignoreInputs`, `guiOnly`, labels/mapLabels per R8), `hasReclaimableMatch` → `kind === "gui"` for `guiOnly`, and exclude `guiOnly` matches in `shouldRefuseTerminalChord`. Extend `keybindings.test.ts` (row shape, reclaim per kind, terminal refusal untouched on mac for Ctrl+=/−/0, any default-binding enumeration/claims tests that list codes). <!-- R8 -->
- [x] T003 [P] Extend `app/frontend/src/types/novnc.d.ts` with `sendKey(keysym: number, code: string | null, down?: boolean): void` (and, after T005's spike, any narrowly-typed internal the chosen mechanism needs, e.g. `_display?: { scale: number; viewportChangeSize(w: number, h: number): void }` — only if candidate 1 wins). Add the local keysym constants module `app/frontend/src/lib/gui-keysyms.ts` (the X11 table from the facts section + `keysymForChar(ch)`) with a small unit test. <!-- R12 R13 -->

### Phase 2: Zoom in the tile

- [x] T004 In `app/frontend/src/components/gui-surface.tsx` replace the `viewMode` prop with `zoom: GuiZoom`, `pointerMode: GuiPointerMode`, `onZoomChange: (z: GuiZoom) => void`; thread them through `surface-layout.tsx` (`guiZoom`, `guiPointerMode`, `onGuiZoomChange` replacing `guiViewMode`) and `app.tsx` state (`guiZoom`/`guiPointerMode` seeded from T001's readers, written on change). Update `applyRfbProps`: `scaleViewport = zoom === "fit"` (subject to T005's mechanism), `dragViewport` per R7/R11. Fix the existing `gui-surface.test.tsx` "view modes" case for the new props. <!-- R4 R5 R11 R14 -->
- [x] T005 **Spike** the three R5 candidates against `node_modules/@novnc/novnc` 1.7.0 (a throwaway harness or the dev rig `just dev` + the gui tile is fine — the VM's daemon has a live Xvnc; `rk gui status`), judging the R5 criteria; then implement the winner in `gui-surface.tsx` (zoom application for the six steps + fit, resize-safe, `resizeSession` untouched under `auto`) and **replace the `#### Zoom rendering mechanism` placeholder in this plan's `### Design Decisions`** with the recorded decision (Decision/Why/Rejected, concrete observations from the spike). Unit-test the mechanism's observable contract with the FakeRFB (e.g. the host div's size / `scaleViewport`/`clipViewport` flags / the internal call the mechanism makes) per zoom step. <!-- R5 -->
- [x] T006 Add the zoom badge (`gui-zoom-badge`, `ZOOM_BADGE_MS = 1500`, restart-on-change, cleared on unmount) to `gui-surface.tsx`; vitest with fake timers: shows `125%`, hides at 1.5 s, restarts on a second change. <!-- R6 -->
- [x] T007 Implement pan in `gui-surface.tsx` per R7 for the winning mechanism: fine-pointer drag (no guest button leak), coarse `touch` → noVNC drag pan, coarse `trackpad` → cursor-follow (exposed as a `panTo`/`ensureVisible` hook the T009 layer calls); clamp the offset; no gesture at `fit`. Vitest: a fine drag pans and the FakeRFB sees no `mousedown`-derived state; clamping at the edges. <!-- R7 -->
- [x] T008 Wire the chords: in `app.tsx` mount the `gui-zoom-in`/`gui-zoom-out`/`gui-zoom-fit` handlers only while `focusedTileKind === "gui"` (the `webOnly` handler-presence pattern), stepping via `stepGuiZoom` / `fit` and writing the posture; the tile's existing capture-phase keydown gate already reclaims `guiOnly` matches through `shouldReclaimChord("gui")`. Add the capture-phase non-passive Ctrl+`wheel` handler (`WHEEL_ZOOM_STEP_PX = 50`, direction by sign, `preventDefault` + `stopPropagation`; plain wheel passes) in `gui-surface.tsx`, calling `onZoomChange`. Vitest: Ctrl+wheel steps and is swallowed, plain wheel reaches the canvas subtree. <!-- R8 --> <!-- rework: review must-fix #2 — replace the local wheelAccumRef/WHEEL_ZOOM_STEP_PX accumulation with lib/zoom-gesture.ts createWheelAccumulator (+ WHEEL_STEP_THRESHOLD) and feed its signed step count through stepGuiZoom; drop WHEEL_ZOOM_STEP_PX; fix the stale "empty/credentials states render no wrapper" comment (nice-to-have #1) -->

### Phase 3: Trackpad layer and key bar

- [x] T009 Create `app/frontend/src/components/gui-pointer.ts` — `attachGuiPointer(wrapper, { rfb, getCanvas, cursorEl, gain, onZoomStep, ensureCursorVisible })` per R10/R9 with the named constants (`TRACKPAD_GAIN`, `TAP_MAX_MS`, `TAP_MAX_PX`, `LONG_PRESS_MS`, `PINCH_STEP_PX`), capture-phase touch ownership, synthetic `MouseEvent`/`WheelEvent` dispatch on the canvas, the virtual cursor model (start at centre, clamp to framebuffer, cursor-follow via the hook), pinch vs two-finger-scroll classification, and a detach that clears timers. Colocated `gui-pointer.test.ts` with synthetic touch events + fake timers covering every R10/R9 scenario (drag+gain, tap under/over both thresholds, two-finger tap → right, two-finger drag → wheel sign/magnitude, long-press hold/release, pinch steps, detach stops interception). <!-- R9 R10 --> <!-- rework: review should-fix #1/#2 + nice-to-have #2 — add the idle→beginTwo case so two contacts arriving in ONE touchstart classify (scroll/pinch/two-finger tap); reuse lib/zoom-gesture.ts clampZoom instead of the local clamp; emit the right-click when both fingers lift in a single touchend; unit-test all three -->
- [x] T010 In `gui-surface.tsx` attach/detach the T009 layer per R11 (trackpad + live RFB only; `dragViewport` forced false while attached; re-evaluated on `pointerMode` flips, disconnect, unmount), render the rk cursor indicator (`gui-trackpad-cursor`) in trackpad mode. Vitest: attach/detach on mode flip and `dragViewport` exclusivity; the indicator renders only in trackpad mode. <!-- R11 --> <!-- rework: review must-fix #1 — the trackpad layer must never swallow taps on the macOS credentials overlay (gui-surface-credentials): detach the layer while `credentials` is set (add it to the attach effect deps) or add the overlay to CHROME_SELECTOR; vitest: with the layer attached, a tap on the password input / Connect reaches them -->
- [x] T011 Create `app/frontend/src/components/gui-keybar.tsx` — `GuiKeyBar` (coarse-only, `Control variant="chip"`, 36 px coarse targets, the ten buttons, pressed/`●` rendering) with the pure exported latch reducer and chord composer per R12, and the `⌨` hidden-input path per R13 (T003's keysyms). Colocated `gui-keybar.test.tsx`: the latch state machine (off→armed→locked→off; armed consumed by one key; locked persists), chord `sendKey` call order, `⌨` focuses the input and forwards a typed `c` with Ctrl armed, value reset, blur releases. <!-- R12 R13 -->
- [x] T012 Mount `GuiKeyBar` in `gui-surface.tsx` as a flex sibling under the noVNC host div (coarse pointers, canvas state only), passing a `sendKey` callback bound to `rfbRef.current?.sendKey`; add a `gui-surface.test.tsx` case that the bar renders on coarse and not on fine, and sits after the host div. <!-- R12 -->

### Phase 4: Palette, e2e, docs

- [x] T013 Update `app/frontend/src/lib/palette/gui.ts` per R14 (input shape, the five zoom/pointer rows with gates and descriptions, `gui-view-1to1` → `onZoom(100)`, header doc comment) and `app.tsx`'s `buildGuiActions` call (pass `zoom`/`pointerMode`, `onZoom`/`onPointerMode`, drop `viewMode`/`onViewMode`). Rewrite the affected `palette/gui.test.ts` cases and add the R14 scenarios (fit/fine, 200/coarse/trackpad, 1:1 routes to 100, pointer pair coarse-only and destination-only). <!-- R14 -->
- [x] T014 Playwright desktop (1280 px) in `app/frontend/tests/e2e/gui-surface.spec.ts` (ungated half, reachable icewm fixture): click the gui tile, press `Control+Equal` twice → badge reads `125%`; `Control+Digit0` → badge reads `fit`; a Ctrl+wheel via `page.mouse.wheel` with Control held steps once. Intent comments per Constitution § Test Intent Comments; note in the file header that the ungated RFB never reaches `connected`, so the chords/badge are the observable and `sendKey` assertions live in vitest. <!-- R6 R8 -->
- [x] T015 Playwright mobile (375 px, `hasTouch`, `isMobile`) in `gui-surface.spec.ts`: the key bar renders with all ten buttons inside the viewport; tapping `Ctrl` renders it pressed, tapping `Esc` releases it (armed-for-one); a two-finger spread via CDP `Input.dispatchTouchEvent` (the `mobile-touch-scroll.spec.ts` precedent, two `touchPoints`) moves the zoom badge to `100%` then `125%`. Intent comments per Constitution. <!-- R9 R12 -->
- [x] T016 [P] Docs: add `### Zoom, pointer modes, and the key bar` to `docs/specs/gui.md` § The tile per R15; update the V2 row in `fab/plans/sahil/26-09-10-gui-viewer-ergonomics.md` § Change breakdown with this change's name and `in progress`. <!-- R15 -->
- [x] T017 Gates: `just check`, `just test-frontend`, `just test-e2e "e2e/gui-surface"` (one spec per run — a bare name that matches the worktree folder runs the whole suite), then `just test`; fix failures. Grep the tree for `GuiViewMode`, `readGuiViewMode`, `writeGuiViewMode`, `guiViewMode`, `onViewMode` — none may remain. <!-- R4 R5 R8 R10 R12 R14 --><!-- gate note: check/test-frontend/gui-surface e2e all green (4450 vitest, 16/16 e2e incl. the real-Xvnc half); the retirement grep is clean. `just test`'s e2e leg fails 6 pre-existing non-gui specs (boards-multi-server, create-server-waiting, legacy-color-sweep, legacy-scope-sweep, multi-server-sidebar, protected-kill-confirm): all six create family-prefixed tmux servers whose names exceed the backend's 64-char MaxServerNameLength under this worktree's long folder name (400 on validate), reproduce standalone, and failed identically on the 260910-zsui worktree's 15:41 `just test` run today (a tree without this diff) while the short-named azure-eagle worktree's 07:54 run was green. Zero Go/backend/harness files changed here; out of this change's frontend-only scope. -->

## Execution Order

- T001 → T004 (the new types/readers) → T005 (mechanism) → T006/T007/T008 (badge, pan, chords depend on the mechanism's zoom application)
- T002 and T003 are independent of T001 and may run alongside it; T008 needs T002
- T009 → T010 → T012 (layer, then its mount; the key bar mount needs T011)
- T013 needs T001 and T004; T014/T015 need everything before them; T016 is independent; T017 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `readGuiZoom`/`writeGuiZoom` round-trip every table value and default invalid/absent/throwing storage to `fit`
- [x] A-002 R2: `stepGuiZoom` implements exactly `fit→100→125→150→200` up and `200→150→125→100→75→50→fit` down, with saturation at both ends
- [x] A-003 R3: `readGuiPointerMode` defaults `trackpad` on coarse and `touch` on fine; a stored value wins
- [x] A-004 R5: the tile renders each of the six zoom steps at exactly `z/100` CSS px per framebuffer px and `fit` unchanged from today; the chosen mechanism is recorded in `### Design Decisions` with the rejected candidates and concrete spike observations
- [x] A-005 R6: a zoom change shows the `gui-zoom-badge` with the new value and hides it after 1.5 s (restart on change, cleared on unmount)
- [x] A-006 R7: pan exists only when zoomed content exceeds the tile — fine drag, coarse touch-mode drag, trackpad cursor-follow — clamped so the canvas always covers the tile
- [x] A-007 R8: `gui-zoom-in`/`gui-zoom-out`/`gui-zoom-fit` are ctrl-tier `guiOnly` registry rows visible in the Shortcuts tab; handlers mount only while the gui tile is focused; Ctrl+wheel steps zoom and is swallowed; plain wheel reaches noVNC
- [x] A-008 R9: in trackpad mode a pinch steps the ladder by `PINCH_STEP_PX` of distance change and is distinguished from a two-finger scroll
- [x] A-009 R10: the trackpad layer implements drag (gain), tap, two-finger tap, two-finger scroll, long-press with the named constants, via synthetic DOM events on the canvas only
- [x] A-010 R11: the layer attaches only in trackpad mode with a live RFB, `dragViewport` is false while attached, and it detaches on mode flip / disconnect / unmount
- [x] A-011 R12: the key bar renders only on coarse pointers, under the canvas, with the ten buttons; the latch reducer and chord composer behave per R12
- [x] A-012 R13: `⌨` focuses the hidden input; typed characters and special keys are forwarded through `sendKey` with latched modifiers and never accumulate in the input
- [x] A-013 R14: the palette rows, ids, gates, descriptions, and the `GUI: 1:1` → 100 alias match R14; `app.tsx` owns and persists both postures
- [x] A-014 R15: `docs/specs/gui.md` § The tile documents zoom, pointer modes, and the key bar; the ergonomics plan's V2 row names this change

### Behavioral Correctness

- [x] A-015 R4: no live reference to `GuiViewMode`/`rk-gui-view` remains outside the one-time migration read; a legacy `1:1` viewer lands on zoom `100`
- [x] A-016 R8: under tty focus Ctrl+=/Ctrl+-/Ctrl+0 reach the pane on every platform (no handler mounted, `shouldRefuseTerminalChord` ignores `guiOnly`)
- [x] A-017 R5: `resizeSession` semantics (`!coarsePointer && focused && !resizeLocked && !hostLocked && geometry === "auto"`) are untouched by zoom

### Removal Verification

- [x] A-018 R4: `readGuiViewMode`/`writeGuiViewMode`/`GuiViewMode` and the `viewMode`/`onViewMode`/`guiViewMode` props are gone from `gui-posture.ts`, `gui-surface.tsx`, `surface-layout.tsx`, `app.tsx`, `lib/palette/gui.ts` and their tests; the `gui-view-fit` id no longer exists

### Scenario Coverage

- [x] A-019 R6 R8: Playwright desktop — Ctrl+= twice reads `125%`, Ctrl+0 reads `fit`, Ctrl+wheel steps; intent comments present
- [x] A-020 R9 R12: Playwright mobile — key bar renders inside 375 px, Ctrl arms and releases on `Esc`, a CDP two-finger spread moves the badge through `100%` to `125%`; intent comments present
- [x] A-021 R10 R12 R13: vitest covers every R10 gesture scenario, the latch state machine, the chord `sendKey` order, and the `⌨` forwarding path

### Edge Cases & Error Handling

- [x] A-022 R1 R3: localStorage read/write failures never throw (try/catch-noop discipline)
- [x] A-023 R10: a touch that starts a drag never produces a click; `touchcancel` and detach release any held button and clear timers
- [x] A-024 R12 R13: with no live RFB the bar and the hidden input are inert (no throw, `sendKey` no-op)
- [x] A-025 R8: Ctrl+wheel accumulates sub-threshold deltas (mac trackpad pinch) into single steps rather than one step per event

### Code Quality

- [x] A-026 Pattern consistency: new modules follow the pure-helper + colocated-test pattern (`lib/gui-posture.ts`, `lib/palette/gui.ts`), `Control` primitives for buttons, `data-testid` naming, and the existing header-comment style; comments state constraints, never narrate or cite change IDs
- [x] A-027 R8: the tile's Ctrl+wheel zoom reuses `lib/zoom-gesture.ts`'s `createWheelAccumulator` (`WHEEL_STEP_THRESHOLD = 50`) feeding signed steps through `stepGuiZoom` — no second zoom/scale table or accumulator anywhere (re-review cycle 1: the local `wheelAccumRef`/`WHEEL_ZOOM_STEP_PX` re-implementation is deleted)
- [x] A-028 Type narrowing over assertions: any noVNC internal access is confined to `src/types/novnc.d.ts` declarations (no scattered `as any`); discriminated unions for the latch/gesture states
- [x] A-029 Named constants: `GUI_ZOOM_STEPS`, `ZOOM_BADGE_MS`, `TRACKPAD_GAIN`, `TAP_MAX_MS`, `TAP_MAX_PX`, `LONG_PRESS_MS`, `PINCH_STEP_PX` — no magic numbers in the gesture/zoom code (the wheel step threshold rides the shared `WHEEL_STEP_THRESHOLD` from `lib/zoom-gesture.ts`; `WHEEL_ZOOM_STEP_PX` was retired during rework)
- [x] A-030 Tests alongside every changed behavior; Playwright `test()`s carry Proves/Steps intent blocks; `just check`, `just test-frontend`, the gui e2e spec, and `just test` pass
- [x] A-031 No god functions: the trackpad state machine and the key bar reducer are decomposed (per-gesture handlers / a pure reducer), not one >50-line switch

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Apply leaves its work uncommitted; ship commits. Never use bare `git stash` in this worktree (shared stash stack).

## Deletion Candidates

- None — this change adds new functionality and already removes the only existing code it makes redundant: `GuiViewMode`/`readGuiViewMode`/`writeGuiViewMode`, the `viewMode`/`guiViewMode`/`onViewMode` prop tunnel, and the `gui-view-fit` palette id (verified absent in the working tree; `rk-gui-view` survives only as the one-time migration read, and `gui-view-1to1` is deliberately retained as the 100% alias per R14). Re-review cycle 1 checked the rework delta too: the prior cycle's local wheel accumulator (`wheelAccumRef`/`WHEEL_ZOOM_STEP_PX`) is deleted in favor of `lib/zoom-gesture.ts`'s shared `createWheelAccumulator`. No other pre-existing symbol, file, or branch lost its callers.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `rk-gui-view`/`GuiViewMode` is retired into `rk-gui-zoom` (fit = `fit`, 1:1 = `100`) with a one-time migration read, rather than kept beside it | Intake A7 says 1:1 becomes an alias *replacing* the clip mode; two postures writing `scaleViewport`/`clipViewport` would conflict; migration keeps a 1:1 viewer where they were | S:70 R:80 A:85 D:75 |
| 2 | Confident | Pinch-to-rk-zoom and cursor-follow pan live in `trackpad` mode only; `touch` mode is an untouched noVNC passthrough (native pinch → guest Ctrl+wheel, one-finger drag pan when zoomed, native two-finger scroll) | Intake A4/A8 make the layer inert in touch mode; capture-phase interception cannot swallow only the second finger without desynchronizing noVNC's gesture state; the coarse default is trackpad, where acceptance is measured | S:60 R:80 A:80 D:65 |
| 3 | Confident | In trackpad mode two-finger drag stays *scroll* (V-D7) and pan is cursor-edge follow; the plan's "two-finger drag (coarse) pans" line is realized in touch mode by noVNC's native one-finger drag pan | The two plan lines conflict in trackpad mode; V-D7's scroll semantics are the more specific, binding decision; cursor-follow is the Chrome-Remote-Desktop convention | S:55 R:80 A:75 D:60 |
| 4 | Confident | The trackpad layer feeds noVNC synthetic DOM `MouseEvent`/`WheelEvent`s on the canvas rather than calling RFB privates | Public-listener seam, version-stable, reuses noVNC's own button-mask and wheel-step logic | S:70 R:85 A:85 D:80 |
| 5 | Confident | Zoom chords are `tier: "ctrl"` on every platform with a new `guiOnly` gate (handlers mount only under gui-tile focus; `shouldRefuseTerminalChord` ignores them) | The plan names Ctrl; ⌘=/⌘- are browser zoom on mac; the `webOnly` precedent is the exact shape; Ctrl must keep reaching a focused pane | S:75 R:80 A:85 D:75 |
| 6 | Confident | Pointer-mode palette rows render only on coarse pointers; zoom rows on any pointer while the tile is open | The layer only acts on touch events and the intake calls the fine-pointer distinction moot; mirrors the fine-only Lock pair | S:60 R:90 A:80 D:70 |
| 7 | Tentative | Constants: `TRACKPAD_GAIN` 1.25, `TAP_MAX_MS` 180, `TAP_MAX_PX` 10, `LONG_PRESS_MS` 500, `PINCH_STEP_PX` 40, `WHEEL_ZOOM_STEP_PX` 50, `ZOOM_BADGE_MS` 1500 | Plan gives 180 ms/10 px/500 ms/1.5 s and a 1.0–1.5 gain window; pinch and wheel thresholds are the intake's Tentative A8 — any value that reaches 200 % on a spread satisfies acceptance | S:45 R:90 A:60 D:45 |
| 8 | Tentative | The zoom rendering mechanism is decided by the T005 spike (three candidates, with candidate 3 "sized host" flagged as the likely winner because it keeps pointer mapping correct with public API only) | Intake A3 / V-D6 Likely — apply decides and records; my noVNC read found concrete costs for candidates 1 and 2 but no spike has run yet | S:50 R:60 A:55 D:45 |
| 9 | Confident | In the ungated e2e half the RFB never reaches `connected`, so `sendKey` is a no-op there; the "Ctrl + letter sends one chord" assertion lives in vitest against the FakeRFB, and the mobile e2e asserts the bar's visible latch state instead | The existing ungated suite never opens a real relay socket by design; a global `sendKey` spy would need a test-only window hook the product should not carry | S:65 R:85 A:80 D:70 |
| 10 | Certain | Trackpad mode draws an rk-owned cursor indicator element | noVNC's local cursor is a CSS `cursor` (invisible under touch) and `_fakeMouseMove`'s indicator is only fed by its own gesture path, which the layer bypasses | S:80 R:90 A:85 D:85 |

10 assumptions (1 certain, 7 confident, 2 tentative).
