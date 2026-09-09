# Plan: Pan-and-zoom for diagrams in the present viewer

**Change**: 260909-pdow-viewer-figure-pan-zoom
**Intake**: `intake.md`

## Requirements

### Viewer: pure pan/zoom math (`viewer/pan-zoom.ts`)

#### R1: A DOM-free module owns every figure zoom derivation
`app/frontend/src/viewer/pan-zoom.ts` SHALL export `fitScale(natural, container, mode)` (`"width"` = `min(1, cW/nW)`; `"contain"` = `min(1, cW/nW, cH/nH)`; `1` for a degenerate natural size), `minScale(fit)` (= fit), `zoomAboutPoint(state, nextScale, point)` (the content point under `point` stays fixed; no clamp), `clampTranslation(state, natural, container)` (per axis: center when scaled size ≤ container, else clamp so content edges never leave container edges), `fitState`, `stepScale(current, dir, min)` (next `FIGURE_ZOOM_LEVELS` entry strictly beyond `current`, clamped to `[min, FIGURE_ZOOM_MAX]`, no snap), `wheelScale(current, deltaY, min)` (= `applyWheelZoom(current, deltaY, min, FIGURE_ZOOM_MAX)` from `@/lib/zoom-gesture`), `formatPercent`, `parseViewBox`, `isPannable`, and the constants `FIGURE_ZOOM_MAX = 8`, `FIGURE_ZOOM_LEVELS` (0.1…8), `PAN_STEP_PX = 40`. It MUST import nothing but `@/lib/zoom-gesture`.

- **GIVEN** natural 3000×1200 and container 800×600, **WHEN** `fitScale` runs in `"width"`, **THEN** it returns 800/3000; in `"contain"` it returns min(800/3000, 600/1200) = 0.2667; **AND GIVEN** natural 200×100 in the same container, **THEN** both modes return 1
- **GIVEN** state `{scale:0.5, tx:0, ty:0}` and point `(100, 50)`, **WHEN** zooming to 1.0 about that point, **THEN** the content coordinate under `(100,50)` is unchanged (`tx' = 100 − 200 = −100`, `ty' = 50 − 100 = −50`)
- **GIVEN** an off-ladder current of 0.43 and min 0.43, **WHEN** `stepScale("in")`, **THEN** 0.5 (not 0.67); stepping `out` from 0.5 with min 0.43 returns 0.43; stepping `in` from 8 returns 8
- **GIVEN** `wheelScale(1, -60, 0.2)`, **THEN** ≈ `exp(0.6)`; `wheelScale(7.9, -600, 0.2)` clamps to 8

### Viewer: the zoomable figure (`viewer/zoomable-figure.ts`)

#### R2: A figure wrapper turns a rendered SVG into a focusable, pan-and-zoomable group
`mountZoomableFigure(holder, svg, { mode: "canvas" | "inline", label })` SHALL keep the holder's existing class (`.viewer-scene` / `.viewer-diagram`) and add `.viewer-figure`, `data-mode`, `data-zoomed`, `tabindex="0"`, `role="group"`, `aria-label="<label>, zoom <pct>"`, `data-testid="viewer-figure"`; wrap the SVG in `.viewer-figure-viewport`; and add a `.viewer-figure-controls` toolbar (`role="toolbar"`, buttons "Zoom out", "Zoom in", "Fit to view", plus "Expand" with `aria-pressed` in inline mode, and an `<output data-testid="viewer-figure-readout" aria-live="polite">`). The natural size MUST come from `viewBox` (fallback: numeric width/height attributes); the wrapper MUST set explicit px `width`/`height` attributes and `style.maxWidth = "none"` on the SVG so ALL magnification is `transform: translate(tx, ty) scale(s)` with origin `0 0`. `data-zoomed` MUST be `"true"` iff `scale > fit`. No `focus()` on mount.

- **GIVEN** an excalidraw SVG with `viewBox="0 0 3000 1200"` in a 800×600 viewport, **WHEN** mounted in canvas mode, **THEN** the readout shows `27%`, `data-zoomed="false"`, the SVG width attribute is `3000`, and its transform is `translate(0px, 140px) scale(0.2667)` (centered on the short axis)
- **GIVEN** a mermaid SVG with `width="100%"` and an inline `max-width`, **WHEN** mounted, **THEN** the SVG's inline `max-width` is `none` and its layout box equals the viewBox size

