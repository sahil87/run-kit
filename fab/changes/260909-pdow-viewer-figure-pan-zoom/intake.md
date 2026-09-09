# Intake: Viewer Figure Pan-and-Zoom (excalidraw scenes + mermaid diagrams)

**Change**: 260909-pdow-viewer-figure-pan-zoom
**Created**: 2026-09-10

## Origin

Promptless dispatch (`/fab-proceed`-style create-new, `{questioning-mode} = promptless-defer`) from a design discussion held 2026-09-09/10. The description below is the synthesized input; every decision it records was made in that discussion and is carried into § What Changes verbatim where values were given.

> Title direction: Pan-and-zoom for diagrams in the present viewer (excalidraw scenes and mermaid diagrams).
>
> **Problem (diagnosed against the code, 2026-09-09).** `rk present foo.excalidraw` renders the scene in the web tile through the backend-served viewer shell as ONE static SVG (`@excalidraw/utils` `exportToSvg`, `viewer/excalidraw.ts`) inside `.viewer-scene`. The CSS rule `#viewer-root .viewer-diagram svg, #viewer-root .viewer-scene svg { max-width: 100%; height: auto }` fits the whole scene to the tile width, so a wide scene (e.g. three diagrams side by side) renders with unreadably small text. The web tile's content zoom cannot help: it is a transform-scale wrapper that shrinks the frame's CSS viewport and scales it back (memory DD "Scale wrapper over guest-document CSS zoom"), so a fit-to-width SVG simply re-fits to the narrower viewport — at 300% (the ladder cap, `WEB_ZOOM_MAX`) the whole scene is still fully visible, just sharper. Raising the 300% cap would change nothing. Mermaid diagrams rendered from Markdown (`.viewer-diagram`) share the identical rule and the identical failure.
>
> **Decision — viewer-owned pan-and-zoom over the static SVG, independent of tile zoom.** Implement pan/zoom INSIDE the viewer shell (`app/frontend/src/viewer/`), the way an image viewer works, decoupled from the tile's content zoom: a pure DOM-free math module (`viewer/pan-zoom.ts` + colocated test); a "zoomable figure" wrapper on each `.viewer-scene` and `.viewer-diagram` — fit-to-width at rest, ctrl/⌘ + wheel zooms continuously about the cursor (mirror the tile's `exp(-deltaY*0.01)` mapping), pinch on touch/trackpad, pointer drag pans when zoomed beyond fit, a small control cluster (`−` `100%/fit label` `+` `⤢ fit`, top-right, hover/focus reveal, always visible on coarse pointers), plain-key keyboard zoom (`+`/`=` `-` `0`) with the figure focused (`tabindex=0`, `role="group"`, aria-label naming the figure and current zoom); excalidraw scene = the document's single figure filling the viewport height; mermaid diagram = an inline clipped pannable box with an "expand" toggle; reset-to-fit on container resize while at fit, keep scale + re-clamp when zoomed; no animated transitions; scaling via CSS `transform: translate() scale()` on the SVG (no re-render, no raster).
>
> **Alternatives rejected.** Raising `WEB_ZOOM_MAX` / changing the tile ladder (no effect on a fit-to-width SVG; changes tile semantics for every page). Dropping `max-width: 100%` (wide scene overflows at 100%, loses the at-a-glance fit, couples readability to a tile-level control). The interactive `@excalidraw/excalidraw` viewer package in view mode (brings React + a large lazy chunk into a deliberately plain-TypeScript shell; 260908-krov parked it as "only if static SVG proves insufficient" — magnification alone does not justify it). Injecting zoom into the guest document from the tile (cross-origin-unsafe, rejected before in memory).
>
> **Constraints.** Viewer shell stays vanilla TypeScript (no React); the excalidraw chunk stays lazy; no new runtime dependencies (no pan-zoom library). Constitution IV: no new routes; no settings surface (zoom is ephemeral per figure; not persisted — grade whether to persist per document in sessionStorage; default no). Tests: Vitest/node for the pure module; Playwright e2e against a presented `.excalidraw` fixture and a Markdown fixture with a mermaid fence via the existing present-viewer harness (extend the spec that covers `/present/` rendering); every new Playwright `test()` carries **Proves:**/**Steps:** JSDoc. Docs to hydrate: the present viewer-shell rows / wherever the viewer shell rendering is documented, plus a Design Decision recording "viewer-owned figure zoom, independent of tile zoom" with the rejected alternatives; specs only if they describe tile zoom semantics this refines (likely no change).

Grounding verified against the code on 2026-09-10 (see § Why → Verified facts). No question was asked; every decision the input delegated ("decide and grade") is graded in § Assumptions.

## Why

**The pain.** A presented `.excalidraw` scene — the common agent-to-human hand-off for architecture sketches — is unreadable whenever the scene is wider than the tile. `renderExcalidraw` (`app/frontend/src/viewer/excalidraw.ts`) exports the whole scene as one `<svg>` with natural pixel `width`/`height` attributes and drops it into `<div class="viewer-scene">`; the shell's CSS (`app/frontend/src/viewer/viewer.css`) then applies:

```css
#viewer-root .viewer-diagram svg,
#viewer-root .viewer-scene svg {
  max-width: 100%;
  height: auto;
}
```

so a 3000px-wide scene renders at the column width (`#viewer-root { max-width: 52rem }`, i.e. ≤ 832px) — roughly 28% of natural size — and 20px text becomes ~5px. Mermaid fences (`renderMarkdown` in `viewer/markdown.ts`, `<div class="viewer-diagram">` holding the mermaid SVG, which itself ships `width="100%"` + an inline `max-width`) hit the same rule and the same failure on wide flowcharts.

**Why the tile's zoom cannot fix it.** The web tile's content zoom (`iframe-window.tsx`, `lib/web-zoom.ts`) is a scale wrapper: the iframe renders at `width/height: 100%/s` and is scaled back by `s` (memory `ui/lenses-and-layout.md` § Design Decisions → "Scale wrapper over guest-document CSS zoom"). Zooming in *shrinks the frame's CSS viewport*, so a `max-width: 100%` SVG re-fits to the narrower viewport and the user sees the same whole scene, merely sharper. At the ladder cap (`WEB_ZOOM_MAX = 3`) the entire scene is still fully visible. Raising the cap changes nothing for this content and would change tile-zoom semantics for every other page.

**What happens if we don't fix it.** Users fall back to `?raw=1` + a desktop excalidraw app, or ask the agent to split scenes — the present viewer stops being the hand-off surface for exactly the documents that most need one.

**Why this approach.** Pan-and-zoom *inside* the viewer shell is what an image viewer does: the SVG keeps its natural size and crisp vector text (fonts are inlined by `exportToSvg`), and a CSS `transform: translate(tx, ty) scale(s)` on the `<svg>` gives arbitrary magnification with no re-render. It is decoupled from tile zoom by construction — the tile keeps giving the frame a viewport, the figure fits to whatever container that yields, and the two compose (tile zoom on top of figure zoom) without either knowing about the other. It needs no new dependency, no React, no route, no setting, and no backend change.

**Verified facts (2026-09-10) that shape the design:**

1. **Chord reclaim cannot collide with plain keys.** The tile attaches a capture-phase `keydown` listener to every same-origin frame document (`iframe-window.tsx` ~L233) and consults `hasReclaimableMatch(e, bindings, "web")` (`lib/keybindings.ts` ~L575). Every registry binding is on the `cmd`/`ctrl`/`shifted` tiers, so an **unmodified** `+`/`=`/`-`/`0` keydown matches nothing and is never reclaimed (the handler only calls `onInteract` and returns). Conversely `⌘0`/`⌘=`/`⌘−` are desktop-shell View-menu accelerators on macOS (`MAC_SHELL_CMD_CLAIMS`, `keybindings.ts` ~L430) and browser page-zoom chords elsewhere — the viewer MUST NOT bind modifier variants. The tile's own `Web: Zoom in/out/reset` actions are palette-only (no chord).
2. **Ctrl/⌘-wheel inside the frame is claimed by the tile first.** `wireGestureListeners(doc)` (`iframe-window.tsx` ~L689) attaches a **capture-phase, non-passive `wheel`** listener plus `gesturestart`/`gesturechange` on the frame's `document` on every `load`, and applies tile zoom on any ctrl/meta wheel. Capture order is window → document → … → target, so a figure-element listener would fire *after* the tile has already zoomed the tile. The viewer therefore claims figure gestures at **`window` capture** (fires before the tile's `document` capture arm) and stops propagation — no change to the tile.
3. **Serving topology.** `servePresentFile` (`app/backend/api/present.go` ~L206) answers `.md`/`.markdown`/`.excalidraw` (resolved extension, no `?raw=1`) with the viewer shell; through the Vite dev proxy (`X-Rk-Dev-Proxy` set in `vite.config.ts`) it serves the inline source shell so `/src/viewer/main.ts` boots from the dev module graph; in production it serves `dist/viewer.html` (the `viewer` Rollup entry). The existing e2e `app/frontend/tests/e2e/present-viewer.spec.ts` drives the backend URL directly (`page.goto('/present/{server}/{hash}/{file}')`) on the real-tmux rig — the correct harness to extend. `present-auto-expand.spec.ts` covers layout writes, not rendering.
4. **Shareable code.** `lib/zoom-gesture.ts` is pure and dependency-free (`applyWheelZoom`, `clampZoom`, `WHEEL_ZOOM_SENSITIVITY`) — importable into the viewer chunk without pulling app code. `lib/web-zoom.ts` imports `web-url.ts` (app code) and its ladder is capped at 3× — not reusable for the figure (which needs 8×); the viewer keeps a local ladder.
5. **No prior coverage.** No active change or backlog entry covers viewer pan/zoom; 260908-krov (the viewer shell) recorded the interactive package as "upgrade only if static SVG proves insufficient" (its assumption #3).

## What Changes

### 1. Pure math module — `app/frontend/src/viewer/pan-zoom.ts` (+ `pan-zoom.test.ts`)

A DOM-free module in the `viewer/format.ts` / `viewer/error.ts` contract (colocated Vitest tests, no renderer imports). It imports only `applyWheelZoom`, `clampZoom` from `@/lib/zoom-gesture` (dependency-free) and owns everything else locally:

```ts
export interface Size { w: number; h: number }
export interface ZoomState { scale: number; tx: number; ty: number }
export type FitMode = "width" | "contain";

/** Max magnification as a multiple of the SVG's natural size. */
export const FIGURE_ZOOM_MAX = 8;

