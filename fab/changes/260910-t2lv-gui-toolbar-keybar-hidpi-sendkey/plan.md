# Plan: Session toolbar, HiDPI, and Send key (S7 / V4)

**Change**: 260910-t2lv-gui-toolbar-keybar-hidpi-sendkey
**Intake**: `intake.md`

> Frontend only (`app/frontend/`). Design authority: `fab/plans/sahil/26-09-10-gui-viewer-ergonomics.md`
> § Decision log V-D10 / V-D12 / V-D13 (binding) and § V4. S6 (`gui-quality-presets-and-stats`) is
> NOT on `main` at apply time — no `rk-gui-quality` posture, no stats seam exists — so the pill's
> quality (`◐`) and stats (`∿`) controls are optional slots that render only when a handler is
> supplied (intake Assumption 4). The worktree is fresh: run `just setup` before any test.

## Requirements

### GUI tile: the toolbar pill

#### R1: Two-context visibility
`GuiToolbar` (`src/components/gui-toolbar.tsx`, new) SHALL render inside the gui tile's canvas
wrapper only when the viewer is coarse-pointer OR the wrapper is the document's fullscreen element.
A fine-pointer, non-fullscreen viewer MUST never see it. It MUST NOT render in the empty or
credentials states.

- **GIVEN** a fine-pointer viewer with the gui tile open and not fullscreen
- **WHEN** the canvas renders
- **THEN** no element with `data-testid="gui-toolbar"` exists
- **GIVEN** a coarse-pointer viewer, OR a fine-pointer viewer whose canvas wrapper is `document.fullscreenElement`
- **WHEN** the canvas renders
- **THEN** the pill mounts (its shown/hidden state is R2's concern)

#### R2: Reveal and auto-hide
The pill SHALL be shown when its context first becomes active (mount), on a tap/pointerdown on the
tile (coarse), or on pointer movement within `TOOLBAR_REVEAL_EDGE_PX` (24) of the wrapper's top
edge (fullscreen). It SHALL hide `TOOLBAR_HIDE_MS` (3000) after the last reveal or pill
interaction; any interaction with the pill restarts the timer. While hidden it renders nothing.

- **GIVEN** the pill was revealed at t=0 with no further interaction
- **WHEN** 3000 ms elapse (fake timers)
- **THEN** `gui-toolbar` is gone from the DOM
- **GIVEN** the pill is hidden on a coarse viewer
- **WHEN** a pointerdown lands on the canvas wrapper
- **THEN** the pill is shown again and the 3 s timer restarts
- **GIVEN** fullscreen on a fine pointer, pill hidden
- **WHEN** a pointermove arrives with `clientY` within 24 px of the wrapper's top
- **THEN** the pill is shown

#### R3: Controls mirror palette callbacks (no duplicated logic)
Each pill control SHALL invoke the SAME callback function the corresponding `buildGuiActions` row
calls, with the same argument: `−` → `onZoom(stepGuiZoom(zoom, -1))`, `fit` → `onZoom("fit")`,
`+` → `onZoom(stepGuiZoom(zoom, 1))`, `⌖ <Mode>` → `onPointerMode(<other mode>)`, `⌨` →
`onKeyBarVisibleChange(!visible)`, `⤢` → `onFullscreen()` (the toggle verb — it exits when
fullscreen), `◐ <Quality>` → the optional `quality.onCycle`, `∿` → the optional `stats.onToggle`.
Destination gating mirrors the palette: `+` disabled at 200, `−`/`fit` disabled at `fit`; `⌖` and
`⌨` render only on coarse pointers (the pointer pair and the key bar are coarse-only surfaces); `⤢`
renders only while fullscreen; `◐`/`∿` render only when their slot is supplied (S6 absent ⇒ hidden,
never thrown). Every control is a `Control variant="chip"` with an `aria-label`
(`Zoom out` / `Zoom to fit` / `Zoom in` / `Pointer mode` / `Toggle key bar` / `Exit fullscreen`).

- **GIVEN** the same `vi.fn()` passed as `onZoom` to both `GuiToolbar` and `buildGuiActions`, zoom `fit`
- **WHEN** the pill's `+` is clicked and the palette's `gui-zoom-in` row's `onSelect` runs
- **THEN** both calls landed on the one spy with identical arguments (`100`)
- **GIVEN** no `quality`/`stats` slot props
- **WHEN** the pill renders
- **THEN** no `◐`/`∿` chips exist and nothing throws

#### R4: Key bar visibility is a posture with palette parity
The key bar's visibility SHALL be a per-viewer posture `rk-gui-keybar` (`"0"` = hidden, absent =
shown; `readGuiKeyBarVisible()` / `writeGuiKeyBarVisible()` in `lib/gui-posture.ts`, the validated
read / try-catch-noop write discipline). `app.tsx` owns the state and threads `guiKeyBarVisible` +
`onGuiKeyBarVisibleChange` through `SurfaceLayout` to `GuiSurface`, which renders `GuiKeyBar` only
when coarse AND visible AND no credentials prompt. The palette gains the destination-only pair
`GUI: Hide key bar` / `GUI: Show key bar` (ids `gui-keybar-hide` / `gui-keybar-show`; tile open AND
coarse) — Constitution V: the pill's `⌨` needs a palette counterpart.

