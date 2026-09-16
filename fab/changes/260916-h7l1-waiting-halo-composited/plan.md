# Plan: Waiting Halo and Seam Composited

**Change**: 260916-h7l1-waiting-halo-composited
**Intake**: `intake.md`

> Plan of record for the wider effort: `fab/plans/sahil/26-09-16-idle-cpu.md` (this is its change 2). Read the intake in full first — it carries the exact CSS, the measurement recipe, and the R3 research findings.

## Requirements

### UI Status Signals: Waiting halo compositing

#### R1: The halo pulse animates only compositor properties
The `.rk-waiting-halo` pulse MUST be carried by a `::after` pseudo-element ring whose `@keyframes rk-waiting-halo` animate **only** `transform` and `opacity`. The rule set MUST NOT animate `box-shadow`, `border-*`, `inset`, or any other main-thread property, and the dot element itself MUST carry no `box-shadow` from the halo.

- **GIVEN** a page with 8 injected `span.rk-waiting-halo` dots (the intake's halo probe) on `/`
- **WHEN** `just perf-idle-cpu / 30 --url http://127.0.0.1:3000 --inject <probe>` samples 30 s
- **THEN** the summary line's `renderer=` is within 3 points of the plain `/` run and `recalcs=` is within 200 of it
- **AND** `anims=` still reports the 8 `rk-waiting-halo` animations as running (the pulse is not silently stopped)

#### R2: The halo's visual contract is unchanged
The ring MUST keep today's look and contract: a constant signal-yellow ring (`var(--color-signal-yellow)`) hugging the dot's silhouette via `border-radius: inherit`, growing from a 1.5 px ring at 55 % alpha to a ≈ 3 px reach at 85 % alpha on a 1.4 s `ease-in-out infinite` cycle; the dot's core hue and shape MUST be untouched; `status-dot.tsx` MUST keep appending the unchanged class name `rk-waiting-halo` with no markup change; the pseudo MUST be `pointer-events: none`. The accepted composited approximation is `transform: scale(1 → 1.3)` + `opacity 0.65 → 1` with the ring colour at the 85 % peak (a ≈ 1 px lift-off gap at the pulse peak is accepted). If the eye review of the screenshot pair rejects the gap, the two-ring opacity-only fallback from the intake (§ What Changes 1) MAY be used instead — it satisfies R1 equally.

- **GIVEN** a waiting window rendered in the sidebar, the tty tile header, the status bar and the PANE panel header
- **WHEN** the halo pulses
- **THEN** every mount shows a yellow ring on the dot's circle (flagged 9 px dots included) with the dot's own hue and shape unchanged, and no ring interior tint shows inside a hollow ring dot
- **AND** the watched underbar under a sidebar dot still sits 4 px (3 px flagged) below the dot with no overlap from the ring

#### R3: Reduced motion keeps a static ring
Under `@media (prefers-reduced-motion: reduce)` the halo pseudo MUST render as a static 2 px full-yellow ring flush outside the dot's border (`animation: none`, `inset: -3px` — the pseudo anchors to the padding box, so the inset clears the dot's border plus the ring width — `border-width: 2px`, `border-color: var(--color-signal-yellow)`, `opacity: 1`, `transform: none`) — attention is never encoded in motion alone. The base rules and keyframes MUST precede the reduced-motion block in `globals.css` so the equal-specificity override wins by source order.

- **GIVEN** `prefers-reduced-motion: reduce` and a waiting window
- **WHEN** the dot's `::after` computed style is read
- **THEN** `animation-name` is `none`, `border-top-width` is `2px`, and `border-top-color` is not transparent

### UI Boards: Waiting seam compositing