/** Local discrete ladder for button/keyboard steps: the browser ladder's shape,
 *  extended below 50% (wide scenes fit far below it) and above 300% (the
 *  figure's max is 8×). Gesture zoom is continuous and ignores it. */
export const FIGURE_ZOOM_LEVELS = [
  0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1,
  1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8,
] as const;

/** Keyboard pan distance per arrow press, CSS px of container (Shift ×5). */
export const PAN_STEP_PX = 40;

/** The rest scale: "width" = min(1, cW/nW) — today's max-width:100% look, never
 *  upscaled past natural; "contain" = min(1, cW/nW, cH/nH) — the whole scene
 *  visible in a fixed-height canvas. Returns 1 for a degenerate natural size. */
export function fitScale(natural: Size, container: Size, mode: FitMode): number;

/** The minimum scale: the fit scale itself (no zoom-out below the at-a-glance fit). */
export function minScale(fit: number): number;

/** Re-anchor so the content point under `point` (container coords) stays put:
 *  tx' = px − (px − tx)·(s'/s), same for y. Does NOT clamp — callers clamp next. */
export function zoomAboutPoint(state: ZoomState, nextScale: number, point: { x: number; y: number }): ZoomState;

/** Per-axis: scaled size ≤ container → center (t = (c − n·s)/2); else clamp
 *  t ∈ [c − n·s, 0] so content edges never leave the container edges. */
