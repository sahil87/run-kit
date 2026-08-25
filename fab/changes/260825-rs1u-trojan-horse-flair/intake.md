# Intake: Trojan Horse Flair

**Change**: 260825-rs1u-trojan-horse-flair
**Created**: 2026-08-25

## Origin

One-shot `/fab-new` invocation:

> Add a new sidebar flair to the existing flair animation system (see FLAIR_STATES in app/frontend/src/themes.ts and the sprite-sheet CSS discipline in app/frontend/src/globals.css) inspired by the Iliad's Trojan Horse story. The flair should depict, as a CSS-only sprite-sheet traversal animation (same conventions as the existing nyan/naruto/onepiece/roadrunner flairs): a beach with a castle/town wall and a town skyline in the background as the ambient backdrop, and in the foreground a wooden horse starts on the beach, people come and pull/push it inside through the castle wall gate into the town, and then it transitions to a night scene where the whole town is on fire. Build this as a new flair option following the established two-layer pattern (ambient background layer + traversal/character layer), CSS-only with no JS timers, original stylized pixel-art SVG data URIs (no copyrighted assets), hidden entirely under prefers-reduced-motion, seamless integer-multiple loop math like the existing flairs.

The prompt is highly specified: it names the exact system (`FLAIR_STATES`, the `globals.css` sprite-sheet discipline), the exact conventions to follow (two-layer pattern, CSS-only, original pixel-art SVG data URIs, reduced-motion full hide, integer-multiple loop math), and the exact narrative to depict (beach + wall + skyline backdrop; horse pulled through the gate; night scene, town on fire). The remaining decisions are the flair's token name and the CSS mechanics for the one genuinely novel aspect — a **multi-phase narrative** loop, where every existing flair is a stateless traversal.

