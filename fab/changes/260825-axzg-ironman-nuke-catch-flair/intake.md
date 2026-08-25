# Intake: Iron Man Nuke-Catch Flair

**Change**: 260825-axzg-ironman-nuke-catch-flair
**Created**: 2026-08-25

## Origin

Conversational `/fab-discuss` session → `/fab-new`. The user asked for a flair depicting Iron Man flying in New York City catching the nuke, referencing the *Avengers* (2012) clip "Iron Man Carries the Nuke - Hulk Saves Iron Man Scene" (https://www.youtube.com/watch?v=yEcwwiVeBDQ), and asked for a scene analysis first, then a flair design:

> I want to create a flare of Iron Man flying in the New York City, catching the nuke animated […] do a deep analysis of the video first then come up with a way how you can represent that as a flare.

The design was worked out in the discussion session and accepted (the user proceeded to `/fab-new` on the presented design). The user then merged main first — the **spidey swing flair (`260824-164i`, PR #737)** landed immediately before this change (13th flair; this is the 14th). Mid-intake, the user added a direction: do NOT use the spidey flair as the creative reference — "you can do better with the Iron Man." So: spidey is the **mechanical** precedent only (the extension path — closed sets, tests, reduced-motion gate); the **visual design aims higher** — the two-act narrative loop and the two-layer parallax skyline below deliberately exceed spidey's single-pass, single-strip composition.

### Scene analysis → design mapping (discussion-time findings)

The referenced sequence, broken into sprite-scale beats: (1) **the carry** — Iron Man fused beneath the missile, redirecting it over the Manhattan skyline with a repulsor trail; (2) **the portal** — he exits the scene through the wormhole; (3) **the release** — character and payload separate off-screen; (4) **the fall** — he tumbles back powerless (no thruster glow, no trail); (5) **the Hulk catch** (excluded — see Assumptions). Two properties make this workable at 22px: the **fused rider-on-missile silhouette** is instantly recognizable without a face, and the sequence has a natural **two-act loop** (out with the nuke, back without it) — a story, unlike the catalogue's one-directional marquees.

Constraint findings from the existing catalogue that shaped the design:

1. **Glued layers cannot converge** — all background layers on one pseudo displace by identical px (pacman's constant-gap chase), so an "Iron Man closes in on the missile" chase is impossible; the catch is pre-fused in the sprite artwork.
2. **Two acts on one pseudo is proven** — aquarium's blue fish crosses twice per loop via a `50%/50.01%` keyframe teleport between fully-off-screen positions.
3. **Frame narrative and traversal choreograph independently** — the two `background-position` longhands compose, so act 1 can show carry frames and act 2 fall frames from the same sheet by timing the `-y` step keyframes against the `-x` teleport.
4. **Spidey established the NYC-skyline `::before` idiom** — a 12px bottom-hugging silhouette tile (72px period, two gray tone-depths, own keyframes) drifting opposite the character; and it established that **taller-than-22px frames are acceptable** when the composition needs room (spidey uses 30px frames for web-line headroom).
5. **The picker absorbs growth with zero change** — `FLAIR_ROW_1`/`FLAIR_ROW_2` in `swatch-popover.tsx:81-83` are computed alternating splits over `FLAIR_NAMED = FLAIR_STATES.slice(1)`; 14 named flairs render 7/7.

## Why

The flair catalogue is run-kit's per-row personality channel — a user-opt-in decoration axis designed for vocabulary growth (the picker's constant-height invariant was built anticipating more flairs, and the just-merged spidey change re-proved the extension path end-to-end). The user has asked for this specific character homage. Nothing breaks without it — it is a pure vocabulary extension — but it is exactly the kind of growth the axis exists for, and it would be the catalogue's first **two-act narrative loop** (every current character flair is a one-directional traversal; aquarium's double-cross is the only multi-pass precedent and carries no story).

Why a flair and not anything else: settled by the spidey change's intake-time research (all hover-treatment categories are claimed; character homages are categorically flairs; the motion-split and always-on-ambient design decisions forbid row-hover character motion). That research holds unchanged here.

## What Changes

### 1. New flair value `ironman` in both closed sets (lockstep)

- `app/frontend/src/themes.ts:494` — append `"ironman"` to `FLAIR_STATES`:
  ```ts
  export const FLAIR_STATES = ["", "rain", "scan", "nyan", "naruto", "onepiece", "pacman", "matrix", "aquarium", "roadrunner", "invaders", "cube", "warp", "spidey", "ironman"] as const;
  ```
- `app/backend/internal/validate/validate.go:208` — append `"ironman"` to `flairTokens` (the `@rk_flair` closed set; `FlairValues`/`ValidateFlairValue` derive from it).

The name is `ironman` — the homage naming register (naruto, onepiece, pacman, roadrunner, spidey). The sprite is an **original pixel-art homage** (red/gold armored figure + gray finned missile), drawn as tiny inline SVG like every other sheet — no film-derived assets.

### 2. `.rk-flair-ironman` treatment in `globals.css` — the two-act loop

A frame-animated sheet flair following the established CSS discipline (background-position longhands only, no transforms, overlay pseudos, box-agnostic), with one structural novelty: a **two-act x-traversal** using the aquarium mid-loop teleport.

**`::before` — Manhattan two-layer parallax** (richer than spidey's single strip — the nyan-starfield / onepiece-waves multi-layer precedent, own artwork + own keyframes, never shared): TWO skyline silhouette layers stacked as background layers on the one pseudo, both bottom-anchored repeat-x tiles drifting right→left at different speeds so the city reads with depth as the character crosses it. **Near layer**: ~96px-period tile, ~12px tall, stepped rooftops with water towers and one distinctly taller stepped spire (the Stark-Tower stand-in), ~12% fill. **Far layer**: ~64px-period tile, ~8px tall, lower sparser blocks at ~6% fill, moving slower. Each layer displaces by an exact multiple of its own period per the shared loop (`rk-flair-ironman-city`, linear infinite — one animation, two layers at different per-layer distances via the two-value `background-position` longhand lists, the same multi-layer keyframe technique rain/matrix use), so both loop boundaries are invisible. Distinct artwork from spidey's tile — different rhythm, taller spire — so adjacent flaired rows never read as copies.

**`::after` — the character layers, one pseudo, two acts** (~14s total loop, `rk-flair-ironman-x` for traversal + `rk-flair-ironman-y` for frame stepping):

- **Sprite sheet**: one vertical SVG data-URI sheet. Frames 0–3: **the carry** — a ~36px-wide fused composition: gray finned missile cylinder with a small orange 2-frame exhaust flicker at its nose-end, red/gold armored figure clinging beneath, blue-white repulsor glow behind; alternating frames carry a 1px climb-bob (the sprite drawn 1px higher on later frames — the upward redirect read, like onepiece's per-frame hull roll). Frames 4–5: **the fall** — the armored figure alone in a limp diagonal tumble, two alternating rotations drawn in the artwork, **no exhaust, no glow, no trail** (powerless free-fall is communicated by the missing effects). Frame height 22–30px as the artwork needs (spidey precedent allows the taller strip; exact geometry is an apply-time drawing decision).
- **Contrail layer** (act 1 only, glued on the same pseudo): a ~110px blue-white repulsor streak, left-edge faded through an SVG mask (nyan's trail mechanic, recolored). It is part of the same background stack with from/to offsets balanced against the sprite so they never separate; it reads as absent in act 2 because the act-2 x-park places it fully off-screen with the sprite (one traversal displaces all glued layers identically — the trail simply exits with the carry composition and the teleport re-enters only what act 2's offsets show). If a single-stack solution can't hide the trail in act 2, the fallback is baking the trail into the carry frames' artwork (the sheet is wide enough); either way NO third pseudo exists.
- **`rk-flair-ironman-x` (two-act traversal)**: 0%→~47%: left off-screen park → `calc(100% + Npx)` (the carry crosses left→right, slower — flying). ~47%→~53%: parked fully off-screen (the portal beat — the empty row IS the portal moment). `53%/53.01%`: teleport between off-screen parks (the aquarium mechanic). ~53%→100%: right off-screen → left off-screen (the fall crosses right→left, faster — falling). Both act boundaries land fully off-screen, so loop and teleport points are invisible.
- **`rk-flair-ironman-y` (frame narrative)**: `step-end` keyframes cycling frames 0–3 at ~5fps during act 1's window, then frames 4–5 during act 2's window — choreographed on the SAME duration as the x animation so the acts stay in sync (one 14s duration for both, unlike spidey's independent short y-cycle).

**Explicitly excluded** (v1 scope): no portal ring or flash visual (a parked landmark can't sit fixed on a traversing pseudo; a `::before` flash adds photosensitivity risk); no Hulk-catch second character (requires converging layers, which the glued-layer rule forbids). The off-screen edge implies the portal; the loop restarting is the reset.

**Colors are baked** in the sprite artwork (hot-rod red / gold, orange exhaust, blue-white repulsor + contrail, neutral-gray skyline) — character flairs never tint via `--rk-flair-color` (only rain/scan do). Cadences stay at classic low-fps (~5fps steps, no strobe) under photosensitivity thresholds.

### 3. Reduced-motion gate

Add `.rk-flair-ironman::before, .rk-flair-ironman::after` to the existing `prefers-reduced-motion` enumeration block in `globals.css`: `animation: none; display: none` — hidden entirely, no static fallback (flairs are motion-only decoration). Base rules precede the gate block (source-order rule).

### 4. Consumers pick the value up from the closed sets

- **FlairOverlay** (`components/flair-overlay.tsx`): sheet flairs render the bare overlay span — zero change expected (no child-span markup; `ironman` is not a transform flair).
- **Picker flair band** (`swatch-popover.tsx`): `FLAIR_NAMED` grows to 14; the computed alternating `FLAIR_ROW_1`/`FLAIR_ROW_2` split renders 7/7 — zero change (verified computed, not hardcoded, at lines 81–83).
- **Backend/API**: no route changes — `@rk_flair` write paths (window option, session `@rk_session_flair`, settings `server_flairs`) all validate via `ValidateFlairValue`, which derives from the updated `flairTokens`.

### 5. Tests

- `themes.test.ts` — flair closed-set expectations gain `ironman`.
- `validate_test.go` — `@rk_flair` closed-set cases gain `ironman`.
- `flair-overlay.test.tsx` / `swatch-popover.test.tsx` — enumeration-driven assertions (new cell renders, overlay class emitted); the spidey change touched `sidebar/index.test.tsx` too — sweep every enumeration the spidey diff touched and mirror it.
- No new e2e spec expected (flairs are asserted at unit level). If an e2e spec IS touched, its sibling `.spec.md` updates in the same commit (constitution: Test Companion Docs).

## Affected Memory

- `run-kit/ui/visual-design`: (modify) add the `ironman` entry to § Character Flair Overlays (two-act structure, sheet geometry, skyline layer, contrail, timing) and the reduced-motion enumeration; bump the named-flair counts; the two-act teleport choreography is a new documented technique alongside aquarium's.
- `run-kit/ui/sidebar`: (modify) § Row Flair closed-set enumeration gains `ironman`.
- `run-kit/architecture`: (modify) validate closed-sets enumeration (`flairTokens`) gains `ironman`.
- `run-kit/tmux-sessions`: (modify) `@rk_*` user-option registry's `@rk_flair` value list gains `ironman`.

## Impact

- **Frontend**: `themes.ts` (closed set), `globals.css` (three keyframe sets + two pseudo rules + reduced-motion gate), tests above. No component changes expected.
- **Backend**: `internal/validate/validate.go` one-line closed-set append + test. No API surface change (Constitution IX untouched).
- **Docs/memory**: four memory files (above) — enumeration/count touches plus one catalogue entry.
- **No dependencies added**; sprites are inline SVG data-URIs. State remains derived (`@rk_flair` tmux options / `server_flairs` settings — Constitution II/X untouched).

## Open Questions

- (none — the design was worked out and accepted in the preceding discussion session; remaining choices are graded assumptions below)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Lands as the 14th named flair on the flair axis, not any other surface | Settled by the spidey change's intake research (all hover categories claimed; character homages are categorically flairs) and the user's explicit "flair" framing | S:85 R:80 A:95 D:95 |
| 2 | Confident | Token is `ironman` (not `stark`/`avengers`/`nukecatch`) | Proposed in discussion with the naming-register rationale (naruto/onepiece/pacman/spidey); user proceeded without objection; stored `@rk_flair` values make renames costly but one obvious front-runner | S:65 R:35 A:80 D:75 |
| 3 | Confident | Two-act narrative loop (carry left→right, portal beat, fall right→left) via the aquarium `50%/50.01%` teleport, both acts on one `::after` | Presented as the hero design in discussion (single-pass offered as fallback); user proceeded on it; mechanically proven by aquarium; reworkable to single-pass by simplifying keyframes if review finds the sync brittle | S:70 R:70 A:75 D:60 |
| 4 | Certain | The catch is a pre-fused rider-on-missile sprite; no converging chase | Glued layers displace identically (documented constraint) — convergence is impossible on one pseudo; the fused silhouette is also the scene's most recognizable image | S:80 R:85 A:95 D:90 |
| 5 | Confident | v1 excludes the portal ring/flash and the Hulk catch | Discussed with rationale (fixed landmark can't ride a traversing pseudo; flash adds photosensitivity risk; second converging character forbidden by the layer rule); user proceeded on the scoped design | S:70 R:80 A:80 D:70 |
| 6 | Certain | Skyline backdrop is a TWO-LAYER parallax `::before` (near 96px-period / far 64px-period tiles, different speeds, exact-multiple displacement, distinct artwork from spidey's) — not spidey's single strip | User explicitly directed mid-intake not to use spidey as the creative reference ("you can do better"); this restores the original discussion design; nyan/onepiece prove the multi-layer parallax mechanic | S:75 R:80 A:85 D:80 |
| 7 | Confident | Contrail rides the same `::after` stack act-1-only (off-screen parked in act 2), with bake-into-frames as the fallback; never a third pseudo | Nyan's glued-trail mechanic is proven; only two pseudos exist per overlay and cube/warp's child spans are reserved for transforms; the fallback preserves the design if offset math can't hide the trail | S:55 R:75 A:70 D:60 |
| 8 | Certain | Frontend `FLAIR_STATES` and backend `flairTokens` updated in lockstep | The documented validation contract for `@rk_flair` writes; diverging them 400s every write of the new value | S:80 R:85 A:95 D:95 |
| 9 | Certain | Reduced motion hides the flair entirely (`animation: none; display: none`) — no static fallback | Standing rule for ALL flairs (motion-only decoration carries no semantics); the gate block enumerates every flair pseudo | S:85 R:90 A:100 D:100 |
| 10 | Certain | Picker absorbs the 14th cell with zero component change (computed 7/7 alternating split) | Verified in code at `swatch-popover.tsx:81-83` — `FLAIR_ROW_1`/`FLAIR_ROW_2` derive from `FLAIR_STATES.slice(1)` by index parity | S:80 R:90 A:100 D:95 |
| 11 | Certain | Colors baked in sprite artwork (red/gold, orange exhaust, blue-white repulsor, gray skyline); no `--rk-flair-color` tinting | Every character flair bakes its palette; only the ambient patterns (rain/scan) tint; documented in visual-design § Character Flair Overlays | S:70 R:80 A:90 D:85 |
| 12 | Confident | ~14s loop (act 1 slower than act 2), ~5fps step cadence, frame height 22–30px decided at apply time | Onepiece's 14s is the epic-pacing precedent; spidey's 30px frames license taller strips; exact px/timing are drawing-time details, easily tuned | S:60 R:90 A:75 D:70 |

12 assumptions (7 certain, 5 confident, 0 tentative, 0 unresolved).
