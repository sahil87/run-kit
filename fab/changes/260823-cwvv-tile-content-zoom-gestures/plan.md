# Plan: Tile Content Zoom with Gesture Triggers

**Change**: 260823-cwvv-tile-content-zoom-gestures
**Intake**: `intake.md`

## Requirements

### Naming: content zoom owns the word "Zoom"

#### R1: Tile-maximize verb renamed to Expand/Restore (labels only)
Every USER-FACING string for the tile-maximize verb SHALL change from "Zoom"/"Unzoom" to "Expand"/"Restore"; internal identifiers, palette action ids, and test seams SHALL stay stable.

- Palette labels: `Layout: Zoom` → `Layout: Expand`, `Layout: Unzoom` → `Layout: Restore` (`app/frontend/src/lib/palette-layout.ts:150-151`; ids `layout-zoom`/`layout-unzoom` UNCHANGED — they persist in user macros/overrides).
- Tile-header verb Tip + aria-label: `Zoom ${label}`/`Unzoom ${label}` → `Expand ${label}`/`Restore ${label}` (`app/frontend/src/components/surface-layout.tsx:1576,1579`).
- The `zen-toggle` binding description "hide top bar + sidebar; zoom the focused tile" → "…; expand the focused tile" (`app/frontend/src/lib/keybindings.ts:291`).
- NOT renamed: `ZoomGlyph` component + `data-icon="zoom"` (test seam names the verb, not the label — `top-bar-icons.tsx:138`), `zoomToggleRef`/`onZoomChange`/`zoomed` internals, the `layout-zoom`/`layout-unzoom` ids.

- **GIVEN** a multi-tile layout with a focused tile
- **WHEN** the user opens the palette and types "expand"
- **THEN** `Layout: Expand` appears and toggles the focused tile full-center (id `layout-zoom` unchanged)
- **AND** no user-visible surface (palette, tooltips, aria-labels, binding descriptions) still calls tile-maximize "Zoom"

### Web tile: content zoom

#### R2: Scale-wrapper zoom mechanism
The web tile (`app/frontend/src/components/iframe-window.tsx`) SHALL support a per-tile content zoom level `s` applied as a scale wrapper on the iframe: the iframe rendered at `width: calc(100% / s); height: calc(100% / s); transform: scale(s); transform-origin: 0 0` inside an `overflow: hidden` flex-1 wrapper. At `s = 1` the wrapper MUST be visually and behaviorally identical to today (no transform artifacts). The mechanism MUST NOT reach into the guest document and MUST work for all four address kinds (`present`/`proxy`/`relative`/`external`).

- **GIVEN** a web tile showing any address kind at zoom 150%
- **WHEN** the frame renders
- **THEN** content appears at 1.5× scale and the iframe's CSS viewport is 1/1.5 of the tile (responsive guest layouts adapt as under real browser zoom)

