# Plan: Web Tile Continuous Gesture Zoom

**Change**: 260824-iafo-web-tile-continuous-gesture-zoom
**Intake**: `intake.md`

## Requirements

### Web tile: gesture zoom becomes continuous

#### R1: Continuous mapping helpers in `zoom-gesture.ts`
`app/frontend/src/lib/zoom-gesture.ts` SHALL gain a continuous arm beside the existing step accumulator (which stays, unchanged, for the terminal's integer font steps): `WHEEL_ZOOM_SENSITIVITY = 0.01` and `applyWheelZoom(current, deltaY, min, max)` returning `clamp(current * Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY), min, max)` (wheel/pinch up = negative deltaY = zoom in, matching the accumulator's convention). Safari's continuous arm needs no module state: `gesturechange` scale is cumulative from `gesturestart`, so the component computes `clamp(base * scale)` directly — the module MAY export only a shared `clampZoom(v, min, max)` if useful. Pure, DOM-free, colocated tests.

- **GIVEN** current zoom 1.0 and two wheel events of deltaY −35 each
- **WHEN** both feed `applyWheelZoom`
- **THEN** zoom is precisely `1 * e^0.35 * e^0.35 ≈ 2.014` (clamped to ≤ 3), with NO intermediate quantization at any step

#### R2: `web-zoom.ts` stores and reads continuous floats
`app/frontend/src/lib/web-zoom.ts` SHALL export `WEB_ZOOM_MIN = 0.5` / `WEB_ZOOM_MAX = 3` (the ladder ends, derived from `WEB_ZOOM_LEVELS`). `readWebZoom` SHALL STOP snapping stored values to the nearest ladder level — a stored float returns as-is, clamped to `[WEB_ZOOM_MIN, WEB_ZOOM_MAX]` (continuous is now a legitimate stored state); absent/unreadable still returns `WEB_ZOOM_DEFAULT`. `writeWebZoom` SHALL round the level to 2 decimals before storing; a value that rounds to exactly `1` removes the entry (the sparse-map rule survives float noise like 0.9999). `stepWebZoom` is UNCHANGED — its nearest-level snap is now the load-bearing bridge from a continuous gesture value to the button/palette ladder.

- **GIVEN** `runkit-web-zoom` holds `{"proxy:3000": 1.37}`
- **WHEN** the tile seeds via `readWebZoom("proxy:3000")`
- **THEN** zoom is exactly 1.37 (not snapped to 1.25/1.5), and a subsequent `+` click steps to 1.5 (snap 1.37→1.25? no — nearest of 1.37 is 1.25 vs 1.5: |1.37−1.25|=0.12 < |1.5−1.37|=0.13 → snaps 1.25, steps to 1.5)

#### R3: `iframe-window.tsx` gestures apply the continuous factor per event
The web tile's gesture wiring (`wireGestureListeners`) SHALL replace the step accumulator with the continuous mapping: each ctrl/meta-wheel event sets `zoom = applyWheelZoom(zoomRef.current, deltaY, MIN, MAX)`; `gesturestart` captures `gestureBaseRef = zoomRef.current`; each `gesturechange` sets `zoom = clamp(gestureBaseRef * scale)`. The frame scales on EVERY event (continuous tracking — no thresholds, no ladder). The interception predicate is unchanged (only ctrl/meta wheel + `gesture*`; everything else passes through), as are the two attach targets (tile wrapper + same-origin frame document) and the external-kind degradation. Buttons, palette (`WEB_ZOOM_EVENT`), and reset keep the quantized `stepWebZoom` path via the existing `applyZoom` — quantized-by-convention for click/shortcut zoom. The percent readout SHALL display the live rounded value (e.g. 137%) during gestures.

- **GIVEN** a same-origin page at 100%
- **WHEN** the user pinches out slowly
- **THEN** the frame scales smoothly through arbitrary values (109%, 113%, 118% …) tracking the gesture, never clicking between ladder stops
- **AND** a `+` button click from 137% lands on a ladder level (1.5)

#### R4: Debounced gesture persistence
Gesture-driven zoom changes SHALL NOT write localStorage per event: a trailing debounce (~250ms, named constant) in the handler layer persists `writeWebZoom(bucket, zoomRef.current)` after gesture quiescence; the pending write is FLUSHED (not dropped) on unmount and on bucket change (the re-seed effect). Button/palette/reset writes stay immediate (already handler-side per the cwvv StrictMode fix — persistence never runs inside a `setState` functional updater).