export function clampTranslation(state: ZoomState, natural: Size, container: Size): ZoomState;

/** The fit state: scale = fit, translation centered/clamped. */
export function fitState(natural: Size, container: Size, mode: FitMode): ZoomState;

/** Button/keyboard step: the next ladder level STRICTLY beyond `current` in
 *  `direction`, clamped to [min, FIGURE_ZOOM_MAX]. Unlike stepWebZoom's
 *  snap-then-step, no snap: the rest scale is an arbitrary fit value (e.g.
 *  0.43) and snapping first would overshoot (0.43 → 0.5 → 0.67). */
export function stepScale(current: number, direction: "in" | "out", min: number): number;

/** Continuous wheel mapping — applyWheelZoom(current, deltaY, min, FIGURE_ZOOM_MAX). */
export function wheelScale(current: number, deltaY: number, min: number): number;

/** `Math.round(scale·100)%` — 100% is natural size. */
export function formatPercent(scale: number): string;

/** Parse an SVG viewBox ("minx miny w h") → Size, or null when absent/invalid. */
export function parseViewBox(viewBox: string | null): Size | null;

/** True when the scaled content exceeds the container on either axis (drag/arrow pan enabled). */
export function isPannable(scale: number, natural: Size, container: Size): boolean;
```

Unit tests (Vitest, jsdom env is fine — the module touches no DOM): `fitScale` width vs contain and the 1-cap for small content; `zoomAboutPoint` keeps the anchored content point invariant for zoom in and out; `clampTranslation` centers on the small axis and clamps on the large one; `stepScale` from an off-ladder fit lands on the next level, clamps at `min` and at 8, and `in` then `out` returns to a ladder stop; `wheelScale(1, -60)` ≈ `exp(0.6)` and clamps; `formatPercent` rounding; `parseViewBox` valid/garbage/null; `isPannable` edge equality.

### 2. Zoomable figure wrapper — `app/frontend/src/viewer/zoomable-figure.ts`

The DOM half. `mountZoomableFigure(holder: HTMLElement, svg: SVGSVGElement, opts: { mode: "canvas" | "inline"; label: string }): void` turns an existing holder (`.viewer-scene` or `.viewer-diagram` — the classes are kept so existing e2e locators `.viewer-scene svg` / `.viewer-diagram svg` still match) into:

```html
<div class="viewer-scene viewer-figure" data-mode="canvas" data-zoomed="false"
     tabindex="0" role="group" aria-label="Scene, zoom 43%" data-testid="viewer-figure">
  <div class="viewer-figure-viewport">
    <svg width="3000" height="1200" style="transform: translate(0px, 118px) scale(0.277); transform-origin: 0 0; max-width: none">…</svg>
  </div>
  <div class="viewer-figure-controls" role="toolbar" aria-label="Zoom controls">
    <button type="button" aria-label="Zoom out">−</button>
    <output data-testid="viewer-figure-readout" aria-live="polite">43%</output>
    <button type="button" aria-label="Zoom in">+</button>
    <button type="button" aria-label="Fit to view">⤢</button>
    <button type="button" aria-label="Expand" aria-pressed="false">⤡</button>  <!-- inline mode only -->
  </div>
