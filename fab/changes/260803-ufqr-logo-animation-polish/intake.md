# Intake: Logo Animation Polish

**Change**: 260803-ufqr-logo-animation-polish
**Created**: 2026-08-03

## Origin

> Logo animation polish: fix LogoSpinner chase start transient (negative animation-delays) and replace the brand-crumb hover ring spin with a white glow detach-orbit-land sweep (variant C from the mock experiment)

Conversational. The design was developed interactively in a `/fab-discuss` session: the user asked to see all logo animations, a mock HTML page was built showing the two existing animations (the `logo-chase` loading pulse and the `rk-brand-spin` hover transform), and the user then iterated on an experimental replacement for the hover spin. Iteration history (each step user-directed):

1. First take — stepped chase head with `floor(ease(t)·N)` scheduling → rejected: end-of-animation jump (the last step lands only at the exact final frame, so the animation parks then snaps) and jittery motion (whole-segment steps).
2. User also spotted that the loading chase itself has a start transient: "only one side glowing, slowly expands over the first lap." Root-caused to positive `animation-delay` in the shipped component.
3. Second take — smooth gaussian glow on an overlay layer with fade-in/out envelope → glow color was the segment gray, invisible over the lit half of the ring.
4. Accent-green glow → **explicitly rejected by the user** ("green is not the answer. Needs to be white only").
5. Final approved take ("Variant C looks good now"): white glow, lit half dims during flight, deceleration lands the blob exactly on the lit half where it crossfades into the rest pattern — "the eye can't make out the difference between 'animation stopping' and the lit areas resetting."

User confirmed scope as **one single fab change** covering both fixes.

## Why

1. **Chase start transient (bug)**: `LogoSpinner` (`app/frontend/src/components/logo-spinner.tsx`) staggers its six ring segments with *positive* `animation-delay: i * 0.2s`. Until a segment's delay elapses, it holds its unanimated opacity (1), so at mount the ring shows one bright side that "expands" over the first 1.2s lap before the steady chase establishes. Every spinner mount in the app shows this artifact (~9 call sites: dialogs, pending buttons, update chip, sidebar refresh, full-pane wait states). If unfixed, every loading state opens with a visually broken first lap.

2. **Brand-crumb hover spin replacement (design change)**: the current hover treatment on the top-bar brand crumb rotates the ring geometry (`rotate(720°)` transform on the `.rk-logo-ring` group). The user prefers a state-based treatment in the same visual language as the loading chase — segments changing lit-state rather than geometry moving — so the logo has one motion vocabulary (segment illumination) across loading and hover. The approved design ("variant C") was prototyped and tuned on a mock page until the start/end seams were imperceptible.

## What Changes

### 1. LogoSpinner chase delays — negative stagger

`app/frontend/src/components/logo-spinner.tsx` (currently line ~44): change the per-segment delay from positive to negative so every segment starts mid-cycle and the ring is in steady state from the first rendered frame:

```tsx
// before
`logo-chase 1.2s ease-in-out ${i * 0.2}s infinite`
// after
`logo-chase 1.2s ease-in-out ${i * 0.2 - 1.2}s infinite`
```

No other change to the chase (keyframes, duration, stagger interval all stay). This fixes all loading call sites at once.

### 2. Brand-crumb hover — replace transform spin with white glow "detach, orbit, land" sweep

**Remove** (all in `app/frontend/src/globals.css`, currently lines ~196–213 and the reduced-motion line ~522):

- `@keyframes rk-brand-spin`
- `.rk-logo-ring { transform-box; transform-origin }`
- `.rk-brand-glitch:hover .rk-logo-ring { animation: ... }`
- the corresponding `prefers-reduced-motion` override line

The `.rk-logo-ring` `<g>` wrapper in `logo-spinner.tsx` and its explanatory comment can go too once nothing targets it. The wordmark's `rk-glitch` treatment (RGB-split + green flip on the "RunKit" text) is **unchanged**.

**Add** a JS-driven per-frame treatment (precedent: `typed-label.tsx` and the boot sweep in `top-bar.tsx` — JS treatments are an established part of the hover vocabulary). Exact model, approved on the mock page — reproduce these constants verbatim:

