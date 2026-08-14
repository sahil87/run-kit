# Intake: Gap-Seam Tile Chrome

**Change**: 260814-011r-gap-seam-tile-chrome
**Created**: 2026-08-14

## Origin

Synthesized from a `/fab-discuss` design session (2026-08-14). The user reviewed an interactive mock of the full treatment and approved it verbatim: "it looks good. Go ahead". Dispatched promptless (`/fab-draft`-style create-intake, `{questioning-mode} = promptless-defer`) — no further questions were asked; the mock pinned the visual spec.

> Gap-seam tile chrome — VS Code-style borders for the surface-layout tiles. Adopt VS Code's current border/drag design language for the terminal route's tile grid (`app/frontend/src/components/surface-layout.tsx`, the 260812-wfic framed grid). The seam between tiles stops reading as a shared border and becomes a legible gap with rest-state drag affordances and a rounded accent sash on hover/drag. Tier 1 scope only: surface-layout tiles (plus applying the same vocabulary to board tiles where they share the framed-tile family). Tier 2 — shell-wide card-ification (sidebar/center/rail as floating cards) — explicitly DEFERRED to a separate future change.

## Why

1. **The pain point**: today's framed grid (260812-wfic) separates tiles with a 3px gutter and full-strength `border-border` frames — adjacent tile borders sit 3px apart and read as one shared border, not as separate cards with a gap between them. The divider drag affordance is invisible at rest: the 6px hit zone only reveals itself as a hard green fill on hover (`hover:bg-accent-green` on the whole hit zone), so "you can drag here" has zero rest-state discoverability, and the hover fill is an unshaped rectangle that touches the tile corner radii. The single-tile terminal has no card identity at all — it fills the center flush, so "the home for the main panel" never reads as a rounded card.
2. **If we don't fix it**: the tile grid keeps a dated shared-border look while VS Code (the design language the rest of the chrome already borrows from — fixed-size verb buttons, boxed segments) has moved to gap-seam cards with grip-dot affordances and rounded sashes; drag discoverability stays hover-only; and `main-*` shapes keep an interaction gap — there is no way to move both ratios at once from the T-junction, which VS Code's intersection sash provides.
3. **Why this approach**: adopt VS Code's current vocabulary — the gap does the separating (borders dim), grip dots advertise draggability at rest, a rounded accent pill (sash) lights on hover/drag with an anti-flicker delay, and the T-junction becomes a two-axis handle. The user compared alternatives in an interactive mock and approved this exact treatment.