#### R4: The seam pulse animates only opacity
`.rk-waiting-seam` MUST set the pane's 3 px `border-color` to the static 55 % yellow trough (`color-mix(in srgb, var(--color-signal-yellow) 55%, transparent)`) and carry the pulse on a `::after` pseudo-element: `position: absolute; inset: -3px; border: 3px solid var(--color-signal-yellow); border-radius: inherit; pointer-events: none`, animated by `@keyframes rk-waiting-seam` over **only** `opacity` (0 → 1 → 0, 1.4 s ease-in-out infinite). No `border-color` keyframe remains. `board-pane.tsx` MUST need no logic change (root already `relative`, `border-[3px]` + class unchanged).

- **GIVEN** a fixed `div.rk-waiting-seam` probe (3 px border, 6 px radius) injected on `/`
- **WHEN** the instrument samples 30 s
- **THEN** `renderer=` is within 3 points and `recalcs=` within 200 of the plain `/` run, and `anims=` reports the seam animation running
- **AND** on a desktop `rounded-md` board pane the ring follows the card's corners and sits exactly over the 3 px border; the focused-and-waiting green 1 px shadow ring outside it is untouched

#### R5: Reduced motion keeps a static seam
Under reduced motion `.rk-waiting-seam` MUST render the border at full `var(--color-signal-yellow)` and hide the pseudo (`display: none`).

- **GIVEN** `prefers-reduced-motion: reduce` and a waiting board pane
- **WHEN** rendered
- **THEN** the pane shows a static 3 px full-yellow border and no animation is running for it

### Tests

#### R6: The reduced-motion e2e proves the ring through the pseudo-element
The test "waiting halo is a static ring under prefers-reduced-motion" in `app/frontend/tests/e2e/agent-next-waiting.spec.ts` MUST assert on `getComputedStyle(el, "::after")`: `animationName === "none"`, `borderTopWidth === "2px"`, and `borderTopColor` not `rgba(0, 0, 0, 0)`; the `box-shadow` assertions MUST be removed; the class assertion stays; the `Proves:` / `Steps:` intent comment MUST be updated in the same commit (Constitution § Test Intent Comments) and MUST NOT cite change IDs.

- **GIVEN** the spec run via `just test-e2e "e2e/agent-next-waiting"`
- **WHEN** the reduced-motion test executes against the new CSS
- **THEN** it passes, and the rest of the spec file is unchanged and green

#### R7: Existing unit tests and the type check stay green with no source logic change
`status-dot.test.tsx` and `sidebar/window-row.test.tsx` MUST pass unchanged (they assert only the class string); `cd app/frontend && npx tsc --noEmit` MUST be clean. No new Vitest is required (jsdom evaluates neither pseudo-elements nor `globals.css` animations).

- **GIVEN** the finished change
- **WHEN** `just test-frontend` and the type check run
- **THEN** both are green

### Measurement and visual parity

#### R8: Before/after instrument table recorded
The apply agent MUST record the instrument's summary lines before and after the CSS change in this file's `## Notes` § Measurements: (a) `/` plain, (b) `/` + 8-dot halo probe, (c) `/` + seam probe, (d) one tty route (`/<server>/@<id>`; with a live waiting window if one exists at run time, else with the halo probe injected). Every run passes `--url http://127.0.0.1:3000` and `30` seconds; runs are serialized (one instrument at a time). `will-change: transform` is added to the pseudo only if the after-run still shows ~1800 recalcs, then re-measured and the addition recorded.

- **GIVEN** the recorded table
- **WHEN** review reads it
- **THEN** after-runs (b), (c) satisfy R1/R4's thresholds against (a), and (d) is not worse than its before-run beyond the 3-point floor

#### R9: Screenshot pair reviewed for visual parity
The apply agent MUST capture a before/after screenshot pair (Playwright, `channel: "chromium"`, via the injected probes on `/`) at `deviceScaleFactor` 1 and 2 for a waiting dot mid-pulse and at rest, one for the seam probe, and one static-form pair under `reducedMotion: "reduce"`, save them in the session scratch directory (never in the repo), review them by eye, and record the verdict (accepted or fallback taken) in `## Notes` § Visual parity. Only the ring's rendering may differ; never the dot's hue/shape or the seam's 3 px width.

