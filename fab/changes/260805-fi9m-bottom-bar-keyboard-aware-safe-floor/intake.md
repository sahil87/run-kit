# Intake: Bottom-Bar Keyboard-Aware Safe-Area Floor

**Change**: 260805-fi9m-bottom-bar-keyboard-aware-safe-floor
**Created**: 2026-08-05

## Origin

Dispatched promptless via `/fab-proceed` from a live conversation (2026-08-05) with photo evidence from the user's iPhone. Synthesized description:

> On iPhones viewed in in-browser Safari, the bottom-bar terminal keys row (the `⇥ ^ ⌥ F▴ ↑ >_ ⌘K` chip toolbar in `app/frontend/src/components/bottom-bar.tsx`) is clipped by the phone's curved bottom corners / home-indicator zone. The existing guard from change 260724-2bmy (PR #458) — `pb-[max(0.375rem,env(safe-area-inset-bottom))]` — is premised on iOS reporting ≈34px via `env(safe-area-inset-bottom)` under `viewport-fit=cover`. In practice `env()` resolves to **0** in in-browser iOS Safari for this app. Decision (user chose over three alternatives): raise the bottom-padding floor on touch devices, keeping the `max(<floor>, env())` shape, applied **only while the system on-screen keyboard is collapsed** — the keyboard-open signal derived in the existing `useVisualViewport` hook.

Interaction mode: promptless dispatch — the user pre-resolved the approach fork in conversation; remaining choices are implementation-level and recorded as graded assumptions below.

## Why

**The pain point.** The bottom bar's terminal-keys chip row is a primary touch surface on mobile (Constitution V — keyboard-first; these chips ARE the mobile keyboard surface for modifiers, arrows, compose, and the palette). On real iPhones in in-browser Safari the extreme chips (`⇥` left, `⌘K`/`⌨` right) and the row's bottom edge sit under the curved glass corners / home-indicator zone — partially clipped and hard to tap. Confirmed by device photo evidence, 2026-08-05.

**Why the existing guard fails.** 260724-2bmy floored the row's bottom padding at `max(0.375rem, env(safe-area-inset-bottom))` (`bottom-bar.tsx:313`), premised on iOS reporting ≈34px via `env(safe-area-inset-bottom)` under `viewport-fit=cover`. On real devices `env()` resolves to **0** in in-browser iOS Safari for this app: the page is `position:fixed` and non-scrollable (`html.fullbleed .app-root` pinned to `--app-height` from `visualViewport` — `use-visual-viewport.ts` + `globals.css`), so Safari never enters the chrome states where it reliably reports the bottom inset. This matches the project's own memory for the *top* inset ("0 in browsers, non-zero only in standalone PWA mode" — `docs/memory/run-kit/ui-patterns.md` § Safe-Area Insets). Net: the effective padding is the 6px floor, and the chips sit under the curve.

**Consequence of not fixing.** The primary mobile input surface stays partially unusable on iPhone-class devices — the exact regression 2bmy was shipped to prevent, still live because its premise was never device-ground-truthed.

**Why this approach over alternatives.** The user explicitly chose **raising the bottom-padding floor on touch devices** over three considered alternatives:

1. *Device ground-truthing first* (instrument and measure what `env()` actually reports across chrome states) — rejected as a prerequisite; the photo evidence plus the existing top-inset memory note already establish the failure, and the fix does not depend on the exact per-state values.
2. *A JS-probed `env()` fallback variable* (measure `env()` via a probe element, substitute a JS value when 0) — rejected: more machinery for the same outcome, and it still needs a hardcoded fallback magnitude when the probe reads 0.
3. *PWA manifest / standalone route* (standalone display mode makes `env()` report real insets) — rejected: changes the install story to fix a browser-tab bug; in-browser Safari remains the primary access mode.

The chosen shape keeps `max(<floor>, env(safe-area-inset-bottom))` so genuine inset reporting (e.g. standalone PWA mode, future Safari behavior) still wins, and scopes the raised floor with the existing `coarse:` Tailwind variant (`@media (pointer: coarse)`) so fine-pointer/desktop layouts are byte-identical. Accepted cost (user-acknowledged): ~10px of terminal height on flat-screen touch devices that didn't need the lift.

**The hard constraint that makes this more than a one-line pad bump.** The raised floor must apply **only while the system on-screen keyboard is collapsed**. When the keyboard is up, `interactive-widget=resizes-content` shrinks the layout viewport and the bar rides above the keyboard on flat screen area — carrying the raised floor there is pure wasted vertical space on an already-short viewport. The 2bmy design got keyboard-collapse behavior "for free" only because it assumed `env()` would drop to 0 when the keyboard opened; a static raised floor loses that property, so an explicit keyboard-open signal is required. iOS Safari support for `interactive-widget=resizes-content` is unreliable — do NOT rely on `env()` collapsing (or any layout-viewport side effect of that directive) when the keyboard opens.

