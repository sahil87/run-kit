# Plan: Bottom-Bar Keyboard-Aware Safe-Area Floor

**Change**: 260805-fi9m-bottom-bar-keyboard-aware-safe-floor
**Intake**: `intake.md`

## Requirements

### Frontend: Keyboard-Open Signal (`app/frontend/src/hooks/use-visual-viewport.ts`)

#### R1: Keyboard-open signal derived in `useVisualViewport`, no new listeners
The hook MUST derive a boolean keyboard-open signal inside its existing rAF-coalesced `apply()` pass (riding the existing `visualViewport` `resize`/`scroll` listeners — no new listeners, no new hooks) and expose it to CSS as the `kb-open` class on `document.documentElement`.

- **GIVEN** the app is mounted with a live `window.visualViewport`
- **WHEN** `visualViewport.height` drops meaningfully below the un-keyboarded baseline (keyboard opened)
- **THEN** `document.documentElement` carries class `kb-open`
- **AND** no additional event listeners beyond the existing `resize`/`scroll` pair are registered

#### R2: Baseline/threshold heuristic robust to URL-bar chrome and rotation
The keyboard-open heuristic MUST NOT misfire on iOS URL-bar collapse/expand or on orientation changes. Baseline = the maximum `visualViewport.height` observed since the last `visualViewport.width` change (a keyboard changes height but never width; rotation and window resizes change width, resetting the baseline). Signal is on when `height < baseline − KEYBOARD_DELTA_PX`, with `KEYBOARD_DELTA_PX = 150` — above any URL-bar chrome delta (~50–114px), below any real keyboard (~260px+). Constants MUST be named (no magic numbers).

- **GIVEN** the baseline height is 812px
- **WHEN** `visualViewport.height` shrinks to 750px (URL-bar chrome delta, width unchanged)
- **THEN** `kb-open` is NOT set
- **GIVEN** the baseline height is 812px
- **WHEN** `visualViewport.height` shrinks to 500px (keyboard, width unchanged)
- **THEN** `kb-open` IS set
- **GIVEN** the device rotates (both `width` and `height` change, e.g. 375×812 → 812×375)
- **WHEN** the new height is far below the old baseline
- **THEN** the baseline resets to the new geometry and `kb-open` is NOT set

#### R3: Cleanup symmetry
The `kb-open` class MUST be removed in the hook's existing cleanup path, matching the `fullbleed` / `--app-height` handling. When `visualViewport` is unavailable, the signal machinery is skipped entirely (no class ever set, no crash).

- **GIVEN** the hook is mounted and `kb-open` is currently set
- **WHEN** the hook unmounts
- **THEN** `kb-open` (and `fullbleed`, `--app-height`, `--app-offset-top`) are removed
- **GIVEN** `window.visualViewport` is undefined (jsdom, old browsers)
- **WHEN** the hook mounts and unmounts
- **THEN** no error is thrown and `kb-open` is never present

### Frontend: Bottom-Bar Safe Floor (`app/frontend/src/components/bottom-bar.tsx` + `app/frontend/src/globals.css`)

#### R4: Raised coarse-pointer floor while the keyboard is collapsed, keeping the `max()` shape
The toolbar row's bottom padding MUST become `max(var(--bottom-bar-floor, 0.375rem), env(safe-area-inset-bottom))`. The `--bottom-bar-floor` custom property lives in `globals.css` alongside the `html.fullbleed` block: default `0.375rem` (6px); raised to `1rem` (16px) under `@media (pointer: coarse)` when `html` does NOT carry `kb-open`. The `max()` shape is retained so genuine inset reporting (standalone PWA, future Safari) still wins. The padding math stays CSS-driven — JS only toggles the signal class.

- **GIVEN** a coarse-pointer device with the on-screen keyboard collapsed (no `kb-open`)
- **WHEN** the bottom-bar toolbar row renders
- **THEN** its computed `padding-bottom` is 16px (env() = 0 in in-browser Safari, floor wins)
- **GIVEN** a standalone-PWA context where `env(safe-area-inset-bottom)` reports 34px
- **WHEN** the row renders
- **THEN** the 34px inset wins over the 16px floor (max() arm)

#### R5: Keyboard open reverts to the original 6px floor
While `html.kb-open` is set, the coarse-pointer floor MUST revert to `0.375rem` — no raised padding above the keyboard (the bar rides above it on flat screen area; `interactive-widget=resizes-content` / `env()` collapse MUST NOT be relied on for this).

- **GIVEN** a coarse-pointer device with `html.kb-open` set
- **WHEN** the bottom-bar toolbar row renders
- **THEN** its computed `padding-bottom` is 6px

#### R6: Fine-pointer/desktop layouts byte-identical
On fine pointers the effective padding expression MUST resolve exactly as today (6px floor + env() arm) — the raised floor is scoped by `@media (pointer: coarse)` and MUST NOT leak into fine-pointer or desktop-shell contexts (260805-9hn1 gating precedent).