- **GIVEN** `localStorage["rk-gui-keybar"] === "0"` on a coarse viewer
- **WHEN** the tile renders
- **THEN** no `gui-keybar` element renders, and the palette offers `GUI: Show key bar`
- **GIVEN** the key absent
- **THEN** the bar renders (today's behavior) and the palette offers `GUI: Hide key bar`

#### R5: The pill is trackpad-layer chrome
The trackpad translation layer's chrome pass-through (`CHROME_SELECTOR` in
`src/components/gui-pointer.ts`) SHALL include the toolbar so taps on its chips are never swallowed
as canvas gestures.

- **GIVEN** trackpad mode attached, the pill shown
- **WHEN** a touchstart targets a pill chip
- **THEN** the layer does not `preventDefault`/`stopPropagation` it and enters no gesture state

### GUI tile: HiDPI

#### R6: `rk-gui-hidpi` posture and palette pair
`lib/gui-posture.ts` SHALL gain `readGuiHidpi(): boolean` (`"1"` = on, absent/other = off) and
`writeGuiHidpi(on)`. `app.tsx` owns `guiHidpi` state seeded from it and threads `guiHidpi` through
`SurfaceLayout` to `GuiSurface`. The palette gains the destination-only pair `GUI: HiDPI on` /
`GUI: HiDPI off` (ids `gui-hidpi-on` / `gui-hidpi-off`; tile open; `on` carries description
`render at device pixels — 1:1 is crisp on a Retina display`).

- **GIVEN** the key absent
- **WHEN** `readGuiHidpi()` runs
- **THEN** it returns `false`, and the palette offers `GUI: HiDPI on`
- **GIVEN** `GUI: HiDPI on` selected
- **THEN** `onHidpiChange(true)` fires, `rk-gui-hidpi` reads `"1"`, and the palette offers `GUI: HiDPI off`

#### R7: HiDPI is a client-side host-sizing rule
A pure `zoomedHostSize(fbW, fbH, zoom, devicePixelRatio)` in `lib/gui-posture.ts` SHALL return the
noVNC host div's CSS size: `undefined` at `fit` or when a framebuffer dimension is 0; otherwise
`{ width: fbW × zoom / (100 × dpr), height: fbH × zoom / (100 × dpr) }`. `GuiSurface` passes
`hidpi ? window.devicePixelRatio : 1` as `dpr`, so with HiDPI on a `100%` zoom renders one
framebuffer pixel per device pixel (crisp 1:1 on a Retina display). HiDPI MUST NOT alter
`resizeSession`, `gui.geometry`, or any request to the server — it changes the CSS size the canvas
is drawn at, nothing else. `fit` is unaffected (the fit scale is tile-bound).