</div>
```

Behavior:

- **Natural size** = `parseViewBox(svg.getAttribute("viewBox"))`, falling back to the numeric `width`/`height` attributes. The wrapper then sets explicit pixel `width`/`height` attributes equal to the natural size and `style.maxWidth = "none"` — this neutralizes mermaid's `width="100%"` + inline `max-width` and the old CSS fit rule — so the SVG's layout box is its natural size and ALL magnification is the transform (crisp vector text, no re-render).
- **Rest** = `fitState(natural, container, mode)`; `data-zoomed="false"`. `container` is the viewport's `getBoundingClientRect()` size. Whenever `scale > fit` (strictly), `data-zoomed="true"` (grab cursor, `touch-action: none`); at fit, `touch-action: pan-x pan-y` (native page scroll still works over an inline figure; browser pinch-zoom is disabled so two-pointer pinch reaches the pointer handlers). This deliberately refines the discussion's "touch-action none inside the figure": an always-`none` inline figure would trap single-finger page scrolling over every diagram in a long Markdown document on touch devices.
- **Apply** writes `svg.style.transform = translate(${tx}px, ${ty}px) scale(${scale})` (origin `0 0`), updates the readout and `aria-label` (`"${label}, zoom ${formatPercent(scale)}"`), toggles `data-zoomed`, and toggles the Zoom-out button's `disabled` at `min` and Zoom-in's at max.
- **Gestures (viewer-wide arm, installed once by `main.ts` via `installFigureGestureArm()`)**: a `window`-level **capture, non-passive** `wheel` listener + `gesturestart`/`gesturechange` (Safari). For an event whose `target` lies inside a `.viewer-figure` AND (`ctrlKey || metaKey` for wheel): `preventDefault()`, `stopImmediatePropagation()` (the tile's document-capture arm never sees it), then `wheelScale` anchored at the cursor (`zoomAboutPoint` at `clientX/Y − viewportRect.left/top`, then `clampTranslation`). Safari: capture `base = scale` at `gesturestart`, apply `clamp(base · e.scale)` per `gesturechange` anchored at the event's `clientX/Y`. Any other wheel/gesture event is untouched — ctrl-wheel over the document margin still zooms the TILE exactly as today.
- **Unmodified wheel** is never intercepted in either mode (page scroll as today); panning is drag, touch drag, and arrow keys. (Plain-wheel panning of a zoomed canvas is a follow-up candidate — § Open Questions.)
- **Pointer**: `pointerdown` on the viewport → `figure.focus()`; if `isPannable`, `setPointerCapture` and drag-pan on `pointermove` (translate + clamp), ending on `pointerup`/`pointercancel`. Two active pointers → pinch: scale by the ratio of current/initial pointer distance about the midpoint, via `zoomAboutPoint` + clamp. `touch-action` per the rule above.
- **Keyboard** (`keydown` on the figure, target inside it, no `ctrlKey`/`metaKey`/`altKey`): `=`/`+` → `stepScale(in)`; `-`/`_` → `stepScale(out)`; `0` → fit; `ArrowLeft/Right/Up/Down` → pan by `PAN_STEP_PX` (×5 with Shift) when pannable; all `preventDefault()`. Button/keyboard zoom anchors at the viewport center. Toolbar buttons are ordinary focusable buttons (Tab reaches Expand). Keys act only while focus is inside the figure (per the discussion: "with the figure focused") — a click on the canvas or a Tab focuses it; there is no document-level key routing.
- **Resize**: one `ResizeObserver` per figure on the viewport. At fit (`scale === fit` within 1e-6) → recompute `fitState`; when zoomed → keep `scale`, `clampTranslation` only.
- **Focus**: no autofocus on load (a programmatic `focus()` inside the frame can move the parent's active element and trip the app's focus protocol — `ui/focus-ownership.md`); focus comes from pointerdown or Tab.
- **Controls visibility**: `.viewer-figure-controls { opacity: 0 }`, `1` under `.viewer-figure:hover`, `.viewer-figure:focus-within`, and `@media (pointer: coarse)`. No CSS transitions anywhere in the figure (so `prefers-reduced-motion` needs no override).

### 3. Layout modes

- **`canvas` (excalidraw — `renderExcalidraw`)**: `main.ts` stamps `document.body.dataset.format = format` before rendering; `body[data-format="excalidraw"] #viewer-root { max-width: none; padding: 0 }` drops the 52rem column so the scene is full-bleed. The figure is `height: 100vh` (the frame's viewport — under tile zoom the frame viewport is what the tile hands over, so the two compose), `overflow: hidden`, fit mode `contain`. Label: `"Scene"`.
- **`inline` (mermaid — `renderMarkdown`)**: the figure stays in the flowing column at `width: 100%`, fit mode `width`, and the viewport's `height` is set explicitly to `natural.h × fit` px (recomputed on resize) — today's fitted look with no clipping at rest. Zooming beyond fit clips inside that box and pans. The **Expand** toggle (`aria-pressed`) sets the box to `calc(100vh − 2rem)`, calls `figure.scrollIntoView({ block: "nearest" })`, and re-clamps at the current scale; toggling back restores the fitted height. Label: `"Diagram N"` (1-based per document).