#### R3: Zoom levels, persistence, and key derivation
Zoom levels SHALL come from a discrete browser-standard ladder `WEB_ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]`, default/reset `1`. A new pure, DOM-free module `app/frontend/src/lib/web-zoom.ts` (colocated `web-zoom.test.ts` — the `web-url.ts` module contract) SHALL own: the ladder + `stepWebZoom(current, direction)` (clamps at ends, snaps an off-ladder value to the nearest level), `webZoomKeyFor(rkUrl)` (the persistence bucket derived via `classifyAddress`: `external` → the URL's origin; `proxy`/loopback → `proxy:{port}`; `present`/`relative` → the single viewer-origin bucket `self`), and try/catch-noop `readWebZoom(key)`/`writeWebZoom(key, level)` over ONE localStorage key `runkit-web-zoom` holding a `{[bucket]: level}` map (a level of 1 removes the entry). `IframeWindow` seeds its zoom state from storage per the current `rkUrl`'s bucket and persists on every change — per-viewer state only, never POSTed (Constitution IV; spec window-views R7).

- **GIVEN** a proxied tile on `:3000` zoomed to 125% and an external tile on `https://example.com` at 100%
- **WHEN** the viewer reloads the page
- **THEN** the `:3000` tile restores 125%, the external tile stays 100%, and no API request carried zoom state

#### R4: Zoom control in the web tile's browser chrome
The URL bar SHALL gain a compact zoom control (the universal floor trigger — the only one that works over an `external` frame): a percent readout with − / + steppers and a reset affordance (reset shown or enabled only when `s ≠ 1`), placed in the button cluster beside the find ⌕ button, following the URL-bar button vocabulary (register glyphs / text glyph, `w-7 h-7 rounded hover:bg-bg-card` treatment, `Tip` labels, `data-testid="web-zoom-control"`). The ONBOARDING state (empty `rkUrl`) SHALL NOT render the control (reduced URL bar keeps only refresh + address input).

- **GIVEN** a web tile showing a page
- **WHEN** the user clicks + twice
- **THEN** the readout steps 100% → 110% → 125% and the frame scales accordingly
- **AND** clicking reset returns to 100%

#### R5: Palette parity for web zoom (Constitution V)
Three palette actions SHALL be registered — `Web: Zoom in` (id `web-zoom-in`), `Web: Zoom out` (`web-zoom-out`), `Web: Reset zoom` (`web-zoom-reset`) — gated exactly like `Web: Find in page` (registered only while the rendered layout includes an open `web` tile AND `hasWebUrl`; an onboarding tile registers nothing). They SHALL reach the mounted tile via a document CustomEvent seam in `lib/web-zoom.ts` (`WEB_ZOOM_EVENT = "web-zoom"` with `detail.direction: "in" | "out" | "reset"` — the `web-find:open` precedent; at most one web tile per layout). No keyboard chord is bound (Cmd/Ctrl+Plus/Minus/0 stay shell-owned — intake exclusion).

- **GIVEN** an open web tile with content
- **WHEN** the user runs `Web: Zoom in` from the palette
- **THEN** the tile steps one ladder level up
- **AND** on a window whose web tile is onboarding, no `Web: Zoom` entries appear

### Gesture triggers (both tiles)

#### R6: Shared gesture-accumulation helper
A new pure module `app/frontend/src/lib/zoom-gesture.ts` (colocated test) SHALL own the gesture→step reduction shared by both tiles: a stateful accumulator fed `ctrlKey` wheel deltas (pinch arrives as `wheel` with `ctrlKey: true`) that emits `+1`/`-1` step events when the accumulated `|deltaY|` crosses `WHEEL_STEP_THRESHOLD = 50` (sign-aware, remainder carried, accumulator reset on direction flip), plus a Safari `gesturechange` arm reducing the event `scale` ratio to steps at ~1.1× per step. One pinch or wheel tick MUST NOT over-step.

- **GIVEN** a rapid pinch producing many small ctrl-wheel deltas
- **WHEN** the deltas accumulate to 2× the threshold
- **THEN** exactly two step events are emitted

#### R7: Terminal ctrl-wheel/pinch steps the font size
`terminal-client.tsx` SHALL attach non-passive `wheel` (capture) and Safari `gesturestart`/`gesturechange` listeners on the terminal container that, ONLY when `ctrlKey` is set (wheel) or for gesture events, `preventDefault()` and step the existing global font preference through the ChromeContext stepper seam (the same increase/decrease used by the palette actions — bounds `TERMINAL_FONT_BOUNDS` 8–24, step 1, [terminal](../../docs/memory/run-kit/ui/terminal.md) § Terminal Font Size). Unmodified wheel events MUST pass through untouched to xterm; the touch-scroll-to-tmux handler (`terminal-client.tsx:637+`) MUST be untouched. Because the preference is global, all mounted terminals react (existing semantics).

- **GIVEN** focus/pointer over the terminal at 13px
- **WHEN** the user scrolls with Ctrl held (or pinches out on a touchpad)
- **THEN** the font steps up within bounds, the PTY refits (existing `fit()` path), and the browser page does NOT zoom
- **AND** a plain (unmodified) scroll still scrolls the terminal exactly as before

#### R8: Web tile ctrl-wheel/pinch steps the web zoom (same-origin)
`IframeWindow` SHALL step its zoom from the same gestures: listeners attached to the same-origin `contentWindow` on every iframe `load` (the chord-reclaim attach pattern — try/catch, cross-origin/pre-load skips silently, re-attach per navigation) AND to the tile's own wrapper (covering the URL-bar/chrome area). `ctrlKey` wheel + gesture events `preventDefault()` and step; everything else passes through. For `external` frames gestures over the frame are unreachable — accepted platform limit; the header control and palette remain the triggers (no fallback attach attempted).

- **GIVEN** a same-origin (present/proxied) page in the web tile
- **WHEN** the user ctrl-scrolls with the pointer over the page
- **THEN** the tile's zoom steps and the gesture never reaches browser page-zoom
- **AND** over a cross-origin frame the same gesture does whatever the browser does natively (no interception claimed)

### Non-Goals

- Claiming Cmd/Ctrl+Plus/Minus/Digit0 keyboard chords — deliberately shell-owned (`keybindings.ts:386-388`); reversing that reservation is a severed future decision.
- Electron `webContents.setZoomFactor` for external tiles in the desktop shell.
- Per-window terminal font size — the terminal preference stays the single per-device global.
- Zooming the `code` surface (code-server ships its own zoom) and the `chat` surface (browser page zoom covers it).

### Design Decisions

#### Scale wrapper over guest-document CSS zoom
**Decision**: web zoom is a transform-scale wrapper on the iframe with compensated width/height.
**Why**: works for all four address kinds including cross-origin `external`; reproduces browser-zoom semantics (smaller CSS viewport when zooming in, responsive layouts adapt); zero reach into guest documents.
**Rejected**: injecting CSS `zoom` into the guest document — same-origin only, and touching proxied content re-opens the proxy-rewrite class of bugs (stale Content-Length scar).
*Introduced by*: 260823-cwvv-tile-content-zoom-gestures

#### Content zoom owns "Zoom"; tile-maximize becomes "Expand"
**Decision**: rename tile-maximize's user-facing strings to Expand/Restore; keep ids, glyph seams, and internals stable.
**Why**: two different "Zoom"s in one tile header/palette is a vocabulary collision; ids persist in user macros/overrides so only labels may move.
**Rejected**: per-surface content-zoom names with `Layout: Zoom` untouched — leaves "zoom" meaning maximize, fighting every browser's muscle-memory meaning of the word (user-decided, intake Clarifications 2026-08-23).
*Introduced by*: 260823-cwvv-tile-content-zoom-gestures

## Tasks

### Phase 1: Setup (pure modules)

- [x] T001 [P] Create `app/frontend/src/lib/web-zoom.ts` + `web-zoom.test.ts`: `WEB_ZOOM_LEVELS`, `stepWebZoom`, `webZoomKeyFor` (via `classifyAddress`), `readWebZoom`/`writeWebZoom` (single `runkit-web-zoom` map key, try/catch-noop, level 1 deletes entry), `WEB_ZOOM_EVENT` constant <!-- R3, R5 -->
- [x] T002 [P] Create `app/frontend/src/lib/zoom-gesture.ts` + `zoom-gesture.test.ts`: ctrl-wheel accumulator (threshold 50, remainder carry, direction-flip reset) + `gesturechange` scale reducer <!-- R6 -->

### Phase 2: Core Implementation

- [x] T003 `app/frontend/src/components/iframe-window.tsx`: zoom state seeded from `readWebZoom(webZoomKeyFor(rkUrl))`, re-seeded on rkUrl bucket change; scale wrapper around the iframe (`overflow-hidden` wrapper, compensated width/height + `transform: scale`); persist on change <!-- R2, R3 -->
- [x] T004 URL-bar zoom control in `iframe-window.tsx`: percent readout + −/+/reset per the URL-bar button vocabulary, `data-testid="web-zoom-control"`, absent in onboarding state <!-- R4 -->
- [x] T005 `iframe-window.tsx`: gesture attach — non-passive ctrl-wheel + `gesture*` listeners on same-origin `contentWindow` per load (try/catch pattern) and on the tile wrapper; step via the T002 accumulator; `WEB_ZOOM_EVENT` document listener answering the palette <!-- R5, R8 -->
- [x] T006 `app/frontend/src/components/terminal-client.tsx` + `src/contexts/chrome-context.tsx`: expose/consume the font stepper seam; non-passive ctrl-wheel (capture) + `gesture*` listeners on the terminal container stepping the global font; unmodified wheel and touch-scroll handler untouched <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T007 Register `Web: Zoom in/out/reset` palette actions (`use-global-palette-actions.ts` or the web-gated registration site beside `Web: Find in page`), gated on open web tile + `hasWebUrl`, dispatching `WEB_ZOOM_EVENT` <!-- R5 -->
- [x] T008 Rename tile-maximize user-facing strings: `palette-layout.ts:150-151` labels, `surface-layout.tsx:1576,1579` Tip/aria-labels, `keybindings.ts:291` description; ids/`data-icon`/internals unchanged <!-- R1 -->
- [x] T009 Sweep tests + docs for the old labels: update every unit/e2e assertion matching `Layout: Zoom`/`Unzoom`/`Zoom ${label}` by role/name (use `grep -a`/`perl` — session-tiles.tsx NUL caveat makes plain grep sweeps unreliable); update `.spec.md` companions of touched specs <!-- R1 -->
- [x] T010 Component unit tests: `iframe-window` zoom (seed/step/persist/onboarding-hidden/wrapper styles) and `terminal-client` ctrl-wheel stepping vs plain-wheel passthrough (jsdom dispatch) <!-- R2, R4, R7 -->

### Phase 4: Polish

- [x] T011 e2e `app/frontend/tests/e2e/web-tile-zoom.spec.ts` + `.spec.md`: on the real-tmux rig (web-view-lens pattern) — zoom control steps a presented same-origin page (assert wrapper transform + readout), reset returns to 100%, level persists across reload, control absent on onboarding tile; palette `Web: Zoom in` steps the tile <!-- R2, R3, R4, R5 -->
- [x] T012 Run gates: `cd app/backend && go test ./...` (untouched, smoke), `cd app/frontend && npx tsc --noEmit`, targeted `just test-frontend`, the new/touched e2e specs via `just test-e2e "<spec>"` <!-- R1-R8 -->

## Execution Order

- T001, T002 are independent [P]
- T003 blocks T004, T005; T001 blocks T003; T002 blocks T005, T006
- T007 needs T005's event listener; T009 follows T008
- T010-T012 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: No user-visible string (palette labels, tile-header Tips/aria-labels, binding descriptions) calls tile-maximize "Zoom"; `Layout: Expand`/`Layout: Restore` work with ids `layout-zoom`/`layout-unzoom` unchanged
- [x] A-002 R2: The web tile scales its iframe via the compensated wrapper; `s = 1` renders byte-identical layout to before
- [x] A-003 R3: `web-zoom.ts` exists as a pure module with the ladder, key derivation per address kind, and map-key persistence; zoom restores per bucket across reloads
- [x] A-004 R4: The URL-bar zoom control renders (readout + steppers + reset) on live tiles and is absent in onboarding
- [x] A-005 R5: The three `Web: Zoom` palette actions exist, gate like `Web: Find in page`, and drive the tile via `WEB_ZOOM_EVENT`
- [x] A-006 R6: `zoom-gesture.ts` exists, shared by both tiles, with remainder-carry threshold stepping proven by unit tests
- [x] A-007 R7: Ctrl-wheel/pinch over the terminal steps the global font within `TERMINAL_FONT_BOUNDS` and prevents browser page zoom
- [x] A-008 R8: Ctrl-wheel/pinch over same-origin web content steps the tile zoom; cross-origin frames are left alone

### Behavioral Correctness

- [x] A-009 R7: Unmodified wheel over the terminal scrolls exactly as before; the touch-scroll-to-tmux handler is unchanged
- [x] A-010 R3: Zoom state is never POSTed — no `/options` or other API request carries it (per-viewer localStorage only)
- [x] A-011 R2: Find-in-page highlights, the load progress line, and the error surfaces still render correctly on a zoomed tile

### Scenario Coverage

- [x] A-012 R2/R4/R5: e2e proves control-stepping, reset, persistence, onboarding absence, and palette stepping on a same-origin page
- [x] A-013 R1: e2e/unit assertions updated in T009 pass — no stale "Zoom/Unzoom" name selectors remain

### Edge Cases & Error Handling

- [x] A-014 R3: Storage-unavailable reads/writes no-op silently; an off-ladder stored value snaps to the nearest level
- [x] A-015 R6: Direction reversal mid-accumulation resets the accumulator (no phantom steps); a single wheel tick steps at most once
- [x] A-016 R8: Pre-load and cross-origin `contentWindow` access never throws (try/catch attach posture)

### Code Quality

- [x] A-017 Pattern consistency: new modules follow the pure-lib contract (DOM-free where possible, colocated tests); listeners cleaned up on effect teardown
- [x] A-018 No unnecessary duplication: both tiles share `zoom-gesture.ts`; the web control reuses register glyph/Tip vocabulary
- [x] A-019 No client polling: zoom stays event-driven; no `setInterval`
- [x] A-020 New UI actions registered in the command palette (Constitution V) and `.spec.md` companions updated with touched specs

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality (web-zoom module, gesture reduction, zoom control, gesture listeners, palette actions) and renames labels only; no existing code was made redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `present`/`relative` addresses share one viewer-origin persistence bucket (`self`) rather than per-path buckets | Same-origin content; per-path buckets would fragment state for presented files that rotate paths; trivially tunable in `webZoomKeyFor` | S:55 R:85 A:80 D:70 |
| 2 | Confident | Gesture thresholds: 50 accumulated wheel delta per step; ~1.1× gesture scale per step | Matches common editor/browser feel; isolated constants in `zoom-gesture.ts` | S:50 R:90 A:80 D:70 |
| 3 | Certain | Palette action ids `web-zoom-in`/`web-zoom-out`/`web-zoom-reset`; event `web-zoom` with `detail.direction` | Follows the `web-find`/`terminal-export` id + CustomEvent conventions verbatim | S:80 R:85 A:90 D:85 |
| 4 | Confident | Terminal palette labels stay "Increase/Decrease/Reset terminal font" (no relabel to "Zoom") | Intake #6 says terminal MAY adopt zoom vocabulary; the font labels are accurate and relabeling churns docs/tests for no discoverability gain — the gesture is the addition | S:60 R:90 A:75 D:65 |
| 5 | Confident | Zoom control placement: in the URL-bar cluster between the find ⌕ and open-external ↗ buttons | Intake fixes "by the address bar/FindBar area"; exact slot is apply's discretion per confirmed intake assumption #8 | S:60 R:90 A:80 D:70 |
| 6 | Certain | `data-icon="zoom"`, `ZoomGlyph`, `zoomToggleRef`, `layout-zoom`/`layout-unzoom` ids all keep their names | Intake #6: stable ids/seams, label-only rename | S:85 R:80 A:90 D:90 |
| 7 | Confident | The zoom control's percent readout doubles as the reset affordance (text-glyph − / readout / +, readout disabled at 100%) | R4 fixes percent readout + in/out/reset in the URL-bar button vocabulary; the readout-as-reset keeps the cluster compact and mirrors browser zoom UI | S:55 R:85 A:80 D:65 |
| 8 | Confident | Ctrl OR Meta on the wheel event both count as the zoom modifier on both tiles | Pinch arrives as `wheel` with `ctrlKey: true` cross-browser (Safari gesture* covered separately); an explicit Cmd-scroll on macOS should behave the same — the modifier set is a superset of the pinch signal, never a conflict with terminal chords (Alt is the excluded tier, not Ctrl/Meta) | S:50 R:90 A:75 D:70 |
| 9 | Confident | T012's touched-e2e scope is the renamed-selector specs (`surface-layout`, `compose-strip`) plus the new `web-tile-zoom` spec | The rename sweep touched selectors only in those two specs; the full e2e suite is `just test`'s job, not the apply gate's | S:55 R:85 A:75 D:65 |

9 assumptions (3 certain, 6 confident, 0 tentative).
