# Plan: Flair overlays run on the compositor

**Change**: 260916-ph9x-flair-compositor-only
**Intake**: `intake.md`

> Read `intake.md` first — its § Research findings (R1/R2) are the evidence every requirement below rests on, and its § What Changes carries the per-flair conversion table and the exact conversion arithmetic. This plan does not repeat the data URIs or today's keyframe constants; `app/frontend/src/globals.css` § Flair overlays is the source for those.

## Requirements

### Frontend CSS: the compositing rule (`app/frontend/src/globals.css` § Flair overlays)

#### R1: Flair keyframes animate only compositor properties
Every `@keyframes rk-flair-*` block in `globals.css` MUST declare only `transform` and/or `opacity`. No flair rule MAY animate `background-position` (or its longhands), `left`/`top`/`inset`, `border-*`, `color`, `filter`, or any other property. No `::before`/`::after` pseudo-element in the section MAY carry an `animation`; pseudos are removed where a child span replaces them (a purely static pseudo MAY remain only if it paints nothing that moves). Container-query units, `var()` and `calc()` inside transform keyframes are permitted.

- **GIVEN** the five-overlay perf route (`/rk-perf-flair`: nemo, nemo, aquarium, aquarium, cube)
- **WHEN** `just perf-idle-cpu /rk-perf-flair 30 --url <dev rig>` runs with every flair animating
- **THEN** `RecalcStyleCount` over 30 s is within 200 of the same session's `--reduced-motion` floor run (≈130), instead of ≈1800
- **AND** `document.getAnimations()` still lists every flair animation as `running` (nothing is silently stopped)