## What Changes

### 1. Keyboard-open signal in `useVisualViewport` (`app/frontend/src/hooks/use-visual-viewport.ts`)

The hook already owns the app's only `visualViewport` listeners (rAF-coalesced `resize` + `scroll`, setting `--app-height` / `--app-offset-top` on `document.documentElement`, adding/removing `html.fullbleed`). Extend the same `apply()` pass to derive a boolean keyboard-open signal and expose it to CSS — e.g. toggle a class such as `html.kb-open` (or a custom property such as `--kb-open`) on `document.documentElement` when `visualViewport.height` is meaningfully smaller than the un-keyboarded viewport height.

- **No new listeners**: the derivation rides the existing `resize`/`scroll` handlers and rAF coalescing. This was an explicit constraint from the conversation.
- **Baseline + threshold**: the "un-keyboarded viewport height" baseline and the "meaningfully smaller" threshold are implementation decisions (e.g. track the max observed `vv.height`, or compare against `window.innerHeight` / `screen.height`, with a threshold that ignores browser-chrome show/hide deltas but catches keyboards). Whatever heuristic is chosen must not misfire on iOS URL-bar collapse/expand or on desktop window resizes (desktop is additionally protected by the `coarse:` scope on the consumer side).
- **Cleanup symmetry**: the signal is removed in the hook's existing cleanup path, matching `fullbleed` / `--app-height` handling.
- The hook is called once in `RootWrapper` (`app.tsx:169`), so the signal is maintained on every route — both bottom-bar render sites (app shell and the board twin) see it for free.

### 2. Padding expression in `bottom-bar.tsx` (toolbar row, currently line 313)

Replace the single `pb-[max(0.375rem,env(safe-area-inset-bottom))]` arm with a keyboard-state-conditional expression:

- **Keyboard collapsed** (default): `max(<raised floor>, env(safe-area-inset-bottom))` on coarse pointers — raised floor around **1rem–20px** (exact value an implementation decision within that band); fine pointers keep the existing 6px-floored expression untouched.
- **Keyboard open** (`kb-open` signal active): the original `max(0.375rem, env(safe-area-inset-bottom))` — i.e. back to the 6px floor, no raised padding above the keyboard.
- The expression stays **CSS-driven**: the JS side only toggles the signal; the padding math lives in CSS. Whether that is a Tailwind arbitrary value with the `coarse:` variant plus a `kb-open` selector, or a small rule in `globals.css` (with a CSS custom property for the floor), is an implementation decision — follow whichever reads cleaner against the existing `coarse:` usage and `rk-*`/fullbleed conventions in `globals.css`.
- The accompanying comment block (`bottom-bar.tsx:307-312`) currently documents the now-known-wrong premise ("the OS reports the corner-arc/home-indicator inset … CSS-only — no JS keyboard detection") — it MUST be rewritten to state the real behavior (`env()` = 0 in in-browser Safari; raised coarse floor; explicit keyboard signal from `useVisualViewport`).

### 3. Possible plumbing in `app/frontend/src/globals.css`

If the class/variable mechanism needs a stylesheet rule (e.g. `html.kb-open` overriding a padding custom property), it lives alongside the existing `html.fullbleed` block. No other stylesheet changes.

### 4. Tests

- **Unit**: cover the keyboard-open signal derivation in a new `use-visual-viewport.test.ts` (no test file exists for this hook today) — jsdom with a mocked `window.visualViewport` (EventTarget with controllable `height`/`offsetTop`), following the existing hook-test patterns in `app/frontend/src/hooks/*.test.ts`. Assert: signal off at baseline, on when height drops past the threshold, off again on restore, cleanup removes it.
- **e2e**: per project memory, Playwright/Chromium reports `env()` as 0 — e2e can only assert computed floor values and class toggling, **not** the `env()` arm. A coarse-pointer-emulated check that the collapsed-keyboard floor applies (and/or that toggling the signal class flips the computed padding) is the realistic ceiling; do not write an e2e that pretends to exercise real insets. New/modified `.spec.ts` files require sibling `.spec.md` companions (Constitution § Test Companion Docs); unit tests are exempt.

### 5. Out of scope

