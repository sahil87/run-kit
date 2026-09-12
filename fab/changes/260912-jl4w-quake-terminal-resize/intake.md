# Intake: Quake Terminal Edge and Corner Resize

**Change**: 260912-jl4w-quake-terminal-resize
**Created**: 2026-09-12

## Origin

One-shot `/fab-new` invocation, Change 1 of the three-change sequential plan `fab/plans/sahil/26-09-12-quake-terminal-drawer.md` (drafted from the 2026-09-12 `/fab-discuss` session on the operator console drawer). Change 0 — the rename to *quake terminal* / *quake launcher* — is merged to `main` as PR #959 (`95604862`); this branch starts fresh from that commit, so every file, test id, CSS class, storage key, and memory file below already carries the renamed vocabulary.

> Every exposed edge of the quake terminal (renamed from operator console in the just-merged PR #959) resizes -- full bottom edge, both sides, both bottom corners (two axes at once) -- with a hover cue on the grabbed edge, independent-edge geometry so a corner tracks the pointer, and double-click reset. This is Change 1 of the sequential plan at fab/plans/sahil/26-09-12-quake-terminal-drawer.md -- read that file's Standing context and Change 1 sections in full before writing the intake; slug quake-terminal-resize. Change 0 (the rename) is merged to main, so start fresh off it -- the renamed vocabulary (QuakeTerminal, quake launcher, etc.) is already in place.

**Decisions of record carried from the plan and the design study** (`docs/wiki/operator-console-drawer-studies.html`, Study C is a live resize mock):

- Resize goes **independent-edge**: geometry gains `centerOffsetPx`; symmetric-about-center is retired because a corner cannot follow the pointer under it (pulling the bottom-right corner 100px right grows a symmetric drawer 200px, so the corner runs away from the pointer at twice its speed). Symmetric width was chosen to keep the drawer centered under the top-bar launcher; the quake genre only needs the drawer to *open* centered, not to *stay* so.
- Clamps stay 25–85vh and 420px–96vw; the offset is clamped so the drawer never leaves the viewport; the reader defaults a missing offset to 0 so stored geometry survives.
- Change 1 is self-contained and a light-lane candidate; it ships before Change 2 (docked compose), which will touch the same component and memory sections — hence strictly sequential.
- Non-goals fixed by the plan: any change to what the drawer contains; the mobile tongue (`QuakeTerminalTongue` — the mobile standing affordance — is not a resize grip and is untouched).

## Why

**The pain.** Today only the 64×12px tongue hanging from the drawer's bottom edge drags height; the rest of the bottom edge is inert. Side grips exist but are invisible 8px zones with no hover cue, so the drawer reads as "not resizable" from the sides. There are no corners, so nothing drags two axes at once — sizing the drawer to a target shape is two separate drags. And the side grips resize *symmetrically about the center line* (an edge delta moves both sides; the width changes by twice the pointer delta), so even if corners were added under today's model the corner would not track the pointer (Study C, "Today" mode).

**The consequence of not fixing it.** Change 2 docks the compose inside the drawer and collapses the top-bar launcher to a glyph, which removes the only reason the drawer had to stay centered — and adds a bottom strip the user will want to size around. Shipping corners on top of symmetric geometry would produce a visibly wrong gesture (the corner escaping the pointer); shipping Change 2 without full-edge resize leaves the invisible-grip problem in the surface users will now spend more time in.

**Why this approach.** Independent edges + a persisted `centerOffsetPx` is the standard window-manager model: each edge moves only its own side, a corner is simply both masks set, and the pointer stays under the grabbed edge by construction. The hover cue reuses the app's existing drag-affordance vocabulary (the accent-green sash on layout dividers — [visual-design](/run-kit/ui/visual-design.md) § Layout dividers), so the grips become discoverable without inventing a new treatment. Double-click reset gives a one-gesture way back to the default once the drawer has been dragged off-center or into an odd shape.

## What Changes

All paths are under `app/frontend/` unless stated. The change is desktop-only (the drawer never renders under `useIsMobile()`).

### 1. Geometry shape and clamp — `src/lib/quake-terminal.ts`

**Type.** `QuakeGeometry` grows a third field:

```ts
export type QuakeGeometry = { heightVh: number; widthPx: number; centerOffsetPx: number };
export const QUAKE_GEOMETRY_DEFAULT: QuakeGeometry = { heightVh: 55, widthPx: 760, centerOffsetPx: 0 };
/** Minimum ground kept visible between the drawer and either viewport edge when
 *  clamping the center offset. */
export const QUAKE_EDGE_PAD_PX = 8;
```

`centerOffsetPx` is the signed horizontal displacement of the drawer's center from the viewport's center: positive = drawer sits right of center. The default is 0 (opens centered — the quake genre's one positional requirement).

**Clamp.** `clampQuakeGeometry(geometry, viewportWidth = window.innerWidth)` keeps the existing height (25–85vh) and width (420px–`0.96 * viewportWidth`) clamps and adds the offset clamp, evaluated *after* the width clamp so it uses the clamped width:

```ts
const maxOffset = viewportWidth !== undefined
  ? Math.max(0, (viewportWidth - widthPx) / 2 - QUAKE_EDGE_PAD_PX)
  : Infinity;
const centerOffsetPx = Math.round(Math.min(maxOffset, Math.max(-maxOffset, geometry.centerOffsetPx)));
```

So `|centerOffsetPx| ≤ (viewport − width)/2 − 8`, and when the width is at its 96vw ceiling the offset collapses to within ±(2vw − 8px) — never negative range (the `Math.max(0, …)`). Non-finite offsets are treated as 0 before clamping.

**Reader.** `parseStoredGeometry` accepts the old two-field shape: a missing `centerOffsetPx` defaults to 0; a present-but-non-numeric one invalidates the record (same posture as the existing `heightVh`/`widthPx` type checks — corrupt → defaults). The retired-key fallback (`runkit-operator-console-geometry`, read when the new key is absent, removed on write) is unchanged; a retired-key record is always two-field and reads with offset 0.

**Writer.** `writeQuakeGeometry` clamps (now including the offset) and stores all three fields under `runkit-quake-terminal-geometry`. `useQuakeGeometry()` keeps its `[value, setter]` shape and pub/sub idiom.

Consumers of `QuakeGeometry` are exactly `lib/quake-terminal.ts` and `components/quake-terminal.tsx` (plus their tests) — no settings-dialog row reads geometry (the settings row is opacity only).

### 2. Drag model — `src/components/quake-terminal.tsx`

Replace the `kind: "height" | "left" | "right"` discriminant with an **edge mask** and one pointer handler set:

```ts
/** Which drawer edges a grip moves: x = −1 left edge, +1 right edge, 0 neither;
 *  y = 1 bottom edge, 0 not. A corner sets both. */
export type QuakeResizeEdge = { x: -1 | 0 | 1; y: 0 | 1 };
```

`dragRef` becomes `{ edge: QuakeResizeEdge; startX; startY; start: QuakeGeometry }`. On `pointermove`, with `dx = e.clientX − startX`, `dy = e.clientY − startY`:

```ts
const next = { ...drag.start };
if (drag.edge.y === 1) next.heightVh = drag.start.heightVh + (dy / window.innerHeight) * 100;
if (drag.edge.x === -1) { next.widthPx = drag.start.widthPx - dx; next.centerOffsetPx = drag.start.centerOffsetPx + dx / 2; }
if (drag.edge.x === 1)  { next.widthPx = drag.start.widthPx + dx; next.centerOffsetPx = drag.start.centerOffsetPx + dx / 2; }
setDragOverride(clampQuakeGeometry(next));
```

Moving one edge by `dx` changes the width by `dx` and shifts the center by `dx/2`, so the *opposite* edge stays put and the grabbed edge stays under the pointer. Unchanged from today: `button !== 0` ignored; `setPointerCapture`/`releasePointerCapture` in try/catch (synthetic events in unit tests have no active pointer); `.rk-quake-dragging` suspends the slide transition for the drag's duration; the live drag drives the in-component `dragOverride`; the store write lands once on `pointerup`. Add `onPointerCancel` to the same up-handler (a captured pointer that is cancelled mid-drag must not leave the drawer stuck in the dragging state).

**Note on the clamp at the edge.** When the width clamp bites (e.g. dragging the right edge past 96vw or under 420px), the offset formula above still applies `dx/2` from the raw delta; the offset clamp then bounds it. That means at the width floor the grabbed edge stops tracking the pointer — expected (the drawer cannot shrink further) and matches the study mock.

### 3. Drawer positioning — `src/components/quake-terminal.tsx`

The drawer root currently centers with Tailwind `left-1/2 -translate-x-1/2` (the centering rides the CSS `translate` property; the slide rides `transform`, so they compose — see the `.rk-quake-slide` comment in `globals.css`). Apply the offset through `left`, leaving both transform channels untouched:

```ts
style={{
  left: `calc(50% + ${effectiveGeometry.centerOffsetPx}px)`,
  width: `${effectiveGeometry.widthPx}px`,
  maxWidth: "96vw",
  height: `${effectiveGeometry.heightVh}vh`,
  ...glassStyle,
}}
```

and drop `left-1/2` from the className (keep `-translate-x-1/2`). The `maxWidth: 96vw` idiom stays so the CSS width ceiling keeps tracking live viewport resizes.

**Live viewport resize re-clamp.** Add a `window` `resize` listener (effect, desktop-render only) that bumps a re-render so `effectiveGeometry = clampQuakeGeometry(dragOverride ?? geometry)` is re-evaluated against the new `innerWidth`. This is a **display-only** re-clamp: it does not write the store (a transiently narrow window must not destroy the viewer's preferred offset — the persisted value re-applies once the viewport is wide again). The width is already CSS-clamped by `maxWidth`; the offset is what needs JS.

### 4. Grips — `src/components/quake-terminal.tsx` + `src/globals.css`

Five grip elements, all `aria-hidden="true"`, `touch-none`, `select-none`, `absolute`, rendered as the last children of the drawer root (corners after edges so they win the hit test where they overlap):

| Grip | `data-testid` | Edge mask | Box | Cursor |
|---|---|---|---|---|
| Left edge | `quake-terminal-grip-left` | `{x:-1, y:0}` | `left-[-5px] top-0 bottom-0 w-2.5` (10px straddling the border: 5 out, 5 in) | `cursor-ew-resize` |
| Right edge | `quake-terminal-grip-right` | `{x:1, y:0}` | `right-[-5px] top-0 bottom-0 w-2.5` | `cursor-ew-resize` |
| Bottom edge | `quake-terminal-grip-bottom` | `{x:0, y:1}` | `left-0 right-0 bottom-[-5px] h-2.5` (full width) — the existing tongue `<span>` (64×12px, `rounded-b-md`, glass background) renders **inside** this element at `left-1/2 top-full -translate-x-1/2`, so the tongue stays the visual pull tab and remains a valid grab by containment | `cursor-ns-resize` |
| Bottom-left corner | `quake-terminal-grip-bottom-left` | `{x:-1, y:1}` | `left-[-6px] bottom-[-6px] h-4 w-4` (16px) | `cursor-nesw-resize` |
| Bottom-right corner | `quake-terminal-grip-bottom-right` | `{x:1, y:1}` | `right-[-6px] bottom-[-6px] h-4 w-4` | `cursor-nwse-resize` |

The old `quake-terminal-grip-height` test id is retired in favor of `-bottom`; the existing Vitest and e2e selectors move with it. The top edge is not a grip (it is the drawer's seam with the top bar — the slide origin).

**Hover cue — the grabbed edge tints accent-green.** Reuse the layout-divider sash vocabulary ([visual-design](/run-kit/ui/visual-design.md) § Layout dividers: a 5px rounded `--color-accent-green` pill filling the seam on hover after a ~150ms anti-flicker `transition-delay`, immediate on drag; the `main-*` T-junction lights BOTH sashes). Concretely:

- The component tracks `hoverEdge: QuakeResizeEdge | null` (set on grip `pointerenter`, cleared on `pointerleave`) and derives `litEdge = dragRef.current?.edge ?? hoverEdge`. The three **edge** grips read `lit` = their axis is set in `litEdge` (so hovering or dragging a corner lights both adjacent edges — the T-junction idiom); corners themselves paint nothing.
- A lit edge grip carries `data-lit=""` and the class `rk-quake-grip-lit`; every edge grip carries `rk-quake-grip`. In `globals.css`, `.rk-quake-grip::after` is a 3px `--color-accent-green` bar with `border-radius: 2px`, positioned along the drawer border inside the grip (for the sides: `top: 0; bottom: 0; width: 3px;` at the grip's inner edge; for the bottom: `left: 0; right: 0; height: 3px;` at the inner edge), `opacity: 0` at rest, `opacity: 1` when `.rk-quake-grip-lit`, with `transition: opacity 120ms` and a `transition-delay: 150ms` on the hover-in direction only (the lit → unlit direction and the dragging state have zero delay: `.rk-quake-dragging .rk-quake-grip-lit::after { transition-delay: 0ms }`). The tongue span keeps its glass background; when the bottom edge is lit the tongue's border also takes `border-color: var(--color-accent-green)`.
- `prefers-reduced-motion`: the existing reduced-motion block zeroes the transition and delay; the lit state remains (static green — "static under `prefers-reduced-motion`", the project's hover-vocabulary rule).

### 5. Double-click reset — `src/components/quake-terminal.tsx` + palette

`onDoubleClick` on any of the five grips calls `writeGeometry(QUAKE_GEOMETRY_DEFAULT)` (55vh × 760px, offset 0) and clears any `dragOverride`. The two pointerdown/up pairs a double-click emits each write the unchanged geometry first — harmless, the reset write lands last.

**Palette entry** (Constitution V — every action reachable from a UI control is registered in the palette): add `Operator: Reset quake terminal size` (id `quake-terminal-reset-size`) in `src/lib/palette/quake-terminal.ts` beside the existing `Operator: …` builders, wired in `app.tsx`'s action map to `writeQuakeGeometry(QUAKE_GEOMETRY_DEFAULT)`; the row is desktop-only (omitted on mobile where no drawer geometry exists) and needs no open drawer — the store write applies live to an open drawer via the pub/sub notify and to the next open otherwise. No keybinding.

### 6. Tests

- **`src/lib/quake-terminal.test.ts`** — extend the `quake geometry store` block: (a) a stored two-field record `{heightVh:70, widthPx:900}` reads as `{…, centerOffsetPx:0}`; (b) a retired-key two-field record reads with offset 0; (c) a non-numeric `centerOffsetPx` falls back to defaults; (d) `clampQuakeGeometry({heightVh:55, widthPx:760, centerOffsetPx:500}, 1000)` → offset `112` (= (1000−760)/2 − 8) and the negative mirror → `−112`; (e) at width ≥ 96vw the offset clamps to `(0.04·vw)/2 − 8` floored at 0; (f) round-trip write/read of a three-field record; (g) `QUAKE_GEOMETRY_DEFAULT.centerOffsetPx === 0`.
- **`src/components/quake-terminal.test.tsx`** — rewrite the two existing drag tests and add: dragging `grip-right` by +100px → `widthPx` +100, `centerOffsetPx` +50, left edge unchanged; dragging `grip-left` by −100px → `widthPx` +100, `centerOffsetPx` −50; dragging `grip-bottom` (and the tongue span inside it) changes only `heightVh`; dragging `grip-bottom-right` by (+100, +Δy) changes width, offset, and height together; the drawer's `left` style reads `calc(50% + Npx)` during and after the drag; hovering `grip-bottom-right` sets `data-lit` on `grip-right` and `grip-bottom` only; `pointercancel` ends the drag; double-click on any grip writes `QUAKE_GEOMETRY_DEFAULT` to `runkit-quake-terminal-geometry`; a `window` resize event re-clamps the rendered `left` without writing the store.
- **`src/lib/palette/quake-terminal.test.ts`** — the new builder produces the `Operator: Reset quake terminal size` row.
- **`tests/e2e/quake-terminal.spec.ts`** — update the existing height-drag test's selector to `quake-terminal-grip-bottom` (and its JSDoc); add one test: drag the bottom-right corner by (+120, +80) with `page.mouse` and assert (via `boundingBox()`) that the drawer's right edge and bottom edge land within 4px of the pointer, the left edge did not move, and `runkit-quake-terminal-geometry` holds a positive `centerOffsetPx`; reload + reopen via the chord and assert the `left` style carries the persisted offset. Both tests carry the constitution's **Proves/Steps** JSDoc. The spec file header's resize sentence is updated.

Verification per the plan's standing context: `npx tsc --noEmit` (from `app/frontend`, after `pnpm install --frozen-lockfile` in a fresh worktree), the affected Vitest suites (`just test-frontend` scoped to the three quake files), and `just test-e2e quake-terminal` — never the full suite as a gate.

### Non-goals

- Anything the drawer *contains* (segments, terminal, status line) — Change 2's territory.
- The mobile tongue's behavior or the mobile arm at all (nothing renders on mobile).
- A top-edge grip (the top is the slide seam), keyboard-driven resize, or a resize *settings* row.
- Touching `operator-compose-dialog.tsx` / `operator-compose.spec.ts`.

## Affected Memory

- `run-kit/ui/quake-terminal`: (modify) rewrite § *Mouse resize with per-viewer geometry persistence (desktop drawer)* — five grips (full bottom edge with the tongue inside it, both sides, two 16px bottom corners), independent-edge math (`dx` → width, `dx/2` → `centerOffsetPx`), the three-field storage shape with the missing-offset-defaults-to-0 read rule, the offset clamp with `QUAKE_EDGE_PAD_PX`, the display-only viewport re-clamp, the lit-edge hover cue, and double-click reset; update its Scenario to a corner drag; touch the § Anatomy sentence that says "a centered drawer" (opens centered, may sit off-center after a drag) and the § Affordance pair sentence "it IS the height drag grip" (the tongue is now inside the bottom grip). Design Decisions gain **Independent edges replace symmetric-about-center** (Decision / Why: a corner cannot track the pointer under symmetric width; centering was for the top-bar launcher anchor, which Change 2 removes / Rejected: symmetric width with corners; no corners) and **Grip hover cue reuses the divider sash vocabulary**.
- `run-kit/ui/visual-design`: (modify) the hover-vocabulary table's *Layout dividers (drag affordance)* row gains the quake terminal's edge grips as a consumer of the accent-green lit-seam treatment (3px inner bar, same 150ms anti-flicker delay, corners light both adjacent edges).
- `run-kit/ui/keyboard-and-palette`: (modify) the `Operator: …` palette family gains `Operator: Reset quake terminal size`.

## Impact

- **Frontend only**: `src/lib/quake-terminal.ts` (type, default, clamp, parse), `src/components/quake-terminal.tsx` (drag model, positioning, grips, hover state, dblclick, resize listener), `src/globals.css` (`.rk-quake-grip*` rules + reduced-motion line), `src/lib/palette/quake-terminal.ts` + `src/app.tsx` (one palette row), three Vitest files, one e2e spec. No backend, API, tmux, or URL state.
- **Storage compatibility**: readers of `runkit-quake-terminal-geometry` written before this change (two fields) keep working; a browser downgraded to the pre-change build would read three fields and — because the old parser only type-checked `heightVh`/`widthPx` — still parse (extra key ignored). No migration.
- **Behavior contract change**: side drags no longer keep the drawer centered; a viewer who liked the centered posture gets it back with the double-click / palette reset. The tongue keeps working as a height grip.
- **Risk surface**: e2e and Vitest selectors on `quake-terminal-grip-height` (renamed); the grips overlap the drawer body by 5px inside the border — same class of overlap as today's 4px side grips, still above the terminal's own edge; corners sit above the side/bottom grips in DOM order so their cursor wins; `left: calc(50% + …)` must not reintroduce `left-1/2`, or the offset double-applies.

## Open Questions

- None blocking. `QUAKE_EDGE_PAD_PX = 8` and the 3px lit-bar thickness are graded assumptions below, adjustable via `/fab-clarify`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Independent-edge geometry with a persisted `centerOffsetPx`; symmetric-about-center retired | Plan § Decisions of record + Study C: a corner cannot track the pointer under symmetric width | S:95 R:70 A:95 D:95 |
| 2 | Certain | Clamps stay 25–85vh / 420px–96vw; missing stored offset reads as 0; retired-key fallback unchanged | Plan Change 1 item 1 states it verbatim; matches the shipped parser posture | S:95 R:90 A:95 D:95 |
| 3 | Certain | Edge-mask drag model `{x:-1|0|1, y:0|1}` with `dx` → width and `dx/2` → offset; pointer capture, `.rk-quake-dragging`, store write on pointer-up unchanged | Plan Change 1 item 2 + the study's mock JS give the exact math | S:95 R:85 A:95 D:95 |
| 4 | Certain | Five grips: full bottom edge (tongue inside it), both sides full height, two 16px bottom corners; `ns`/`ew`/`nesw`/`nwse` cursors; zones straddle the border | Plan Change 1 item 3 + the study's CSS (10px edge zones at −5px, 16px corners at −6px) | S:90 R:90 A:90 D:90 |
| 5 | Certain | Double-click any grip resets to `QUAKE_GEOMETRY_DEFAULT` (55vh × 760px, offset 0) | Plan Change 1 item 4 (the plan's `CONSOLE_GEOMETRY_DEFAULT` is the pre-rename name of the same constant) | S:95 R:95 A:95 D:95 |
| 6 | Confident | Offset applied via `left: calc(50% + offsetPx)` keeping `-translate-x-1/2`; `left-1/2` dropped | Centering rides the `translate` property and the slide rides `transform`; `left` is the one free channel — one obvious default | S:60 R:90 A:90 D:85 |
| 7 | Confident | Hover cue = the divider sash vocabulary: 3px accent-green inner bar, 150ms anti-flicker delay on hover-in, immediate on drag; corners light both adjacent edges; reduced-motion keeps the static state | Plan says "tints that edge accent-green" and cites the hover vocabulary; visual-design memory already defines the sash idiom and the T-junction both-sashes rule | S:65 R:90 A:80 D:70 |
| 8 | Confident | `QUAKE_EDGE_PAD_PX = 8` for the offset clamp | Plan writes the clamp as `(viewport − width)/2 − pad` without a value; the study mock uses 12 on a scaled stage; 8px keeps a hairline of ground visible and is trivially retunable | S:50 R:95 A:70 D:65 |
| 9 | Confident | Viewport-resize re-clamp is display-only (re-render, no store write) | Plan asks for "a resize listener"; writing on every resize would erase a viewer's preferred offset during a transient narrow window — Constitution IV posture of writing preferences only on user action | S:55 R:90 A:80 D:75 |
| 10 | Confident | Add palette row `Operator: Reset quake terminal size` (id `quake-terminal-reset-size`), desktop-only, no keybinding | Constitution V requires every UI-control action to be in the palette; the plan is silent for Change 1 but cites V for Change 2's pin; one small builder in the existing file | S:45 R:95 A:90 D:80 |
| 11 | Confident | Test ids `quake-terminal-grip-{left,right,bottom,bottom-left,bottom-right}`; `-grip-height` retired and its two existing tests migrated | Naming follows the existing `-grip-left/right` pattern; the tongue is now inside the bottom grip so a separate `-height` id would be a duplicate | S:55 R:95 A:85 D:80 |
| 12 | Confident | `pointercancel` routes to the pointer-up handler | Not in the plan; a cancelled captured pointer otherwise leaves `.rk-quake-dragging` stuck — standard pointer-events hygiene | S:40 R:95 A:90 D:90 |
| 13 | Certain | Verification: `npx tsc --noEmit` + scoped Vitest + `just test-e2e quake-terminal`; never the full suite as a gate; e2e `test()` JSDoc updated in the same commit | Plan § Standing context + Constitution Test Intent Comments | S:90 R:95 A:95 D:95 |

13 assumptions (6 certain, 7 confident, 0 tentative, 0 unresolved).
