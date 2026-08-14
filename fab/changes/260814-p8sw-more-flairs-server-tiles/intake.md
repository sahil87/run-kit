# Intake: More Flairs + Server-Tile Flair Rendering

**Change**: 260814-p8sw-more-flairs-server-tiles
**Created**: 2026-08-14

## Origin

Conversational `/fab-new`-equivalent invocation, stacked on `260814-2esh-sidebar-character-row-animations` (PR #605):

> create a stack pr, i want more animations can we discuss what animations we can do, also can we do it on the server boxes [screenshot of the SERVER panel tiles]

An idea menu was discussed and the user selected (AskUserQuestion, 2026-08-14): new traversal flairs **sl steam train, Pac-Man, Matrix rain, Asciiquarium** plus a request for **"some 3d animations"**; tile-only 2D flairs **DVD logo bounce, Tetris corner stack, Space Invaders**; tile wiring = **same server flair value** (recommended option — no second channel). The 3D request is satisfied with CSS 3D transforms (perspective + preserve-3d), not WebGL — two tile-only 3D flairs: **spinning neon wireframe cube** and **hyperspace starfield warp**.

## Why

1. **Pain point**: the flair vocabulary is three characters, and the SERVER panel tiles — the most box-like, animation-friendly surface in the sidebar (the user's screenshot) — render no flair at all even though every server already carries a flair value in the settings store.
2. **If we don't**: the flair channel stays a three-trick novelty; the server tiles stay static while their own group headers animate — an inconsistency the user noticed immediately.
3. **Approach**: extend the proven sprite-sheet/overlay machinery (base branch) with nine new treatments in two classes — universal flairs that work on 22px row strips AND tiles, and tile-only flairs that need a 2D box — and mount the existing server-flair value on the ServerPanel tiles. Stacked on the flair branch because it builds directly on its CSS discipline, picker section, and persistence.

## What Changes

### 1. Flair vocabulary: two classes, 12 values

- **Universal** (rows + tiles; extend `FLAIR_STATES` in `themes.ts`): existing `nyan`/`naruto`/`onepiece` + new `train`, `pacman`, `matrix`, `aquarium`.
- **Tile-only** (new `TILE_FLAIR_STATES`): `dvd`, `tetris`, `invaders`, `cube`, `warp` — only meaningful in a 2D box.
- Validation splits accordingly: `validate.ValidateFlairValue` (universal set — window/session writes) and a new `validate.ValidateServerFlairValue` (universal + tile-only — server writes). Window/session endpoints reject tile-only values with 400; the server settings endpoint accepts all 12.

### 2. Nine new CSS treatments (`globals.css`, following the base branch's sprite-sheet discipline)

Universal traversal/ambient (22px-strip pseudos on rows; the same classes fill tiles, where the strip becomes the tile's height or a stacked layout):

- **`train`** — the `sl` locomotive homage: engine with spinning-wheel frames (4-frame sheet), steam puffs drifting up-left, two coach cars as the trail layer. Right→LEFT traversal (the `sl` joke runs backwards), ~11s.
- **`pacman`** — yellow chomper with 2-frame mouth, eating a dot trail that ends at his mouth (dots as a repeat-x layer clipped behind him), one 2-frame ghost trailing, ~7s.
- **`matrix`** — falling glyph columns: 2–3 layered repeat-x tiles of short katakana-ish glyph stacks in `--color-accent-green` tones, drifting DOWN at different speeds (background-position-y linear loops, tile-multiple displacement), head glyph brighter. Ambient — no traversal. On tiles it fills the box.
- **`aquarium`** — asciiquarium homage: two fish sprites swimming opposite directions at different speeds (each its own layer), rising bubble tile, seaweed frond at the left edge (2-frame sway). Ambient + traversal mix.

Tile-only (mounted only by the tile overlay; ~76×56px canvas):

- **`dvd`** — the bouncing logo: a small rounded "RK" lozenge translating on X and Y with different periods (two independent longhand-like animations via two nested spans or bg-x/bg-y linear alternate loops), hue-rotating stepwise so corner-adjacent hits read as recolors.
- **`tetris`** — pieces drifting down the tile's right corner in a stepped 8-frame sheet loop that stacks three pieces then flashes/clears. Pure sheet animation — the physics is drawn, not computed.
- **`invaders`** — a 3×2 invader formation marching left-right-down with the classic 2-frame arm wiggle (sheet frames encode the march offsets), tiny shield stubs at the bottom.
- **`cube`** — CSS 3D: a `perspective` wrapper + `transform-style: preserve-3d` cube of 6 bordered translucent faces (accent-green wireframe look), keyframed `rotateX`/`rotateY` tumble, ~8s loop.
- **`warp`** — CSS 3D hyperspace: 3–4 star layers on `translateZ` planes flying from far to past-camera (scale+opacity ramp under a perspective wrapper), continuous depth zoom.

**Drag-ghost guard (tile-only 3D/transform treatments)**: server tiles are drag sources (`useServerReorder`, `isDragSource` in `server-panel.tsx`). The tile overlay is hidden while the tile is the drag source (`isDragSource` already reaches the tile component), so animated transforms never pollute the native drag snapshot. Row treatments remain background-position-only per the base discipline.

**Reduced motion**: every new pseudo/element joins the existing gate — hidden entirely.

### 3. Server-tile flair rendering (`server-panel.tsx`)

The tile root is already `relative overflow-hidden` — mount the standard flair overlay element inside it, gated on the server's flair (the SAME `serverFlairs` map the group header uses; the value flows down from `sidebar/index.tsx` where `getAllServerFlairs()` already lives — thread it into `ServerPanel`'s existing props). Universal flairs render their treatment sized to the tile; tile-only flairs render only here (a row never mounts them). No new state, endpoints, or persistence — wiring only, per the user's "same server flair" choice.

### 4. Picker: flair section becomes a grid

The SwatchPopover flair section grows from 4 cells to up to 13 (∅ + 12). Render as a compact grid (4 per row) of live-preview cells, keyboard-navigable. The section's cell set is caller-dependent: window/session pickers offer ∅ + 7 universal; the server picker offers ∅ + all 12. The existing `GRID_ROWS === MARKER_CELLS.length` marker invariant is untouched (flair is its own section).

### 5. Tests

- Go: two-vocabulary validation (universal vs server sets; tile-only value → 400 on window/session endpoints, 200 on server endpoint).
- Vitest: picker grid cell sets per entry point, tile overlay gating (incl. hidden-while-dragging), row components never mounting tile-only classes.

## Affected Memory

- `run-kit/ui/visual-design`: (modify) flair catalogue grows to 12 with the two-class split, tile-only treatments, CSS-3D mechanism, drag-source hide guard
- `run-kit/ui/sidebar`: (modify) server-tile flair overlay, picker grid section, per-entry-point cell sets
- `run-kit/architecture`: (modify) two-vocabulary validation split (`ValidateServerFlairValue`)

## Impact

- **Frontend**: `globals.css` (nine treatments), `themes.ts` (vocabulary split), `swatch-popover.tsx` (grid section + caller-dependent sets), `server-panel.tsx` (tile overlay + drag guard), `sidebar/index.tsx` (thread serverFlairs into ServerPanel), colocated tests.
- **Backend**: `internal/validate` (second allowlist), `api/settings.go` (server handler uses it), tests. Window/session endpoints unchanged except the (already-present) universal allowlist.
- **Stacking**: branch `260814-p8sw-more-flairs-server-tiles` forks from `260814-2esh-sidebar-character-row-animations` (PR #605). The PR targets `sahil87:main` from the fork and notes the dependency; its diff includes #605's commits until #605 merges (cross-repo forks cannot base onto another fork branch upstream).
- Scale: medium-large — ~8 files, CSS-heavy.

## Open Questions

*None — the animation set, tile wiring, and 3D approach were chosen in the 2026-08-14 discussion (see Origin).*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New flair set: train/pacman/matrix/aquarium (universal) + dvd/tetris/invaders (tile-only 2D) | Discussed — user selected exactly these | S:95 R:70 A:85 D:90 |
| 2 | Certain | Server tiles render the SAME server flair value (no second channel) | Discussed — user chose the recommended option | S:95 R:75 A:90 D:90 |
| 3 | Confident | "Some 3d animations" = two CSS-3D tile-only flairs (cube, warp), not WebGL | User asked for 3D without specifying; WebGL already rejected on context-cap grounds in the base change; CSS 3D delivers real perspective at compositor cost | S:70 R:75 A:75 D:60 |
| 4 | Confident | Two-vocabulary validation split (universal vs server-accepts-all) | Tile-only values on a row row would render nothing; rejecting at the write seam keeps state meaningful — mirrors the closed-set posture | S:60 R:75 A:80 D:70 |
| 5 | Confident | Tile overlay hidden while the tile is a drag source | Tiles are HTML5 drag sources; animated transforms corrupt drag snapshots — the base branch's drag-ghost rule extended to the one place transforms are now used | S:65 R:85 A:85 D:75 |
| 6 | Confident | `sl` train runs right→left | The `sl` command's locomotive travels leftward; the homage is the point | S:70 R:95 A:90 D:80 |
| 7 | Tentative | Tetris "physics" is a drawn 8-frame sheet loop (stack-then-clear), not computed stacking | Computed stacking needs JS; a drawn loop reads the same at tile size. Revisit if it looks canned <!-- assumed: tetris is a drawn sheet loop, not simulated --> | S:45 R:80 A:70 D:55 |
| 8 | Certain | CSS-only (plus CSS 3D transforms on tiles), reduced-motion hides everything, memoization untouched | Base-branch discipline, constitution conventions | S:85 R:90 A:100 D:95 |

8 assumptions (3 certain, 4 confident, 1 tentative, 0 unresolved).