- Segments indexed 0–5 clockwise (the order they appear in `BORDER_SEGMENTS`); rest pattern lit trio `{5, 0, 1}` (fills `#b4b4b4`), dark trio `{2, 3, 4}` (fills `#2a2a2a`). The lit trio is centered on segment 0.
- Duration **900ms**, **3 laps**, ease-out cubic `ease(t) = 1 − (1−t)³`. Head position `h = (ease(p) · 18) mod 6` — continuous (fractional). Integer lap count ⇒ final head position is exactly 0, the center of the lit trio: **the blob's landing spot IS the rest pattern's position**.
- Settled parameter `s(p) = max(1 − smoothstep(p / 0.10), smoothstep((p − 0.78) / 0.22))` — 1 at both ends, 0 mid-flight. (`smoothstep(t) = clamp(t,0,1)² · (3 − 2·clamp(t,0,1))`.)
- Per segment `i`: circular distance `d = min(|h − i|, 6 − |h − i|)`; `gauss = exp(−d² / (2 · 0.85²))` (σ = 0.85); `rest_i = 1` if `i ∈ {5,0,1}` else 0; brightness `B = gauss·(1−s) + rest_i·s`.
- Color: `bright = mix(WHITE, #b4b4b4, s)`; segment fill = `rgb(mix(#2a2a2a, bright, B))` (linear RGB-channel interpolation; WHITE = `rgb(255,255,255)`).
- The frames at `p = 0` and `p = 1` compute to exactly the rest fills — **no restore snap**; the landing and the rest state are the same event. (A final restore to the literal hex fills after `p = 1` is fine as a numerical safety net.)
- Driven by `requestAnimationFrame`; **re-trigger while running is ignored** (guard flag, no restart).
- Trigger: mouseenter on the brand crumb anchor (`.rk-brand-glitch` in `top-bar.tsx`, currently line ~860). The glitch CSS keeps firing via `:hover` as today.
- `prefers-reduced-motion: reduce`: the JS skips the sweep entirely — the rest state is the reduced-motion state (same convention as TypedLabel; nothing to gate in CSS).

Wiring seam: the sweep manipulates polygon fills inside `LogoSpinner`, so the driver should live with the component (e.g. an opt-in prop on `LogoSpinner` used only by the brand crumb, or an exported hook/component from `logo-spinner.tsx` that the crumb renders). Exact seam decided at apply; the crumb currently renders `<LogoSpinner size={20} loading={false} />`.

### 3. Documentation touch-ups

The hover-vocabulary comment block in `globals.css` (~line 120) and the vocabulary line in `fab/project/context.md` describe the brand treatment as "the logo's border ring additionally kickstart-spins — rk-logo-ring". Update both to describe the new treatment (white glow detach-orbit-land sweep, JS-driven).

## Affected Memory

- `run-kit/ui-patterns`: (modify) update the top-bar chrome / hover-animation-vocabulary coverage — brand-crumb logo hover is now a JS-driven white glow sweep (not a CSS transform spin), and LogoSpinner's chase starts at steady state via negative delays.

## Impact

- `app/frontend/src/components/logo-spinner.tsx` — delay fix; likely hosts the sweep driver; `.rk-logo-ring` group removed.
- `app/frontend/src/components/top-bar.tsx` — brand crumb wiring for the sweep trigger; the comment at ~line 862 explaining "inline SVG so CSS can reach the ring" needs updating (the reason becomes "so JS can reach the segments").
- `app/frontend/src/globals.css` — remove `rk-brand-spin` keyframes, `.rk-logo-ring` rules, hover rule, reduced-motion line; update vocabulary comment.
- `fab/project/context.md` — vocabulary line update.
- `app/frontend/src/components/top-bar.test.tsx` — existing tests reference the crumb; may need adjustment. New behavior should get unit coverage where practical (delay string values; sweep skip under reduced motion); e2e visual assertion of the animation is not practical.
- No backend, API, or route changes. No new dependencies.

## Open Questions

*(none — all decisions resolved during the design conversation)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Chase fix is exactly `${i * 0.2 - 1.2}s` negative delays; keyframes/duration unchanged | Discussed — user confirmed this fix explicitly ("the fix the chase animation itself") | S:95 R:90 A:95 D:95 |
| 2 | Certain | Sweep constants locked: white glow, 3 laps / 900ms, ease-out cubic, σ=0.85, envelope 10% in / last 22% land, exact-rest first+last frames | User approved the mock verbatim ("Variant C looks good now") after rejecting green, gray, and stepped variants | S:90 R:75 A:90 D:90 |
| 3 | Certain | Remove the CSS transform spin (`rk-brand-spin`, `.rk-logo-ring` rules + group); wordmark glitch unchanged | User confirmed the replacement scope ("ring+glitch improvement" = ring treatment swapped, glitch stays) | S:90 R:85 A:90 D:90 |
| 4 | Confident | Sweep driver lives with `LogoSpinner` (opt-in prop or exported hook from `logo-spinner.tsx`), following the JS-treatment precedent (`typed-label.tsx`) | Codebase pattern is clear; exact seam is an implementation detail, easily moved | S:70 R:80 A:75 D:60 |
| 5 | Certain | Reduced motion: JS skips the sweep; rest state is the reduced-motion state; CSS gate lines for the old spin are removed | Established convention — context.md: "JS treatments skip themselves" under reduced motion | S:85 R:90 A:95 D:90 |
| 6 | Confident | Re-hover during a running sweep is ignored (guard), not restarted | Mock behaved this way through all approved iterations; no user objection | S:65 R:90 A:80 D:70 |
| 7 | Confident | Update hover-vocabulary docs (globals.css comment, `fab/project/context.md`) in the same change | Vocabulary comments explicitly describe the old kickstart-spin; leaving them stale contradicts constitution-adjacent doc hygiene | S:60 R:95 A:85 D:75 |
| 8 | Confident | Test coverage is unit-level (delay values, reduced-motion skip); no e2e visual assertion of animation frames | code-quality.md requires tests for changed behavior; animation-frame e2e is impractical and the project has no precedent for it | S:55 R:85 A:70 D:65 |

8 assumptions (4 certain, 4 confident, 0 tentative, 0 unresolved).