- **GIVEN** fb 1920×1080, zoom 100, dpr 1
- **THEN** `{ width: 1920, height: 1080 }`
- **GIVEN** fb 1920×1080, zoom 100, dpr 2
- **THEN** `{ width: 960, height: 540 }`
- **GIVEN** fb 1920×1080, zoom 150, dpr 1.5
- **THEN** `{ width: 1920, height: 1080 }`
- **GIVEN** zoom `fit`, any dpr
- **THEN** `undefined`

### GUI tile: Send key

#### R8: Chord grammar and the five suggestions
`src/lib/gui-send-key.ts` (new) SHALL export `SUGGESTED_CHORDS = ["Ctrl+Alt+Del", "Ctrl+Alt+T",
"Alt+F4", "Super", "Print"]`, `parseKeyChord(text): KeyChord | null` accepting `+`-joined tokens,
case-insensitive, with modifiers `Ctrl`/`Control`, `Alt`, `Shift`, `Super`/`Win`/`Meta`, and a final
key from: `Del`/`Delete`, `F1`–`F12`, `Print`/`PrtSc`, `Esc`/`Escape`, `Tab`, `Enter`/`Return`,
`Space`, `Backspace`, arrows, or a single printable character (via `keysymForChar`); a chord of
modifiers only (`Super`) is valid (the modifier is pressed and released). `sendKeyChord(sendKey,
chord)` SHALL emit modifier downs in order, the key's press+release (`sendKey(keysym, code)` with
`down` undefined), then modifier ups in reverse — the `composeChord` ordering. New keysyms
(`KEYSYM_DELETE 0xffff`, `KEYSYM_F1..F12 0xffbe..0xffc9`, `KEYSYM_SUPER_L 0xffeb`,
`KEYSYM_PRINT 0xff61`, `KEYSYM_SPACE 0x20`) live in `lib/gui-keysyms.ts`.

- **GIVEN** `"Ctrl+Alt+Del"` and a `sendKey` spy
- **WHEN** parsed and sent
- **THEN** calls are `(Control_L, "ControlLeft", true)`, `(Alt_L, "AltLeft", true)`, `(Delete, "Delete")`, `(Alt_L, "AltLeft", false)`, `(Control_L, "ControlLeft", false)`
- **GIVEN** `"Alt+F4"` → `Alt_L` down, `F4` press+release, `Alt_L` up; `"Super"` → `Super_L` press+release; `"Print"` → `Print` press+release; `"Ctrl+Alt+T"` → `Control_L`, `Alt_L`, `t` (keysym 0x74), ups
- **GIVEN** `"Ctrl+"`, `"Foo+Bar"`, `""`
- **THEN** `parseKeyChord` returns `null`

#### R9: The prompt reuses the one-field shape
`src/components/gui-send-key-prompt.tsx` (new) SHALL follow `GuiGeometryPrompt`'s shape (`Dialog`
title `Send key`, one text input with live validation, a submit button, Escape/backdrop close),
plus a row of five `Control variant="chip"` quick-picks labeled with `SUGGESTED_CHORDS` — tapping
one submits that chord immediately. The input placeholder is `Ctrl+Alt+F4`; an unparseable
non-empty value shows an inline error and disables `Send`; Enter submits when valid.
`onSubmit(chord: KeyChord)` receives the parsed chord; the caller owns sending and closing. It is
lazy-loaded from `app.tsx` like `GuiGeometryPrompt`.

- **GIVEN** the prompt open
- **WHEN** the `Alt+F4` chip is clicked
- **THEN** `onSubmit` receives the parsed `Alt+F4` chord
- **GIVEN** `Ctrl+Alt+Del` typed and Enter pressed
- **THEN** `onSubmit` receives that chord
- **GIVEN** `Ctrl+` typed
- **THEN** an inline error shows and `Send` is disabled

#### R10: Viewer-side send with the mirror refusal
`GuiSurfaceCommands` SHALL gain `sendKey(keysym, code, down?)` bound to the live RFB (a no-op
without one). The palette gains `GUI: Send key…` (id `gui-send-key`; tile open AND connected — the
`GUI: Paste clipboard` gate), which opens the prompt. On submit `app.tsx` SHALL: if the host
signal's `backend === "screen-sharing"`, toast `GUI_SEND_KEY_MIRROR_REFUSAL` (`"gui send key is not
supported on macOS in v1 — the GUI mirrors your live session view-only"`, the backend's
`gui <verb> is not supported…` template with verb `send key`) as an error and send nothing;
otherwise run `sendKeyChord(guiCommandsRef.current.sendKey, chord)`. No server round trip exists.