#### R2: Every moving layer is a `FlairOverlay` child span
`FlairOverlay` (`app/frontend/src/components/flair-overlay.tsx`) MUST render one child `<span>` per moving layer for all sixteen flairs, driven by a per-flair layer table in the component. A stepped sprite MUST be a frame-box span (the sprite's width × its strip height, `overflow: hidden`, positioned exactly where the old strip pseudo sat) holding an inner sheet span (the full sheet as `background-image`, `background-repeat: no-repeat` or `repeat-y` when the frame cycle is tiled). Ambient tiles MUST be their own spans sized to the box plus one displacement period. DOM order MUST equal today's paint order (former `::before` content first, former `::after` content last). The existing cube, warp and nemo child markup MUST remain unchanged (the Vitest contracts for them stay green as written). Class names are flair-scoped (`rk-<flair>-<layer>` style) and stable.

- **GIVEN** `render(<FlairOverlay flair="nyan" />)`
- **WHEN** the overlay is inspected
- **THEN** it holds the star tile span first, then the cat frame box (with its inner sheet span), then the trail frame box — and no pseudo-element carries an animation

#### R3: No flair animation iterates faster than 1 s
Every `animation` in the section MUST have an iteration duration ≥ 1 s. Fast visual cadences MUST be encoded inside a longer iteration: articulation (nemo tail ±22°, fin ±18°, blades ±7°) as explicit keyframe lists (8 s iteration holding 10 full wags at the 0.4 s cadence, 20 at the 0.2 s cadence, per-segment `ease-in-out`, existing `animation-delay` offsets kept verbatim, the counter-phase blade on the inverted list); frame stepping via `steps(n)` or `step-end` keyframe lists whose iteration covers ≥ 1 s of frames (repeating the frame cycle inside the list, or tiling the sheet with `repeat-y` on a taller inner span). The visible cadence (frames per second, wags per second) MUST equal today's.

- **GIVEN** the two nemo overlays animating alone (aquarium and cube rows re-flaired to `""`)
- **WHEN** measured for 30 s on the dev rig
- **THEN** `RecalcStyleCount` is within 200 of the floor (research: 213 vs ≈130) and renderer % is within 3 points of the floor (research: 5.0 vs 3.0–3.7), versus 11.2% and 60 recalcs/s before

#### R4: Pixel-art layers move in whole device pixels
Every pixel-art layer (all sheet sprites and their glued companions, rain dashes, scan lines, matrix glyphs, stars, streaks, dust, cities, bubbles — everything except nemo's bezier fish and blades, cube's wireframe and warp's star planes) MUST be translated with a `steps()` timing function whose step count equals the traversal distance in CSS px (times the device-pixel factor, R4a), so the layer only ever sits on whole device pixels exactly as `background-position` snapping did:
- width-dependent traversals use `steps(calc((var(--rk-flair-w, 240) + K) * var(--rk-flair-dpr, 1)))` (jump-end) with the frame box translated `from translateX(A px) to translateX(calc(var(--rk-flair-w, 240) * 1px + E px - w px))`, where today's rule was `background-position-x: A px → calc(100% + E px)` on a layer of width `w` and `K = E − A − w` (glued layers of one flair share `K` by construction — one count per flair);
- fixed-period tiles use a literal `steps(P × dpr)` for a displacement of `P` px per iteration, on a span covering the box plus the displacement (`width: calc(100% + P px)` or `height: calc(100% + P px)`), with today's `background-repeat`;
- smooth vector layers (nemo swims, cube ricochet/spin, warp planes) keep `linear`/their current timing and MAY use `100cqw`/`100cqh`.

R4a: under `@media (min-resolution: 2dppx)` the overlay rule sets `--rk-flair-dpr: 2` so hops stay one device pixel on 2× displays.

- **GIVEN** the nyan cat frame box mid-traversal on a 1× viewport, paused at an arbitrary `currentTime`
- **WHEN** its row is screenshotted and the distinct-color count of the row crop is compared with the same paused time on the pre-change build
- **THEN** the counts match (research oracle: 7 colors snapped vs 18–19 blurred)

#### R5: `FlairOverlay` maintains the integer width variable without re-rendering
For every flair whose layers use `--rk-flair-w`, `FlairOverlay` MUST attach a `ResizeObserver` to the overlay element on mount, write `Math.round(contentRect.width)` to the element's inline `--rk-flair-w` custom property on every observation (directly via the element's `style`, never React state), and disconnect on unmount. A single module-level shared observer is preferred when it stays simple; one observer per overlay is acceptable. Every mount site (window row, session row, server header, server tile, picker band cells, composite preview) gets the behavior through the single component with no call-site changes. CSS falls back to `var(--rk-flair-w, 240)` before the first observation.

- **GIVEN** a mounted `<FlairOverlay flair="pacman" />` in Vitest with a mocked `ResizeObserver` whose callback reports `contentRect.width: 219.6`
- **WHEN** the callback fires
- **THEN** the overlay element's `style.getPropertyValue("--rk-flair-w")` is `"220"`, and the component did not re-render (no state hook involved)

#### R6: Reduced motion and drag guard are unchanged in effect
Under `prefers-reduced-motion: reduce` every one of the sixteen `.rk-flair-<name>` overlay spans MUST be hidden (`display: none`), replacing today's per-pseudo/per-child list with one rule per overlay (or one selector list). `FlairOverlay`'s `hidden` prop MUST still render nothing for every flair, and the `color` prop MUST still set `--rk-flair-color` (read by the rain/scan lane spans).

- **GIVEN** `prefers-reduced-motion: reduce`
- **WHEN** any flaired row renders
- **THEN** no flair pixel is painted and `document.getAnimations()` lists no `rk-flair-*` animation

#### R7: A static CSS lint enforces the rule
A Vitest file (`app/frontend/src/globals.flair.test.ts` or equivalent) MUST read `globals.css`, isolate the `/* ── Flair overlays` section (up to the next `/* ──` section rule) plus the reduced-motion flair block, and assert: (a) every `@keyframes rk-flair-*` block declares only `transform`/`opacity`; (b) `background-position` appears inside no `@keyframes` block anywhere in the file; (c) every `animation`/`animation-duration` declaration in the section has a duration ≥ 1 s (parse `Ns`/`Nms`); (d) every name in `FLAIR_STATES` (imported from `@/themes`) except `""` has a reduced-motion rule hiding `.rk-flair-<name>`. The test MUST pass on the converted CSS and MUST fail if any assertion is violated (verify once by temporarily breaking one rule, then restore).

- **GIVEN** the converted `globals.css`
- **WHEN** `just test-frontend` runs
- **THEN** the lint passes; and a `background-position` reintroduced into any `rk-flair-*` keyframe makes it fail with a message naming the keyframe

### Frontend behavior: visual parity and acceptance

#### R8: Every flair looks the same as before
Sheet data URIs MUST be byte-identical to today's. Durations, from/to constants, strip anchoring (centered 22 px strips; spidey's `bottom: -8px` 30 px strip; ironman's centered 30 px strip; onepiece/noon bottom-anchored), opacities (`0.92`/`0.9`), tinting, stacking (nemo bubbles under fish/weed), the blue-fish 50%/50.01% teleport, aquarium's mid-loop stops, invaders' `steps(26, jump-none)` 13 s `alternate` wander, ironman's frame-per-percent narrative and multi-stop traversal MUST convert 1:1. Visual parity MUST be demonstrated with paused-`currentTime` screenshot pairs per flair — old build (release daemon `http://127.0.0.1:3000/rk-perf-flair`) vs new build (dev rig), same `T` values (one mid-traversal, one at a frame step), `deviceScaleFactor` 1 and 2 — compared by eye and by distinct-color count of the row crop, recorded in § Measurements below and summarized in the PR.

- **GIVEN** each of the sixteen flairs set on the perf server's first window in turn
- **WHEN** both builds are paused at the same `currentTime` and screenshotted
- **THEN** sprite positions match to the pixel, frame indices match, and pixel-art rows have equal distinct-color counts; the only permitted differences are sub-pixel softness on ironman's linear multi-stop traversal and the soft scan band

#### R9: Five on-screen flairs cost within noise of none
On the same-build dev rig, the five-overlay run MUST read renderer % within 3 points of the session's `--reduced-motion` floor and `RecalcStyleCount` within 200 of it over 30 s, with `anims` ≥ the count of flair animations the five overlays declare. A per-flair table (each of the 16 flairs alone on one window for 20 s) MUST show each flair's recalcs within 130 of the floor; any flair ≥ 600 per 20 s is not composited and fails. A failing measurement is re-run once before it counts. Before/after summary lines, the floor, and the per-flair table are recorded in § Measurements.

- **GIVEN** the `rk-perf-flair` tmux server (nemo, nemo, aquarium, aquarium, cube windows) and `just dev` serving this worktree
- **WHEN** the before (untouched worktree), floor, and after runs are taken
- **THEN** after − floor ≤ 3 renderer points and ≤ 200 recalcs, and before − after ≥ 5 renderer points

#### R10: Scope stays inside the two frontend files plus tests and memory
No Go code, no `FLAIR_STATES`/`themes.ts`, no `validate.go`, no settings, no e2e spec, no picker grid change, no new flair. `npx tsc --noEmit` passes; `just test-frontend` passes; the eight sidebar/picker Vitest files that mount flairs stay green (assertions that counted overlay children are updated to the new contract, never deleted).

- **GIVEN** the finished diff against `origin/main`
- **WHEN** `git diff --name-only <merge-base>` is listed
- **THEN** it contains only `app/frontend/src/globals.css`, `app/frontend/src/components/flair-overlay.tsx`, `app/frontend/src/components/flair-overlay.test.tsx`, the new CSS lint test, any Vitest files whose overlay-children assertions needed the new contract, and this change's `fab/changes/…` artifacts

### Non-Goals

- Pause-when-hidden of any kind (`content-visibility`, `IntersectionObserver`, `animation-play-state` gating) — measured useless once composited (intake § R2)
- Changing which surfaces render a server flair (group header + SERVERS tile both keep it)
- Frame-rate reduction, `will-change` hints, WebGL, new settings, reduced-motion semantics, new flairs
- Fixing the "Server not found" page's 100% CPU loop (separate `idea`)

### Design Decisions

#### Flairs must not tick the main thread
**Decision**: Every flair animation is compositor-only — keyframes animate only `transform`/`opacity` on real child spans, never `background-position` on pseudo-elements — and no iteration is shorter than 1 s.
**Why**: Measured 2026-09-16 on five overlays: 13.6% renderer / 1803 recalcs per 30 s vs a 3.0% / 129 floor; any animated `background-position` alone held style recalc at 60/s (aquarium fish 1203/20 s, nemo bubbles 1203/20 s), while transform layers on child spans composited at the floor (nemo swims 90, cube 94–101). Composited animations still cost one main-thread frame per iteration boundary (~0.045 renderer points per boundary/s; nemo's 14 sub-second `alternate` parts ≈ 55/s), so cadences live inside long keyframe lists. Nemo end to end: 11.2% → 5.0%.
**Rejected**: Removing or defaulting flairs off (a chosen feature); pausing off-screen overlays (`content-visibility: auto` left all 91 animations ticking; an `IntersectionObserver` pause of 41 rows measured worse); `will-change` (no effect: 1110 vs 1108); reducing frame rate (changes the look).
*Introduced by*: 260916-ph9x-flair-compositor-only

#### Pixel-art traversals are quantized with `steps()`
**Decision**: Pixel-art layers translate with `steps(distance × dpr)` fed by a `ResizeObserver`-maintained integer width variable (`--rk-flair-w`) so they land only on whole device pixels; smooth vector layers stay `linear`.
**Why**: `background-position` is pixel-snapped, so today's sprites hop by whole pixels and stay crisp; a fractional composited translate renders the same nyan sheet through bilinear filtering (18–19 distinct colors and ~120 soft-edge pixels vs 7), and `image-rendering: pixelated` does not change it. `steps(calc(var(--w) + 40))` is accepted by Chromium, lands on integers, renders 7 colors and stays composited.
**Rejected**: Accepting the blur (changes the look of 13 flairs); `image-rendering: pixelated` (no effect on compositor filtering); a fixed step count (fractional steps on any width it was not tuned for); `round()` in keyframes (interpolation happens after keyframe resolution).
*Introduced by*: 260916-ph9x-flair-compositor-only

#### Container-query units stay allowed in flair keyframes
**Decision**: `100cqw`/`100cqh`, `var()` and `calc()` remain permitted inside transform keyframes; every overlay is a size query container.
**Why**: The plan's leading hypothesis (cq units block compositing) was falsified directly — nemo's swims composite identically with `100cqw`, px, and `var()` endpoints (89–90 recalcs / 20 s).
**Rejected**: Replacing cq units with JS-measured px everywhere (unnecessary; the width variable is needed only where integer quantization is).
*Introduced by*: 260916-ph9x-flair-compositor-only

## Tasks

### Phase 1: Setup

- [x] T001 Confirm the perf rig and take the BEFORE and FLOOR measurements on the untouched worktree: verify `tmux -L rk-perf-flair list-windows -t perf -F '#W flair=#{@rk_win_flair}'` shows `nemo1=nemo nemo2=nemo aquarium1=aquarium aquarium2=aquarium cube1=cube` (recreate per intake § 5 if missing); start this worktree's dev rig (`RK_CODE_SERVER_PORT=<any free port> just dev` in the background — code-server is not installed here, the preset skips it; Vite serves `http://127.0.0.1:3418`, Go at 3419 — confirm the URL from the dev output and that `curl -s http://127.0.0.1:3418/rk-perf-flair` returns 200); run `scripts/perf-idle-cpu.sh /rk-perf-flair 30 --url http://127.0.0.1:3418 --label before` and `… --reduced-motion --label floor`; paste both summary lines into § Measurements. Check with a 6 s smoke run that `anims` ≥ 31 (all five overlays animating) before trusting a number. <!-- R9 -->

### Phase 2: Core Implementation

- [x] T002 `app/frontend/src/components/flair-overlay.tsx`: add the per-flair layer table and render one child span per moving layer for every flair (frame box + inner sheet span per stepped sprite; tile spans for ambience; DOM order = former `::before` content first, `::after` content last; cube/warp/nemo markup untouched). Add the `ResizeObserver` that writes `Math.round(contentRect.width)` to the overlay element's inline `--rk-flair-w` (ref + effect, no state; shared module-level observer preferred; disconnect on unmount). Rewrite the file header comment for the new contract (no change IDs, no narration). <!-- R2 -->
- [x] T003 `app/frontend/src/components/flair-overlay.test.tsx`: replace the "bare span for sheet flairs" test with per-flair layer-contract assertions (child count and order for each of the 13 converted flairs), keep the cube/warp/nemo/hidden/empty tests, and add the `--rk-flair-w` test with a mocked `ResizeObserver` (`219.6` → `"220"`). <!-- R5 -->
- [x] T004 `app/frontend/src/globals.css` § Flair overlays — shared rules: move `container-type: size` onto a shared overlay selector covering all sixteen `.rk-flair-<name>` spans; declare `--rk-flair-dpr: 1` there and `2` under `@media (min-resolution: 2dppx)`; rewrite the section header comment to the compositing rule (transform/opacity-only keyframes, child-span layers, ≥1 s iterations, `steps()` quantization and why, drag-ghost guard now for every flair, WebGL rejection kept, the measured reason in one line). <!-- R1 -->
- [x] T005 `globals.css` nemo: replace the tail/fin/blade `alternate` loops with 8 s explicit-keyframe iterations (10 wags at 0.4 s cadence, 20 at 0.2 s, per-segment `ease-in-out`, delays kept, inverted list for the counter-phase blade); move the bubbles from `::before` to the new bubble tile span (`translateY(0 → −44px)` over 5 s with `steps(calc(44 * var(--rk-flair-dpr, 1)))`, `height: calc(100% + 44px)`, z-index 1); swims unchanged. <!-- R3 -->
- [x] T006 `globals.css` aquarium: three frame boxes (orange 18×22 `K` from `−18 → 100%+22`, blue 16×22 with the 50%/50.01% teleport, seaweed fixed at `left: 6px`) with inner 2-frame steppers at today's 2.5/5/2.5 flips per second inside a 1.6 s iteration (4/8/4 frame changes per list), plus the bubble tile span exactly as nemo's. <!-- R1 -->
- [x] T007 [P] `globals.css` rain, scan, matrix: rain → two lane spans (36/28 px periods, `width: calc(100% + 72px)`/`+56px`, `translateX(0 → −72px)` `steps(72×dpr)` / `−56px` `steps(56×dpr)`, 2.8 s, gradients read `--rk-flair-color`); scan → crawl span (`height: calc(100% + 3px)`, `top: −3px`, `translateY(0 → 3px)` `steps(3×dpr)`, 2.4 s) + band span (12 px, `translateY(−12px)` at 0%/60% → `translateY(100cqh)` at 100%, 7 s, linear — soft gradient, no quantization needed); matrix → three tile spans (`height: calc(100% + 88/132/176px)`, `translateY` by 88/132/176 px, `steps(88/132/176 ×dpr)`, 9 s). <!-- R4 -->
- [x] T008 [P] `globals.css` nyan, naruto, roadrunner: each becomes an ambient tile span (nyan stars 80 px 2.4 s + 2-frame stepper ≥1 s; naruto/roadrunner streaks 48 px 0.7 s → two periods per 1.4 s iteration, `steps(96×dpr)`) plus frame box + inner sheet for the character (nyan 36×22 4-frame at 0.6 s → 1.2 s list of 8; naruto 30×22 4-frame at 0.5 s → 1 s list of 8; roadrunner 36×22 2-frame at 0.3 s → 1.2 s list of 8) and nyan's glued trail frame box (140×22, same `K`, ±1 px jiggle as a translateY stepper on the same cadence). <!-- R4 -->
- [x] T009 [P] `globals.css` onepiece, pacman, invaders: onepiece → two wave spans (`steps(48×dpr)` / `steps(72×dpr)`, 4 s) + bottom-anchored ship frame box 34×22 with the 4-frame 1.6 s list; pacman → three frame boxes sharing one `K` (pacman 20×22 and ghost 16×22 with 2-frame steppers at 0.4 s → 1.2 s lists, dots 140×22 static inside its box), 7 s; invaders → frame box 44×22 `translateX(0 → calc(var(--rk-flair-w, 240) * 1px − 44px))` `steps(26, jump-none)` 13 s `alternate` + inner 2-frame 1 s stepper. <!-- R4 -->
- [x] T010 [P] `globals.css` spidey, ironman, noon: spidey → city tile span (72 px, `steps(72×dpr)`, 18 s) + frame box 32×30 anchored `bottom: −8px` with the 8-frame 2.4 s `step-end` list; ironman → two city spans (192/64 px, 16 s) + frame box 36×30 whose translateX keeps the 0→40%→50%→60%→100% narrative on whole-pixel endpoints (`linear`, the one unquantized pixel-art traversal) and an inner 16 s `step-end` list mapping today's `-30n px` frames 1:1; noon → dust span (30 px, `steps(30×dpr)`, 11 s) + bottom-anchored frame box 80×22 with a `step-end` list preserving the 4-frames-per-0.125 s cadence inside a ≥1 s iteration. <!-- R4 -->
- [x] T011 `globals.css` reduced-motion block: replace the per-pseudo/per-child flair list with rules hiding the sixteen `.rk-flair-<name>` overlay spans (`display: none`); update the comment (motion-only decoration hidden entirely; the onepiece wave baseline hides with the overlay). <!-- R6 -->
- [x] T012 New `app/frontend/src/globals.flair.test.ts`: read `globals.css`, slice the flair section and the reduced-motion block, assert (a) transform/opacity-only `rk-flair-*` keyframes, (b) no `background-position` inside any `@keyframes`, (c) every section animation duration ≥ 1 s, (d) reduced-motion coverage for every `FLAIR_STATES` name; verify it fails when one rule is broken, then restore. <!-- R7 -->

### Phase 3: Integration & Edge Cases

- [x] T013 Visual parity: write a throwaway Playwright script under this worktree's scratch dir (not committed) that, for each of the 16 flairs, sets the perf server's `nemo1` window to that flair (`tmux -L rk-perf-flair set-option -w -t perf:nemo1 @rk_win_flair <flair>`, others `""`), loads `/rk-perf-flair` on both the release daemon (`http://127.0.0.1:3000`) and the dev rig, pauses all animations at two fixed `currentTime` values, screenshots the row at `deviceScaleFactor` 1 and 2, and records sprite position, frame index and the row crop's distinct-color count per build. Fix any mismatch in the CSS; record the table in § Measurements (positions match; color counts equal for pixel-art flairs; note ironman/scan-band softness if any). Restore the five-flair configuration afterwards. <!-- R8 -->
- [x] T014 AFTER measurements on the dev rig: five-overlay 30 s run (`--label after`) plus a fresh `--reduced-motion` floor, and the per-flair 20 s table (each flair alone on `nemo1`, others cleared) — re-run any failing measurement once; paste summary lines and the table into § Measurements; confirm after − floor ≤ 3 renderer points and ≤ 200 recalcs, and every flair < 600 recalcs per 20 s; restore the five-flair configuration. <!-- R9 -->
- [x] T015 Gates: `cd app/frontend && npx tsc --noEmit`; `just test-frontend` (all Vitest incl. the eight flair-mounting files — update any overlay-children assertion to the new contract); `cd app/frontend && pnpm build` (production bundle compiles). No e2e run, no Go tests (no Go touched). <!-- R10 -->

### Phase 4: Polish

- [x] T016 Comment and diff hygiene pass over `globals.css` and `flair-overlay.tsx`: comments state constraints and non-obvious arithmetic (each flair's `K` and why), never narrate or cite change IDs; remove any pseudo rule left behind with nothing to paint; `git diff --stat` shows only the files R10 allows. <!-- R10 -->

## Execution Order

- T001 first (BEFORE numbers must come from the untouched tree)
- T002 → T003; T004 before T005–T011 (shared overlay rule and `--rk-flair-dpr` are prerequisites)
- T005–T010 may run in parallel after T004; T011 and T012 after them
- T013 → T014 → T015 → T016

## Acceptance

### Functional Completeness

- [x] A-001 R1: No `@keyframes rk-flair-*` block declares a property other than `transform`/`opacity`, and no flair pseudo-element carries an `animation`
- [x] A-002 R2: `FlairOverlay` renders child layer spans for all sixteen flairs from a per-flair table, in paint order, with cube/warp/nemo markup unchanged
- [x] A-003 R3: Every flair animation iteration is ≥ 1 s; nemo's parts run as 8 s explicit-keyframe lists with delays preserved
- [x] A-004 R4: Every pixel-art layer's traversal uses `steps()` with a count equal to its px distance × `--rk-flair-dpr`; width-dependent ones read `--rk-flair-w`; smooth vector layers are unquantized
- [x] A-005 R5: A `ResizeObserver` keeps `--rk-flair-w` current on the overlay element without React state; disconnects on unmount
- [x] A-006 R6: Reduced motion hides all sixteen overlay spans; `hidden` still renders nothing; `color` still sets `--rk-flair-color`
- [x] A-007 R7: The CSS lint Vitest exists, passes on the converted CSS, and was shown to fail on a deliberately broken rule
- [x] A-008 R8: Sheet data URIs are byte-identical to `origin/main`; durations, constants and anchoring convert 1:1
- [x] A-009 R9: § Measurements holds before, floor, after summary lines and the 16-row per-flair table with the stated thresholds met
- [x] A-010 R10: The diff touches only the files R10 permits

### Behavioral Correctness

- [x] A-011 R1: Five-overlay run on the dev rig reads recalcs within 200 of the floor and renderer within 3 points of it (was 13.6% / 1803 vs 3.0% / 129 on the release daemon)
- [x] A-012 R3: Nemo-only run on the dev rig reads within 3 renderer points and 200 recalcs of the floor
- [x] A-013 R4: Paused-time screenshot of a pixel-art sprite mid-traversal has the same distinct-color count on the new build as on the old build at 1× (no bilinear blur)
- [x] A-014 R9: `anims` in the after run is ≥ the five overlays' declared animation count — nothing was silently stopped

### Scenario Coverage

- [x] A-015 R8: Screenshot pairs for all 16 flairs at 1× and 2× and two `currentTime` values show matching sprite positions and frame indices; the only differences are the permitted sub-pixel softness cases
- [x] A-016 R2: `flair-overlay.test.tsx` asserts the layer contract for every converted flair and the width variable behavior
- [x] A-017 R9: Per-flair table: every flair alone reads < 600 recalcs per 20 s, within 130 of the floor

### Edge Cases & Error Handling

- [x] A-018 R5: Before the first `ResizeObserver` callback the CSS falls back to `--rk-flair-w: 240` and nothing is degenerate; picker cells (18 px / 28 px) receive their own rounded width
- [x] A-019 R4: Invaders' wander still maps image-edge to box-edge on any mount width (`translateX(0 → W − 44px)`); the blue fish's teleport keyframes stay fully off-screen at both ends
- [x] A-020 R6: A row that is the drag source still renders no overlay for every flair (uniform guard, now load-bearing for all 16)

### Code Quality

- [x] A-021 Pattern consistency: new spans and classes follow the existing `rk-*` / `rk-<flair>-<part>` naming and the cube/warp/nemo child-markup precedent; CSS comments state constraints and arithmetic, not narration or change IDs
- [x] A-022 No unnecessary duplication: one shared overlay rule carries `container-type`, `--rk-flair-dpr`; repeated per-flair geometry (22 px strip centering) is expressed once where the cascade allows
- [x] A-023 Type narrowing over assertions in `flair-overlay.tsx` (the layer table is typed against `FlairState`; no `as` casts beyond the existing `--rk-flair-color` style object)
- [x] A-024 Tests accompany the behavior change (layer contract, width variable, CSS lint) per code-quality.md; no e2e added for motion
- [x] A-025 No magic numbers without a stated source: every `K`, period and step count in the CSS traces to today's constants in a comment or is derivable from the rule text
- [x] A-026 Readability: the layer table in `flair-overlay.tsx` reads as data, not a chain of conditionals; functions stay small

## Measurements

Rig: `rk-perf-flair` tmux server (`perf` session: `nemo1=nemo nemo2=nemo aquarium1=aquarium aquarium2=aquarium cube1=cube`), route `/rk-perf-flair`, viewport 1600×1000, headless Chromium (software GPU on this VM). Noise floor ≈ 3 renderer points run to run; the state socket rate (3–12 msg/s) moves the floor by ~1 point.

Reference (release daemon 3.20.1 on `:3000`, research 2026-09-16, 30 s):

```
perf-idle-cpu base 30.1s renderer=13.6% gpu=3.4% browser=0.1% main=5.7% recalcs=1803 layouts=3 anims=31
perf-idle-cpu off  30.1s renderer=3%    gpu=0.3% browser=0.1% main=1%   recalcs=129  layouts=2 anims=2
```

Dev rig (this worktree, `just dev`, same build type before and after) — filled by apply:

| Run | Renderer % | GPU % | Recalcs / 30 s | Anims | Summary line |
|---|---|---|---|---|---|
| before (untouched tree) | 16.0 | 3.5 | 1796 | 31 | `perf-idle-cpu before 30.1s renderer=16% gpu=3.5% browser=0.1% main=7.7% recalcs=1796 layouts=3 anims=31` |
| floor (`--reduced-motion`) | 5.3 | 0.0 | 0 | 0 | `perf-idle-cpu floor 30.2s renderer=5.3% gpu=0% browser=0.1% main=3.1% recalcs=0 layouts=3 anims=0` |
| after | 7.5 | 3.1 | 268 | 37 | `perf-idle-cpu after2 30.2s renderer=7.5% gpu=3.1% browser=0.1% main=3.4% recalcs=268 layouts=3 anims=37` |
| after, nemo only | 7.1 | 2.4 | 218 | 22 | `perf-idle-cpu after-nemo-rerun 30.1s renderer=7.1% gpu=2.4% browser=0.1% main=3.2% recalcs=218 layouts=2 anims=22` |
| no-flair baseline (options cleared, normal motion) | 5.0 | 0.4 | 128 | 2 | `perf-idle-cpu noflair 30.1s renderer=5% gpu=0.4% browser=0.1% main=2.6% recalcs=128 layouts=2 anims=2` |

Reading: before − after = **8.5 renderer points** (≥ 5 required). The
`--reduced-motion` floor on this rig reads 0 recalcs (it zeroes the compose
carets too), which makes the literal "within 200 of the floor" recalc check
uninformative; the no-flair baseline (normal motion, flairs cleared — the
brief's "within noise of no flairs" comparator) measures 128, matching the
plan's calibrated floor ≈ 130. Against it: after − baseline = **+2.5 renderer
points, +140 recalcs** (≤ 3 and ≤ 200 ✓); nemo-only − baseline = +2.1 points,
+90 recalcs ✓ (matches research's 213 ≈ its 218 here). The first nemo-only
run read 1799 (60/s) once and did not reproduce on re-run — the documented
spurious-run case. anims = 37 in the after run = 35 flair animations (nemo 2×10
+ aquarium 2×6 + cube 3) + 2 compose carets — nothing silently stopped.

Per-flair (each alone on `nemo1`, 20 s, dev rig after):

| Flair | Recalcs / 20 s | Renderer % | Anims | Composited? |
|---|---|---|---|---|
| rain | 115 | 5.1 | 4 | yes |
| scan | 141 | 4.9 | 4 | yes |
| nyan | 160 | 5.5 | 8 | yes |
| naruto | 197 | 6.1 | 7 | yes |
| onepiece | 154 | 5.1 | 6 | yes |
| pacman | 142 | 5.7 | 7 | yes |
| matrix | 95 | 5.3 | 5 | yes |
| aquarium | 140 | 5.7 | 8 | yes |
| nemo | 159 | 6.3 | 12 | yes |
| roadrunner | 208 | 6.0 | 5 | yes |
| invaders | 137 | 5.1 | 4 | yes |
| cube | 112 | 5.7 | 5 | yes |
| warp | 163 | 6.5 | 5 | yes |
| spidey | 137 | 5.6 | 5 | yes |
| ironman | 90 | 5.5 | 6 | yes |
| noon | 141 | 5.6 | 5 | yes |

Every flair is far below the 600-recalcs/20 s not-composited line (60/s would
read ≈ 1200); residuals track iteration-boundary density (~1 recalc per
boundary) over an ~90–130 baseline. ironman at 90 proves the 81-stop step-end
list composites.

Visual parity (T013): paused-`currentTime` row crops, release daemon (`:3000`,
old build) vs dev rig (new build), T1 mid-traversal / T2 later step (both at
integer-landing times so the old build's snapped linear and the new build's
`steps()` floor land on the same pixel); diff px = pixels exceeding a
per-channel-sum threshold of 24, as `1×T1/T2` and `2×T1/T2`; colors = distinct
/ 4-bit-quantized distinct at 1×, old vs new. Screenshots (old/new per flair ×
T × dpr) live in the apply worker's scratch dir for the PR.

| Flair | T1/T2 (ms) | Diff px 1× | Diff px 2× | Colors 1× old/new | Notes |
|---|---|---|---|---|---|
| rain | 857/1907 | 0/0 | 0/0 | 145/141, 149/143 (q 79/80, 80/81) | identical |
| scan | 801/801 | 0/0 | 0/0 | 179/180 (q 82/81) | identical, soft band included |
| nyan | 3155/6273 | 0/0 | 0/0 | 320/297, 767/739 (q 99/99, 177/180) | identical; crisp (no blur signature) |
| naruto | 2057/4114 | 0/0 | 0/0 | 207/205, 232/230 (q 102/102, 115/119) | identical |
| onepiece | 4178/11009 | 0/0 | 0/0 | 316/292, 488/461 (q 87/87, 133/130) | identical |
| pacman | 2448/4894 | 0/0 | 0/0 | 156/151, 141/143 (q 77/77, 80/79) | identical |
| matrix | 3274/6342 | 0/0 | 0/0 | 167/164, 163/154 (q 95/95, 89/88) | identical |
| aquarium | 10348/15476 | 1/0 | 10/0 | 156/148, 151/147 (q 85/84, 85/84) | T1: blue fish within the 1px step quantum |
| nemo | 1706/3524 | 0/0 | 0/0 | 456/456, 472/468 (q 186/186, 192/191) | identical |
| roadrunner | 1052/2044 | 0/0 | 0/0 | 198/194, 168/164 (q 103/100, 88/89) | identical |
| invaders | 4650/9150 | 28/90 | 180/180 | 141/154, 133/136 (q 74/86, 77/79) | accepted: steps(26) wander keeps fractional jump positions (plan T009); slight crab softening, position/frame identical |
| cube | 4123/7677 | 0/0 | 0/0 | 285/285, 308/308 (q 107/107, 90/90) | identical (unchanged mechanism) |
| warp | 4123/7677 | 0/0 | 0/0 | 145/145 (q 77/77) | identical (unchanged mechanism) |
| spidey | 3257/6294 | 0/0 | 3/0 | 181/177, 181/167 (q 97/97, 94/94) | identical |
| ironman | 5501/11251 | 34/0 | 84/0 | 158/172, 154/154 (q 91/95, 87/87) | accepted: the one linear (unquantized) multi-stop traversal; T1 figure at a fractional x, reads clean at 3× zoom |
| noon | 2596/4834 | 0/0 | 0/81 | 379/373, 376/364 (q 110/109, 98/97) | 2× T2: dust motes (1px, ≤30% alpha) land a half CSS px apart; invisible at row scale |

Exact color counts on a full row wobble by a few entries between two browser
instances (sub-threshold channel noise, backgrounds byte-identical); the
quantized counts and zero over-threshold diffs are the crispness signal. The
parity shots predate the stepper-lengthening commit of the CSS, which only
repeats each frame cycle more times per iteration — frame-at-T is unchanged
by construction (2.4s lists are exact 2× repetitions of the 1.2s cycle, etc.).

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change rewrote the flair pseudo-element rules in place (the old `@keyframes rk-flair-*` background-position blocks and `::before`/`::after` rules in `app/frontend/src/globals.css` were deleted as part of the same edit); no code outside the changed files became redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Requirements R1–R10 restate intake § What Changes 1–5 one for one; no new scope was introduced at plan time | The intake already carries the concrete conversion table and arithmetic | S:90 R:85 A:90 D:90 |
| 2 | Confident | Sub-second sheet cadences are held inside 1–1.6 s `step-end` lists (8 frames per list) rather than `repeat-y` tiling, unless a flair's geometry makes tiling simpler | Both encodings measured compositable; short lists keep each flair's rule readable and its sheet geometry untouched | S:70 R:90 A:80 D:70 |
| 3 | Confident | `--rk-flair-dpr` is a plain custom property flipped by a `min-resolution: 2dppx` media query on the shared overlay rule | Simplest way to fold the device-pixel factor into `calc()` inside `steps()`; verifiable on a 2× `deviceScaleFactor` context | S:60 R:85 A:70 D:65 |
| 4 | Confident | The parity script is throwaway (scratch dir), not a committed test | Plan item 6 forbids an e2e for motion; the instrument and the CSS lint are the committed guards | S:75 R:95 A:85 D:80 |
| 5 | Tentative | Ironman's multi-stop traversal stays `linear` with whole-pixel keyframe endpoints; softness between stops is accepted | `steps()` cannot vary per segment; the figure is 6–28 px with baked streaks; judged by the screenshot pair | S:45 R:80 A:45 D:40 |

5 assumptions (1 certain, 3 confident, 1 tentative).
