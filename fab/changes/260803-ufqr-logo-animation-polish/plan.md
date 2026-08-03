# Plan: Logo Animation Polish

**Change**: 260803-ufqr-logo-animation-polish
**Intake**: `intake.md`

## Requirements

### Frontend: LogoSpinner loading chase

#### R1: Chase starts in steady state
`LogoSpinner` (`app/frontend/src/components/logo-spinner.tsx`) SHALL stagger its six ring segments with *negative* animation delays — `${i * 0.2 - 1.2}s` — so every segment starts mid-cycle and the ring shows the established chase from the first rendered frame. The `logo-chase` keyframes, the 1.2s duration, and the 0.2s stagger interval MUST NOT change.

- **GIVEN** any loading call site mounts `<LogoSpinner loading />`
- **WHEN** the first frame renders
- **THEN** every segment is already mid-cycle (delay `i * 0.2 - 1.2` ≤ −0.2s, all negative) and no "one bright side expanding over the first lap" transient occurs

### Frontend: Brand-crumb hover sweep

#### R2: White glow detach-orbit-land sweep replaces the transform spin
Hovering the brand crumb anchor (`.rk-brand-glitch` in `app/frontend/src/components/top-bar.tsx`) SHALL trigger a JS-driven (requestAnimationFrame) white glow sweep over the logo's six border segments, using these constants verbatim:

- Segments indexed 0–5 in `BORDER_SEGMENTS` order; rest lit trio `{5, 0, 1}` (`#b4b4b4`), dark trio `{2, 3, 4}` (`#2a2a2a`).
- Duration **900ms**, **3 laps**, ease-out cubic `ease(t) = 1 − (1−t)³`; head `h = (ease(p) · 18) mod 6` (continuous/fractional).
- Settled parameter `s(p) = max(1 − smoothstep(p / 0.10), smoothstep((p − 0.78) / 0.22))` with `smoothstep(t) = clamp(t,0,1)² · (3 − 2·clamp(t,0,1))`.
- Per segment `i`: `d = min(|h − i|, 6 − |h − i|)`; `gauss = exp(−d² / (2 · 0.85²))` (σ = 0.85); `rest_i = 1` if `i ∈ {5,0,1}` else 0; brightness `B = gauss·(1−s) + rest_i·s`.
- Color: `bright = mix(WHITE, #b4b4b4, s)`; segment fill = `rgb(mix(#2a2a2a, bright, B))` — linear per-RGB-channel interpolation, WHITE = `rgb(255,255,255)`.

The wordmark's `rk-glitch` CSS treatment stays untouched and keeps firing via `:hover`.

- **GIVEN** the pointer enters the brand crumb anchor
- **WHEN** the sweep runs
- **THEN** a white glow blob detaches, orbits the ring 3 laps decelerating over 900ms while the lit half dims, and lands centered on segment 0 where the rest pattern re-establishes

#### R3: Seamless start and landing frames
The frames at `p = 0` and `p = 1` MUST compute to exactly the rest fills (lit trio `rgb(180,180,180)`, dark trio `rgb(42,42,42)`) — the landing and the rest state are the same event, no restore snap. After `p = 1` the driver MAY restore the literal static hex fills as a numerical safety net.

- **GIVEN** the sweep math `fill(i, p)`
- **WHEN** evaluated at `p = 0` or `p = 1`
- **THEN** every segment's fill equals its rest value exactly (integer lap count places `h = 0`, the lit-trio center; `s = 1` at both ends)

#### R4: Re-trigger guard
A mouseenter while a sweep is running SHALL be ignored — no restart, no queue.

- **GIVEN** a sweep in flight
- **WHEN** the pointer re-enters the brand crumb
- **THEN** the running sweep continues uninterrupted and no second sweep starts

#### R5: Reduced motion skips the sweep in JS
Under `prefers-reduced-motion: reduce` the JS SHALL skip the sweep entirely (same convention as `TypedLabel` via `prefersReducedMotion()`); the rest state IS the reduced-motion state and no CSS gate is needed for it.

- **GIVEN** `prefers-reduced-motion: reduce`
- **WHEN** the pointer enters the brand crumb
- **THEN** segment fills never change and no animation frame is scheduled

### Frontend: CSS spin removal