- **GIVEN** backend `Xtigervnc`, connected, chord `Alt+F4` submitted
- **THEN** the RFB's `sendKey` receives the R8 sequence and no fetch occurs
- **GIVEN** backend `screen-sharing`
- **WHEN** a chord is submitted
- **THEN** the refusal toast shows and `sendKey` is never called

### Docs and bookkeeping

#### R11: Spec and parent-plan bookkeeping
`docs/specs/gui.md` § The tile SHALL gain a subsection `### The toolbar pill, HiDPI, and Send key`
covering the two-context rule and auto-hide, the mirror-of-palette rule (Constitution V), the
`rk-gui-hidpi` rendering-only semantics (and that under a fixed geometry it moves no bytes — the
crisp Retina workflow is a larger `GUI: Resolution →` preset plus HiDPI on at 1:1), the key bar
posture, and Send key's chord list, viewer-side mechanism, and the mirror refusal. The ergonomics
plan's § Change breakdown V4 row SHALL carry this change's folder (status `in progress`), V1/V2
rows read `Done` with PRs #919 / #931, and the combined plan's § Queue S7 row carries `t2lv` +
the folder. The § Done-means items assigned to earlier stages are VERIFIED, not re-edited:
§ Resize policy reads the `auto` form, § Switching desktops exists, `docs/site/skill/gui.md` ≤ 150
lines (the `skill_test.go` guard) — nothing in `docs/site/` changes (no CLI surface changes).

- **GIVEN** the docs task complete
- **THEN** `grep -c "" docs/site/skill/gui.md` ≤ 150 and the spec subsection exists

### Non-Goals
- Quality (`◐`) and stats (`∿`) behavior — S6 owns them; this change leaves optional slots only.
- Any server-side change: no route, stream field, Go type, or `gui.geometry` write. HiDPI never drives `SetDesktopSize`, even under `auto`.
- A persistent (non-auto-hiding) toolbar, or one on fine-pointer non-fullscreen viewers (V-D10).
- A real-rig Playwright fullscreen test — headless Chromium cannot enter element fullscreen from a scripted gesture; fullscreen visibility is unit-tested via `document.fullscreenElement`.

### Design Decisions

