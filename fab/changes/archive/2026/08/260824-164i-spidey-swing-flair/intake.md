# Intake: Spidey Swing Flair

**Change**: 260824-164i-spidey-swing-flair
**Created**: 2026-08-24

## Origin

One-shot `/fab-new` invocation:

> Add a new Spider-Man style swinging animation to the flair/hover-animation vocabulary described in fab/project/context.md (the rk-* hover-animation treatments in globals.css) -- research the existing treatments (glitch, boot-sweep, brackets+caret, typed-sweep, CRT glint) and their one-treatment-per-element-category convention before choosing where this new treatment applies

The user explicitly delegated the placement decision to research: study the hover-animation vocabulary and its one-treatment-per-element-category convention, then choose where the new treatment applies. The research was performed at intake (findings below); the conclusion is that the swinging animation belongs on the **flair axis** (`.rk-flair-*`), not on a chrome hover-treatment category.

### Research findings (intake-time)

Sources: `fab/project/context.md` (Conventions), `app/frontend/src/globals.css` (vocabulary comment block at ~line 135 + all `rk-*` rules), `docs/memory/run-kit/ui/visual-design.md` (§ Hover-Animation Vocabulary, § Character Flair Overlays, § Design Decisions), `app/frontend/src/themes.ts`, `app/backend/internal/validate/validate.go`.

1. **Every hover-vocabulary element category is claimed.** The one-treatment-per-element-category map is: glitch = brand (`.rk-brand-glitch` + JS logo sweep), boot sweep = top-bar page heading (JS, `rk-typed-*` cells), brackets+caret = section headings (`.rk-bracket-group`), typed sweep = section labels (`rk-typed-*` / `typed-label.tsx`), CRT glint = buttons (`.rk-glint`), gap-seam sash = layout dividers (`.rk-divider`/`.rk-sash`). A new treatment on any of these categories would violate the convention (two treatments, one category); a swing animation maps to no unclaimed chrome category.
2. **Character animations are categorically flairs.** The repo already has a second, sibling motion vocabulary: the 12 named per-row flairs (`FLAIR_STATES` in `themes.ts`: rain, scan, nyan, naruto, onepiece, pacman, matrix, aquarium, roadrunner, invaders, cube, warp). Pop-culture character homages crossing the row — nyan cat, the naruto runner, the onepiece pirate ship, pacman, the roadrunner — are exactly this axis. A Spider-Man-style web-swinger is a character homage and belongs here.
3. **A recorded design decision forbids the alternative.** visual-design.md § "The motion split — markers hold still, flairs move": *flair owns ALL row motion*; and § "Flair animation is always-on ambient": flairs animate in every row state, never gated on hover. Placing a swinging character as a row hover treatment would contradict both.
4. **The extension path is fully paved.** Adding a 13th flair touches two closed sets kept in lockstep (frontend `FLAIR_STATES`, backend `flairTokens` in `validate.go:208`), one CSS block in `globals.css` following the sprite-sheet mold, and the reduced-motion enumeration. The picker's flair band derives from `FLAIR_STATES` (`FLAIR_NAMED = FLAIR_STATES.slice(1)` in `swatch-popover.tsx`), and `FlairOverlay` renders sheet flairs as a bare span — so both surfaces pick the new value up with little or no component change.

## Why

The flair catalogue is run-kit's per-row personality channel — a deliberate, user-opt-in decoration axis whose value grows with variety (10 color families × 3 shades × 8 markers × N flairs). The catalogue already spans data-rain, CRT, and five character homages; a web-swinger is a requested addition in the same spirit. If we don't add it, nothing breaks — this is a pure vocabulary extension — but the user has asked for this specific character treatment, and the flair axis is designed for exactly this kind of growth ("constant height holds regardless of any axis's vocabulary growth" — the picker was built anticipating more flairs).

Why a flair over a new hover treatment: see Research findings — all hover categories are claimed, character motion is categorically flair territory, and two recorded design decisions (motion split, always-on ambient) rule out row-hover character animation.