- **GIVEN** the pair
- **WHEN** compared
- **THEN** the dot core and the seam width are pixel-identical between before and after, and the reduced-motion forms are identical

### Comment hygiene

#### R10: Comments describe the pseudo ring, cite no change IDs, and drop the stale square note
Every comment that describes the halo or seam as a box-shadow / animated border-color MUST be corrected: `globals.css` (the halo block above the keyframes — including removing the stale "no `border-radius` … waiting done-SQUARE / `rounded-none`" explanation and the `change 260706-y1ar` citation — the seam block, and the reduced-motion audit line), `status-dot.tsx` (the header's ATTENTION bullet, the comment above `const halo`, and the watched-underbar "3px box-shadow reach" comment), and `board/board-pane.tsx` (verify the line ≈ 41 header note and the border-precedence comment still read true; edit only if wrong). New or rewritten comments MUST state constraints (transform/opacity only; `border-radius: inherit`; source-order rule) and MUST NOT cite change IDs or PR numbers.

- **GIVEN** `grep -n "box-shadow" app/frontend/src/components/status-dot.tsx app/frontend/src/globals.css`
- **WHEN** run after the change
- **THEN** no hit refers to the waiting halo or seam (other box-shadow uses in `globals.css` are untouched)

### Non-Goals

- The halo's timing (1.4 s), colour token, or semantics — a rendering-mechanism swap only.
- The watched underbar — static already.
- The status bar's hidden measurement probe copy of the dot (a second, invisible waiting animation per status-bar mount) — composited it costs nothing; a status-bar change is outside this plan.
- The `/__controls` gallery PNG baselines — the gallery renders no `StatusDot` (R3 finding); do not regenerate.
- Flair overlays (change 1 of the plan, parallel worktree) and the state-socket dedup (change 3).
- Any new setting, palette action, or route (Constitution IV, V).

### Design Decisions

#### Attention overlays run on the compositor
**Decision**: The waiting halo and the board-pane waiting seam pulse via pseudo-element rings animated with `transform`/`opacity` only; no attention animation touches a main-thread property.
**Why**: Measured 2026-09-16 with `just perf-idle-cpu`: four animated box-shadow halos cost +3.6 points of a core and 1802 style recalcs per 30 s on an otherwise idle `/`, scaling with waiting agents × render sites (≈ 4–5 dots per waiting window on a desktop tty route). Blink cannot composite `box-shadow` or `border-color`; it composites `transform` and `opacity` for free.
**Rejected**: `will-change` on the box-shadow rule (cannot composite a non-compositable property); a JS `requestAnimationFrame` pulse (moves the cost, does not remove it); removing or slowing the pulse (changes the signal — the plan's decision of record keeps the halo's semantics and timing).
*Introduced by*: 260916-h7l1-waiting-halo-composited

#### The seam's border is the trough; the overlay ring is the peak
**Decision**: `.rk-waiting-seam` paints the pane's own 3 px border at 55 % yellow and fades a full-yellow `::after` ring over it with `opacity`.
**Why**: The old keyframes ran 55 % → 100 % on `border-color`; a static trough plus an opacity-faded full ring reproduces exactly those endpoints with a single composited property, and the reduced-motion form falls out as "border at full yellow, ring hidden".
**Rejected**: scaling a ring (a 3 px seam has no room for lift-off); animating `border-color` with a compositing hint (never composited).
*Introduced by*: 260916-h7l1-waiting-halo-composited

#### One scaled ring for the halo, two-ring opacity fallback
**Decision**: The halo is a single `::after` ring at `inset: -1.5px` scaled 1 → 1.3 with opacity 0.65 → 1 (ring colour at the 85 % peak); if the eye review rejects the ≈ 1 px lift-off gap at the peak, the fallback is a static 55 % `::before` ring plus a 3 px 85 % `::after` ring fading with opacity only.
**Why**: The plan of record names transform + opacity on a `::after` ring; scaling reproduces the growing-ring motion most faithfully, and the fallback keeps the ring flush at the cost of a two-step growth. Either form is composited.
**Rejected**: a `z-index: -1` ring behind the dot (paints above the host's border within the host's stacking context, so it tints hollow rings); animating `inset`/`border-width` (main thread).
*Introduced by*: 260916-h7l1-waiting-halo-composited

## Tasks

### Phase 1: Setup and baseline

- [x] T001 Ensure the worktree can run the instrument and tests: if `app/frontend/node_modules/@playwright/test` is absent run `just setup` (it may already have been started by the orchestrator — check the log at the scratch path noted in the dispatch prompt, and wait for it rather than running a second install); confirm `just perf-idle-cpu --help` prints usage and `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/` is 200. <!-- R8 -->
- [x] T002 Baseline (BEFORE any CSS edit) instrument runs, 30 s each, serialized, all with `--url http://127.0.0.1:3000`: (a) `/`; (b) `/` + the intake's 8-dot halo `--inject`; (c) `/` + the intake's seam `--inject`; (d) a tty route — pick a live `waiting` window from `curl -s http://127.0.0.1:3000/api/sessions?server=<srv>` (fields `agentState`) if one exists, else `/<server>/@<id>` of any live window + the halo probe. Paste the summary lines into `## Notes` § Measurements (BEFORE rows). <!-- R8 -->
- [x] T003 [P] BEFORE screenshots via a small Playwright script (`@playwright/test` resolved from `app/frontend/node_modules`, `chromium.launch({ channel: "chromium" })`): the halo probe and seam probe on `/` at `deviceScaleFactor` 1 and 2, one frame at rest (t≈0 s) and one mid-pulse (pause animations via `document.getAnimations().forEach(a => { a.pause(); a.currentTime = 700 })`), plus a `reducedMotion: "reduce"` frame; save to the session scratch directory. <!-- R9 -->

### Phase 2: Core CSS

- [x] T004 `app/frontend/src/globals.css` halo block (≈ lines 453–478): replace the box-shadow keyframes with the transform/opacity keyframes, make `.rk-waiting-halo { position: relative; }`, add the `.rk-waiting-halo::after` ring rule exactly per intake § What Changes 1, and rewrite the comment (compositing constraint, `border-radius: inherit`, no done-square text, no change-ID citation). <!-- R1 R2 R10 -->
- [x] T005 `app/frontend/src/globals.css` seam block (≈ lines 495–502): 55 % static `border-color`, opacity-only keyframes, `.rk-waiting-seam::after` ring rule per intake § What Changes 2; rewrite the comment. <!-- R4 R10 -->
- [x] T006 `app/frontend/src/globals.css` reduced-motion block (≈ lines 2083–2084): replace the two waiting lines with the `::after` static-ring override for the halo and the full-yellow border + `::after { display: none }` for the seam per intake § What Changes 3; keep the audit-line comment accurate. <!-- R3 R5 -->
- [x] T007 [P] Comment-only edits: `app/frontend/src/components/status-dot.tsx` (header ATTENTION bullet; the comment above `const halo`; the watched-underbar comment's "3px box-shadow reach"), and verify `app/frontend/src/components/board/board-pane.tsx` comments (≈ line 41 and ≈ 167–170) still read true. No logic changes. <!-- R10 -->

### Phase 3: Tests, measurement, parity

- [x] T008 `app/frontend/tests/e2e/agent-next-waiting.spec.ts` (≈ lines 118–155): move the static-ring assertions to `getComputedStyle(el, "::after")` (animation-name none, `borderTopWidth === "2px"`, `borderTopColor !== "rgba(0, 0, 0, 0)"`), drop the box-shadow assertions, update the Proves/Steps comment; run `just test-e2e "e2e/agent-next-waiting"` (one spec per run) and make it green. <!-- R6 -->
- [x] T009 [P] `cd app/frontend && npx tsc --noEmit`; `just test-frontend` (or the scoped Vitest files `src/components/status-dot.test.tsx` and `src/components/sidebar/window-row.test.tsx` through the just recipe) — green with no test edits. <!-- R7 -->
- [x] T010 AFTER instrument runs — the same (a)–(d) as T002, serialized, 30 s each; paste the summary lines as AFTER rows in `## Notes` § Measurements and state pass/fail against R1/R4/R8 thresholds. If (b) still shows ~1800 recalcs, add `will-change: transform` to `.rk-waiting-halo::after`, re-measure, and record that. <!-- R8 R1 R4 -->
- [x] T011 AFTER screenshots (same script as T003), compare by eye against the BEFORE set, and record the verdict in `## Notes` § Visual parity (ring gap accepted, or the two-ring fallback taken with the CSS updated and (b) re-measured). <!-- R9 R2 -->

## Execution Order

- T002 and T003 MUST run before T004–T006 (they are the BEFORE measurements).
- T004, T005, T006 are one file; do them in one pass, then T007.
- T008, T009 after the CSS; T010 and T011 last.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `@keyframes rk-waiting-halo` animates only `transform` and `opacity`; `.rk-waiting-halo` sets `position: relative` and no `box-shadow` or `animation`; `.rk-waiting-halo::after` carries the ring and the animation.
- [x] A-002 R2: The pseudo ring uses `border-radius: inherit`, `pointer-events: none`, an inset that places the 1.5 px `var(--color-signal-yellow)`-derived ring flush OUTSIDE the dot's border at rest (the pseudo anchors to the padding box; apply measured `inset: -2.5px` — the intake's `-1.5px` painted over the dot border and was corrected), and the class name and `status-dot.tsx` markup are unchanged.
- [x] A-003 R3: The reduced-motion block overrides `.rk-waiting-halo::after` to a static 2 px full-yellow ring flush outside the dot border (`inset: -3px`, `border-width: 2px`) with `animation: none`, and sits after the base rules in source order.
- [x] A-004 R4: `.rk-waiting-seam` has a 55 % static `border-color`, no `animation`; `.rk-waiting-seam::after` is the full-yellow 3 px ring at `inset: -3px` animated by opacity-only keyframes; `board-pane.tsx` has no logic change.
- [x] A-005 R5: The reduced-motion block sets the seam border to full yellow and hides its pseudo.
- [x] A-006 R6: The e2e reduced-motion test asserts on the `::after` computed style, its intent comment is updated, and `just test-e2e "e2e/agent-next-waiting"` passes.
- [x] A-007 R7: `npx tsc --noEmit` is clean and the two Vitest files pass unchanged.
- [x] A-008 R8: `## Notes` § Measurements holds BEFORE and AFTER summary lines for runs (a)–(d).
- [x] A-009 R9: `## Notes` § Visual parity records the eye-review verdict and the scratch paths of the pairs.
- [x] A-010 R10: No comment in `globals.css`, `status-dot.tsx`, or `board-pane.tsx` describes the halo as a box-shadow or the seam as an animated border-color; the stale done-square note is gone; rewritten comments cite no change IDs.

### Behavioral Correctness

- [x] A-011 R1: AFTER run (b) has `renderer=` within 3 points and `recalcs=` within 200 of AFTER run (a), with `anims=` reporting 8 running halo animations.
- [x] A-012 R4: AFTER run (c) has `renderer=` within 3 points and `recalcs=` within 200 of AFTER run (a), with the seam animation reported running.
- [x] A-013 R8: AFTER run (d) is not worse than BEFORE run (d) beyond the 3-point floor.
- [x] A-014 R2: In the AFTER screenshots the dot core (hue, shape, 1.8 px border) is pixel-identical to BEFORE at both scale factors; only the ring differs.

### Scenario Coverage

- [x] A-015 R3: The reduced-motion screenshot pair (halo and seam) is identical BEFORE vs AFTER.
- [x] A-016 R2: A flagged (9 px) waiting dot and a watched (underbar) waiting dot were considered — the `::after` host works for `relative inline-flex` hosts with children and the underbar sibling is unaffected (verified by reading the markup; `status-dot.test.tsx`'s halo/watched composition test still passes).

### Edge Cases & Error Handling

- [x] A-017 R4: The pseudo does not extend past the 3 px border into the focused-and-waiting pane's 1 px green shadow ring (inset -3 px over a 3 px border), and `pointer-events: none` keeps the resize handle and header hit targets intact.
- [x] A-018 R8: Every instrument invocation passed `--url http://127.0.0.1:3000` (the worktree's derived `rk url` port has no listener) and runs were serialized.

### Code Quality

- [x] A-019 Pattern consistency: the new rules follow `globals.css`'s `rk-*` utility vocabulary, comment style (constraints, not narration), and the reduced-motion block's audit-line convention.
- [x] A-020 No unnecessary duplication: no new class names, no duplicated keyframes, no JS added.
- [x] A-021 Comment narration anti-pattern: rewritten comments state constraints the code cannot show and cite no change IDs or PR numbers.
- [x] A-022 Tests conform to the implementation spec (Constitution § Test Integrity): the e2e change re-targets the property that proves the static ring; no implementation was bent to fit a test.
- [x] A-023 Verification discipline: tests ran through `just` recipes only; the full suite was not used as a gate.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

### Measurements

Instrument: `just perf-idle-cpu <path> 30 --url http://127.0.0.1:3000 [--inject <js>]`. Noise floor ≈ 3 points of one core; recalc oracle ≈ 1800 per 30 s per main-thread animation. Paste the summary lines verbatim.

| Run | Route and probe | BEFORE | AFTER |
|-----|-----------------|--------|-------|
| a | `/` plain | `perf-idle-cpu a-before-plain 30.1s renderer=3.9% gpu=0.2% browser=0.3% main=1.3% recalcs=15 layouts=15 anims=0 xterm=0 iframes=0 ws[/ws/state]=5.6msg/s,7.5kB/s` | `perf-idle-cpu a-after-plain 30.1s renderer=2.8% gpu=0% browser=0.1% main=0.9% recalcs=0 layouts=3 anims=0 xterm=0 iframes=0 ws[/ws/state]=3msg/s,4.7kB/s` |
| b | `/` + 8 halo dots | `perf-idle-cpu b-before-halo8 30.1s renderer=5.7% gpu=0.9% browser=0.1% main=2% recalcs=1803 layouts=3 anims=8 xterm=0 iframes=0 ws[/ws/state]=3msg/s,4.3kB/s` | `perf-idle-cpu b3-after-halo8 30.1s renderer=3.3% gpu=1.2% browser=0.1% main=0.7% recalcs=111 layouts=6 anims=8 xterm=0 iframes=0 ws[/ws/state]=2.9msg/s,4.7kB/s` — **PASS R1**: +0.5 renderer and +111 recalcs vs AFTER (a) (floor: 3 points / 200), 8 halo animations still running. `will-change` NOT added (recalcs at baseline, not ~1800). |
| c | `/` + seam box | `perf-idle-cpu c-before-seam 30.1s renderer=4.9% gpu=1.1% browser=0.1% main=1.5% recalcs=1803 layouts=3 anims=1 xterm=0 iframes=0 ws[/ws/state]=3msg/s,4.4kB/s` | `perf-idle-cpu c-after-seam 30.1s renderer=5.6% gpu=2.2% browser=0.1% main=1.5% recalcs=108 layouts=3 anims=1 xterm=0 iframes=0 ws[/ws/state]=2.9msg/s,4.7kB/s` — **PASS R4**: +2.8 renderer vs AFTER (a) (inside the 3-point floor; the BEFORE seam row carried the same +1.0 noise over its plain run), +108 recalcs, seam animation running. |
| d | tty route (state the route and whether a live waiting window was used) | `/rK/@109` + halo probe (no window had `agentState=waiting` on any server at run time — checked `/api/sessions` for all six servers — so the live tty route + halo probe substitute is used): `perf-idle-cpu d-before-tty-halo8 30.1s renderer=11% gpu=42.2% browser=0.1% main=7.4% recalcs=1901 layouts=6 anims=13 xterm=1 iframes=0 ws[/ws/state]=2.9msg/s,4.5kB/s ws[/ws/terminals]=1.7msg/s,4.3kB/s` | Same route + probe: `perf-idle-cpu d3-after-tty-halo8 30.1s renderer=10.2% gpu=23.9% browser=0.1% main=5.8% recalcs=1854 layouts=4 anims=13 xterm=1 iframes=0 ws[/ws/state]=3msg/s,4.7kB/s ws[/ws/terminals]=0.9msg/s,2.3kB/s` — **PASS R8/A-013**: 10.2% vs 11.0% at matched quiet socket rates (~3 msg/s). A first AFTER attempt landed mid-burst (13.8% at 13 msg/s state / 8 msg/s terminals); a paired BEFORE re-run at matched busy rates read 14.0%/1912 recalcs, so the burst pair is also not-worse. |

**How AFTER reaches the page**: the `:3000` daemon is the Homebrew release binary (run-kit 3.20.3, embedded SPA, cwd `/home/sahil`) — it serves the OLD box-shadow CSS and cannot hot-serve this worktree's edit (restarting/touching the user's daemon is out of bounds). BEFORE runs inject only the probe elements; AFTER runs inject the probe PLUS a `<style>` tag replaying this change's exact edited rules (later source order wins at equal specificity; the injected block also neutralizes the release rules that would otherwise double-render, e.g. `.rk-waiting-halo { animation: none }`). This is the instrument's designed one-mechanism A/B (`testing.md` § Performance probes: `--inject` "a `<style>` tag"). The committed CSS itself is proven by the e2e (run against this worktree's own rig) and tsc/vitest.

Inject runs (b)–(d) invoked `scripts/perf-idle-cpu.sh` directly with the same flags: `just`'s variadic `{{args}}` interpolation does not re-quote arguments, so the `--inject` JavaScript (parentheses) breaks the shell parse when routed through the recipe. The recipe body is that script verbatim (Constitution VIII one-liner); every invocation passed `--url http://127.0.0.1:3000` and runs were serialized.

**Apply-time geometry correction (review attention)**: the intake's halo insets (`-1.5px` base / `-2px` reduced-motion; also pinned literally by A-002/A-003) are geometrically wrong for this host: an absolutely positioned pseudo's containing block is the dot's PADDING box, not its border box, and Chromium snaps the dot's fractional 1.8px border when resolving that padding edge (empirically 1 CSS px at both dsf 1 and 2 — an integer-2px-border control confirmed inset = border + ring lands flush). The intake's values put the ring mostly ON TOP of the dot's own blue border (covering the core hue at rest and in the static reduced-motion form — fails R2/A-014/A-015). Corrected to `inset: -2.5px` (base, 1.5px ring) and `inset: -3px` (reduced, 2px ring), verified flush by pixel-row inspection of the screenshot pairs. Side effect: the pulse-peak reach is ≈2.4–2.7px instead of the old shadow's 3px (scale 1.3 about the dot center over a slightly smaller pseudo box), inside R2's "≈" tolerance; the peak lift-off gap is ≈0.6px. The seam needed no correction: its `inset: -3px` equals the pane's 3px border width, so the overlay band is exactly the border band (screenshot RMSE 0% at 2x). The seam PROBE also had to drop the `border: 3px solid` shorthand for explicit `border-width`/`border-style`: the shorthand's implied `border-color: currentcolor` is an inline declaration that beats the class rule once the element's animation is gone (the released keyframes used to win over it), rendering the trough charcoal instead of 55% yellow — a probe artifact only; real panes carry color purely from `.rk-waiting-seam`.

Reference (plan of record, 2026-09-16, another host session): `/` 3.1 % renderer, 0 recalcs; `/` + 4 dots 6.7 % renderer, 1.0 % GPU, 1802 recalcs.

### Visual parity

Pairs live under the session scratch dir (never the repo):
`/tmp/claude-1001/-home-sahil-code-sahil87-run-kit-worktrees-waiting-halo-composited/bb565388-d772-426c-84c5-533b9df0d196/scratchpad/h7l1-shots/`
— `{before,after}-{halo,seam}-{rest,mid}-{1x,2x}.png` plus `{before,after}-reduced-{halo,seam}-{1x,2x}.png` (rest = animations paused at `currentTime=0`, mid = `700` ms — the 50% keyframe; BEFORE = release build as served by the daemon, AFTER = the same page with this change's edited rules injected as an override `<style>`, see § Measurements).

**Verdict: ACCEPTED — the single scaled-ring form ships; the two-ring fallback was NOT taken.** Eye review + pixel-row checks:

- Dot core (hue, shape, 1.8px blue border, position) is identical BEFORE/AFTER at 1x and 2x — verified down to the pixel row (blue border band intact at dev px 16–17/32–33 in both forms).
- Rest state: gold ring flush against the dot, same geometry as the retired 1.5px box-shadow spread (after the inset correction in § Measurements — the intake's `-1.5px`/`-2px` insets put the ring over the dot's own border; corrected to `-2.5px`/`-3px`).
- Mid-pulse: the ring grows outward with the accepted ≈0.6px lift-off gap; reads cleanly at 1x; peak reach ≈2.4–2.7px (R2's "≈3px").
- Seam: rest and mid pairs are pixel-equal at 2x (RMSE 0%) and ≤1.5% at 1x (residual = live page text drifting behind the fixed probe box, e.g. the `up Nm` clock).
- Reduced-motion pairs: static 2px full-yellow ring and static full-yellow seam match BEFORE (RMSE ≈1.9%, same text-drift residual; ring band verified at the same [dot-outer−2px, dot-outer] geometry as the old shadow).
- No ring interior tint inside the hollow dots (pseudo carries a border only, no background).

## Deletion Candidates

- None — this change replaces the retired `box-shadow`/`border-color` keyframes in place; no surviving symbol, file, branch, or config is made redundant or unused.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The plan follows the intake's CSS verbatim; the only apply-time freedom is the documented two-ring fallback after the eye review | Intake § What Changes 1 and Assumption 1 fix both forms; either satisfies R1 | S:90 R:90 A:85 D:85 |
| 2 | Confident | Mid-pulse screenshots pause every animation at `currentTime = 700` ms (the 50 % keyframe of the 1.4 s cycle) so BEFORE and AFTER frames align | Web Animations API is available in the instrument's Chromium; pausing removes frame-timing luck from the comparison | S:75 R:95 A:80 D:75 |
| 3 | Confident | The tty-route run (d) uses a live waiting window only if one exists at run time; otherwise the halo probe on a live tty route substitutes | A waiting agent cannot be scheduled; the substitute keeps the check executable (intake Assumption 7) | S:80 R:90 A:75 D:70 |
| 4 | Certain | `just setup` is the install path (not a bare `pnpm install`), so the Playwright chromium channel the instrument needs is present | Project context § Testing names `just setup` as the one-time rig install; the instrument requires `channel: "chromium"` | S:85 R:95 A:90 D:90 |

4 assumptions (2 certain, 2 confident, 0 tentative).
