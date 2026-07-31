# Plan: Shared useMediaQuery Hook

**Change**: 260731-tfr1-use-media-query-hook
**Intake**: `intake.md`

## Requirements

### Frontend Hooks: Shared media-query primitive

#### R1: Shared `useMediaQuery` / `evaluateMediaQuery` module
A new module `app/frontend/src/hooks/use-media-query.ts` SHALL export `useMediaQuery(query: string): boolean` (live subscription) and `evaluateMediaQuery(query: string): boolean` (one-shot evaluation), carrying the most defensive semantics of the four existing copies: SSR/non-browser guard (`typeof window === "undefined" || typeof window.matchMedia !== "function"` → `false` / no subscription), `useState(() => evaluateMediaQuery(query))` initial value, one `MediaQueryList` per hook call, modern `addEventListener("change", …)` with `typeof`-checked fallback to the deprecated `addListener`/`removeListener` (narrowing-cast typing, no bare `as` widening), an update handler that re-reads `mql.matches` (not the event object), one `update()` call after subscribing, symmetric cleanup, and the effect keyed on `[query]` so a changed query resubscribes.

- **GIVEN** a jsdom variant or older WebView where `window.matchMedia` is missing
- **WHEN** `useMediaQuery("(pointer: coarse)")` mounts or `evaluateMediaQuery(...)` is called
- **THEN** the value is `false` and nothing throws

- **GIVEN** a legacy `MediaQueryList` exposing only `addListener`/`removeListener`
- **WHEN** the hook mounts, the query flips, and the component unmounts
- **THEN** the listener attaches via `addListener`, the value updates live, and cleanup goes through `removeListener`

- **GIVEN** a mounted `useMediaQuery(q1)` whose `query` prop changes to `q2`
- **WHEN** the effect re-runs
- **THEN** the `q1` listener is removed and a `q2` subscription is created, with the value re-read from the new list

#### R2: `useIsMobile` becomes a thin wrapper (two separate subscriptions)
`app/frontend/src/hooks/use-is-mobile.ts` SHALL be rewritten over the shared module: `useIsMobile()` MUST be the OR of **two separate** `useMediaQuery` subscriptions — `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)` and `(pointer: coarse)` — preserving the current two-MQL shape (NOT one combined query string). `MOBILE_BREAKPOINT_PX = 640` MUST stay exported from this module (no import-path churn). The private `evaluateIsMobile()` SHALL become two `evaluateMediaQuery` calls and be **exported** so `chrome-context.tsx` can stop mirroring the rule.

- **GIVEN** a 1200px-wide viewport with a coarse pointer
- **WHEN** `useIsMobile()` renders
- **THEN** it returns `true` (OR semantics identical to before the rewrite)

- **GIVEN** existing importers of `MOBILE_BREAKPOINT_PX` (e.g. `chrome-context.tsx`)
- **WHEN** the wrapper lands
- **THEN** the import path `@/hooks/use-is-mobile` still resolves the constant unchanged

#### R3: `useCoarsePointer` becomes a thin wrapper; policy split preserved
`app/frontend/src/hooks/use-coarse-pointer.ts` SHALL be rewritten as `useMediaQuery("(pointer: coarse)")`. The module MUST keep its doc comment explaining the deliberate policy split (pointer TYPE only, deliberately NOT the narrow-OR-coarse rule — 260719-mxvw); the two policies MUST NOT be merged. Its existing unit test `use-coarse-pointer.test.ts` MUST be kept and stay green as the regression proof that wrapper semantics are unchanged.

- **GIVEN** the existing `use-coarse-pointer.test.ts` suite (legacy fallback, SSR guard, live updates, cleanup)
- **WHEN** the wrapper rewrite lands
- **THEN** every test passes unchanged

#### R4: Sidebar components lose their local copies
The module-local `useMediaQuery` in `app/frontend/src/components/sidebar/collapsible-panel.tsx` (~line 76) and `useIsMobileLayout` in `app/frontend/src/components/sidebar/server-panel.tsx` (line 32) SHALL be deleted; their call sites SHALL use `useIsMobile()` from `@/hooks/use-is-mobile` instead. Both local copies subscribe to `"(pointer: coarse), (max-width: 639px)"`, which is semantically identical to `useIsMobile`'s rule (comma = OR; 639 = `MOBILE_BREAKPOINT_PX - 1`), so behavior MUST be unchanged and both `639` magic literals are eliminated.

- **GIVEN** the sidebar rendered at a 639px-wide viewport with a fine pointer
- **WHEN** `CollapsiblePanel` / `ServerPanel` compute `isMobile`
- **THEN** the value is `true`, exactly as with the deleted local hooks