- **GIVEN** a fine-pointer (desktop) browser
- **WHEN** the bottom bar renders, with or without `kb-open`
- **THEN** computed `padding-bottom` is 6px (identical to pre-change behavior)

#### R7: Comment block rewritten to state the real behavior
The comment above the toolbar row (`bottom-bar.tsx`, currently lines 307–312) documents the now-known-wrong premise ("the OS reports the corner-arc/home-indicator inset … CSS-only — no JS keyboard detection") and MUST be rewritten: `env(safe-area-inset-bottom)` resolves to 0 in in-browser iOS Safari for this fixed-position app; the clearance comes from a raised coarse-pointer floor in `globals.css`; the floor is gated by the explicit `kb-open` keyboard signal from `useVisualViewport`.

- **GIVEN** the updated `bottom-bar.tsx`
- **WHEN** the comment is read
- **THEN** it states the env()=0 reality, the raised coarse floor, and the JS keyboard signal — no claim that iOS reports the inset in-browser or that the mechanism is CSS-only

### Tests

#### R8: Unit coverage of the signal derivation
A new `app/frontend/src/hooks/use-visual-viewport.test.ts` MUST cover the keyboard-open signal with a mocked `window.visualViewport` (controllable height/width/offsetTop + listener set) and a controllable rAF stub, following the existing hook-test patterns (`use-coarse-pointer.test.ts` `vi.stubGlobal` style). Assert at minimum: signal off at baseline; on when height drops past the threshold; off again on restore; NOT set for a sub-threshold (URL-bar) delta; baseline reset on width change (rotation); cleanup removes the class; no-visualViewport mount/unmount is safe.

- **GIVEN** the mocked viewport fires a resize with height reduced by more than 150px (width unchanged)
- **WHEN** the queued rAF callback flushes
- **THEN** `document.documentElement.classList.contains("kb-open")` is true
- **AND** restoring the height and flushing removes it

#### R9: e2e floor/class assertions with `.spec.md` companion
A new Playwright spec `app/frontend/tests/e2e/bottom-bar-safe-floor.spec.ts` (+ sibling `.spec.md` per Constitution § Test Companion Docs) MUST assert what Chromium can honestly measure (env() is 0 there): with `hasTouch: true` (flips `pointer: coarse`) the toolbar's computed `padding-bottom` is 16px; adding `kb-open` to `<html>` via `page.evaluate` flips it to 6px; without touch emulation (fine pointer) it is 6px. No test may pretend to exercise real insets.

- **GIVEN** a Chromium page with `hasTouch: true` at 375×812
- **WHEN** the terminal-server route renders the bottom bar
- **THEN** the toolbar row's computed `padding-bottom` is `16px`, and becomes `6px` after `document.documentElement.classList.add("kb-open")`

### Non-Goals

- No PWA manifest / standalone-mode work (rejected alternative)
- No JS probing of `env()` values (rejected alternative)
- No change to the top-bar `pt-[env(safe-area-inset-top)]` guard or shell titlebar gating (260805-9hn1)
- No change to `--app-height` semantics, the fullbleed pin, or xterm refit behavior

### Design Decisions

#### Raised floor = 1rem (16px)
**Decision**: The coarse-pointer keyboard-collapsed floor is `1rem` (16px), the low end of the intake's 1rem–20px band.
**Why**: 16 − 6 = 10px matches the intake's explicitly accepted cost ("flat-screen touch devices lose ~10px of terminal height"); trivially tunable post-ship via one CSS value.
**Rejected**: 20px (top of band) — spends more terminal height than the accepted cost without device evidence that 16px is insufficient.
*Introduced by*: 260805-fi9m-bottom-bar-keyboard-aware-safe-floor

#### Keyboard heuristic = max-height baseline keyed to width
**Decision**: Baseline = max observed `visualViewport.height` since the last `visualViewport.width` change; keyboard-open when `height < baseline − 150px`.
**Why**: A keyboard shrinks height without touching width, while rotations/window-resizes change width — so a width change is a reliable baseline-reset signal; 150px sits above URL-bar chrome deltas and below real keyboards. Self-heals if the page loads with the keyboard already open (baseline grows when it closes).
**Rejected**: comparing against `window.innerHeight` (unreliable — `interactive-widget=resizes-content` shrinks the layout viewport too on browsers honoring it, erasing the delta); `screen.height` (orientation semantics differ per platform). A desktop height-only window resize can false-positive, but the consumer is `coarse:`-scoped so desktop is unaffected.
*Introduced by*: 260805-fi9m-bottom-bar-keyboard-aware-safe-floor