- **GIVEN** a pinch producing 40 gesturechange events in 1s
- **WHEN** the gesture ends
- **THEN** localStorage was written at most a handful of times (trailing debounce), the final value matches the on-screen zoom, and navigating away mid-debounce still persists it

### Non-Goals

- Terminal-tile gesture behavior — the font accumulator stays (integer steps 8–24; feedback scoped to the web tile).
- Any change to button/palette/reset semantics (quantized is platform-correct for click/shortcut zoom).
- Momentum/inertia or rubber-banding past the [0.5, 3] clamp.

### Design Decisions

#### Exponential wheel mapping, direct scale for Safari
**Decision**: `s *= exp(-deltaY * 0.01)` per wheel event; `s = base * e.scale` per gesturechange.
**Why**: exponential mapping makes equal deltas multiply equally (symmetric in/out feel — the Chrome mapping); Safari's cumulative `scale` IS the continuous factor, needing only a base capture.
**Rejected**: shrinking the step ladder (finer quantization) — still visibly clicks; linear `s += k*deltaY` — asymmetric feel, zoom-out crawls near the low bound.
*Introduced by*: 260824-iafo-web-tile-continuous-gesture-zoom

#### Read returns the float; only stepping snaps
**Decision**: `readWebZoom` returns the stored float clamped to bounds; the ladder snap lives solely in `stepWebZoom`.
**Why**: a reload must restore the gesture-set value exactly; snapping belongs to the one path that needs a ladder index (button/palette stepping).
**Rejected**: keeping read-time snapping — a 137% pinch would reload as 125%, silently moving the user's zoom.
*Introduced by*: 260824-iafo-web-tile-continuous-gesture-zoom

## Tasks

### Phase 1: Pure modules

- [x] T001 [P] `app/frontend/src/lib/zoom-gesture.ts` + `zoom-gesture.test.ts`: add `WHEEL_ZOOM_SENSITIVITY`, `applyWheelZoom(current, deltaY, min, max)` (+ `clampZoom` if shared); accumulator/gesture-arm exports untouched; tests for mapping symmetry, clamping, sign convention <!-- R1 -->
- [x] T002 [P] `app/frontend/src/lib/web-zoom.ts` + `web-zoom.test.ts`: export `WEB_ZOOM_MIN`/`WEB_ZOOM_MAX`; `readWebZoom` clamps instead of snapping; `writeWebZoom` rounds to 2 decimals with round-to-1 removal; update read-snap tests, add float round-trip tests; `stepWebZoom` snap-from-float behavior pinned by test <!-- R2 -->

### Phase 2: Component wiring

- [x] T003 `app/frontend/src/components/iframe-window.tsx`: continuous wheel/gesture handlers (`gestureBaseRef` capture, per-event apply via a new `applyZoomFactor(next)`), trailing-debounce persistence with unmount/bucket-change flush, live readout; buttons/palette/reset unchanged on `applyZoom` <!-- R3, R4 -->

### Phase 3: Tests & gates

- [x] T004 Component unit tests (`iframe-window` zoom block): continuous wheel event applies exp mapping (no quantization), gesturestart/change base math, debounce-single-write + flush-on-unmount, button-from-float snap+step; update any test asserting stepped gestures <!-- R1, R3, R4 -->
- [x] T005 e2e `web-tile-zoom.spec.ts` + `.spec.md`: update/extend the gesture case for continuous semantics (dispatch ctrl-wheel into the frame, assert an off-ladder readout/transform; button click from off-ladder lands on-ladder); run gates — `npx tsc --noEmit`, `just test-frontend`, `just test-e2e web-tile-zoom` <!-- R1-R4 -->

## Execution Order