#### R3: Gestures, pointer, and keyboard drive the figure; the tile keeps everything else
`installFigureGestureArm()` (called once at boot) SHALL attach a `window`-level **capture, non-passive** `wheel` listener and Safari `gesturestart`/`gesturechange` listeners. For a `wheel` with `ctrlKey || metaKey` whose target lies inside a `.viewer-figure` it MUST `preventDefault()`, `stopImmediatePropagation()`, and apply `wheelScale` anchored at the cursor (then clamp). Any wheel outside a figure, and any unmodified wheel, MUST be left untouched. Pointer: `pointerdown` on the viewport focuses the figure; when `isPannable`, drag pans with pointer capture; two pointers pinch about their midpoint. Keyboard (focus inside the figure, no ctrl/meta/alt): `=`/`+` step in, `-`/`_` step out, `0` fit, arrows pan by `PAN_STEP_PX` (×5 with Shift) when pannable; all `preventDefault()`. Button/keyboard zoom anchors at the viewport center. `touch-action` MUST be `pan-x pan-y` at fit and `none` when zoomed. A `ResizeObserver` MUST recompute the fit state when at fit and only re-clamp when zoomed.

- **GIVEN** a mounted figure at fit 0.2667, **WHEN** a ctrl-wheel `deltaY −60` is dispatched on the SVG, **THEN** the scale becomes 0.2667·e^0.6, the event is `defaultPrevented`, and `data-zoomed="true"`
- **GIVEN** a ctrl-wheel dispatched on `document.body` outside any figure, **THEN** it is NOT `defaultPrevented` and a document-level listener still receives it
- **GIVEN** the figure is focused at fit, **WHEN** `+` is pressed, **THEN** the readout equals the next ladder level above fit; **WHEN** `0` is pressed, **THEN** the readout returns to the fit value and `data-zoomed="false"`

### Viewer: layout modes and renderer wiring

#### R4: Canvas mode for excalidraw, inline mode for mermaid; the old fit rule is replaced
`main.ts` SHALL stamp `document.body.dataset.format` before dispatching and call `installFigureGestureArm()` once. `excalidraw.ts` SHALL mount the figure in `canvas` mode (label `"Scene"`): `body[data-format="excalidraw"] #viewer-root { max-width: none; padding: 0 }`, figure `height: 100vh`, `overflow: hidden`, fit mode `contain`. `markdown.ts` SHALL mount each rendered mermaid SVG in `inline` mode (label `"Diagram N"`, 1-based): fit mode `width`, viewport height set to `natural.h × fit` px (recomputed on resize), and an **Expand** toggle that sets the box to `calc(100vh − 2rem)`, calls `scrollIntoView({ block: "nearest" })`, re-clamps, and restores the fitted height when toggled off. A fence that fails to render MUST keep its source block as today. `viewer.css` MUST replace the `.viewer-diagram svg, .viewer-scene svg { max-width: 100%; height: auto }` rule with the figure rules (viewport `overflow: hidden`; `[data-zoomed="true"] .viewer-figure-viewport { cursor: grab }`, `:active { cursor: grabbing }`; controls absolutely positioned top-right using the `--viewer-*` tokens, `opacity: 0` → `1` on `:hover`, `:focus-within`, and `@media (pointer: coarse)`; 36px buttons on coarse pointers; `:focus-visible` outline; no transitions).

- **GIVEN** a presented `.excalidraw`, **WHEN** the shell boots, **THEN** `body[data-format="excalidraw"]` is set, `#viewer-root` has no max-width, and the single figure's height equals the viewport height
- **GIVEN** a presented `.md` with one mermaid fence, **WHEN** rendered, **THEN** `.viewer-diagram.viewer-figure` height equals the SVG's scaled height (±1px); clicking Expand sets `aria-pressed="true"` and height ≈ `100vh − 2rem`; clicking again restores the fitted height
- **GIVEN** the existing e2e locators `.viewer-scene svg` and `.viewer-diagram svg`, **THEN** they still resolve