#### CSS mechanism = `html.kb-open` class + `--bottom-bar-floor` custom property
**Decision**: JS toggles a `kb-open` class on `<html>` (same element/lifecycle as `fullbleed`); `globals.css` owns a `--bottom-bar-floor` property (default 0.375rem, raised to 1rem under `@media (pointer: coarse)` on `html:not(.kb-open)`); `bottom-bar.tsx` keeps a single Tailwind arbitrary value `pb-[max(var(--bottom-bar-floor,0.375rem),env(safe-area-inset-bottom))]`.
**Why**: Keeps the padding math in one CSS expression (no stacked Tailwind variants like `coarse:[html.kb-open_&]:pb-…`), matches the existing `html.fullbleed` class convention, and the media query + `:not()` selector encode "coarse AND keyboard-collapsed" declaratively.
**Rejected**: pure Tailwind stacked-variant classes (three arbitrary variants on one element, hard to read and cascade-order-sensitive); a `--kb-open` 0/1 variable multiplied into calc() (clever but opaque).
*Introduced by*: 260805-fi9m-bottom-bar-keyboard-aware-safe-floor

## Tasks

### Phase 1: Core Implementation

- [x] T001 Add the `--bottom-bar-floor` custom property block to `app/frontend/src/globals.css` alongside the `html.fullbleed` block: `:root { --bottom-bar-floor: 0.375rem; }` plus `@media (pointer: coarse) { html:not(.kb-open) { --bottom-bar-floor: 1rem; } }`, with a comment stating the env()=0 reality and the keyboard gate <!-- R4, R5, R6 -->
- [x] T002 [P] Extend `app/frontend/src/hooks/use-visual-viewport.ts`: derive the keyboard-open signal inside `apply()` (named constant `KEYBOARD_DELTA_PX = 150`; baseline = max height since last width change; toggle `kb-open` on `document.documentElement`), include width in the change guard, run the same derivation in the initial sync, and remove the class in the existing cleanup <!-- R1, R2, R3 -->
- [x] T003 Update `app/frontend/src/components/bottom-bar.tsx` toolbar row: replace `pb-[max(0.375rem,env(safe-area-inset-bottom))]` with `pb-[max(var(--bottom-bar-floor,0.375rem),env(safe-area-inset-bottom))]` and rewrite the comment block (lines 307–312) to state the real behavior <!-- R4, R7 -->

### Phase 2: Tests

- [x] T004 [P] New `app/frontend/src/hooks/use-visual-viewport.test.ts`: mocked `visualViewport` + rAF stub covering baseline-off, keyboard-on, restore-off, URL-bar-delta-no-fire, rotation baseline reset, cleanup, and missing-visualViewport safety <!-- R8 -->
- [x] T005 [P] New `app/frontend/tests/e2e/bottom-bar-safe-floor.spec.ts` + sibling `bottom-bar-safe-floor.spec.md`: coarse-emulated (`hasTouch: true`) computed padding-bottom = 16px, flips to 6px with `kb-open`, fine-pointer stays 6px <!-- R9 -->

### Phase 3: Verification

- [x] T006 Run `cd app/frontend && npx tsc --noEmit`, `just test-frontend`, and `just test-e2e "bottom-bar-safe-floor"`; fix any failures <!-- R1, R4, R8, R9 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `useVisualViewport` toggles `kb-open` on `document.documentElement` from within the existing rAF-coalesced apply pass; no new event listeners are registered — verified `use-visual-viewport.ts:42` inside `syncKeyboardSignal`, called only from `apply()` (:58) and the initial sync (:72); the "registers only the resize and scroll listener pair" test (`use-visual-viewport.test.ts:172`) asserts the listener set
- [x] A-002 R4: the toolbar row's padding-bottom expression is `max(var(--bottom-bar-floor,0.375rem),env(safe-area-inset-bottom))` and `globals.css` raises the floor to 1rem only under `(pointer: coarse)` with no `kb-open` — `bottom-bar.tsx:317`, `globals.css:583-590`
- [x] A-003 R8: `use-visual-viewport.test.ts` exists and passes with the enumerated cases — 8/8 pass
- [x] A-004 R9: `bottom-bar-safe-floor.spec.ts` + `.spec.md` exist; the spec passes under `just test-e2e` — 2/2 pass

### Behavioral Correctness

- [x] A-005 R2: a sub-threshold height delta (URL-bar chrome) does not set `kb-open`; a width change resets the baseline (rotation safe) — `use-visual-viewport.test.ts:90` and `:103`
- [x] A-006 R5: with `kb-open` set, the coarse-pointer computed padding-bottom reverts to 6px — e2e `bottom-bar-safe-floor.spec.ts:40` (passing)
- [x] A-007 R6: fine-pointer computed padding-bottom is 6px with and without `kb-open` (byte-identical desktop behavior) — e2e `bottom-bar-safe-floor.spec.ts:50-56` (passing)
- [x] A-008 R3: unmounting the hook removes `kb-open` alongside `fullbleed`/`--app-height`; a missing `visualViewport` never sets the class or throws — `use-visual-viewport.ts:82` + tests `:151`, `:182`

