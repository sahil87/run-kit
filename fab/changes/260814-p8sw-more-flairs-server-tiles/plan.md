# Plan: More Flairs + Server-Tile Flair Rendering

**Change**: 260814-p8sw-more-flairs-server-tiles
**Intake**: `intake.md`

## Requirements

### Vocabulary & Validation

#### R1: Two-class flair vocabulary
`app/frontend/src/themes.ts` MUST extend `FLAIR_STATES` (universal — rows + tiles) to `["", "nyan", "naruto", "onepiece", "train", "pacman", "matrix", "aquarium"]` and add `TILE_FLAIR_STATES = ["dvd", "tetris", "invaders", "cube", "warp"] as const` (tile-only). `app/backend/internal/validate` MUST split accordingly: `ValidateFlairValue` accepts the universal set (window/session writes, unchanged signature); a new `ValidateServerFlairValue` accepts universal + tile-only (server writes). `api/settings.go`'s server-flair handler switches to the server validator.

- **GIVEN** `POST /api/windows/@1/options` with `{"options": {"@rk_flair": "dvd"}}`
- **WHEN** the request is validated
- **THEN** it returns 400 with zero tmux calls (tile-only value on a row scope)
- **AND** `POST /api/settings/server-flair` with `{"server": "s", "flair": "dvd"}` returns 200

### CSS Treatments (`app/frontend/src/globals.css` — follow the § Flair overlays discipline verbatim: vertical sprite sheets, background-position-x traversal + background-position-y `step-end` frames on 22px strip pseudos, balanced per-layer from/to constants, opposite-drift parallax ambience, seams at exact tile multiples, inline-SVG data URIs, original stylized pixel art)

#### R2: Universal traversal/ambient flairs
Four new row-capable treatments:
- **`.rk-flair-train`** — the `sl` locomotive homage traveling right→LEFT (~11s): engine (chimney, boiler, cab) with a 4-frame spinning-wheel/side-rod cycle, steam puffs drifting up-and-back (2-frame trail layer), two coach cars trailing right of the engine.
- **`.rk-flair-pacman`** — yellow chomper (2-frame mouth open/closed, ~5fps) traversing left→right (~7s) over a dot trail drawn AHEAD of him as a repeat-x dot line with the eaten side masked by the sprite's passage illusion (dots layer ends at his mouth: layer geometry glued like the nyan trail, dots in front, blank behind), one ghost (2-frame skirt wiggle) trailing ~26px behind.
- **`.rk-flair-matrix`** — ambient falling glyph rain (no traversal): 2–3 repeat-x tile layers of short vertical glyph stacks (katakana-like strokes, drawn as small rect clusters) in accent-green tones with a brighter head glyph, each layer drifting DOWN via background-position-y linear loops at different speeds, displaced by exact tile-height multiples per loop.
- **`.rk-flair-aquarium`** — asciiquarium homage: two fish sprites (2-frame tail flap each) swimming OPPOSITE directions at different speeds as independent layers, a rising-bubble repeat-x tile drifting UP, and a seaweed frond (2-frame sway) anchored near the left edge.

- **GIVEN** a session row with flair `train`
- **WHEN** it renders
- **THEN** the locomotive crosses right→left with turning wheels and drifting steam, seamlessly looping

#### R3: Tile-only 2D flairs
Three treatments mounted ONLY by the server-tile overlay (~76×56px canvas; classes still defined globally):
- **`.rk-flair-dvd`** — a small rounded "RK" lozenge bouncing: X and Y positions animated as two independent linear `alternate` loops with incommensurate periods (e.g. 7.3s / 5.1s), plus a stepped `filter: hue-rotate` recolor loop so color changes read as bounce-triggered.
- **`.rk-flair-tetris`** — an 8-frame sheet loop drawn to read as pieces falling into the tile's bottom-right, stacking three, flashing, and clearing (drawn animation, not simulated).
- **`.rk-flair-invaders`** — a 3×2 invader formation marching left-right-down with the classic 2-frame arm wiggle (march offsets encoded in a sheet), two shield stubs at the bottom edge.

#### R4: Tile-only 3D flairs (CSS 3D, not WebGL)
- **`.rk-flair-cube`** — a `perspective` wrapper + `transform-style: preserve-3d` cube of 6 translucent bordered faces (accent-green wireframe look) in a keyframed rotateX/rotateY tumble (~8s). Faces are DOM spans inside the overlay (the one place real elements are needed).
- **`.rk-flair-warp`** — hyperspace starfield: 3–4 star-tile layers on increasing `translateZ` planes under a perspective wrapper, each animating from far to past-camera (translateZ + opacity ramp), staggered so the zoom is continuous.