#### R5: One-shot evaluate for non-hook readers
`app/frontend/src/contexts/chrome-context.tsx` `isMobileViewport()` SHALL be re-expressed over the exported evaluate function(s) (delegating to `evaluateIsMobile()` from `@/hooks/use-is-mobile`) so the mobile rule lives in one place — the helper's name and its callers (`readSidebarOpen`, terminal-font device default) stay as-is. `app/frontend/src/components/terminal-client.tsx` (~line 505) SHALL replace `window.matchMedia("(pointer: coarse)").matches` with `evaluateMediaQuery("(pointer: coarse)")`, gaining the SSR guard for free.

- **GIVEN** `chrome-context.tsx` initializing `sidebarOpen` / terminal font default at state init (no hooks available)
- **WHEN** `isMobileViewport()` runs
- **THEN** it returns the same narrow-OR-coarse result as before, computed by the shared evaluate function

- **GIVEN** the terminal touch-to-scroll effect on a touch device
- **WHEN** the `isTouch` gate is computed
- **THEN** it is `true` via `evaluateMediaQuery` (and `false`, not a throw, where `matchMedia` is missing)

#### R6: Tests and type-check gate
A new unit test `app/frontend/src/hooks/use-media-query.test.ts` SHALL be added, modeled on `use-coarse-pointer.test.ts`: initial value, live change updates, legacy `addListener` fallback, missing-`matchMedia` guard, unsubscribe on unmount, and resubscribe on query change. All existing frontend tests MUST pass unchanged (`just test-frontend`) and `npx tsc --noEmit` in `app/frontend` MUST be clean.

- **GIVEN** the completed change
- **WHEN** `just test-frontend` and `npx tsc --noEmit` (in `app/frontend`) run
- **THEN** both exit zero with no test modified to accommodate the refactor (per the intake probe, no stub rework is expected)

### Non-Goals