#### R6: Transform-spin CSS and ring group removed
`app/frontend/src/globals.css` MUST no longer contain `@keyframes rk-brand-spin`, the `.rk-logo-ring` rules (`transform-box`/`transform-origin`), the `.rk-brand-glitch:hover .rk-logo-ring` animation rule, or the corresponding `prefers-reduced-motion` override line. The `<g className="rk-logo-ring">` wrapper (and its explanatory comment) in `logo-spinner.tsx` MUST be removed once nothing targets it.

- **GIVEN** the change is applied
- **WHEN** searching the frontend source for `rk-logo-ring` or `rk-brand-spin`
- **THEN** no matches remain

### Docs: Hover-vocabulary comments

#### R7: Vocabulary comments describe the new treatment
The hover-vocabulary comment block in `globals.css` (brand entry) and the vocabulary line in `fab/project/context.md` SHALL describe the brand logo treatment as the JS-driven white glow detach-orbit-land sweep (not the kickstart spin / `rk-logo-ring`). The comment in `top-bar.tsx` explaining why the crumb uses an inline SVG SHALL state the reason as "so JS can reach the segments".

- **GIVEN** the updated comments
- **WHEN** a reader consults the vocabulary in `globals.css` or `fab/project/context.md`
- **THEN** the brand entry matches the shipped JS sweep and no stale `rk-logo-ring`/kickstart-spin description remains

### Non-Goals

- No change to the `logo-chase` keyframes, duration, or stagger interval — only the delay sign.
- No change to the wordmark `rk-glitch` treatment or any other vocabulary category.
- No e2e visual assertion of animation frames (unit-level coverage only, per intake Assumption 8).
- No backend, API, or route changes; no new dependencies.

## Tasks

### Phase 2: Core Implementation

- [x] T001 Fix chase delays in `app/frontend/src/components/logo-spinner.tsx`: `${i * 0.2}s` → `${i * 0.2 - 1.2}s` <!-- R1 -->
- [x] T002 Add the pure sweep math to `app/frontend/src/components/logo-spinner.tsx`: exported `sweepSegmentFill(i, p)` (+ named constants: 900ms, 3 laps, σ 0.85, envelope 0.10/0.78/0.22) implementing the ease/settle/gauss/mix model verbatim <!-- R2, R3 -->
- [x] T003 Add `useBrandLogoSweep()` hook in `logo-spinner.tsx`: rAF driver applying `sweepSegmentFill` to the six border polygons (tagged via a data attribute; `svgRef` prop on `LogoSpinner`), re-trigger guard flag, `prefersReducedMotion()` skip, inline fill-transition suppression during flight, literal-hex restore at completion; remove the `<g className="rk-logo-ring">` wrapper <!-- R2, R3, R4, R5, R6 -->
- [x] T004 Wire the sweep in `app/frontend/src/components/top-bar.tsx`: `useBrandLogoSweep()` in the component owning the brand crumb, `onMouseEnter` on the `.rk-brand-glitch` anchor, `svgRef` on its `LogoSpinner`; update the inline-SVG comment (reason becomes "so JS can reach the segments") <!-- R2, R7 -->
- [x] T005 Remove from `app/frontend/src/globals.css`: `@keyframes rk-brand-spin`, `.rk-logo-ring` rules, `.rk-brand-glitch:hover .rk-logo-ring` rule (+ the explanatory comment above them), and the reduced-motion `.rk-brand-glitch:hover .rk-logo-ring` line <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T006 Unit tests in `app/frontend/src/components/logo-spinner.test.tsx`: negative delay values per segment (R1); `sweepSegmentFill` exact rest fills at `p=0`/`p=1` (R3); mid-flight white glow near the head + dimmed lit trio (R2); re-trigger guard ignores second mouseenter (R4); reduced-motion skip leaves fills untouched (R5); completion restores literal static fills + transition (R3). Run via `just test-frontend` <!-- R1, R2, R3, R4, R5 -->

### Phase 4: Polish