- T001, T002 independent [P]; both block T003; T004–T005 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `applyWheelZoom` exists, exponential, clamped, sign-correct; accumulator exports untouched — verified `zoom-gesture.ts:43-61` + colocated tests (symmetry, clamping, sign); `createWheelAccumulator`/`createGestureArm` unchanged and still consumed by `terminal-client.tsx`
- [x] A-002 R2: bounds exported; read returns clamped float (no snap); write rounds to 2 decimals with round-to-1 removal; `stepWebZoom` unchanged — verified `web-zoom.ts:44-46,129-133,143-156`; `stepWebZoom` body byte-identical to HEAD, snap-from-float pinned by `web-zoom.test.ts:28-32`
- [x] A-003 R3: gestures scale the frame continuously per event on both attach targets; buttons/palette/reset still step the ladder — `wireGestureListeners` applies `applyWheelZoom`/`base*scale` per event on wrapper + same-origin frame doc (`iframe-window.tsx:206-245`); click/palette path unchanged on `applyZoom`→`stepWebZoom`
- [x] A-004 R4: gesture persistence is debounced-trailing with unmount/bucket-change flush; click-path writes stay immediate — `ZOOM_PERSIST_DEBOUNCE_MS = 250` trailing timer in `applyZoomFactor`; flush-on-unmount effect + flush-before-reseed on bucket change (`iframe-window.tsx:147-167`); unmount flush test-pinned, bucket-change flush verified by inspection (see review should-fix on coverage); click path cancels the pending timer and writes immediately

### Behavioral Correctness

- [x] A-005 R2: a stored 1.37 reloads as 1.37 (regression: read-time snap removed) — `web-zoom.test.ts:82-90`
- [x] A-006 R3: gesture interception predicate unchanged — plain wheel/scroll passes through; external frames degrade exactly as before — diff shows identical ctrl/meta guard and `preventDefault`; attach still same-origin-gated (`iframe-window.tsx:379-382`); plain-wheel pass-through pinned by test
- [x] A-007 R3: the terminal tile's gesture behavior is byte-identical (no `terminal-client.tsx` change) — `terminal-client.tsx` absent from the diff

### Scenario Coverage

- [x] A-008 R3/R4: e2e proves an off-ladder gesture value renders + persists, and a button click from it lands on-ladder; `.spec.md` updated same-commit — e2e (e) passes (182%→201% continuous, + click → 250% ladder); gesture persistence unit-proven (debounce + flush tests); `.spec.md` updated in the same working tree. NOTE: pre-existing e2e test (b) fails on this branch AND on pre-change HEAD (verified via stash) — unrelated to this diff, tracked as a should-fix

### Edge Cases & Error Handling

- [x] A-009 R1/R2: clamping holds at both bounds under repeated gestures; a stored value outside [0.5, 3] reads clamped — `zoom-gesture.test.ts` clamp cases + `web-zoom.test.ts:86-89` (stored 5→3, 0.1→0.5)
- [x] A-010 R4: unmount mid-debounce persists the final value (no lost zoom); storage failures still no-op silently — flush-on-unmount unit test; `writeWebZoom`/`readZoomMap` try/catch-noop unchanged

### Code Quality

- [x] A-011 Pattern consistency: persistence stays handler-side (never in a functional updater — the cwvv StrictMode rule); listeners/timers cleaned up on teardown — all writes in event handlers/timer callbacks; teardown removes the three listeners per arm; unmount cleanup flushes/clears the timer
- [x] A-012 No unnecessary duplication: one clamp helper; the ladder bridge reuses `stepWebZoom`'s existing snap — `clampZoom` exported once from `zoom-gesture.ts`; bridge is `stepWebZoom` unchanged (nice-to-have: `readWebZoom` inlines the clamp instead of importing `clampZoom`)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before hydrate
- N/A items: mark checked with **N/A** prefix and reason

## Deletion Candidates

None — this change replaces the web tile's gesture reduction in place (the removed `applyGestureSteps` plumbing has no leftover call sites); the stepped `createWheelAccumulator`/`createGestureArm` exports remain live in `terminal-client.tsx`, and no other existing code became redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Sensitivity 0.01 (exp mapping) and 250ms trailing debounce as named constants | Chrome-like feel; both isolated and trivially tunable | S:60 R:90 A:80 D:75 |
| 2 | Confident | Write-time rounding to 2 decimals (1% granularity) with round-to-1 removal | Sub-percent precision is invisible; keeps the sparse-map rule robust to float noise | S:55 R:90 A:85 D:75 |
| 3 | Certain | The ladder bridge for click/shortcut zoom is `stepWebZoom`'s existing snap — no new code | Shipped in cwvv exactly for this composition; pinned by test | S:80 R:90 A:90 D:85 |

3 assumptions (1 certain, 2 confident, 0 tentative).