#### HiDPI sizes the host div by devicePixelRatio; it never touches the framebuffer
**Decision**: `rk-gui-hidpi` divides the percentage-zoom host CSS size by `devicePixelRatio`, so `100%` maps one framebuffer pixel to one device pixel; `fit` and every server-facing value are untouched.
**Why**: noVNC owns the canvas backing store (`canvas.width` = framebuffer width) and resets it on every resize, so a fight over backing pixels is unwinnable; device-pixel-exact CSS sizing is the one client-only lever that yields crisp text at 1:1 on a 2× display. V-D12 asks for exactly that and forbids changing the desktop size.
**Rejected**: `image-rendering: pixelated` (blocky, not crisp); requesting `tile × dpr` as the desktop under `auto` (changes the server-side size — forbidden by the intake's Assumption 2).
*Introduced by*: 260910-t2lv-gui-toolbar-keybar-hidpi-sendkey

#### The pill is presentational; the tile owns its context, app.tsx owns every action
**Decision**: `GuiToolbar` receives `zoom`/`pointerMode`/`coarsePointer`/`fullscreen`/`keyBarVisible`, a `revealSignal` counter, and the SAME callbacks `buildGuiActions` receives; `GuiSurface` decides the context (coarse or its wrapper is fullscreen) and bumps the signal on tap / edge-hover; `app.tsx` threads its existing handlers down through `SurfaceLayout`.
**Why**: Constitution V — the palette is the complete action registry; a control that shares the callback object cannot drift from its row. A counter prop keeps the auto-hide machine unit-testable with fake timers.
**Rejected**: building the pill's rows from `buildGuiActions` output (its labels/ids are palette-shaped, and its gating omits rows instead of disabling chips).
*Introduced by*: 260910-t2lv-gui-toolbar-keybar-hidpi-sendkey

#### Send key refuses on the mirror in the frontend, with the backend's wording
**Decision**: the refusal is a frontend constant in the backend's `gui <verb> is not supported on macOS in v1 — the GUI mirrors your live session view-only` template (verb `send key`), toasted at submit.
**Why**: the send is viewer-side (no route to answer 409), and the relay silently drops input on the mirror — a silent no-op would leave the user guessing; the shared template keeps one refusal vocabulary.
**Rejected**: hiding the row on the mirror (the user would not learn why the feature is absent).
*Introduced by*: 260910-t2lv-gui-toolbar-keybar-hidpi-sendkey

## Tasks

### Phase 1: Setup

- [x] T001 Run `just setup` in this worktree (fresh — no `app/frontend/node_modules`); confirm `just test-frontend` runs green before any edit <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 [P] `app/frontend/src/lib/gui-posture.ts`: add `rk-gui-hidpi` (`readGuiHidpi`/`writeGuiHidpi`), `rk-gui-keybar` (`readGuiKeyBarVisible`/`writeGuiKeyBarVisible`, `"0"` = hidden), and pure `zoomedHostSize(fbW, fbH, zoom, dpr)`; update the header doc; tests in `gui-posture.test.ts` for defaults, round-trips, and the dpr 1 / 2 / 1.5 + `fit` table <!-- R4 R6 R7 -->
- [x] T003 [P] `app/frontend/src/lib/gui-keysyms.ts` + `src/lib/gui-send-key.ts` (new): the new keysym constants, `SUGGESTED_CHORDS`, `KeyChord`, `parseKeyChord`, `sendKeyChord`, `GUI_SEND_KEY_MIRROR_REFUSAL`; `gui-send-key.test.ts` covering the five suggestions' exact `sendKey` sequences, free-typed parsing (`Ctrl+Alt+F4`, case-insensitivity, single characters), and the null cases <!-- R8 R10 -->
- [x] T004 `app/frontend/src/components/gui-toolbar.tsx` (new): `GuiToolbar` per R2/R3 — `TOOLBAR_HIDE_MS`/`TOOLBAR_REVEAL_EDGE_PX` constants, `revealSignal` + internal timer, chips via `Control variant="chip"`, optional `quality`/`stats` slots, `data-testid="gui-toolbar"`, absolute top-center `z-20`, font-mono; `gui-toolbar.test.tsx`: shown on mount → hidden after 3000 ms (fake timers), a `revealSignal` bump re-shows and restarts, chip interaction restarts, the shared-spy identity test against `buildGuiActions` for `+`/`−`/`fit`/`⌖`/`⌨`/`⤢`, gating (`+` disabled at 200, `⌖`/`⌨` absent on fine, `⤢` absent when not fullscreen, `◐`/`∿` absent without slots) <!-- R2 R3 -->
- [x] T005 `app/frontend/src/components/gui-surface.tsx`: new props `hidpi`, `keyBarVisible`, `onPointerModeChange`, `onKeyBarVisibleChange`, `onFullscreen`; track `fullscreen` via a `fullscreenchange` listener (`document.fullscreenElement === wrapperRef.current`); `revealSignal` state bumped from the existing `onPointerDownCapture` and a new `onPointerMove` top-edge check while fullscreen; render `GuiToolbar` when `coarsePointer || fullscreen` (canvas branch, not during credentials); gate `GuiKeyBar` on `keyBarVisible`; `hostStyle` via `zoomedHostSize(..., hidpi ? window.devicePixelRatio : 1)`; `GuiSurfaceCommands.sendKey`; header doc updated. Tests in `gui-surface.test.tsx`: two-context rule (fine+not-fullscreen ⇒ none; coarse ⇒ pill; fine + mocked `fullscreenElement` ⇒ pill), key bar hidden when `keyBarVisible=false`, host size with `hidpi` and a stubbed `devicePixelRatio` 2, `commandsRef.sendKey` reaching the fake RFB <!-- R1 R2 R4 R7 R10 -->
- [x] T006 [P] `app/frontend/src/components/gui-pointer.ts`: add `[data-testid="gui-toolbar"]` to `CHROME_SELECTOR`; a `gui-pointer.test.ts` case proving a touchstart targeted inside the toolbar is passed through <!-- R5 -->
- [x] T007 [P] `app/frontend/src/components/gui-send-key-prompt.tsx` (new, lazy like `GuiGeometryPrompt`): the `Send key` dialog per R9; `gui-send-key-prompt.test.tsx`: chip click submits the parsed chord, typed + Enter submits, invalid input shows the error and disables `Send`, Escape closes <!-- R9 -->
- [x] T008 `app/frontend/src/lib/palette/gui.ts`: input gains `hidpi`, `keyBarVisible`, `onHidpiChange`, `onKeyBarVisibleChange`, `onSendKey`; rows `GUI: HiDPI on/off` (tile open, destination-only), `GUI: Hide/Show key bar` (tile open AND coarse), `GUI: Send key…` (tile open AND connected); header doc rows; `palette/gui.test.ts` cases for gating and `onSelect` routing <!-- R4 R6 R10 -->

### Phase 3: Integration & Edge Cases

- [x] T009 `app/frontend/src/app.tsx`: `guiHidpi`/`guiKeyBarVisible` state seeded from the postures with write-through handlers; `guiSendKeyOpen` state + the lazy `GuiSendKeyPrompt` mount whose submit applies the R10 mirror refusal or `sendKeyChord(guiCommandsRef.current?.sendKey…)`; pass the new `buildGuiActions` inputs; thread `guiHidpi`, `guiKeyBarVisible`, `onGuiPointerModeChange={handleGuiPointerModeChange}`, `onGuiKeyBarVisibleChange`, `onGuiFullscreen={guiFullscreen}` into `SurfaceLayout` <!-- R3 R4 R6 R10 -->
- [x] T010 `app/frontend/src/components/surface-layout.tsx`: declare and forward the five new gui props (`guiHidpi`, `guiKeyBarVisible`, `onGuiPointerModeChange`, `onGuiKeyBarVisibleChange`, `onGuiFullscreen`) into `GuiSurface` with safe defaults (`false`/`true`/noop) — the same optional-prop grammar `guiPointerMode`/`onGuiZoomChange` use <!-- R3 R4 R6 -->
- [x] T011 `app/frontend/tests/e2e/gui-surface.spec.ts` mobile fork (375 px, `hasTouch`): (a) the pill shows after the tile opens, is gone within ~5 s, and a tap on the noVNC host brings it back; (b) tapping the pill's `Zoom in` chip reads `100%` on `gui-zoom-badge` (the RFB-mock-free observable the existing zoom tests use). Intent comments per Constitution § Test Intent Comments; update the spec's file-header comment. Run `just test-e2e "e2e/gui-surface"` <!-- R2 R3 -->
- [x] T012 Gates: `just test-frontend`, `cd app/frontend && npx tsc --noEmit`, `just test-e2e "e2e/gui-surface"`, then `just test` (see Notes for the known environmental specs) <!-- R1 -->

### Phase 4: Polish

- [x] T013 [P] `docs/specs/gui.md` § The tile: add `### The toolbar pill, HiDPI, and Send key` per R11 (cite V-D10/V-D12/V-D13 as the design log) <!-- R11 -->
- [x] T014 [P] Bookkeeping: ergonomics plan § Change breakdown — V4 row folder `260910-t2lv-gui-toolbar-keybar-hidpi-sendkey`, status `in progress`; V1 → `Done`, PR #919; V2 → `Done`, PR #931; refresh the `**Status (…)**` line; combined plan § Queue S7 row → `t2lv` + folder. Verify (no edit) § Resize policy's `auto` form, § Switching desktops, and `docs/site/skill/gui.md` ≤ 150 lines <!-- R11 -->

## Execution Order

- T001 blocks everything (no `node_modules` before it)
- T002, T003 block T004/T005/T007/T008 (types and helpers)
- T004 blocks T005 (the surface mounts the pill); T005 + T008 block T009; T009 and T010 land together (the threading is one type change)
- T011 needs T009/T010 (the pill must reach the real tile); T012 last in Phase 3

## Acceptance

### Functional Completeness

- [x] A-001 R1: `GuiToolbar` renders for coarse or fullscreen viewers only; fine + not-fullscreen renders none; never in empty/credentials states
- [x] A-002 R2: the pill shows on mount/tap/top-edge hover and hides 3000 ms after the last reveal or interaction (constants named, not literals)
- [x] A-003 R3: every pill control calls the identical callback its palette row calls; `◐`/`∿` are absent without slots; gating matches the palette's destination rules
- [x] A-004 R4: `rk-gui-keybar` posture, `GuiKeyBar` gated on it, and the `GUI: Hide/Show key bar` palette pair exist
- [x] A-005 R5: `CHROME_SELECTOR` includes the toolbar
- [x] A-006 R6: `rk-gui-hidpi` posture and the `GUI: HiDPI on/off` pair exist with the stated description
- [x] A-007 R7: `zoomedHostSize` matches the dpr 1 / 2 / 1.5 / `fit` table and `GuiSurface` uses it with `devicePixelRatio` only when `hidpi`
- [x] A-008 R8: `parseKeyChord`/`sendKeyChord` produce the exact sequences for all five suggestions; invalid chords return `null`
- [x] A-009 R9: the prompt has five quick-pick chips, live validation, Enter submit, Escape close
- [x] A-010 R10: `GUI: Send key…` gated on tile open AND connected; `GuiSurfaceCommands.sendKey` exists; the mirror refusal toasts the exact string and sends nothing
- [x] A-011 R11: spec subsection added; V4/S7 rows filled; V1/V2 rows Done with PR numbers; skill page ≤ 150 lines untouched

### Behavioral Correctness

- [x] A-012 R7: `resizeSession` truth table is unchanged by `hidpi` (no new clause); no `resizeGui`/settings POST is reachable from HiDPI or Send key
- [x] A-013 R4: with `rk-gui-keybar` absent the key bar renders exactly as before this change (default shown)

### Scenario Coverage

- [x] A-014 R2 R3: e2e mobile — pill visible after open, hidden within ~5 s, tap re-shows; `Zoom in` chip moves the badge to `100%`
- [x] A-015 R3: vitest shared-spy identity test covers `+`, `−`, `fit`, `⌖`, `⌨`, `⤢`
- [x] A-016 R1: vitest fullscreen case mocks `document.fullscreenElement` to the wrapper and asserts the pill on a fine pointer

### Edge Cases & Error Handling

- [x] A-017 R10: `sendKey` without a live RFB is a no-op (no throw)
- [x] A-018 R8: a modifiers-only chord (`Super`) presses and releases the modifier; `Ctrl+` and unknown tokens are rejected
- [x] A-019 R7: `zoomedHostSize` returns `undefined` when `fbW` or `fbH` is 0

### Code Quality

- [x] A-020 Pattern consistency: new components follow `gui-keybar.tsx`/`gui-geometry-prompt.tsx` conventions (header doc stating constraints, `Control` chips, `Dialog` shell, lazy import in app.tsx)
- [x] A-021 No unnecessary duplication: the pill reuses `stepGuiZoom`, `Control`, and the palette callbacks; the prompt reuses `Dialog`/`controlClass`/`INPUT_*`; chord sending reuses the `composeChord` ordering rather than a second latch machine
- [x] A-022 Type narrowing over assertions; no `as` casts introduced beyond test fixtures
- [x] A-023 Named constants for 3000 ms, 24 px, keysyms, the refusal string, the posture keys
- [x] A-024 Comments state constraints (why the pill is chrome for the trackpad layer, why HiDPI divides CSS size), never narrate or cite change IDs
- [x] A-025 New `test()`s in `gui-surface.spec.ts` carry Proves/Steps JSDoc and the file header names the new fixtures/behaviors
- [x] A-026 Vitest colocated `*.test.ts(x)` for every new module; `tsc --noEmit` clean

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- **Manual acceptance (from the plan, not automatable here)**: laptop fullscreen top-edge hover shows the pill and `⤢` exits; phone `−`/`+` step zoom; `Alt+F4` from Send key closes the focused IceWM window; HiDPI on a dpr-2 laptop renders 1:1 crisp. The Mbit/s doubling line depends on S6's stats overlay and a larger desktop preset — documented in the spec, not asserted.
- **Known environmental e2e reds in long-named worktrees** (the 64-char server cap): `boards-multi-server`, `create-server-waiting`, `legacy-*-sweep`, `multi-server-sidebar`, `protected-kill-confirm`, plus a `status-bar` flake that passes standalone. The per-spec gate is `just test-e2e "e2e/gui-surface"`; do not stash the working tree to prove pre-existing failures.
- `just test-e2e` takes one spec filter per run, `"e2e/<spec>"` form.

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The one replaced block (the inline `hostStyle` computation in `gui-surface.tsx`) was deleted in place when `zoomedHostSize` took it over; `composeChord`'s down/press/up ordering is mirrored, not duplicated-and-stranded (its latch-map shape cannot serve a parsed chord).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | HiDPI = host CSS size ÷ `devicePixelRatio` at percentage zooms (device-pixel-exact 1:1), `fit` unaffected, no server-facing change | V-D12 wants a crisp 1:1 on Retina and forbids changing the desktop size; noVNC owns the canvas backing store, so CSS sizing is the only client-only lever; the intake's "backing store at DPR" phrasing describes the same visible outcome | S:65 R:85 A:80 D:65 |
| 2 | Certain | Quality/stats pill controls are optional slots rendered only when a handler is supplied; S6 is not on main so they are hidden | Intake Assumption 4 and the S6 check (`rk-gui-quality` absent from `gui-posture.ts`) | S:85 R:90 A:90 D:85 |
| 3 | Confident | Key bar visibility becomes a posture (`rk-gui-keybar`) with a `GUI: Hide/Show key bar` palette pair | Constitution V requires a palette counterpart for the pill's `⌨`; the intake's "two new rows" count predates noticing that gap | S:60 R:85 A:85 D:70 |
| 4 | Confident | No existing hover-reveal exists (fullscreen exits via the verb/Esc), so the pill implements a 24 px top-edge pointermove reveal itself | Intake Assumption 7 resolved by reading `app.tsx`'s `guiFullscreen` — there is no reveal affordance to reuse | S:60 R:85 A:80 D:70 |
| 5 | Confident | The mirror refusal is a frontend constant in the backend's `gui <verb> is not supported on macOS in v1 — the GUI mirrors your live session view-only` template | The frontend has no such message today (input is silently dropped by the relay filter); the backend's template is the "existing mirror view-only message" the intake names | S:60 R:85 A:80 D:65 |
| 6 | Certain | The pill is chrome for the trackpad layer (`CHROME_SELECTOR`) | Otherwise trackpad mode swallows chip taps — the key bar precedent | S:85 R:90 A:95 D:90 |
| 7 | Confident | `⤢` calls the same `guiFullscreen` toggle verb as `GUI: Fullscreen` (exits when fullscreen) rather than a separate exit handler | R3's identical-callback rule; the verb already branches on `document.fullscreenElement` | S:70 R:90 A:85 D:75 |
| 8 | Confident | The pill shows once on mount, then hides — so a phone user discovers it without knowing to tap | V-D10 says "shown on tap or on hover"; an initial reveal is the cheapest discovery path and costs nothing after 3 s | S:55 R:90 A:75 D:60 |
| 9 | Certain | No real-rig fullscreen e2e; fullscreen visibility is unit-tested via a mocked `fullscreenElement` | Headless Chromium cannot enter element fullscreen from Playwright without a trusted gesture | S:80 R:90 A:90 D:85 |

9 assumptions (3 certain, 6 confident, 0 tentative).