### Tests

#### R5: Unit and e2e coverage
`viewer/pan-zoom.test.ts` (Vitest) SHALL cover R1's scenarios. `tests/e2e/present-viewer.spec.ts` SHALL gain two fixtures written in `beforeAll` — `wide.excalidraw` (a 3000×300 rectangle + text so fit < 1 at any test viewport) and `wide.md` (a `graph LR` mermaid fence chaining ~14 nodes) — and six tests with **Proves:**/**Steps:** JSDoc: fit at rest; ctrl-wheel escapes the fit (dispatched `WheelEvent` with `ctrlKey`, readout = round(fit·e^0.6·100)%); keyboard `+` then `0`; drag pans when zoomed (transform translate changes, content still covers the viewport); mermaid inline + Expand; tile passthrough (ctrl-wheel on `document.body` not `defaultPrevented`). The file-header comment MUST describe the new fixtures. Existing tests MUST keep passing unchanged.

- **GIVEN** `just test-frontend` and `just test-e2e "present-viewer"`, **WHEN** run, **THEN** all pass; `npx tsc --noEmit` is clean; `just build` still emits the `viewer` Rollup entry

### Non-Goals

- No persistence of figure zoom; no palette registration; no double-click zoom; no plain-wheel panning; no document-level key routing to an unfocused figure; no minimap; no selection/editing; no change to the tile's zoom control, ladder, gesture arm, or `iframe-window.tsx`; no backend change; no new runtime dependency; no React.

### Design Decisions