### Removal Verification

- [x] A-009 R7: the old comment's claims ("OS reports the corner-arc/home-indicator inset", "CSS-only — no JS keyboard detection") are gone from `bottom-bar.tsx`; the rewritten comment states env()=0 in-browser, the raised coarse floor, and the `useVisualViewport` keyboard signal — `bottom-bar.tsx:307-316`; the surviving "corner-arc/home-indicator" phrase names the physical zone being cleared, not an OS-reporting claim

### Scenario Coverage

- [x] A-010 R2: unit tests exercise the GIVEN/WHEN/THEN trio of R2 (chrome delta, keyboard delta, rotation) explicitly — `use-visual-viewport.test.ts:67` (keyboard delta + restore), `:90` (chrome delta), `:103` (rotation reset, plus a keyboard against the new baseline)
- [x] A-011 R9: the e2e asserts only what Chromium honestly measures (floor values + class flip), never a real `env()` inset — the spec's header comment (`bottom-bar-safe-floor.spec.ts:14-17`) states the limitation; every assertion reads computed `padding-bottom` against the floor constants only

### Code Quality

- [x] A-012 Pattern consistency: signal follows the `fullbleed` class convention (same element, same cleanup path); test follows the `vi.stubGlobal` hook-test pattern; CSS block sits with the fullbleed rules — `use-visual-viewport.ts:81-82` (paired removal), test mirrors `use-coarse-pointer.test.ts`'s controllable-fake idiom, `globals.css:573` sits directly below the `html.fullbleed .app-shell` block
- [x] A-013 No unnecessary duplication: no new hook, no new listeners, no polling — the derivation rides the existing `apply()` pass — confirmed; `syncKeyboardSignal` is the only added function and has exactly two call sites (initial sync + `apply()`)
- [x] A-014 No magic numbers: the keyboard threshold and floor values are named (`KEYBOARD_DELTA_PX` constant; `--bottom-bar-floor` custom property) — `use-visual-viewport.ts:6`, `globals.css:584`; the e2e also names its expectations (`RAISED_FLOOR`/`BASE_FLOOR`)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)

## Deletion Candidates

- `docs/memory/run-kit/ui-patterns.md` § Design Decisions → "Safe-area padding is a CSS `max()` floor, not JS keyboard detection" (~line 3109) — this entry's decision AND its "Rejected: a `visualViewport` resize listener toggling a class" line are exactly what this change now implements; the entry must be superseded (not merely amended) at hydrate, or memory will assert the opposite of the code
- `docs/memory/run-kit/ui-patterns.md` § Safe-Area Insets, "Why `max()` and not a media query" paragraph (~line 1946) — its claim that `env()` "collapses to 0 on its own" so "no JS observes the keyboard" is now false for the bottom edge; already scoped for hydrate by the intake's Affected Memory
- `var(--bottom-bar-floor, 0.375rem)` inline fallback (`bottom-bar.tsx:317`) — redundant with the `:root` default in `globals.css:584`; retained deliberately so the Tailwind class is self-documenting in isolation. Listed for completeness, NOT recommended for deletion

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Raised floor = 1rem (16px), the low end of the intake's 1rem–20px band | 16−6 = 10px exactly matches the intake's stated accepted cost ("~10px of terminal height"); one-value tunable post-ship | S:70 R:90 A:85 D:75 |
| 2 | Confident | Keyboard heuristic: baseline = max `vv.height` since last `vv.width` change; open when `height < baseline − 150px` | Keyboard changes height but never width (rotation/resizes change width → reset); 150px clears URL-bar deltas (~50–114px) and undercuts real keyboards (~260px+); desktop false-positives are harmless behind the `coarse:` scope | S:65 R:85 A:85 D:70 |
| 3 | Confident | Mechanism = `html.kb-open` class + `--bottom-bar-floor` custom property in `globals.css`; single Tailwind arbitrary `max(var(),env())` value in `bottom-bar.tsx` | Matches the existing `fullbleed` class convention and keeps the padding math one CSS expression instead of stacked Tailwind variants; intake delegated this choice | S:60 R:90 A:85 D:70 |
| 4 | Confident | e2e is included (new `bottom-bar-safe-floor.spec.ts`, `hasTouch: true` coarse emulation) rather than skipped | Intake marked e2e optional, but code-quality.md says UI changes SHOULD include e2e where possible and the coarse-emulation pattern already exists (`bottom-bar-chip-size.spec.ts`) — the floor/class assertion is cheap and honest | S:55 R:95 A:85 D:75 |

4 assumptions (0 certain, 4 confident, 0 tentative).