- **GIVEN** a server tile with flair `cube`
- **WHEN** it renders
- **THEN** a perspective-projected wireframe cube tumbles inside the tile

#### R5: Reduced motion
All nine new treatments (every pseudo AND the cube/warp/dvd child spans) MUST join the existing reduced-motion gate — hidden entirely.

### Rendering & Picker

#### R6: Server-tile flair overlay with drag guard
`server-panel.tsx` tiles MUST mount the flair overlay (`<span aria-hidden class="absolute inset-0 pointer-events-none overflow-hidden rk-flair-{value}">` — the tile root is already `relative overflow-hidden`) gated on the server's flair from the SAME `serverFlairs` map the group header uses (thread it from `sidebar/index.tsx` into `ServerPanel`'s props alongside `serverColors`). The overlay MUST NOT render while the tile `isDragSource` (transform-animated treatments would corrupt the native drag snapshot). Universal flairs render here too (sized by their strip centering — acceptable within the taller box); tile-only flairs render ONLY here (row components never mount them; a defensive gate keeps unknown values renderless).

- **GIVEN** server `runkit-dev` carries flair `invaders`
- **WHEN** the SERVER panel renders its tile
- **THEN** the tile shows the marching formation, and it disappears while that tile is being dragged
- **AND** the SESSIONS group header for `runkit-dev` (a row) renders no invaders overlay

#### R7: Picker flair grid with caller-dependent sets
The SwatchPopover flair section becomes a compact GRID (4 cells per visual row) of live-preview cells: window/session entry points offer ∅ + the 7 universal values; the server entry point offers ∅ + all 12. Keyboard nav covers the grid. Selection semantics unchanged (`onSelectFlair` with exact value, `""` clears). The marker `GRID_ROWS === MARKER_CELLS.length` invariant is untouched.

- **GIVEN** the server tile/header picker is open
- **WHEN** the flair section renders
- **THEN** 13 cells show (∅ + 12) with live animated previews, while a window picker shows 8

### Tests

#### R8: Coverage
Go: universal vs server vocabulary split (tile-only → 400 on window/session, 200 on server). Vitest: picker cell sets per entry point, tile overlay gating incl. the drag-source hide, and row components never emitting tile-only classes.

### Non-Goals

- No WebGL (per-page context caps — decided in the base change).
- No second per-server flair channel (user chose same-value wiring).
- No host-page server-grid changes beyond what `ServerPanel` shares with it structurally (scope is the sidebar SERVER panel tiles from the screenshot; if the Host grid reuses the same tile component, it inherits the overlay for free — acceptable, not required).
- No new endpoints or state — wiring + vocabulary only.

### Design Decisions

#### CSS 3D transforms for the "3D" ask, tile-only
**Decision**: `cube` and `warp` use `perspective`/`preserve-3d` transform keyframes on overlay child spans, mounted only on server tiles, hidden while dragging.
**Why**: Real perspective projection at compositor cost, zero JS, no WebGL context budget; tiles are few and boxy. The drag-source hide extends the base branch's drag-ghost rule to the one place transforms are used.
**Rejected**: WebGL (context caps, machinery); transform animation on row overlays (rows keep the background-position-only rule).
*Introduced by*: 260814-p8sw-more-flairs-server-tiles

#### Two-class vocabulary instead of render-nothing tolerance
**Decision**: Tile-only values are rejected at row-scope write seams (400), not silently accepted-and-unrendered.
**Why**: State that renders nowhere is a trap; the closed-set posture already exists — extending it keeps every stored value meaningful on its surface.
**Rejected**: One 12-value allowlist everywhere with renderless fallbacks.
*Introduced by*: 260814-p8sw-more-flairs-server-tiles

## Tasks

### Phase 1: Setup

- [x] T001 `themes.ts`: extend `FLAIR_STATES`, add `TILE_FLAIR_STATES` + doc comments <!-- R1 -->
- [x] T002 [P] `internal/validate`: extend `FlairValues` message/set only if needed for universal additions (`train`/`pacman`/`matrix`/`aquarium`), add `ServerFlairValues`/`ValidateServerFlairValue` (universal + tile-only), unit tests <!-- R1 -->

### Phase 2: Core Implementation