- No behavior change anywhere — this is a pure dedupe refactor; the only intentional deltas are hardening (terminal-client's `isTouch` gains the SSR guard; the ex-local copies gain `typeof`-based fallback checks).
- No merging of the two pointer policies: `useCoarsePointer` stays pointer-type-only.
- `app.tsx`'s one-shot `prefers-reduced-motion` read (~line 1171) is out of scope — not in the dedupe cluster's member list.
- No backend, e2e spec, route, or memory changes (memory is hydrate's job).

## Tasks

### Phase 1: Setup

- [x] T001 Create `app/frontend/src/hooks/use-media-query.ts` exporting `useMediaQuery(query)` and `evaluateMediaQuery(query)` with SSR guard, `typeof`-checked legacy-listener fallback, `mql.matches` re-read, post-subscribe `update()`, and `[query]`-keyed effect <!-- R1 -->

### Phase 2: Core Implementation

- [x] T002 Rewrite `app/frontend/src/hooks/use-is-mobile.ts` as a thin wrapper: two separate `useMediaQuery` subscriptions ORed; keep `MOBILE_BREAKPOINT_PX` exported; export `evaluateIsMobile()` built on two `evaluateMediaQuery` calls <!-- R2 -->
- [x] T003 Rewrite `app/frontend/src/hooks/use-coarse-pointer.ts` as `useMediaQuery("(pointer: coarse)")`, preserving the policy-split doc comment (260719-mxvw); keep `use-coarse-pointer.test.ts` untouched <!-- R3 -->
- [x] T004 [P] Create `app/frontend/src/hooks/use-media-query.test.ts` modeled on `use-coarse-pointer.test.ts`: initial value, live updates, legacy fallback, missing-matchMedia guard, unmount cleanup, resubscribe on query change <!-- R6 -->

### Phase 3: Integration & Edge Cases

- [x] T005 [P] `app/frontend/src/components/sidebar/collapsible-panel.tsx`: delete the local `useMediaQuery` (~line 76) and switch the `isMobile` call site to `useIsMobile()` from `@/hooks/use-is-mobile`; prune now-unused imports <!-- R4 -->
- [x] T006 [P] `app/frontend/src/components/sidebar/server-panel.tsx`: delete `useIsMobileLayout` (line 32) and switch the `isMobile` call site to `useIsMobile()`; prune now-unused imports <!-- R4 -->
- [x] T007 [P] `app/frontend/src/contexts/chrome-context.tsx`: re-express `isMobileViewport()` as a delegate to the exported `evaluateIsMobile()`; prune the now-unused `MOBILE_BREAKPOINT_PX` import if nothing else uses it <!-- R5 -->
- [x] T008 [P] `app/frontend/src/components/terminal-client.tsx` (~line 505): replace `window.matchMedia("(pointer: coarse)").matches` with `evaluateMediaQuery("(pointer: coarse)")` <!-- R5 -->

### Phase 4: Polish

- [x] T009 Run `just test-frontend` (repo root) and `npx tsc --noEmit` (in `app/frontend`); fix any failures without weakening existing tests <!-- R6 -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `src/hooks/use-media-query.ts` exists and exports `useMediaQuery(query: string): boolean` and `evaluateMediaQuery(query: string): boolean` with SSR guard, legacy-listener fallback, single subscription per call, and `[query]`-keyed resubscribe
- [x] A-002 R2: `useIsMobile()` is a thin wrapper ORing two separate `useMediaQuery` subscriptions (not one combined query string); `MOBILE_BREAKPOINT_PX` is still exported from `use-is-mobile.ts`; `evaluateIsMobile()` is exported
- [x] A-003 R3: `useCoarsePointer()` is `useMediaQuery("(pointer: coarse)")` and the policy-split doc comment (pointer-type-only vs narrow-OR-coarse, 260719-mxvw) survives in the module
- [x] A-004 R5: `chrome-context.tsx` `isMobileViewport()` delegates to the shared evaluate function(s) (no inline matchMedia mirror); `terminal-client.tsx` `isTouch` uses `evaluateMediaQuery("(pointer: coarse)")`

### Behavioral Correctness

- [x] A-005 R2: The mobile rule is byte-equivalent to before — `(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)` OR `(pointer: coarse)` — with no `639` magic literal remaining in production `src/`
- [x] A-006 R3: The two pointer policies remain unmerged: `useCoarsePointer` subscribes to pointer type only, `useIsMobile` to narrow-OR-coarse

### Removal Verification

- [x] A-007 R4: The module-local `useMediaQuery` in `collapsible-panel.tsx` and `useIsMobileLayout` in `server-panel.tsx` are deleted (no dead code, no remaining `"(pointer: coarse), (max-width: 639px)"` string in components)

### Scenario Coverage

- [x] A-008 R6: `src/hooks/use-media-query.test.ts` covers initial value, live change updates, legacy `addListener` fallback, missing-matchMedia guard, unmount cleanup, and resubscribe on query change
- [x] A-009 R3: `use-coarse-pointer.test.ts` passes unchanged as the wrapper-semantics regression proof

### Edge Cases & Error Handling

- [x] A-010 R1: With `window.matchMedia` absent, `useMediaQuery` returns `false` without subscribing and `evaluateMediaQuery` returns `false` without throwing

### Code Quality

- [x] A-011 Pattern consistency: New hook follows the existing `use-*.ts` module style (doc comments, `typeof`-guarded fallbacks, narrowing casts — no bare `as` widening)
- [x] A-012 No unnecessary duplication: All four former matchMedia subscription copies route through the single shared module; no new copy of the fallback dance exists
- [x] A-013: `just test-frontend` passes and `npx tsc --noEmit` is clean in `app/frontend`, with no test weakened to accommodate the refactor (Test Integrity)

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- `app/frontend/src/contexts/chrome-context.tsx:71` `isMobileViewport()` — now a bare one-line pass-through to `evaluateIsMobile()`; its 2 callers (`readSidebarOpen`, terminal-font device default) could import `evaluateIsMobile` directly and drop the indirection. Deliberately retained by plan R5 ("the helper's name and its callers stay as-is"), so this is an opportunity, not a defect.
- `app/frontend/src/lib/motion.ts:9-10` `prefersReducedMotion()` — an unguarded-style one-shot `window.matchMedia("(prefers-reduced-motion: reduce)")` read with its own `typeof` capability guard; now expressible as `evaluateMediaQuery("(prefers-reduced-motion: reduce)")`. Out of dedupe cluster 5's member list (plan Non-Goals), so a follow-up candidate.
- `app/frontend/src/app.tsx:1168-1174` — the second inline `prefers-reduced-motion` matchMedia read with its own guard; duplicates `lib/motion.ts`'s logic and is likewise now expressible over the shared `evaluateMediaQuery`. Explicitly out of scope per plan Non-Goals; a follow-up candidate alongside the `motion.ts` copy.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Query strings in `use-is-mobile.ts` live as module constants shared by `useIsMobile` and `evaluateIsMobile` (identical strings, single source) | Trivially equivalent to the intake's inline literals; keeps hook and evaluate from drifting | S:80 R:95 A:95 D:85 |
| 2 | Confident | `isMobileViewport()` delegates to the exported `evaluateIsMobile()` (not two raw `evaluateMediaQuery` calls) | Intake says "re-express over the exported evaluate function(s)" and exports `evaluateIsMobile` explicitly "so chrome-context can stop mirroring the rule" — one-place rule wins | S:70 R:90 A:85 D:75 |
| 3 | Certain | Now-unused imports (`MOBILE_BREAKPOINT_PX` in chrome-context, React hooks in the sidebar components) are pruned as part of the switch | `tsc --noEmit` enforces unused-local cleanliness; leaving dead imports would fail the gate | S:75 R:95 A:95 D:90 |
| 4 | Certain | `app.tsx`'s one-shot `prefers-reduced-motion` matchMedia read stays untouched | Not a member of dedupe cluster 5; intake scope lists exactly the four hooks/components + two evaluate call sites | S:85 R:90 A:90 D:90 |

4 assumptions (3 certain, 1 confident, 0 tentative).