## What Changes

### 1. New flair value `spidey` in both closed sets (lockstep)

- `app/frontend/src/themes.ts:494` — append `"spidey"` to `FLAIR_STATES`:
  ```ts
  export const FLAIR_STATES = ["", "rain", "scan", "nyan", "naruto", "onepiece", "pacman", "matrix", "aquarium", "roadrunner", "invaders", "cube", "warp", "spidey"] as const;
  ```
- `app/backend/internal/validate/validate.go:208` — append `"spidey"` to `flairTokens` (the `@rk_flair` closed set; `FlairValues`/`ValidateFlairValue` derive from it).

The name is `spidey` — an homage nickname matching the existing naming register (naruto, onepiece, pacman, roadrunner), avoiding the trademarked full name. The sprite is an original pixel-art homage (red/blue web-swinger silhouette), consistent with how nyan/naruto/onepiece are drawn as original tiny SVG sprites.

### 2. `.rk-flair-spidey` treatment in `globals.css` (sprite-sheet mold)

A frame-animated sheet flair following the established CSS discipline:

- `::after` carries an inline-SVG data-URI **vertical sprite sheet of 22px-tall frames** (frame n at y = −22n), each frame drawing the swinger at a different swing phase **plus its web line** — the thread drawn from the frame's top edge down to the character's hand, so the "hanging from above" read comes from the artwork, and the swing arc (rise at the ends of a swing, dip in the middle, body lean swapping direction) is encoded **in the frames**, like nyan's body bob and onepiece's per-frame hull roll. ~4 frames at classic low-fps step cadence.
- Two `background-position` **longhands compose**: `-x` carries a slow linear left→right traversal (from a negative start offset to `calc(100% + Npx)` so loop boundaries happen fully off-screen), `-y` steps the sheet with `step-end` keyframes. Keyframe names follow the register: `rk-flair-spidey-x` / `rk-flair-spidey-y`.
- Optional `::before` ambient companion layer (e.g. faint web-filament tile drifting the opposite way, in the pattern of naruto/roadrunner's speed-streak tiles — own keyframes, never shared). May be omitted if it reads as noise.
- **No transforms, no layout-affecting properties** — background-position only, on the overlay's pseudos (the cube/warp child-span transform exception is NOT needed: the swing reads through frame poses + the stepped y-bob, same as every other character flair). Box-agnostic: the fixed 22px strip centering (static top/margin) so it renders on 24px rows, 36px coarse rows, server tiles, and 18px picker preview cells.
- Layer-balance rule: if `::after` carries multiple glued layers (sprite + trail), all layers' from/to offsets displace by identical px so they never separate.

### 3. Reduced-motion gate

Add `.rk-flair-spidey::before, .rk-flair-spidey::after` to the existing `prefers-reduced-motion` enumeration block (`globals.css` ~line 1253): `animation: none; display: none` — flairs are motion-only decoration, hidden entirely, no static fallback. Base rules must precede the gate block (source-order rule).

### 4. Consumers pick the value up from the closed sets

- **FlairOverlay** (`components/flair-overlay.tsx`): sheet/pseudo flairs render the bare overlay span — no child-span markup needed; expected zero or trivial change.
- **Picker flair band** (`swatch-popover.tsx`): `FLAIR_NAMED = FLAIR_STATES.slice(1)` → 13 named cells. Verify the `FLAIR_ROW_1`/`FLAIR_ROW_2` two-row split is computed (not hardcoded to 6/6); if hardcoded, adjust to a computed split (7/6). The band's `scrollIntoView` keyboard model already tolerates overflow; constant panel height is a stated invariant.
- **Backend/API**: no route changes — `@rk_flair` write paths validate via `ValidateFlairValue`, which derives from the updated `flairTokens`.

### 5. Tests

- `themes.test.ts` — flair closed-set expectations (add `spidey`).
- `validate_test.go` — `@rk_flair` closed-set cases (add `spidey`; keep the axes-independent assertion intact).
- `flair-overlay.test.tsx` / `swatch-popover.test.tsx` — enumeration-driven assertions (new cell renders, overlay class emitted).
- Any other closed-set enumerations surfaced by the sweep (`windows_test.go`, `sessions_test.go`, `sidebar/index.test.tsx` matched "nyan" in the intake grep — check each).
- No new e2e spec expected (flairs are asserted via class presence at unit level; the existing e2e surface doesn't enumerate flairs). If an e2e spec IS touched, its sibling `.spec.md` must be updated in the same commit (constitution: Test Companion Docs).

## Affected Memory

- `run-kit/ui/visual-design`: (modify) add the `spidey` entry to the § Character Flair Overlays catalogue (sheet geometry, frame count, traversal timing, companion layer) and the reduced-motion enumeration note; bump "12 named flairs" counts.
- `run-kit/ui/sidebar`: (modify) § Row Flair closed-set enumeration gains `spidey`.
- `run-kit/architecture`: (modify) validate closed-sets enumeration (`flairTokens`) gains `spidey`.
- `run-kit/tmux-sessions`: (modify) `@rk_*` user-option registry's `@rk_flair` value list gains `spidey` (verify at hydrate — the file matched the flair enumeration grep).

## Impact

- **Frontend**: `themes.ts` (closed set), `globals.css` (keyframes + classes + reduced-motion gate), `swatch-popover.tsx` (only if the row split is hardcoded), tests above. No new components.
- **Backend**: `internal/validate/validate.go` one-line closed-set append + test. No API surface change (Constitution IX untouched; no new endpoints).
- **Docs/memory**: four memory files (above), all count/enumeration touches plus one catalogue entry.
- **No dependencies added**; sprite is an inline SVG data-URI like the other sheets. State remains derived (the flair value lives in `@rk_flair` tmux options — Constitution II/X untouched).

## Open Questions

- (none — the placement decision was delegated to research and resolved; remaining choices are graded assumptions below)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | The swinging animation lands as a 13th named flair (`rk-flair-spidey`), not a new hover-treatment category | User delegated placement to research; every hover category is claimed, character homages are categorically flairs, and the recorded motion-split + always-on-ambient design decisions forbid row-hover character motion | S:70 R:55 A:85 D:75 |
| 2 | Confident | Flair name is `spidey` (homage nickname), not `spiderman` | Matches the homage naming register (naruto/onepiece/pacman/roadrunner); avoids the trademarked full name; stored `@rk_flair` values make later renames costly, but the pick has one obvious front-runner | S:60 R:35 A:80 D:70 |
| 3 | Confident | Sprite-sheet mold (frames encode the swing arc + web line; background-position longhands only), NOT the cube/warp child-span transform exception | The sheet mold is the house pattern for character flairs and the swing reads through frame poses + step-end bob, like nyan's bob and onepiece's hull roll; CSS-only and easily reworked if the arc needs more | S:50 R:75 A:65 D:45 |
| 4 | Certain | Frontend `FLAIR_STATES` and backend `flairTokens` are updated in lockstep | The two closed sets are the documented validation contract for `@rk_flair` writes; diverging them 400s every write of the new value | S:80 R:85 A:95 D:95 |
| 5 | Certain | Reduced motion hides the flair entirely (`animation: none; display: none`) — no static fallback | Explicit standing rule for ALL flairs (motion-only decoration carries no semantics); the gate block enumerates every flair pseudo | S:85 R:90 A:100 D:100 |
| 6 | Confident | The picker flair band absorbs the 13th cell without layout rework (7/6 column-flow split; scrollIntoView already tolerates future overflow) | The band derives from `FLAIR_STATES.slice(1)` and constant panel height is a stated invariant built for vocabulary growth; only a hardcoded row split would need a touch | S:60 R:80 A:80 D:80 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).