- [x] T007 Update the hover-vocabulary brand entries: `globals.css` header comment block and the `fab/project/context.md` vocabulary line describe the JS-driven white glow detach-orbit-land sweep <!-- R7 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: Every rendered loading segment carries animation delay `i * 0.2 - 1.2`s (all negative); keyframes/duration/stagger unchanged
- [x] A-002 R2: Brand-crumb mouseenter runs the rAF white-glow sweep with the approved constants (900ms, 3 laps, ease-out cubic, σ 0.85, envelope max(1−smoothstep(p/0.10), smoothstep((p−0.78)/0.22)), white→#b4b4b4→#2a2a2a RGB mixing)
- [x] A-003 R6: `rk-brand-spin`, `.rk-logo-ring` CSS rules, the hover rule, the reduced-motion line, and the `<g>` wrapper are gone; no `rk-logo-ring`/`rk-brand-spin` references remain in source
- [x] A-004 R7: Vocabulary comments in `globals.css`, `fab/project/context.md`, and the `top-bar.tsx` inline-SVG comment describe the new treatment

### Behavioral Correctness

- [x] A-005 R3: `sweepSegmentFill` at `p=0` and `p=1` equals the exact rest fills (no snap); after completion the driver restores the literal static hex fills
- [x] A-006 R4: A mouseenter during a running sweep is ignored (no restart)
- [x] A-007 R5: Under `prefers-reduced-motion: reduce` the sweep is skipped entirely in JS (fills never change)

### Scenario Coverage

- [x] A-008 R1: Unit test asserts per-segment negative delays on the loading spinner
- [x] A-009 R2: Unit tests cover the sweep math (rest frames, mid-flight glow) and the hook behavior (guard, reduced-motion, completion restore)

### Code Quality

- [x] A-010 Pattern consistency: The sweep follows the established JS-treatment precedent (`typed-label.tsx` / boot sweep) — `prefersReducedMotion()` from `@/lib/motion` reused, rest state as reduced-motion state, no new CSS classes
- [x] A-011 No unnecessary duplication: Rest pattern derived from `BORDER_SEGMENTS` static fills (single source of truth); no new dependencies
- [x] A-012 Tests cover the added/changed behavior (code-quality principle: new features and bug fixes include tests); frontend type check passes

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — the change's own redundancies were already removed during apply (`@keyframes rk-brand-spin`, the `.rk-logo-ring` rules + hover rule + reduced-motion gate line in `app/frontend/src/globals.css`, and the `<g className="rk-logo-ring">` wrapper in `app/frontend/src/components/logo-spinner.tsx`); a repo-wide search for `rk-logo-ring`/`rk-brand-spin` returns no matches, so nothing is left stranded.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Seam = exported `useBrandLogoSweep()` hook + `svgRef` prop on `LogoSpinner`; trigger attached to the crumb anchor | Intake Assumption 4 allows prop-or-hook; the trigger lives on the anchor (whole-crumb hover, matching the old `.rk-brand-glitch:hover` scope), which requires the hook form | S:70 R:85 A:80 D:70 |
| 2 | Confident | Suppress the polygons' inline `transition: fill 0.5s` during the sweep (capture, set `none`, restore at completion) | Discovered necessity: the rest-state (`loading={false}`) inline transition would smear per-frame fill updates into 0.5s crossfades, destroying the sweep timing | S:60 R:90 A:90 D:85 |
| 3 | Confident | Rest lit trio derived from `BORDER_SEGMENTS[i].staticFill === LIT_FILL` rather than a duplicate `{5,0,1}` set | Single source of truth — the static fills already encode the rest pattern the intake names | S:65 R:90 A:85 D:80 |
| 4 | Confident | Frames apply fills via `setAttribute("fill", …)`; border polygons tagged with a `data-logo-seg` attribute for selection | Matches how React renders the `fill` prop (attribute), so the completion restore leaves DOM and React's recorded props consistent; attribute selection is robust against sibling `INNER_FACES` polygons | S:60 R:90 A:85 D:75 |
| 5 | Confident | Tests colocated as `logo-spinner.test.tsx`, run via `just test-frontend`; no e2e | code-quality.md test strategy (colocated `.test.tsx`) + intake Assumption 8 (unit-level only) + context.md § Testing (just recipes only) | S:75 R:90 A:90 D:85 |
| 6 | Confident | Adding `onMouseEnter` to the Tip-wrapped anchor is safe — floating-ui's `getReferenceProps(child.props)` chains user handlers with its own | Verified in `tip.tsx`: the child's props are passed through `getReferenceProps`, which composes event handlers rather than overwriting them | S:65 R:85 A:80 D:80 |

6 assumptions (0 certain, 6 confident, 0 tentative).