- No PWA manifest / standalone-mode work (rejected alternative).
- No JS probing of `env()` values (rejected alternative).
- No change to the top-bar `pt-[env(safe-area-inset-top)]` guard or the shell titlebar gating (260805-9hn1) — though the memory correction below adjoins that section.
- No change to `--app-height` semantics, the fullbleed pin, or xterm refit behavior.

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Safe-Area Insets — its stated premise ("On a curved-screen phone with the keyboard collapsed the OS reports the corner-arc/home-indicator inset (≈34px)") is now known-wrong for in-browser Safari on real devices and must be corrected at hydrate: `env(safe-area-inset-bottom)` is 0 in in-browser iOS Safari for this fixed-position app (mirroring the section's own top-inset note), the bottom bar now carries a raised coarse-pointer floor gated by the `useVisualViewport` keyboard-open signal, and the "no JS keyboard detection" claim (and the § Design Decisions entry rejecting a `visualViewport` keyboard-state branch) no longer holds for the bottom edge. Cross-referenced sections § Bottom Bar (toolbar padding description, ~line 1845), § Mobile Responsive (~line 1920), and § iOS Keyboard Support (hook description, ~line 1899) update to match.

## Impact

- **Code**: `app/frontend/src/components/bottom-bar.tsx` (padding expression + comment, one toolbar row — covers both render sites), `app/frontend/src/hooks/use-visual-viewport.ts` (signal derivation + cleanup), possibly `app/frontend/src/globals.css` (class/variable rule). Small, frontend-only; no backend, no API, no route changes.
- **Tests**: new `use-visual-viewport.test.ts` unit suite; optional narrow e2e assertion on floor/class (with `.spec.md` companion if a spec file is touched).
- **UX blast radius**: coarse-pointer devices only (the `coarse:` variant scopes it); fine-pointer/desktop and the desktop shell are untouched — consistent with 260805-9hn1's rule that edge padding must not leak into contexts that don't need it. Flat-screen touch devices lose ~10px of terminal height with the keyboard collapsed (accepted cost). Standalone-PWA users with genuine `env()` reporting are unaffected (the `max()` still lets the larger real inset win).
- **Dependencies**: none new. No reliance on `interactive-widget=resizes-content` behaving correctly on iOS.

## Open Questions

- None blocking. Implementation-level choices (exact raised-floor value within 1rem–20px, keyboard threshold heuristic and baseline source, class vs custom-property mechanism and where the CSS expression lives) are delegated to apply and recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix = raise the bottom-padding floor on coarse pointers, keeping the `max(<floor>, env(safe-area-inset-bottom))` shape so real inset reporting still wins | Discussed — user explicitly chose this over device ground-truthing, a JS-probed env() fallback, and a PWA/standalone route | S:90 R:75 A:95 D:95 |
| 2 | Certain | Raised floor applies ONLY while the on-screen keyboard is collapsed; keyboard open reverts to the original 6px floor | User-specified hard constraint, verbatim intent captured in Origin/Why | S:95 R:80 A:90 D:90 |
| 3 | Certain | Do not rely on `env()` collapsing or `interactive-widget=resizes-content` when the keyboard opens — an explicit keyboard-open signal is required | User-stated: iOS support for the directive is unreliable; the 2bmy free-collapse premise is dead with a static floor | S:90 R:80 A:90 D:90 |
| 4 | Confident | Keyboard-open signal is derived inside the existing `useVisualViewport` hook (class or custom property on `document.documentElement`), no new listeners | Discussed implementation direction; hook already owns the only visualViewport listeners and is mounted once in RootWrapper; exact mechanism left open | S:80 R:80 A:85 D:70 |
| 5 | Confident | Raised-floor magnitude lands in the 1rem–20px band on coarse pointers | User named the band and delegated the exact value; trivially tunable post-ship | S:60 R:90 A:75 D:60 |
| 6 | Confident | Keyboard-open threshold = `visualViewport.height` meaningfully smaller than the un-keyboarded baseline, tuned to ignore URL-bar chrome deltas | Direction discussed; heuristic details delegated to apply; easily adjusted, consumer side already `coarse:`-scoped | S:55 R:85 A:80 D:65 |
| 7 | Confident | CSS mechanism (class `html.kb-open` vs `--kb-open` variable; Tailwind arbitrary value vs `globals.css` rule) decided at apply, keeping the padding math CSS-driven | Explicitly delegated as an implementation decision; both options fit existing conventions and are cheap to swap | S:55 R:90 A:80 D:60 |
| 8 | Confident | Tests = jsdom unit coverage of the signal derivation (mocked `visualViewport`); e2e limited to floor/class assertions since Chromium reports `env()` as 0 | Description + project memory state the Playwright env() limitation; code-quality.md requires tests for fixes | S:70 R:85 A:80 D:75 |
| 9 | Certain | Hydrate corrects `run-kit/ui-patterns` § Safe-Area Insets (premise now known-wrong on device) plus its Bottom Bar / Mobile Responsive / iOS Keyboard Support cross-references | Explicitly listed in the description's Affected Memory direction; memory-truth maintenance is the hydrate contract | S:85 R:90 A:90 D:85 |
| 10 | Certain | Desktop shell and fine-pointer layouts stay byte-identical — the raised floor is `coarse:`-scoped and must not leak into contexts that don't need it (per 260805-9hn1's gating precedent) | User-identified constraint; the existing `coarse:` variant already provides the scope | S:80 R:85 A:90 D:85 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).