### 4. Renderer wiring

- `excalidraw.ts`: after `exportToSvg`, `mountZoomableFigure(holder, svg, { mode: "canvas", label: "Scene" })` where `holder` is the existing `.viewer-scene` div.
- `markdown.ts`: after `holder.innerHTML = svg`, `const el = holder.querySelector("svg")` and `mountZoomableFigure(holder, el, { mode: "inline", label: \`Diagram ${n}\` })`; a fence that failed to render keeps its source block as today.
- `main.ts`: `installFigureGestureArm()` once at boot (before the format dispatch) and `document.body.dataset.format = format`.
- `viewer.css`: replace the `max-width: 100%; height: auto` rule with the figure rules (`.viewer-figure`, `.viewer-figure-viewport`, `.viewer-figure[data-zoomed="true"] .viewer-figure-viewport { cursor: grab }` / `:active { cursor: grabbing }`, controls cluster absolutely positioned top-right with the viewer's existing `--viewer-*` tokens, coarse-pointer 36px buttons, focus ring via `:focus-visible` outline). Add the `body[data-format="excalidraw"]` full-bleed rule.

### 5. Tests

- **Vitest** (`just test-frontend`): `viewer/pan-zoom.test.ts` per § 1.
- **Playwright** (`just test-e2e "present-viewer"`): extend `app/frontend/tests/e2e/present-viewer.spec.ts` (file-header comment updated for the new fixtures). New fixtures written in `beforeAll`: `wide.excalidraw` — a scene with a 3000×300 rectangle + a text element so `fit < 1` at any test viewport; `wide.md` — a mermaid fence `graph LR` chaining ~14 nodes (`A --> B --> … --> N`) so the diagram's natural width exceeds the 52rem column. Each `test()` carries **Proves:**/**Steps:** JSDoc. Locators: `[data-testid="viewer-figure"]`, `[data-testid="viewer-figure-readout"]`, `getByRole("button", { name: "Zoom in" })` etc. Assertions:
  1. **Fit at rest** — `wide.excalidraw` renders one figure; readout `< 100%`; the SVG's bounding-box width ≤ the figure's width; `data-zoomed="false"`.
  2. **Ctrl-wheel escapes the fit** — dispatch `new WheelEvent("wheel", { deltaY: -60, ctrlKey: true, bubbles: true, cancelable: true })` on the SVG (the `web-tile-zoom.spec.ts` technique); assert readout = round(fit·exp(0.6)·100)% (computed from the pre-zoom readout), the SVG bounding width now exceeds the figure width, and `data-zoomed="true"`.
  3. **Keyboard** — focus the figure (click), press `+` → readout equals the next ladder level above fit; press `0` → readout returns to the fit value and `data-zoomed="false"`.
  4. **Drag pans when zoomed** — after zooming, `page.mouse` down/move/up across the viewport; assert the SVG `transform` translate components changed and content stayed within clamp (bounding box still covers the viewport).
  5. **Mermaid inline + expand** — `wide.md` renders `.viewer-diagram.viewer-figure`; its height equals the SVG's scaled height (± 1px); click `Expand` → `aria-pressed="true"` and height ≈ viewport height − 2rem; click again → fitted height restored.
  6. **Tile passthrough** — a ctrl-wheel dispatched on `document.body` (outside any figure) is NOT `defaultPrevented` and reaches a document-level listener installed by the test (proves the viewer only claims figure gestures, leaving the tile's arm intact).
  7. Existing tests (`.viewer-scene svg` / `.viewer-diagram svg` visible, same-origin-only requests) keep passing unchanged.

### 6. Docs (hydrate)

- `docs/memory/run-kit/ui/lenses-and-layout.md` § Iframe Window → the "What a present tab renders" paragraph: add the figure pan/zoom contract (rest fit, gesture/keys/controls, canvas vs inline, resize rule, the window-capture claim). § Design Decisions: add **"Viewer-owned figure zoom, independent of tile zoom"** (Decision / Why / Rejected: raise `WEB_ZOOM_MAX`; drop `max-width:100%`; interactive `@excalidraw/excalidraw`; tile-injected guest zoom) and **"The viewer claims ctrl-wheel over figures at window capture; the tile keeps the rest"** (Why: the tile's frame-document capture arm fires first; Rejected: a yield hook in `iframe-window.tsx` — couples the tile to guest markup). Place beside the existing zoom DDs.
- `docs/memory/run-kit/api-and-sockets.md`: **no change** — the `/present` HTTP contract (gate, header, shell sourcing) is untouched.
- Specs (`window-views.md`, `surface-layout.md`, `ui-state.md`): **no change** — tile zoom semantics are unchanged; figure zoom is guest-document rendering, per-viewer and ephemeral (not even a viewer preference row).

### Non-goals

- No persistence of figure zoom (not per document, not sessionStorage); no palette registration of figure actions (guest content — see assumption #12); no double-click-to-zoom; no plain-wheel panning; no document-level key routing to an unfocused figure; no minimap; no selection/editing; no change to the tile's zoom control, ladder, or gesture arm; no backend change.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) § Iframe Window "What a present tab renders" gains the figure pan/zoom contract; two new Design Decisions (viewer-owned figure zoom independent of tile zoom; window-capture gesture claim).

## Impact

- **Frontend (viewer chunk only)**: new `app/frontend/src/viewer/pan-zoom.ts`, `pan-zoom.test.ts`, `zoomable-figure.ts`; modified `viewer/main.ts`, `viewer/excalidraw.ts`, `viewer/markdown.ts`, `viewer/viewer.css`. Imports `@/lib/zoom-gesture` (pure). Adds a few KB to the `viewer` entry chunk; excalidraw/mermaid remain lazy chunks.
- **Tests**: `app/frontend/tests/e2e/present-viewer.spec.ts` extended (fixtures + 6 tests); new Vitest file.
- **Backend / API / routes / settings / deps**: none.
- **Tile (`iframe-window.tsx`, `lib/web-zoom.ts`, `lib/keybindings.ts`)**: untouched; verified non-colliding (plain keys never match the reclaim predicate; the viewer's window-capture arm pre-empts the tile's document-capture arm only over figures).
- **Docs**: one memory file.
- **Verification gates**: `just test-frontend`, `just test-e2e "present-viewer"`, `cd app/frontend && npx tsc --noEmit`, `just build` (the viewer entry must still build as its own Rollup input).

## Open Questions

- Should zoom-out below the fit scale ever be allowed (e.g. to 50% of fit for a padded overview)? Decided no for v1 (assumption #5); revisit if users ask.
- Palette parity for figure actions would need a parent→frame seam (postMessage or a same-origin DOM call from the tile); deferred as a follow-up (assumption #12).
- Follow-up candidates deliberately left out of scope (not in the discussion): unmodified-wheel panning of a zoomed canvas-mode figure (Figma/excalidraw convention), and routing `+`/`-`/`0` from an unfocused single-figure document to its canvas so keys work before any click.
- The `touch-action` toggle (assumption #9) needs a manual pass on a touch device during apply/review; the e2e cannot prove native scroll interplay.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Viewer-owned pan/zoom over the static SVG via CSS transform, independent of tile zoom; the interactive `@excalidraw/excalidraw` package stays out | The discussion's core decision with rejected alternatives recorded; 260908-krov parked the interactive package for exactly this bar | S:95 R:70 A:90 D:95 |
| 2 | Certain | Keyboard zoom is plain `+`/`=`, `-`/`_`, `0` (no ⌘/Ctrl); modifier variants are never bound | Verified: every registry binding is cmd/ctrl/shifted-tier so unmodified keys never match `hasReclaimableMatch`; ⌘0/⌘=/⌘− are mac desktop-shell View-menu claims and browser page-zoom elsewhere | S:90 R:85 A:95 D:90 |
| 3 | Certain | Vanilla TypeScript, no React, no new runtime dependency, excalidraw + mermaid chunks stay lazy | Stated constraints; matches the viewer shell's existing shape | S:95 R:80 A:95 D:95 |
| 4 | Confident | Ctrl/⌘-wheel and Safari `gesture*` over a figure are claimed by a viewer-wide **`window`-capture** listener that stops propagation; the tile's frame-document capture arm is untouched and keeps every non-figure gesture | Verified the tile attaches at `document` capture on frame load; window capture fires first by DOM dispatch order — the only way to give the figure ctrl-wheel without editing `iframe-window.tsx` | S:60 R:80 A:85 D:75 |
| 5 | Confident | Scale bounds: minimum = the fit scale (no zoom-out below the at-a-glance fit), maximum `FIGURE_ZOOM_MAX = 8` × natural | Both delegated with named candidates ("fit or a small floor below"; "8× or 10×"); the fit IS the overview, 8× already renders 5px-at-fit text at 40px+, and both are single constants | S:75 R:92 A:60 D:60 |
| 6 | Confident | Local extended ladder `FIGURE_ZOOM_LEVELS` (0.1…8); `stepScale` = next level strictly beyond current, clamped to [fit, 8] (no snap-then-step); only `lib/zoom-gesture.ts` is shared | Delegated ("reuse if shareable without pulling app code, else local — grade it"); verified `web-zoom.ts` pulls `web-url.ts` and caps at 3×; snap-then-step overshoots from an arbitrary fit (0.43 → 0.5 → 0.67) | S:70 R:90 A:85 D:65 |
| 7 | Confident | Excalidraw = `canvas` mode: full-bleed (`#viewer-root` column dropped for the format), `height: 100vh`, fit mode `contain` | Stated ("the figure fills the viewport height — grade as assumption"); the column drop and contain-fit are the agent's fill-ins that make a full-viewport canvas coherent | S:75 R:75 A:75 D:70 |
| 8 | Confident | Mermaid = `inline` mode: fit-to-width capped at 1, explicit fitted height, Expand toggle to `calc(100vh − 2rem)` with `scrollIntoView` | Stated ("clipped pannable box with an expand toggle — grade as assumption"); the 2rem margin and scrollIntoView are fill-ins | S:80 R:75 A:75 D:75 |
| 9 | Confident | `touch-action: pan-x pan-y` at fit (native scroll passes, browser pinch disabled so pointer-event pinch works), `none` once zoomed | Refines the discussion's "touch-action none": always-`none` traps single-finger page scroll over inline diagrams on touch; the toggle is one CSS write on the existing zoomed flag — needs a real-device pass | S:50 R:80 A:60 D:55 |
| 10 | Confident | Readout is always a percentage of natural size (100% = natural); `⤢` is the fit affordance, no textual "Fit" state | The input's "`100%/fit label`" is ambiguous; a number matches the tile readout's meaning of 100% and browser convention, and the fit value stays visible | S:50 R:90 A:65 D:55 |
| 11 | Certain | No persistence: zoom is ephemeral per figure; no sessionStorage, no localStorage, nothing POSTed | Delegated with "default no"; Constitution IV; nothing else in the viewer persists | S:80 R:95 A:80 D:85 |
| 12 | Confident | Figure actions are NOT registered in the command palette | The shell is presented guest content like the tutorial companion page (never palette-registered), not app chrome; parity would need a parent→frame seam — flagged as a follow-up | S:35 R:85 A:65 D:60 |
| 13 | Confident | Docs: `ui/lenses-and-layout.md` § Iframe Window paragraph + two DDs; `api-and-sockets.md` and all specs unchanged | The HTTP contract is untouched; rendering behavior lives in the lenses memory today ("What a present tab renders") | S:65 R:90 A:80 D:70 |
| 14 | Confident | Arrow keys pan (40px, ×5 with Shift) while pannable | Constitution V: pan is a user-facing action and must be keyboard-reachable; not in the input | S:40 R:90 A:85 D:75 |
| 15 | Certain | ResizeObserver: at fit → recompute fit; zoomed → keep scale, re-clamp translation | Stated in the discussion | S:90 R:85 A:90 D:90 |
| 16 | Certain | Magnification is solely `transform: translate() scale()` on the SVG; no re-render, no raster, no CSS transitions | Stated; reduced-motion satisfied by having no motion | S:95 R:85 A:95 D:95 |
| 17 | Confident | DOM sizing contract: natural size from `viewBox` (fallback width/height attrs), explicit px `width`/`height` + `max-width: none` on the SVG; the `.viewer-scene`/`.viewer-diagram` holders are kept and gain `.viewer-figure` | Both renderers emit a viewBox; explicit sizing is what makes "transform is the only magnification" hold; keeping the holders preserves the four shipped e2e locators | S:50 R:85 A:80 D:75 |
| 18 | Certain | e2e extends `present-viewer.spec.ts` (direct `/present/…` URL on the real-tmux rig) with wide fixtures; ctrl-wheel synthesized by dispatching a `WheelEvent` with `ctrlKey` | Verified the spec and harness; the `web-tile-zoom.spec.ts` technique is proven on this rig | S:75 R:90 A:90 D:85 |
| 19 | Confident | Touch pinch via two-pointer pointer events about the midpoint; Safari pinch via `gesturestart` base × `gesturechange.scale` | Stated ("pinch on touch/trackpad; Safari gesturechange if cheap"); the tile already implements the Safari arm the same way | S:75 R:75 A:70 D:65 |
| 20 | Confident | Focus arrives via pointerdown or Tab; no `focus()` on load | Programmatic focus inside a frame can move the parent's active element (`ui/focus-ownership.md` steal-guard posture) | S:40 R:80 A:80 D:70 |

20 assumptions (7 certain, 13 confident, 0 tentative, 0 unresolved).