- [x] T003 `api/settings.go`: server-flair handler validates via `ValidateServerFlairValue`; handler tests for the split <!-- R1 -->
- [x] T004 `globals.css`: `train` + `pacman` treatments (sheets, trails, traversal keyframes; train right→left) <!-- R2 -->
- [x] T005 [P] `globals.css`: `matrix` + `aquarium` treatments (ambient layers, opposite drifts, seamless tile multiples) <!-- R2 -->
- [x] T006 [P] `globals.css`: `dvd` + `tetris` + `invaders` tile treatments <!-- R3 -->
- [x] T007 [P] `globals.css`: `cube` + `warp` CSS-3D treatments (overlay child spans) + reduced-motion gate additions for ALL nine <!-- R4 -->
- [x] T008 `server-panel.tsx` + `sidebar/index.tsx`: thread `serverFlairs` into `ServerPanel`, mount the tile overlay with the `isDragSource` hide; cube/warp/dvd child-span markup where needed <!-- R6 -->
- [x] T009 `swatch-popover.tsx`: flair section → 4-per-row grid, caller-dependent cell sets (universal vs full), keyboard nav over the grid <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T010 Vitest: picker cell sets per entry point, tile overlay gating + drag hide, no tile-only classes from row components <!-- R8 -->
- [x] T011 Go tests: vocabulary split accept/reject matrix across the three write seams <!-- R8 -->
- [x] T012 Gates: `cd app/backend && go test ./...` (11 pre-existing environmental failures are known: 3 TestMoveWindow_*, 8 TestTerminals_*), `cd app/frontend && npx tsc --noEmit`, `just test-frontend` <!-- R8 -->

## Execution Order

- T001/T002 first; T003 after T002; T004–T007 parallel after T001; T008 after T006/T007; T009 after T001; T010–T012 last

## Acceptance

### Functional Completeness

- [x] A-001 R1: `FLAIR_STATES`/`TILE_FLAIR_STATES` split exists; window/session writes reject tile-only values (400, zero tmux calls); server writes accept all 12
- [x] A-002 R2: `train`, `pacman`, `matrix`, `aquarium` render on rows with the described motion (train right→left; matrix/aquarium ambient)
- [x] A-003 R3: `dvd`, `tetris`, `invaders` render inside server tiles
- [x] A-004 R4: `cube` and `warp` render perspective-projected 3D inside server tiles, CSS-only
- [x] A-005 R6: tiles mount the overlay from the same `serverFlairs` map as the group header, hidden while `isDragSource`; row components never mount tile-only classes
- [x] A-006 R7: picker flair grid shows ∅+7 on window/session pickers, ∅+12 on the server picker, keyboard-navigable, live previews

### Behavioral Correctness

- [x] A-007 R5: under `prefers-reduced-motion` none of the nine new treatments render any visible animation or element
- [x] A-008 R2/R3: all loops are seamless (tile-multiple displacement; no visible snap)

### Scenario Coverage

- [x] A-009 R8: Go tests cover the accept/reject matrix; Vitest covers cell sets, drag hide, and tile-only isolation

### Edge Cases & Error Handling

- [x] A-010 R6: a server whose stored flair is tile-only renders nothing on its SESSIONS group-header row (defensive gate), tile still animates
- [x] A-011 R1: unknown/legacy values keep normalizing to unset (closed-set idiom intact)

### Code Quality

- [x] A-012 Pattern consistency: new CSS follows the § Flair overlays discipline (strips, balanced constants, step-end sheets, parallax counter-drift); new Go mirrors the existing validator/handler idioms
- [x] A-013 No duplication: one vocabulary source (`themes.ts`), one validator module; overlay markup shared with the base branch's pattern
- [x] A-014 Tests included per code-quality.md
- [x] A-015 Security: allowlist validation before any write; no new subprocess surface

## Notes

- Check items as you review: `- [x]`
- Stacked on `260814-2esh-sidebar-character-row-animations` (PR #605) — the PR body must note the dependency.

## Deletion Candidates

None — this change extends the flair vocabulary and mounts the existing overlay machinery on a new surface (server tiles); the one replaced block (the picker's single flair row + its inline preview span in `swatch-popover.tsx`) was removed in-place in the same diff, superseded by the shared `FlairOverlay`. No orphaned files, symbols, or config remain.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Universal flairs also render on tiles without tile-specific variants (strip centered in the box) | Cheapest coherent behavior; tile-specific variants can come later | S:60 R:80 A:75 D:65 |
| 2 | Confident | `matrix` uses accent-green tokens rather than hardcoded greens | Theme coherence; the token exists | S:65 R:85 A:85 D:75 |
| 3 | Confident | Host-page server grid inherits the overlay only if it reuses the same tile component (no dedicated work) | Scope was the sidebar SERVER panel screenshot | S:55 R:80 A:70 D:60 |

3 assumptions (0 certain, 3 confident, 0 tentative).
