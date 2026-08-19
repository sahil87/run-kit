# Intake: Universal Flair Catalogue Refresh

**Change**: 260819-lrm8-universal-flair-catalogue-refresh
**Created**: 2026-08-19

## Origin

Promptless dispatch (`/fab-proceed` create-new) from a synthesized design-session description. The user ran a design review of draft PR #606 (12-flair, two-class vocabulary + server-tile rendering) and decided on a **smaller ship vehicle**: a new change off `main` carrying only the universal-flair decisions. All decisions below were made in that session and are FINAL — do not reopen them downstream.

> **Change type**: feat. **Title**: Universal Flair Catalogue Refresh — add pacman, matrix, aquarium, roadrunner, invaders, cube, warp; redraw naruto & onepiece.
>
> Flairs are decoration-only ambient CSS overlays on sidebar rows, driven by the `@rk_flair` tmux user option. On main the vocabulary is `FLAIR_STATES = ["", "nyan", "naruto", "onepiece"]`. This change grows the universal catalogue to 10 named flairs (+ unset), redraws two existing sprites, and grows the swatch-popover flair section accordingly. PR #606 remains open and will need rebase/rescoping afterward — explicitly OUT of this change's scope.

Key design-session outcomes (a later session extended the first): `train`, `dvd`, and `tetris` were rejected; the user rejected any two-class (tile-only) vocabulary — ONE universal set, every flair's treatment box-agnostic (fills whatever box it mounts in, row strip or tile); `roadrunner` is the "zip-blur" variant chosen from four candidates; naruto redraw is "option A — true run"; onepiece redraw is "option A — Jolly-Roger sail"; `invaders`/`cube`/`warp` were adapted through three review rounds to box-agnostic treatments (final versions approved). Server-tile flair RENDERING stays out — this change ships the set on the row surfaces main has; the vocabulary is ready for tiles when #606 is rescoped.

## Why

1. **Pain point**: the flair catalogue is small (3 named flairs) and two of the three existing sprites read poorly — the naruto runner has ~14px "noodle arms", and the onepiece ship reads as a generic sailboat with no franchise identity. PR #606 grew the catalogue but bundled a two-class vocabulary and server-tile rendering the user does not want to ship yet.
2. **Consequence of not fixing**: the polished new sprites and the four accepted flairs stay stranded on a draft PR whose larger scope blocks shipping; the weak naruto/onepiece artwork stays in production.
3. **Why this approach**: a fresh, minimal PR off main ships only the decisions that survived design review — a single universal vocabulary (exactly as main has today), four new flairs, and two artwork swaps. This keeps main's architecture untouched (no vocabulary split, no new render surfaces), makes review tractable, and leaves PR #606 to be rescoped independently.

## What Changes

### 1. Vocabulary — frontend + backend (single universal set)

`app/frontend/src/themes.ts:472` — `FLAIR_STATES` becomes (order fixed: existing three, then the additions in approval order):

```ts
export const FLAIR_STATES = ["", "nyan", "naruto", "onepiece", "pacman", "matrix", "aquarium", "roadrunner", "invaders", "cube", "warp"] as const;
```

`app/backend/internal/validate/validate.go:205` — `flairTokens` mirrors it minus the empty string (empty = "unset" per existing structure):

```go
flairTokens = []string{"nyan", "naruto", "onepiece", "pacman", "matrix", "aquarium", "roadrunner", "invaders", "cube", "warp"}
```

Adjacent doc comments (`validate.go:261-272` — "the three named states", "one of \"\"/nyan/naruto/onepiece") must be updated to match. No two-class split, no `SERVER_FLAIR_STATES`, no `ValidateServerFlairValue` — single universal vocabulary exactly as on main.

### 2. Three flairs ported verbatim from PR #606: pacman, matrix, aquarium