**Alternatives rejected** (from the design session):
- VS Code-literal **blue** sash — rejected: it would split run-kit's hover vocabulary, where green already means interactive/live-pane (CRT glint, focused tile, agent state).
- **Tier 2 shell card-ification now** (sidebar/center/rail as floating cards, the full VS Code workbench look) — deferred to a separate future change: bigger blast radius (Shell seam branches, board-page's no-handle branch, mobile drawer).
- **Keeping full-strength tile borders** — the approved mock uses the 55% dimmed border. Known tension, decided: the dimmed border may weaken card edges against dark terminal content; the user approved the mock anyway. The full-border fallback stays a noted escape hatch, not part of this change.

## What Changes

All changes are desktop-only; the mobile branch is exempt (see § Mobile below). Current code anchors verified against `app/frontend/src/components/surface-layout.tsx` at HEAD.

### 1. Seam geometry (grid + tile classes)

Current: the grid container is `relative flex-1 min-h-0 min-w-0 grid gap-[3px] bg-bg-inset` (line ~879); each desktop tile is `border rounded ${isFocused ? "border-accent-green" : "border-border"}` (line ~687).

Target:
- **Gutter**: `gap-[3px]` → `gap-[6px]`.
- **NEW ground inset**: 6px padding around the grid container (`p-[6px]` on the `bg-bg-inset` ground) so tiles float on the inset ground on all four sides — the single-tile terminal reads as a rounded card ("the home for the main panel gets rounded borders"). Applies at every arity including `single`.
- **Tile radius**: `rounded` (4px) → `rounded-md` (6px). Safe with xterm: tiles already carry `overflow-hidden` and the tty body keeps its `py-0.5 px-1` padding.
- **Tile border dims to ~55%**: the rest-state tile border color becomes a 55% mix of the border token, e.g. `color-mix(in srgb, var(--color-border) 55%, transparent)` — the gap does the separating, the border only defines the card edge. Light theme comes free via the existing tokens (white cards on `#e8eaef` ground).
- **Focused tile border unchanged**: stays full `--color-accent-green` (existing 260812-wfic R2 behavior — suppressed at arity 1, default slot A).

### 2. Rest-state grip dots + hover/drag sash (divider redesign)

Current: each divider is an absolutely-positioned 6px hit zone (`w-1.5`/`h-1.5`, centered on the boundary via `-translate-x-1/2`/`-translate-y-1/2`) that fills solid on interaction: `hover:bg-accent-green ${draggingIndex === spec.index ? "bg-accent-green" : ""}` (lines ~896–900).

Target, three states per divider:
- **Rest**: 3 centered grip dots (~2.5px each, border-colored, `pointer-events-none`) rendered in the gutter — "draggable here" without hover. No fill.
- **Hover**: a 5px-wide rounded pill (border-radius 3px) fills the gap along the seam, inset ~10px from the tile corners at both ends so it never touches the tile radii. The pill appears after a ~150ms hover `transition-delay` (VS Code's anti-flicker — brushing across a seam en route to a tile must not strobe). Grip dots invert to bg-colored (ground color) while the sash is lit so they read as punched-out of the pill.
- **Dragging**: the same pill, zero delay (`draggingIndex === spec.index` renders it immediately).
- **Hit zone**: widens 6px → 14px (`w-1.5` → `w-3.5`, same centering transform) to cover the wider 6px gutter plus slop. Drag mechanics (`onDividerPointerDown`/`Move`/`Up`, pointer capture, `clampRatio` + 280px `MIN_PANEL_WIDTH_PX` floor, persist-on-release via `writeStoredRatios`, `touchAction: "none"`, tiles-stay-live/no-suspension, content `pointer-events-none` mid-drag) are unchanged.
- Dividers still render only when not zoomed and never on `single` (existing `dividerSpecs` returns []).

### 3. Intersection rule — NEW two-axis drag capability (`main-*` shapes)

In `main-left` / `main-right` / `main-top`, the B/C divider meets the A-boundary divider at a T-junction. New behavior:
- A ~20px hit zone centered on the junction point (where `dividerSpecs`' two boundaries cross: e.g. main-left at (`r0`%, `r1`%)).
- **Hovering** the intersection zone lights BOTH sashes (both pills render, same 150ms delay semantics). Hovering a seam away from the junction lights only that seam (existing per-divider hover).
- **Dragging** the intersection moves BOTH ratios at once: pointer x updates the x-axis boundary, pointer y the y-axis boundary (main-left/right: x → ratio 0, y → ratio 1; main-top: y → ratio 0, x → ratio 1), each clamped independently by the existing per-boundary clamp (280px floor both sides), both persisted on release. `cursor: move` on the zone (the single-axis dividers keep `cursor-col-resize`/`cursor-row-resize`).
- `row`/`col` (two parallel same-axis dividers) have no junction — no intersection zone there. `split-h`/`split-v`/`single` likewise unaffected.
- The zone needs its own testid (e.g. `surface-divider-intersection`) and sits above the two dividers in z-order so it wins the hit-test at the junction.

### 4. Sash color

`--color-accent-green` — NOT VS Code's blue and NOT run-kit's `--color-accent`. Rationale (decided): green already means interactive/live-pane in run-kit's hover vocabulary (CRT glint, focused tile, agent state). Focus border (1px frame) vs sash (5px pill) differ by geometry, so sharing the hue is unambiguous.

### 5. Board tiles — shared framed-tile vocabulary (bounded)

Board panes (`app/frontend/src/components/board/board-pane.tsx` ~line 170) share the framed-tile family: idle panes render `border border-border`. Apply the vocabulary only where it is shared: the **idle** board-pane border dims to the same ~55% mix. The semantic border states stay full-strength — `waiting` (3px `rk-waiting-seam`) and focused (`border-accent` + shadow ring) are status signals, not card chrome. No gutters, ground inset, sash, radius, or drag changes on the board route (it has its own header-drag width-resize model and a deliberate no-handle Shell seam branch — Tier 2 territory; the 3px waiting-seam geometry also makes radius churn risky there).

Session-tiles (`src/components/session-tiles/` — the server-list preview cards) are **out of scope**: they are list cards, not framed layout tiles; the shared-vocabulary clause covers the board's framed panes only.

### 6. Mobile — unchanged

The mobile branch (`isMobile`) renders no tile chrome today (no border/rounded classes, no dividers, no grid) and stays that way: no gutters, no ground inset, no dots/sash — every px of width stays tmux's. Verified: the mobile `renderTile` path adds only `flex-1`.

### 7. `prefers-reduced-motion`

The 150ms hover delay is a `transition-delay`, zeroed by the existing global motion kill in `globals.css`; the states themselves (dots, pill, inversion) remain. No JS motion, so no JS skip needed.

### 8. CSS placement

The sash/grip treatment needs pseudo-element/child styling with delays — new `rk-*` utility classes in `app/frontend/src/globals.css` per the established convention; simple one-off values (gap, padding, radius, hit-zone width) stay inline Tailwind in `surface-layout.tsx`.

### 9. Tests

- **Unit** (`src/components/surface-layout.test.tsx`): tile class changes (dimmed border, radius, gutter/inset), grip-dot render, intersection-zone presence per shape (main-* only), two-axis drag ratio math (both ratios move, clamps hold, both persist on release).
- **e2e** (`tests/e2e/surface-layout.spec.ts` + its `.spec.md` companion, per constitution): existing divider cases keep passing (drag semantics unchanged — they assert `aria-valuenow` + persistence); new/updated cases for the sash render states and the intersection zone (hover lights both, drag moves both ratios). The Playwright pointer-events hover-gate pattern applies: grip dots are `pointer-events-none`, so hit-tests must hover the divider/zone first. Perf budget holds: intersection tests need a 3-tile `main-*` layout — reuse/extend the ONE existing 3-tile test rather than adding a second 3-tile mount (HTTP/1.1 6-slot pool budget, spec § Performance note).

### Constraints / costs (acknowledged, accepted)

- **Width budget**: ground inset + wider gutters cost ~12–15px in 3-tile shapes (~1–2 tmux columns), ~12px at single-tile. Accepted for desktop; mobile exempt.
- **Dimmed border vs dark terminal content**: known tension, decided — the user approved the mock with the 55% border. Full-border fallback is a noted escape hatch, not part of this change.

## Affected Memory

- `run-kit/ui-patterns`: (modify) the surface-layout § Tiles/Dividers entries (framed-grid chrome values, divider states) gain the gap-seam vocabulary: 6px gutter + ground inset, 6px radius, 55% dimmed border, grip dots + sash states, the intersection two-axis drag, and the board idle-border share.

## Impact

- `app/frontend/src/components/surface-layout.tsx` — grid/tile classes, divider render (3-state sash + dots), widened hit zones, NEW intersection zone + two-axis drag handler (the only new interaction machinery; existing single-axis drag path reused).
- `app/frontend/src/globals.css` — new `rk-*` sash/grip utilities.
- `app/frontend/src/components/board/board-pane.tsx` — idle border dim only.
- `app/frontend/src/components/surface-layout.test.tsx`, `tests/e2e/surface-layout.spec.ts` + `surface-layout.spec.md` — updated/extended per § Tests.
- No backend, no API, no routes, no keyboard-surface changes (drag is pointer-only today and stays so; ratios remain mouse-adjustable only, as shipped in 260812-ab5v/R5).

## Open Questions

- None — the design session resolved the visual spec via an approved interactive mock; remaining implementation choices are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Seam geometry verbatim from the approved mock: 6px gutter, NEW 6px ground inset, 6px tile radius, tile border dimmed to ~55% `color-mix` of `--color-border`; focused border stays full accent-green | Discussed — user approved the interactive mock ("it looks good. Go ahead"); values pinned in the session | S:95 R:85 A:90 D:95 |
| 2 | Certain | Sash color = `--color-accent-green`, not VS Code blue, not `--color-accent` | Discussed — blue alternative shown in the mock and rejected (vocabulary split); green = interactive/live in run-kit | S:95 R:90 A:95 D:95 |
| 3 | Certain | Divider 3-state spec: 3 rest grip dots (~2.5px, border-colored, `pointer-events-none`, inverting while lit); 5px rounded pill (r=3px) inset ~10px from corners, ~150ms hover delay, zero delay dragging; hit zone 6px→14px | Discussed — exact values from the approved mock | S:95 R:90 A:90 D:90 |
| 4 | Certain | Intersection rule: ~20px T-junction zone in `main-*` shapes only; hover lights both sashes, drag moves both ratios, `cursor: move`; mid-seam hover lights one seam | Discussed — new capability specified and approved in the session | S:90 R:80 A:85 D:90 |
| 5 | Certain | Mobile branch fully exempt (no chrome, gutters, or ground inset) | Discussed + verified: mobile `renderTile` renders no tile chrome today | S:95 R:90 A:95 D:95 |
| 6 | Certain | `prefers-reduced-motion`: hover delay is a transition-delay zeroed by the existing motion kill; states remain | Discussed; matches the established `rk-*` motion-kill convention in globals.css | S:90 R:90 A:90 D:90 |
| 7 | Certain | Width budget (~12–15px 3-tile, ~12px single) accepted for desktop; Tier 2 shell card-ification deferred to a future change | Discussed — costs acknowledged and scope fork decided in the session | S:95 R:85 A:90 D:95 |
| 8 | Confident | Intersection drag mechanics: pointer x/y map to the shape's two ratio indices (main-left/right: x→r0, y→r1; main-top: y→r0, x→r1), each clamped by the existing per-boundary 280px-floor clamp, both persisted on release via `writeStoredRatios`; zone z-orders above the dividers | Derivable from the existing single-axis drag path and `dividerSpecs` geometry; not user-visible policy | S:65 R:85 A:80 D:70 |
| 9 | Confident | Sash/grip CSS lands as new `rk-*` utilities in `globals.css`; simple values stay inline Tailwind; dots render as children of the existing divider elements (geometry single-sourced in `dividerSpecs`) | Follows the project's established `rk-*` utility convention; easily reshaped in review | S:60 R:90 A:85 D:75 |
| 10 | Confident | Board share = idle-pane border dim only; `waiting`/focused borders stay full-strength (status signals, not chrome); no gutter/ground/sash/radius churn on the board route | Description bounds it to "where they share the framed-tile family"; board's semantic border states and no-handle seam branch are Tier 2 territory | S:45 R:85 A:50 D:50 |
| 11 | Confident | `session-tiles/` preview cards are out of scope | They are list cards, not framed layout tiles; the description's "and/or session-tiles" resolves to no on inspection | S:50 R:90 A:60 D:60 |
| 12 | Certain | Tests: unit + e2e updated per constitution (`.spec.md` companion in the same commit); hover-gate pattern for `pointer-events-none` dots; intersection e2e reuses the single 3-tile mount (perf budget) | Constitution Test Companion Docs + code-quality UI-test rule; perf budget is binding in the existing spec | S:85 R:90 A:90 D:90 |

12 assumptions (8 certain, 4 confident, 0 tentative, 0 unresolved).