#### Viewer-owned figure zoom, independent of tile zoom
**Decision**: Magnification of diagrams lives inside the viewer shell as a CSS transform on the SVG within a fitted, pannable figure; the tile's content zoom is untouched and composes on top.
**Why**: The tile zoom shrinks the frame viewport and scales it back, so a fit-to-width SVG re-fits and never magnifies; a viewer-owned transform gives arbitrary crisp magnification with no re-render, no dependency, no route.
**Rejected**: Raising `WEB_ZOOM_MAX` (no effect on re-fitting content, changes every page's tile zoom); dropping `max-width: 100%` (wide scenes overflow at rest); the interactive `@excalidraw/excalidraw` viewer (React + a large chunk in a plain-TS shell — parked by 260908-krov until selection/editing is wanted); tile-injected guest zoom (cross-origin-unsafe).
*Introduced by*: 260909-pdow-viewer-figure-pan-zoom

#### The viewer claims ctrl-wheel over figures at window capture; the tile keeps the rest
**Decision**: One viewer-wide `window`-capture wheel/gesture arm handles only events whose target is inside a `.viewer-figure`, stopping propagation so the tile's frame-document capture arm never sees them.
**Why**: DOM capture order is window → document → target; the tile attaches at the frame's `document` on load, so a figure-level listener would run after the tile has already zoomed the tile. Window capture is the only pre-emption point that needs no change in `iframe-window.tsx`.
**Rejected**: A yield hook in `iframe-window.tsx` (couples the tile to guest markup); letting both zoom (the tile would zoom on every figure gesture).
*Introduced by*: 260909-pdow-viewer-figure-pan-zoom

#### Plain keys for figure zoom, never modifier chords
**Decision**: `+`/`=`, `-`/`_`, `0`, arrows, active only while focus is inside the figure.
**Why**: Every registry binding is on a cmd/ctrl/shifted tier, so unmodified keys never match the tile's reclaim predicate; `⌘0`/`⌘=`/`⌘−` are desktop-shell View-menu and browser page-zoom chords.
**Rejected**: `⌘`/`Ctrl` variants (collide with shell and browser zoom).
*Introduced by*: 260909-pdow-viewer-figure-pan-zoom

### Deprecated Requirements

#### `.viewer-diagram svg, .viewer-scene svg { max-width: 100%; height: auto }` as the sizing rule
**Reason**: Fit-to-width by CSS is what made magnification impossible; the figure wrapper now owns sizing.
**Migration**: The rest state reproduces today's fitted look via `fitScale`; the holders keep their classes so shipped locators keep matching.

## Tasks

### Phase 1: Core Implementation

- [x] T001 Create `app/frontend/src/viewer/pan-zoom.ts` (constants, `fitScale`, `minScale`, `zoomAboutPoint`, `clampTranslation`, `fitState`, `stepScale`, `wheelScale`, `formatPercent`, `parseViewBox`, `isPannable`; imports only `@/lib/zoom-gesture`) and `pan-zoom.test.ts` covering R1's scenarios plus clamping/centering, `formatPercent` rounding, `parseViewBox` valid/garbage/null, `isPannable` edge equality <!-- R1 -->
- [x] T002 Create `app/frontend/src/viewer/zoomable-figure.ts`: `mountZoomableFigure` (DOM shape, natural-size + explicit sizing, apply/transform, readout/aria/disabled state, controls, `data-zoomed`, touch-action rule, pointer drag + two-pointer pinch, keyboard, ResizeObserver, inline Expand) and `installFigureGestureArm` (window-capture ctrl/meta wheel + Safari gesture arm scoped to `.viewer-figure` targets) <!-- R2, R3 -->

### Phase 2: Integration & Edge Cases

- [x] T003 Wire the renderers and styles: `main.ts` stamps `body[data-format]` and installs the gesture arm once; `excalidraw.ts` mounts canvas mode (`"Scene"`); `markdown.ts` mounts inline mode per fence (`"Diagram N"`, failed fences unchanged); `viewer.css` replaces the old fit rule with the figure/viewport/controls rules, the `body[data-format="excalidraw"]` full-bleed rule, coarse-pointer sizing, focus ring, grab cursors <!-- R4 -->
- [x] T004 Extend `app/frontend/tests/e2e/present-viewer.spec.ts`: `wide.excalidraw` + `wide.md` fixtures in `beforeAll`, updated file-header comment, six new `test()`s with **Proves:**/**Steps:** JSDoc (fit at rest; ctrl-wheel escapes fit; keyboard `+`/`0`; drag pans; mermaid inline + Expand; tile passthrough); existing tests unchanged <!-- R5 -->

### Phase 3: Polish

- [x] T005 Verification gates: `cd app/frontend && npx tsc --noEmit`; `just test-frontend`; `just test-e2e "present-viewer"`; `just build` (viewer entry still emitted); fix what they surface <!-- R5 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `pan-zoom.ts` exports the listed functions and constants and imports only `@/lib/zoom-gesture`
- [x] A-002 R2: `mountZoomableFigure` produces the specified DOM (classes kept, `.viewer-figure`, tabindex/role/aria-label/testid, viewport, toolbar with the named buttons and readout) and sizes the SVG explicitly with `max-width: none`
- [x] A-003 R3: ctrl/meta-wheel over a figure zooms about the cursor and is stopped before the tile's arm; pointer drag pans when pannable; two-pointer pinch zooms about the midpoint; plain keys step/fit/pan; ResizeObserver behaves per fit vs zoomed
- [x] A-004 R4: canvas mode (excalidraw) is full-bleed 100vh contain-fit; inline mode (mermaid) is fit-to-width with a fitted height and a working Expand toggle; the old CSS fit rule is gone
- [x] A-005 R5: `pan-zoom.test.ts` exists and passes; `present-viewer.spec.ts` gains the two fixtures and six tests with intent comments

### Behavioral Correctness

- [x] A-006 R3: an unmodified wheel and any wheel outside a figure are untouched (not `defaultPrevented`, propagate normally)
- [x] A-007 R2: `data-zoomed` is `"true"` exactly when `scale > fit`; the readout and `aria-label` update on every change; Zoom-out is disabled at `min`, Zoom-in at 8×
- [x] A-008 R4: `body[data-format]` is stamped before rendering; the excalidraw column drop applies only to that format

### Removal Verification

- [x] A-009 R4: no `.viewer-diagram svg, .viewer-scene svg { max-width: 100% }` rule remains in `viewer.css`

### Scenario Coverage

- [x] A-010 R1: unit tests prove fit width/contain and the 1-cap, cursor-anchored zoom invariance, center-vs-clamp per axis, off-ladder `stepScale` (0.43→0.5), clamps at min and 8, `wheelScale` ≈ e^0.6 and clamping
- [x] A-011 R5: e2e proves fit at rest (readout < 100%, SVG within figure width, `data-zoomed="false"`)
- [x] A-012 R5: e2e proves ctrl-wheel escapes the fit with readout = round(fit·e^0.6·100)% and the SVG exceeding the figure width
- [x] A-013 R5: e2e proves `+` steps to the next ladder level and `0` returns to fit
- [x] A-014 R5: e2e proves drag changes the translate components and content still covers the viewport
- [x] A-015 R5: e2e proves the mermaid figure's fitted height and the Expand toggle both ways
- [x] A-016 R5: e2e proves tile passthrough (ctrl-wheel on `document.body` not `defaultPrevented`)

### Edge Cases & Error Handling

- [x] A-017 R2: a degenerate/missing viewBox falls back to width/height attributes, and a missing size yields fit 1 without throwing
- [x] A-018 R4: a mermaid fence that fails to render keeps its source block and mounts no figure
- [x] A-019 R3: `touch-action` is `pan-x pan-y` at fit and `none` when zoomed
- [x] A-020 R2: no `focus()` is called on mount

### Code Quality

- [x] A-021 Pattern consistency: `pan-zoom.ts` follows the `viewer/format.ts`/`error.ts` pure-module + colocated-test contract; `zoomable-figure.ts` is plain TypeScript with no framework
- [x] A-022 No unnecessary duplication: `applyWheelZoom`/`clampZoom` are reused from `lib/zoom-gesture.ts`; no pan-zoom library added; no new runtime dependency
- [x] A-023 No magic numbers: max scale, ladder, pan step, wheel sensitivity, and the 2rem expand margin are named constants or tokens
- [x] A-024 Comments state constraints, not narration; no change-ids or PR numbers in code comments
- [x] A-025 Every new Playwright `test()` carries **Proves:**/**Steps:** JSDoc and the file header describes the shared fixtures
- [x] A-026 Constitution IV/V: no new route or setting; every figure action is keyboard-reachable inside the frame

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`
- Never run Playwright directly — `just test-e2e "present-viewer"` (derived per-worktree rig).

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. The one removed block (the `.viewer-diagram svg, .viewer-scene svg { max-width: 100%; height: auto }` rule in `viewer.css`) was the *planned* removal declared in `## Requirements → Deprecated Requirements` and is verified under A-009, not a discovered candidate.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Five tasks: pure module, figure wrapper, wiring+CSS, e2e, gates — one viewer chunk, no backend | The intake's six sections collapse cleanly; docs are hydrate's | S:85 R:95 A:95 D:90 |
| 2 | Confident | Two-pointer pinch tracks pointer distance ratio about the midpoint using the same `zoomAboutPoint`+clamp path as wheel | Intake #19; no library | S:75 R:85 A:80 D:75 |
| 3 | Confident | The excalidraw canvas figure's 100vh box uses `height: 100vh` (not `100dvh`) since the frame viewport has no mobile browser chrome | The viewer runs inside the tile's iframe | S:60 R:95 A:85 D:80 |
| 4 | Confident | An SVG with no usable viewBox or width/height gets a 1×1 natural size: fit 1, nothing pannable, no throw | Intake's degrade requirement; both renderers always emit a viewBox so this is a safety net | S:60 R:95 A:90 D:85 |
| 5 | Confident | Expand keeps the current scale (re-clamped) when zoomed and stays at fit when at fit; the inline fitted height is computed against an unbounded container height in width mode | Decided at apply; matches the resize rule's fit-vs-zoomed split | S:55 R:90 A:85 D:75 |
| 6 | Confident | Mouse drag starts only on the primary button; touch/pen pointers are not button-filtered; `focus({preventScroll:true})` on pointerdown so an inline figure never scrolls the document when clicked | Standard pointer-event hygiene; not in the intake | S:45 R:95 A:90 D:85 |

6 assumptions (1 certain, 5 confident, 0 tentative).