Their CSS blocks (keyframes + `.rk-flair-pacman` / `.rk-flair-matrix` / `.rk-flair-aquarium` rules with inline-SVG sprite data URIs) exist on the local git ref `pr-606-view` in `app/frontend/src/globals.css` (roughly lines 859–976 of that ref's file; verified anchors: `rk-flair-pacman-x` at :859, `rk-flair-matrix-fall` at :900, `rk-flair-aquarium-x` at :929). Port them **verbatim** into this branch's `app/frontend/src/globals.css`, appended after the existing onepiece block.

Do NOT port `train` (rejected; its block sits at :797–845 on that ref — skip it). Do NOT port the tile-only flairs (dvd/tetris/invaders/cube/warp) or any server-tile / two-class-vocabulary machinery.

### 3. One brand-new flair: roadrunner ("zip-blur" variant)

Final tested CSS lives at `/tmp/claude-1001/-home-sahil-code-sahil87-run-kit-worktrees-sandy-basin/e7f95aa5-b9c4-4e50-8bb9-943cf8858050/scratchpad/variants.css` under class `.fx-rr-b` (keyframes `fx-rr-b-x` / `fx-rr-b-y`, plus a `::before` speed-streak layer; verified at lines 137–210 of that file). Rename to house style: class `.rk-flair-roadrunner`, keyframes `rk-flair-roadrunner-*`.

Characteristics (for verification, not redesign): 2-frame 36×44 sprite sheet, 3s traversal, 0.3s step cadence. Sprite: blue bird head/crest/beak up front, body dissolved into horizontal speed streaks, yellow leg-blur, dust puffs. The `::before` is a repeat-x speed-streak tile racing the opposite way — same pattern as naruto's streaks, but it MUST get its own keyframes rather than reusing naruto's. The chosen variant has no blinking text; blink/strobe cadences stay under photosensitivity thresholds.

### 3b. Three box-agnostic flairs: invaders, cube, warp

These render identically on any mount box — a 22px row strip today, a ~76×56px server tile when #606 rescopes onto this vocabulary. User-approved final versions live in the staged `assets/variants.css` (classes to rename to house style):

- **`invaders`** (from `.fx-inv3`, rename `.rk-flair-invaders`, keyframes `rk-flair-invaders-*`): a trio of crabs (44×44 2-frame wiggle sheet, 10px crabs) on a centered 22px strip `::after`, marching left↔right across the box in **26 discrete steps** — the wander is `background-position-x` 0%→100% with `steps(26, jump-none)` timing over 13s alternate, each jump landing on the 0.5s arm-flip (`background-position-y` 2-frame step at 1s). Percentage x-positioning makes it box-agnostic; pure background-position, NO transforms.
- **`cube`** (from `.fx-cube2` in assets/variants.css, rename `.rk-flair-cube`, keyframes `rk-flair-cube-*`): a 16px wireframe accent-green CSS-3D cube (6 faces, `translateZ(8px)`, perspective **260px** — deliberately flatter than #606's 110px, which read distorted) tumbling on an 8s spin while ricocheting around the whole box DVD-style: two nested wrapper spans animate `translateX(calc(100cqw - 18px))` (16s alternate) and `translateY(calc(100cqh - 18px))` (7.5s alternate) with `container-type: size` on the overlay element. **Markup contract**: the overlay hosts `<span class="cx"><span class="cy"><span class="rk-cube">6× <span class="rk-cube-face"/></span></span></span>` (final shipped class names at apply's discretion, keeping the `rk-` prefix).
- **`warp`** (port **verbatim** from `pr-606-view` globals.css `.rk-flair-warp` block, keeping its name): the hyperspace starfield — three oversized `.rk-warp-plane` children flying translateZ(−160px)→55px on staggered 3.6s loops under a 60px perspective. **Markup contract**: three `<span class="rk-warp-plane">` children.

**Row markup consequence**: on main, rows mount flair as a bare pseudo-only span. cube/warp need CHILD SPANS, so the change introduces a small shared `FlairOverlay` component (window-row, session-row, and the picker's preview cells all render it) that emits the overlay span plus the per-flair children when the value needs them.

**Drag guard**: cube/warp animate `transform` on child spans — rows ban transforms (the drag-ghost rule). The overlay is therefore hidden on a drag-source row (the same guard #606 gives dragged tiles); pure-background flairs may keep animating or share the same simple guard, whichever is simpler in the row code.

### 4. Naruto sprite artwork replacement ("option A — true run")

Fixes the current sprite's ~14px noodle arms. New 30×88 4-frame runner sheet: spiky triangular blond hair, headband + wider plate, whisker mark, fluttering headband ribbon tails, short swept-back arm stubs with skin-tone hands, 3-pose leg cycle — PLUS the EXISTING 120×44 wind/leaf trail sheet glued behind, kept verbatim from main.

Final CSS at the same scratchpad `variants.css` under `.fx-naruto-a` (keyframes `fx-naruto-a-x` / `fx-naruto-a-y`; verified at lines 3, 269–298). Adapt into the existing `.rk-flair-naruto` block (globals.css :639–692 on main):

- Replace the runner data URI.
- Adjust the x-keyframe constants for the 30px sprite width: from `-30px` / `-150px` to `calc(100% + 34px)` / `calc(100% + 4px)` — offsets balanced so both layers (runner + trail) displace identically.
- The `::before` speed-streak layer on main stays unchanged.
- Update the block's comment to describe the new sheet.

### 5. Onepiece sprite artwork replacement ("option A — Jolly-Roger sail")

The current ship reads generic. The new sheet puts a large straw-hat Jolly Roger emblem on the mainsail (yellow hat + red band + brim over a black skull with cream eye pixels and crossbone ends) and simplifies the mast flag to a plain black pennant. Same 34×88 geometry and identical keyframe constants as main's current onepiece — a **pure background-image data-URI swap** inside the existing `.rk-flair-onepiece` block (globals.css :694–742 on main). Hull, wake, waves `::before`, roll transforms all unchanged. Final CSS at scratchpad `variants.css` under `.fx-op-a` (verified at lines 51, 363–389). Update the block's comment.

### 6. Picker — swatch-popover flair section grows from 4 cells to 11

`app/frontend/src/components/swatch-popover.tsx`: the flair section is currently one row of 4 cells (∅ + nyan/naruto/onepiece), rendered from `FLAIR_STATES` at :427–451 (cells flow inside the existing 4-wide grid), with keyboard-nav clamps keyed to `FLAIR_ROW` (:74–80, :169–171, :236–257 — ArrowRight clamp at `FLAIR_STATES.length`, marker-column exception on entry: col 0 maps to col 1).

The layout must accommodate 11 cells (∅ + 10): **three logical flair rows** mapped onto the wrapped 4-wide grid (4/4/3 — `FLAIR_ROW`, `FLAIR_ROW+1`, `FLAIR_ROW+2`), so arrow keys move where the eye expects: ArrowRight clamps at each row's last cell, ArrowDown/Up move between flair rows (clamping to the short last row), the marker-column exception extends to all flair rows. Cell focus/render mapping: flair index `i` sits at row `FLAIR_ROW + floor(i/4)`, col `(i%4)+1`. Preview cells for cube/warp render the same child-span markup via the shared `FlairOverlay` (§3b).

### 7. Reduced-motion

All new/changed treatments must be covered by the existing `prefers-reduced-motion` gate in globals.css (on main it enumerates flair pseudo-element selectors at :879–884: `.rk-flair-nyan::before, ... .rk-flair-onepiece::after { animation: none; display: none; }`). Extend the enumeration with the new flairs' pseudo-elements. The flair CSS blocks must stay ahead of the reduced-motion block in source order (source-order override discipline).

### 8. Tests

- **Go**: accept/reject matrix for the new tokens in `app/backend/internal/validate/validate_test.go` (pacman/matrix/aquarium/roadrunner/invaders/cube/warp accepted; unknown tokens — including the rejected `train`/`dvd`/`tetris` — still rejected).
- **Frontend**: update tests touching `FLAIR_STATES` / flair cells — `app/frontend/src/themes.test.ts`, `app/frontend/src/components/swatch-popover.test.tsx` (cell counts / keyboard nav), `app/frontend/src/components/sidebar/session-row.test.tsx` and `window-row.test.tsx` where they enumerate flair classes. Note: `session-tiles.tsx` contains a deliberate NUL join — grep-based sweeps must use `grep -a` or perl.
- **No new Playwright specs** expected (no route/behavior change), so no `.spec.md` obligations anticipated.

### 9. Asset staging (early plan task)

The plan MUST include an early task copying the two authoritative scratchpad files into the change folder so the pipeline is self-contained:

- `/tmp/claude-1001/-home-sahil-code-sahil87-run-kit-worktrees-sandy-basin/e7f95aa5-b9c4-4e50-8bb9-943cf8858050/scratchpad/variants.css` (classes `.fx-naruto-a`, `.fx-op-a`, `.fx-rr-b`) — the authoritative sprite CSS.
- The same scratchpad's `flair-only.css` — the PR #606 reference CSS (also available on git ref `pr-606-view`).

Destination: `fab/changes/260819-lrm8-universal-flair-catalogue-refresh/assets/`.

### Constraints (all binding)

- Sprites are original stylized pixel art embedded as inline SVG data URIs — no external requests, no copyrighted assets (constitution/flair discipline).
- Traversal via `background-position` longhands only — never `transform` on row pseudos.
- Flair CSS block order stays ahead of the reduced-motion block.
- Roadrunner text/blink cadences stay under photosensitivity thresholds (chosen variant has no blinking text).

### Explicitly out of scope

`train`, `dvd`, and `tetris` flairs (all rejected in review); any two-class vocabulary (`TILE_FLAIR_STATES` / `SERVER_FLAIR_STATES` / `ValidateServerFlairValue` — the user explicitly rejected a separate tile-only state); server-tile flair RENDERING (no server flair surface exists on main; #606's rescope mounts this same universal set on tiles); any rescoping of PR #606 itself (it stays open, to be rebased/rescoped afterward).

## Affected Memory

- `run-kit/ui/visual-design`: (modify) row textures + character flair overlays — flair vocabulary grows to 7 named states; naruto/onepiece sprite redraws; roadrunner cadence/photosensitivity note; reduced-motion enumeration.
- `run-kit/tmux-sessions`: (modify) `@rk_flair` entry in the `@rk_*` user-option registry — accepted value set grows.

## Impact

- `app/frontend/src/themes.ts` — `FLAIR_STATES` (+ `FlairState` type follows automatically).
- `app/frontend/src/globals.css` — 7 new flair blocks (pacman/matrix/aquarium/roadrunner/invaders/cube/warp), 2 artwork swaps in existing blocks (naruto runner URI + x-keyframes, onepiece sail URI), reduced-motion enumeration extension. Largest file delta (inline SVG data URIs).
- `app/frontend/src/components/flair-overlay.tsx` (new) — shared overlay component emitting the per-flair child spans (cube/warp markup contracts) + the drag-source hide guard.
- `app/frontend/src/components/sidebar/window-row.tsx`, `session-row.tsx` — mount `FlairOverlay` in place of the bare flair span.
- `app/frontend/src/components/swatch-popover.tsx` — flair section layout (4→11 cells, three logical rows) + keyboard-nav clamps + `FlairOverlay` preview cells.
- `app/backend/internal/validate/validate.go` — `flairTokens` + doc comments.
- Tests: `validate_test.go`, `themes.test.ts`, `swatch-popover.test.tsx`, `session-row.test.tsx`, `window-row.test.tsx` (as they enumerate flairs).
- `fab/changes/260819-lrm8-universal-flair-catalogue-refresh/assets/` — staged sprite CSS sources.
- No API/route changes, no new endpoints, no tmux-layer changes (the `@rk_flair` option plumbing already exists; only the accepted value set grows).
- No new Playwright specs; existing e2e should be unaffected (decoration-only overlays).

## Open Questions

- (none — all design decisions were finalized in the design session; the single open judgment, flair-row grid geometry, is a Confident apply-time decision recorded below)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Vocabulary and order fixed: `["", "nyan", "naruto", "onepiece", "pacman", "matrix", "aquarium", "roadrunner", "invaders", "cube", "warp"]`; backend `flairTokens` mirrors it minus `""`; ONE universal set, no tile-only class | Design session — stated verbatim as final; single-set requirement explicit ("I don't want a separate state for tile-only flairs") | S:95 R:85 A:95 D:95 |
| 2 | Certain | Port pacman/matrix/aquarium CSS verbatim from `pr-606-view` globals.css (:859–976); exclude train and all tile-only/server-tile machinery | Design session — user accepted these three, rejected train; anchors verified on the ref | S:95 R:80 A:90 D:95 |
| 3 | Certain | Roadrunner = zip-blur variant `.fx-rr-b` from scratchpad variants.css, renamed `.rk-flair-roadrunner` / `rk-flair-roadrunner-*`, with its own streak keyframes (not naruto's) | Design session — chosen from four candidates; CSS verified present | S:95 R:75 A:90 D:95 |
| 4 | Certain | Naruto redraw = option A (`.fx-naruto-a`) adapted into existing `.rk-flair-naruto`: new runner URI + x-keyframe constants for 30px width (`calc(100% + 34px)` / `calc(100% + 4px)`); `::before` streaks + trail sheet unchanged | Design session — exact constants supplied; source CSS verified | S:95 R:75 A:90 D:90 |
| 5 | Certain | Onepiece redraw = option A (`.fx-op-a`): pure background-image data-URI swap, geometry/keyframes identical to main | Design session — stated as pure swap; source CSS verified | S:95 R:80 A:90 D:95 |
| 6 | Confident | Picker grows to three logical flair rows (4/4/3, ∅ + 10) mapped onto the wrapped 4-wide grid; FLAIR_ROW clamps, ArrowDown/Up between flair rows (short-row clamp), marker-column exception extended | Grid code read directly (cells flow in the 4-wide grid); row/col mapping `FLAIR_ROW + floor(i/4)` / `(i%4)+1` follows the visual wrap | S:70 R:85 A:80 D:75 |
| 7 | Certain | Stage authoritative asset CSS (`variants.css`, `flair-only.css`) into `fab/changes/260819-lrm8-.../assets/` as an early plan task | User-specified provenance requirement; destination given as the obvious default | S:75 R:95 A:85 D:85 |
| 8 | Confident | Affected memory = `run-kit/ui/visual-design` (modify) + `run-kit/tmux-sessions` (modify, `@rk_flair` registry) | Judged from docs/memory indexes per dispatch instruction ("likely"/"possibly") | S:65 R:90 A:75 D:70 |
| 9 | Certain | Reduced-motion coverage by extending the existing pseudo-element enumeration (globals.css :879–884); flair blocks stay ahead of the gate in source order | Pattern read directly from main; explicitly constrained by the description | S:85 R:90 A:95 D:90 |
| 10 | Certain | Test scope: Go accept/reject matrix in validate_test.go; themes.test.ts, swatch-popover.test.tsx, session-row/window-row tests; NO new Playwright specs (no route/behavior change → no .spec.md obligations) | Enumerated in the description; all named frontend test files verified to exist | S:85 R:85 A:85 D:85 |
| 11 | Certain | Out of scope: train/dvd/tetris flairs, server-tile rendering, SERVER_FLAIR_STATES/two-class vocabulary, ValidateServerFlairValue, PR #606 rescoping | Design session — explicit exclusion list; tetris rejected in the box-agnostic review round | S:95 R:90 A:95 D:95 |
| 12 | Certain | invaders = `.fx-inv3` (stepped 26-jump wander, wiggle-synced), cube = `.fx-cube2` v3 (260px perspective, 16s/7.5s ricochet, cq units), warp = `pr-606-view` block verbatim; all renamed to `rk-flair-*` house style | User approved these exact versions after three review rounds; CSS staged in assets/variants.css | S:95 R:80 A:90 D:95 |
| 13 | Confident | New shared `FlairOverlay` component carries the cube/warp child-span markup contracts + a drag-source hide guard on rows (transforms would corrupt drag ghosts); mounted by window-row, session-row, and the picker preview cells | Markup need is structural (child spans can't ride a bare pseudo span); the guard mirrors #606's dragged-tile hide; exact guard wiring decided at apply | S:70 R:85 A:80 D:70 |
| 14 | Certain | Roadrunner + invaders + tetris-rejection keep row motion rationed: no full-width tiling for character flairs; wander is percentage `background-position-x` (box-agnostic), stepped for invaders | User's explicit direction across the review rounds ("too loud", "in steps") | S:90 R:85 A:90 D:90 |

14 assumptions (11 certain, 3 confident, 0 tentative, 0 unresolved).