The extension path is fully paved by precedent: `260824-164i-spidey-swing-flair` (merged as #737) is the exact same class of change — a 14th named flair follows the same lockstep checklist (frontend `FLAIR_STATES` + backend `flairTokens`, one CSS block, the reduced-motion enumeration, count-bearing tests and memory files).

## Why

The flair catalogue is run-kit's per-row personality channel — a deliberate, user-opt-in decoration axis whose value grows with variety. It already spans data-rain, CRT effects, and six character homages (nyan, naruto, onepiece, pacman, roadrunner, spidey); a Trojan Horse story-flair is a requested addition in the same spirit, and the first to carry a *narrative arc* rather than a stateless crossing — which the always-on ambient design accommodates naturally (a long loop with phases is still a loop). If we don't add it, nothing breaks — this is a pure vocabulary extension — but the user has asked for this specific treatment and the axis is designed for exactly this growth ("constant height holds regardless of any axis's vocabulary growth" — the picker was built anticipating more flairs).

Why a flair and not anything else: character/story motion is categorically flair territory per the recorded design decisions in `docs/memory/run-kit/ui/visual-design.md` (§ "The motion split — markers hold still, flairs move"; § "Flair animation is always-on ambient"). The user also named the flair system explicitly.

## What Changes

### 1. New flair value `troy` in both closed sets (lockstep)

- `app/frontend/src/themes.ts:494` — append `"troy"` to `FLAIR_STATES` (after `"spidey"`, at the end):
  ```ts
  export const FLAIR_STATES = ["", "rain", "scan", "nyan", "naruto", "onepiece", "pacman", "matrix", "aquarium", "roadrunner", "invaders", "cube", "warp", "spidey", "troy"] as const;
  ```
- `app/backend/internal/validate/validate.go:208` — append `"troy"` to `flairTokens` (the `@rk_flair` closed set; `FlairValues`/`ValidateFlairValue` derive from it); update the enumerating comment at `validate.go:273`.
- `app/backend/api/operator.go:444` — the operator help text enumerates flair values; append `troy`.

The token is `troy` — short, evocative, matches the homage-nickname register (naruto, onepiece, pacman, roadrunner, spidey). The Iliad is public domain; the sprite art is original stylized pixel art (per-flair house rule). `trojan` was rejected for its malware connotation.

### 2. `.rk-flair-troy` treatment in `globals.css` — the narrative master loop

A two-pseudo treatment following the established discipline (background-position longhands only, no transforms, fixed-height strips, loop boundaries clean), extended with the one novel mechanic this flair needs: **a single master duration `D` (~24s) shared by every keyframe timeline on both pseudos, with the story phases encoded as keyframe percentages**. Every sub-cadence animation (frame stepping, flame flicker) gets a period that divides `D` exactly, so the whole scene loops seamlessly — the same integer-multiple loop math the existing flairs apply per-layer, applied scene-wide.

**Narrative phases (as percentages of the master loop, indicative):**

| Phase | ~% of loop | What shows |
|-------|-----------|------------|
| 1. Approach | 0–55% | Day scene. The wooden horse + pullers sprite traverses left→right across the beach toward the gate |
| 2. Entry | 55–65% | The sprite slides behind the wall layer through the gate opening (real occlusion, see layering) and the sheet parks on a blank frame |
| 3. Night + fire | 65–95% | Backdrop steps to its night frames: dark sky, town skyline aflame — 2 alternating fire frames flicker at a `D`-dividing cadence |
| 4. Reset | 95–100% | Backdrop steps back to the day frame while the row is horse-free; the sprite re-enters from off-left at 0% |

**Layering (the occlusion trick — pacman's multi-layer-one-pseudo pattern):**

- `::after` (foreground strip, bottom-anchored like onepiece) carries **two background layers**: layer 1 (paints on top) is the **castle wall + gate** — a no-repeat slice anchored at the box's right edge with a static x position (the gate is a fixed target regardless of box width); layer 2 (behind it) is the **horse + pullers vertical sprite sheet** (22px frames; ~4 walk frames — pullers' leg cycle + rope, horse on its wheeled platform — plus a blank frame for phases 2–4). The traversal keyframes run the sheet's x from off-left to a stop just inside the gate's x, so the sprite genuinely disappears *behind* the wall through the gate opening, not via a cut. The wall layer itself needs a night variant, so it is also a small vertical scene sheet (day / night / night-glow frames) y-stepped by the master timeline.
- `::before` (ambient backdrop, full row or bottom-anchored) carries the **beach + town-skyline scene sheet(s)**: repeat-x tiles whose vertical frames are day / night-fire-A / night-fire-B, y-stepped at the master-loop percentages (day through phases 1–2, alternating fire frames through phase 3). Skyline flames and glow live here, behind the wall.
- Keyframe names follow the register and are never shared: `rk-flair-troy-x`, `rk-flair-troy-frames`, `rk-flair-troy-scene`, `rk-flair-troy-wall` (indicative).

**Constraints honored** (the standing flair rules): background-position longhands only, never transform and never `left` (the drag-ghost rule; no cube/warp child-span exception needed); fixed-height strips with static centering/anchoring so px frame offsets hold at every box height (24px rows, 36px coarse rows, 18px picker preview cells, server tiles); sprite layers no-repeat with balanced from/to constants; all art as original pixel-art inline SVG data URIs (URL-encoded, `%23` hex colors); no external requests; fire flicker cadence well under photosensitivity thresholds (≥ 0.3s per frame, matching existing step cadences); CSS-only, no JS timers.

### 3. Reduced-motion gate

Add `.rk-flair-troy::before, .rk-flair-troy::after` to the existing `prefers-reduced-motion` enumeration (`globals.css` ~line 1320): `animation: none; display: none` — motion-only decoration, hidden entirely, no static fallback. Update the block's "all thirteen named states" comment to fourteen. Base rules must precede the gate block (source-order rule). Also update the flair section's header comment list (~line 482) with `troy`.

### 4. Consumers pick the value up from the closed sets

- **FlairOverlay** (`components/flair-overlay.tsx`): sheet/pseudo flairs render the bare overlay span — zero component change (no child-span markup; the cube/warp exception does not apply).
- **Picker flair band** (`swatch-popover.tsx`): `FLAIR_NAMED = FLAIR_STATES.slice(1)` → 14 named cells; the 2-row column-flow split is computed (`i % 2`), so it becomes 7/7 automatically. Update the "13 named states" doc comments (lines ~53, ~78, ~624).
- **Backend/API**: no route changes — `@rk_flair` and `@rk_session_flair` write paths validate via `ValidateFlairValue`, which derives from the updated `flairTokens`. Constitution IX untouched.
- **types.ts** (lines ~68, ~107): doc-comment unions gain `"troy"`.

### 5. Tests (the count-bearing enumeration sweep)

- `app/frontend/src/themes.test.ts:532` — `FLAIR_STATES` expected array gains `"troy"`.
- `app/backend/internal/validate/validate_test.go:529` — valid list gains `"troy"`; keep case/whitespace-variant invalids intact (add e.g. `"Troy"`, `" troy "` to the invalid list, matching the spidey precedent).
- `app/backend/api/operator_test.go:960` — the flair enumeration string gains `troy`.
- `app/frontend/src/components/swatch-popover.test.tsx:457` — "lists the 13 states … spidey last" → 14 states, troy last; the column-clamp test at ~801 (clamps to col 6, currently landing on spidey) re-lands on the new 7/7 grid — re-derive its expectation.
- `app/frontend/src/components/sidebar/index.test.tsx:2080` — flair-cell presence assertion (spidey precedent touched it; extend or re-point).
- `app/frontend/src/components/flair-overlay.test.tsx` — enumeration-driven loop (currently samples `["nyan", "spidey"]`); add or swap in `troy`.
- No new e2e spec expected (flairs are asserted via class presence at unit level). If an e2e spec IS touched, its sibling `.spec.md` updates in the same commit (constitution: Test Companion Docs).

## Affected Memory

- `run-kit/ui/visual-design`: (modify) add the `troy` entry to § Character Flair Overlays (sheet geometry, master-loop phase timeline, occlusion layering, companion-layer detail); bump the closed-set enumeration and "13 named flairs"/two-row-split counts; note the narrative master-loop pattern as the first multi-phase flair.
- `run-kit/ui/sidebar`: (modify) § Row Flair closed-set enumeration gains `troy`.
- `run-kit/architecture`: (modify) validate closed-sets enumeration (`flairTokens`) gains `troy`.
- `run-kit/tmux-sessions`: (modify) `@rk_flair` and `@rk_session_flair` value lists gain `troy`; "thirteen named states" count becomes fourteen.

## Impact

- **Frontend**: `themes.ts` (closed set), `globals.css` (keyframes + classes + header comment + reduced-motion gate — the largest artifact, several SVG sheets), `swatch-popover.tsx` (doc-comment counts only; the split is computed), `types.ts` (doc comments), tests above. No new components.
- **Backend**: `internal/validate/validate.go` one-token closed-set append + comment, `api/operator.go` help-text enumeration, tests. No API surface change; no new endpoints (Constitution IX untouched).
- **Docs/memory**: four memory files (above) — enumeration/count touches plus one catalogue entry.
- **No dependencies added**; all art is inline SVG data URIs. State remains derived — the flair value lives in `@rk_flair`/`@rk_session_flair` tmux options (Constitution II/X untouched).

## Open Questions

- (none — the prompt pre-resolved the conventions; remaining choices are graded assumptions below)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Flair token is `troy` (not `trojan`, `trojanhorse`, or `iliad`) | Matches the short homage-nickname register (naruto/onepiece/pacman/spidey); `trojan` reads as malware; stored `@rk_flair` values make later renames costly but there is one clear front-runner | S:55 R:35 A:80 D:70 |
| 2 | Certain | Frontend `FLAIR_STATES` and backend `flairTokens` updated in lockstep, `troy` appended last | The two closed sets are the documented validation contract for `@rk_flair` writes; append-at-end is the established growth order (spidey precedent) | S:85 R:85 A:95 D:95 |
| 3 | Confident | Multi-phase narrative encoded as ONE master-loop duration (~24s) shared by all keyframe timelines, phases as keyframe percentages, sub-cadences at periods dividing D exactly | The user asked for "seamless integer-multiple loop math"; this is its scene-wide application, and the only CSS-only way to keep phases synced with no JS timers; timings are trivially tunable later | S:75 R:80 A:80 D:70 |
| 4 | Confident | Gate occlusion via two background layers on ONE `::after` pseudo — wall+gate no-repeat anchored at the right box edge painting over the horse sheet behind it | pacman's multi-layer-one-pseudo pattern; a right-edge-anchored gate is the only box-width-agnostic fixed target for the traversal endpoint; genuine occlusion beats a hard cut and needs no transforms | S:60 R:75 A:75 D:60 |
| 5 | Confident | Day→night transition via vertical scene sheets on the backdrop layers, y-stepped at master-loop percentages; fire flicker as 2 alternating night frames at a D-dividing cadence ≥ 0.3s/frame | The sheet-frame mechanic is the house pattern (all character flairs step -y); flicker cadence matches existing step rates and stays under photosensitivity thresholds | S:70 R:80 A:80 D:75 |
| 6 | Certain | Reduced motion hides the flair entirely (`animation: none; display: none`) — no static fallback | Explicit standing rule for ALL flairs (motion-only decoration carries no semantics); the gate block enumerates every flair pseudo | S:85 R:90 A:100 D:100 |
| 7 | Certain | The picker flair band absorbs the 14th cell with zero layout code change (computed `i % 2` column-flow split → 7/7); only count-bearing doc comments and tests update | `FLAIR_ROW_1`/`FLAIR_ROW_2` are derived by filter, verified in source; constant panel height is a stated invariant built for vocabulary growth | S:75 R:85 A:95 D:90 |
| 8 | Confident | Foreground strip is bottom-anchored (onepiece/spidey precedent), horse+pullers drawn as ~4 walk frames + 1 blank frame in a single 22px-frame vertical sheet | Ground-based procession reads bottom-anchored; the blank frame is the cheapest way to keep the row horse-free through the night phase while the sheet's x stays parked | S:65 R:80 A:80 D:70 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).
