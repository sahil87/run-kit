# Intake: Web Tile Continuous Gesture Zoom

**Change**: 260824-iafo-web-tile-continuous-gesture-zoom
**Created**: 2026-08-24

## Origin

Direct user feedback on the just-merged 260823-cwvv change (PR #729, archived): "The zoom action on the web tile cannot be quantized like the shortcut (Cmd+ or + click based zoom). That has to be continuous like what happens on Chrome and literally all other apps on macOS."

Shipped state being corrected (from cwvv): the web tile's pinch / Ctrl+wheel gestures feed `lib/zoom-gesture.ts`'s threshold accumulator (50 accumulated delta per step) and step the discrete `WEB_ZOOM_LEVELS` ladder — the same quantized ladder the +/− buttons and palette actions use. Real pinch zoom in Chrome/macOS is continuous: the scale tracks the fingers smoothly and lands on arbitrary values; only shortcut/click zoom is stepped.

## Why

1. **Pain point**: a trackpad pinch on the web tile visibly "clicks" between ladder levels (100 → 110 → 125 …) instead of tracking the gesture. Every macOS app the user compares against (Chrome, Safari, Preview, Figma) scales continuously under pinch; the quantized gesture feels broken, not deliberate.
2. **Consequence of not fixing**: the flagship gesture trigger shipped in cwvv reads as a downgrade from native behavior — users pinch, see stutter, and fall back to the buttons.
3. **Why this approach**: split the trigger semantics — gestures write a continuous zoom factor (multiplicative, exponential in wheel delta — the Chrome mapping); buttons and palette keep the discrete ladder (that is exactly how browsers behave: pinch = continuous, Cmd+± = stepped). The shipped `stepWebZoom` already snaps an off-ladder value to the nearest level before stepping, so the two trigger families compose without new logic.

## What Changes

### 1. Continuous gesture arm (`app/frontend/src/lib/zoom-gesture.ts`)

Add a pure continuous mapping beside the existing threshold accumulator (which stays for the terminal's integer font steps):

- **Wheel**: `applyWheelZoom(current, deltaY) = clamp(current * Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY), WEB_ZOOM_MIN, WEB_ZOOM_MAX)` with `WHEEL_ZOOM_SENSITIVITY = 0.01` (the Chrome-like exponential mapping — equal deltas multiply equally, so zoom feels symmetric in and out).
- **Safari gestures**: `gesturestart` captures `base = current`; `gesturechange` sets `clamp(base * e.scale, …)` (the event's `scale` is already relative to gesture start — no accumulator).
- Bounds: `WEB_ZOOM_MIN = 0.5`, `WEB_ZOOM_MAX = 3` (the shipped ladder's ends, exported from `lib/web-zoom.ts` or derived from `WEB_ZOOM_LEVELS`).
- The terminal tile is UNTOUCHED: its ctrl-wheel keeps the threshold accumulator (font size is inherently integer-stepped 8–24; user scoped this feedback to the web tile).

### 2. Web tile wiring (`app/frontend/src/components/iframe-window.tsx`)

- The gesture handlers (same-origin `contentWindow` + tile wrapper, shipped in cwvv) switch from "accumulate → step ladder" to the continuous mapping — zoom updates on every wheel/gesture event so the frame tracks the pinch.
- Buttons, palette actions, and the `web-zoom` CustomEvent keep the quantized ladder path (`stepWebZoom`), which snaps a continuous value to the nearest level first (already shipped behavior — verify with a unit test rather than new code).
- The percent readout displays the live rounded value during a gesture (e.g. 137%).
- Reset (button/palette) still returns exactly to 1.

### 3. Persistence (`app/frontend/src/lib/web-zoom.ts`)

- The `runkit-web-zoom` bucket map stores the continuous float (round to 2 decimals on write; the exact-1 removal rule stays).
- Gestures emit many events — persistence MUST NOT write localStorage per event: debounce trailing (~250ms) or write on gesture end (`gestureend` / wheel quiescence), in the event-handler layer (the StrictMode-safe pattern from the cwvv Copilot fix — never inside a `setState` functional updater).
- `stepWebZoom`'s off-ladder snap already handles reading a continuous stored value into the button path; the scale wrapper consumes the float directly.

### Constraints

- No behavior change to: terminal gestures/font stepping, the button/palette ladder semantics, the onboarding-state control absence, the external-kind gesture degradation, key bindings (Cmd/Ctrl+±/0 stay shell-owned).
- Constitution IV/V unchanged (per-viewer localStorage; palette entries already exist).
- Tests: unit coverage for the continuous mapping + persistence debounce; update the shipped `web-tile-zoom.spec.ts` e2e (+ `.spec.md` same-commit) where gesture quantization was asserted; companion-doc rule applies.

### Explicit exclusions

- Terminal-tile continuous zoom (font size stays stepped).
- Rubber-banding past the clamp bounds, momentum/inertia effects.
- Any change to shortcut/click zoom semantics — quantized is correct there by platform convention.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) the Iframe Window content-zoom paragraph — gesture arm becomes continuous (exponential wheel mapping, gesturechange scale, debounced persistence); button/palette arm stays laddered.
- `run-kit/ui/terminal`: (verify only) its gesture paragraph already scopes the accumulator to the font path — expected unchanged.

## Impact

- `app/frontend/src/lib/zoom-gesture.ts` + test — new continuous helpers beside the accumulator.
- `app/frontend/src/lib/web-zoom.ts` + test — bounds export, float rounding on write.
- `app/frontend/src/components/iframe-window.tsx` + test — handler switch, live readout, debounced persist.
- `app/frontend/tests/e2e/web-tile-zoom.spec.ts` + `.spec.md` — gesture assertions updated for continuous semantics.
- No backend, no API, no new storage keys.

## Open Questions

None — trigger-family split (gesture continuous, shortcut/click quantized) is the user's explicit directive and platform convention.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Gestures (pinch / Ctrl+wheel) become continuous on the web tile; buttons + palette keep the quantized ladder | User's explicit directive, mirroring Chrome/macOS convention (pinch continuous, Cmd+± stepped) | S:95 R:80 A:90 D:90 |
| 2 | Certain | Terminal tile untouched — font stepping keeps the threshold accumulator | User scoped the feedback to the web tile; font size is inherently integer-stepped | S:90 R:85 A:90 D:90 |
| 3 | Confident | Wheel mapping `s *= exp(-deltaY * 0.01)`, clamped to [0.5, 3] (ladder ends); Safari `gesturechange` uses `base * e.scale` | Chrome-like exponential mapping; isolated named constants, trivially tunable | S:60 R:90 A:80 D:75 |
| 4 | Confident | Persistence writes are debounced (~250ms trailing or gesture-end), storing the float rounded to 2 decimals; exact-1 removal stays | Per-event localStorage writes are waste; handler-side persistence per the cwvv StrictMode fix | S:55 R:90 A:85 D:75 |
| 5 | Confident | Button/palette stepping from a continuous value relies on `stepWebZoom`'s existing nearest-level snap (verified by test, no new code) | Shipped in cwvv (plan R3); composing the two arms was designed in | S:65 R:85 A:85 D:80 |

5 assumptions (2 certain, 3 confident, 0 tentative, 0 unresolved).
