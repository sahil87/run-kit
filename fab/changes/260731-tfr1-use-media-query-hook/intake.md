# Intake: Shared useMediaQuery Hook

**Change**: 260731-tfr1-use-media-query-hook
**Created**: 2026-07-31

## Origin

One-shot `/fab-new tfr1` from the backlog (dedupe sweep 2026-07-31, cluster 5):

> [tfr1] Extract a shared useMediaQuery hook and collapse 4 duplicated media-query subscriptions (production code, app/frontend/src). Members: hooks/use-is-mobile.ts `useIsMobile` (width<MOBILE_BREAKPOINT_PX(640) OR pointer:coarse; SSR guard + modern-addEventListener-with-legacy-addListener fallback dance), hooks/use-coarse-pointer.ts `useCoarsePointer` (same guard+fallback dance, comment self-cites "the use-is-mobile.ts pattern"), components/sidebar/collapsible-panel.tsx:76 local `useMediaQuery("(pointer: coarse), (max-width: 639px)")`, components/sidebar/server-panel.tsx:32 local `useIsMobileLayout` (same hardcoded combined query). The two component-local ones re-implement useIsMobile's EXACT rule with a magic 639 that can drift from MOBILE_BREAKPOINT_PX. Plan: new hooks/use-media-query.ts exporting `useMediaQuery(query: string): boolean` (SSR guard + legacy-listener fallback, single subscription); rewrite useIsMobile and useCoarsePointer as thin wrappers preserving exact semantics, keep exporting MOBILE_BREAKPOINT_PX, and PRESERVE the deliberate policy split documented in use-coarse-pointer.ts (pointer-type-only vs narrow-OR-coarse — do NOT merge the two policies); switch collapsible-panel + server-panel to useIsMobile(). Optional layer: export the one-shot evaluate function for non-hook readers (contexts/chrome-context.tsx:75 state init, components/terminal-client.tsx:505 isTouch). Behavior must be identical. Verify: just test-frontend + npx tsc --noEmit in app/frontend. GOTCHA: existing tests stub matchMedia keyed on query strings (server-panel.test.tsx:10) — useIsMobile subscribes to two separate queries instead of one combined string; make sure those component tests still exercise the mobile branch they intend.

All four member implementations were re-read at intake time and match the backlog description. The test gotcha was probed: no test keys on the combined query string — `server-panel.test.tsx:10`'s default stub returns `matches: false` for everything except `prefers-color-scheme: dark` (desktop branch), and `sidebar/index.test.tsx:377` (`makeMatchMedia`) matches on the substrings `max-width` / `pointer: coarse`, which hold for both the combined string and useIsMobile's two separate queries. The wrapper switch therefore does not invalidate any existing stub.

## Why

1. **Pain point**: the same matchMedia subscription dance — SSR/jsdom guard, modern `addEventListener("change", …)` with deprecated `addListener` fallback, symmetric cleanup — is implemented four times in `app/frontend/src`. Two of the copies (`collapsible-panel.tsx` local `useMediaQuery`, `server-panel.tsx` local `useIsMobileLayout`) additionally re-implement `useIsMobile`'s exact mobile rule with a hardcoded `639` magic number.
2. **Consequence of not fixing**: the `639` literals silently drift if `MOBILE_BREAKPOINT_PX` (640) ever changes, splitting the app's mobile breakpoint; every future media-query consumer copies the fallback dance again (use-coarse-pointer.ts already self-cites "the use-is-mobile.ts pattern" as a copy source); the two component-local copies also use a less defensive truthiness-based fallback check than the hooks.
3. **Why this approach**: a single generic `useMediaQuery(query)` hook is the smallest primitive that all four members are trivially expressible over; thin wrappers keep every existing call site's semantics and import path unchanged, so this is a pure dedupe with zero behavior change.

## What Changes

### New: `src/hooks/use-media-query.ts`

Exports:

```ts
/** Subscribe to a media query; live via matchMedia change listener. */
export function useMediaQuery(query: string): boolean
/** One-shot evaluation for non-hook contexts (state init, event handlers). */
export function evaluateMediaQuery(query: string): boolean
```

Behavior (lifted from the current `use-is-mobile.ts` implementation — the most defensive of the four copies):

- SSR/non-browser guard: `typeof window === "undefined" || typeof window.matchMedia !== "function"` → `false` (evaluate) / no subscription (hook effect), so it never throws in jsdom variants or older WebViews.
- `useState(() => evaluateMediaQuery(query))` initial value; effect subscribes one `MediaQueryList` per call.
- Listener attach/detach uses `typeof mql.addEventListener === "function"` checks with fallback to the deprecated `addListener`/`removeListener` (typed via the existing narrowing-cast pattern, no bare `as` widening).
- The update handler re-reads `mql.matches` (not the event object), and the effect calls `update()` once after subscribing (the existing pattern, catching changes between state init and effect run).
- Effect is keyed on `[query]` so a changed query string resubscribes (collapsible-panel's local copy already does this).

### Rewrite: `src/hooks/use-is-mobile.ts` as a thin wrapper

- `MOBILE_BREAKPOINT_PX = 640` stays exported from this module (imported by `chrome-context.tsx` and others) — no import-path churn.
- `useIsMobile()` becomes an OR of **two separate** `useMediaQuery` subscriptions, preserving the current two-MQL shape (NOT one combined query string):

```ts
export function useIsMobile(): boolean {
  const narrow = useMediaQuery(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`);
  const coarse = useMediaQuery("(pointer: coarse)");
  return narrow || coarse;
}
```

- The private `evaluateIsMobile()` becomes two `evaluateMediaQuery` calls; export it (see Optional layer below) so `chrome-context.tsx` can stop mirroring the rule.

### Rewrite: `src/hooks/use-coarse-pointer.ts` as a thin wrapper

- `useCoarsePointer()` → `useMediaQuery("(pointer: coarse)")`. The module keeps its doc comment explaining the **deliberate policy split** (pointer TYPE only, deliberately NOT the narrow-OR-coarse rule — 260719-mxvw); the two policies MUST NOT be merged.
- Its existing unit test `use-coarse-pointer.test.ts` (covers legacy-listener fallback, SSR guard, live updates, cleanup) is kept and must stay green — it becomes the regression proof that wrapper semantics are unchanged.

### Switch: `src/components/sidebar/collapsible-panel.tsx` and `src/components/sidebar/server-panel.tsx`

- Delete the module-local `useMediaQuery` (collapsible-panel.tsx:~76) and `useIsMobileLayout` (server-panel.tsx:32) — both subscribe to the combined `"(pointer: coarse), (max-width: 639px)"`, which is semantically identical to useIsMobile's rule (comma = OR; 639 = `MOBILE_BREAKPOINT_PX - 1`).
- Replace their call sites with `useIsMobile()` from `@/hooks/use-is-mobile`, eliminating both `639` magic literals.

### Optional layer (included): one-shot evaluate for non-hook readers

- `src/contexts/chrome-context.tsx:71` `isMobileViewport()` currently mirrors useIsMobile's rule inline for state init (hooks can't run there). Re-express it over the exported evaluate function(s) so the rule lives in one place; the exported name and its callers (`readSidebarOpen`, terminal-font device default) stay as-is.
- `src/components/terminal-client.tsx:505` `const isTouch = window.matchMedia("(pointer: coarse)").matches` → `evaluateMediaQuery("(pointer: coarse)")` (also gains the SSR guard for free).

### Tests

- New `src/hooks/use-media-query.test.ts` modeled on `use-coarse-pointer.test.ts` (initial value, live change updates, legacy `addListener` fallback, missing-matchMedia guard, unsubscribe on unmount, resubscribe on query change).
- All existing tests must pass unchanged — per the probe in Origin, no stub rework is expected; if a component test turns out to exercise the wrong branch after the switch, fix the stub to keep exercising the branch it intends (Test Integrity: tests conform to spec).

## Affected Memory

- `run-kit/ui-patterns`: (modify) hook-inventory row for `useIsMobile()` (ui-patterns.md:683) — note the shared `use-media-query.ts` substrate; the row's query description is also slightly stale (`max-width: 640px` vs actual 639px-OR-coarse) and can be corrected in passing. Behavior is otherwise identical, so no other memory changes.

## Impact

- **Files**: 1 new hook + 1 new test file; 2 hooks rewritten as wrappers; 2 sidebar components lose local copies; `chrome-context.tsx` + `terminal-client.tsx` switch to the shared evaluate (optional layer). All in `app/frontend/src` — no backend, no API, no route changes.
- **Behavior**: must be identical — this is a pure dedupe. The only intentional deltas are hardening (terminal-client's isTouch gains the SSR guard; the two component-local copies gain the typeof-based fallback checks).
- **Coordination**: backlog notes `5hm6` ↔ `tfr1` share one file at the margin (`server-panel.test.tsx`) — whichever change lands second rebases; no stub rework is expected here, so the overlap is likely moot.
- **Verification**: `just test-frontend` + `npx tsc --noEmit` in `app/frontend` (backlog-specified; matches code-quality gates 1–2 for a frontend-only change).

## Open Questions

- None — the backlog entry (dedupe sweep cluster 5) fully specifies the API, member list, wrapper semantics, policy-split constraint, optional layer, and verification; the test-stub gotcha was probed and resolved at intake.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | New `src/hooks/use-media-query.ts` exporting `useMediaQuery(query: string): boolean` with SSR guard + legacy-listener fallback, one subscription per call | API, filename, and semantics spelled verbatim in the backlog entry | S:95 R:85 A:95 D:95 |
| 2 | Certain | `useIsMobile` wraps TWO separate `useMediaQuery` calls (width, coarse) ORed — not one combined query string | Preserves the current two-MQL shape the backlog gotcha calls out; verified no test keys on a combined string | S:90 R:80 A:95 D:90 |
| 3 | Certain | Policy split preserved: `useCoarsePointer` stays pointer-type-only; never merged with the narrow-OR-coarse rule | Backlog says PRESERVE in caps; use-coarse-pointer.ts documents the split with rationale (260719-mxvw) | S:95 R:90 A:95 D:95 |
| 4 | Certain | `MOBILE_BREAKPOINT_PX` remains exported from `use-is-mobile.ts` (no import-path churn) | Backlog explicit; chrome-context.tsx imports it today | S:95 R:90 A:100 D:95 |
| 5 | Certain | collapsible-panel + server-panel switch to `useIsMobile()`; their combined query `(pointer: coarse), (max-width: 639px)` is semantically identical (comma = OR, 639 = breakpoint − 1) | Backlog explicit; equivalence verified by reading both implementations; stub probe shows no test breakage | S:90 R:75 A:90 D:85 |
| 6 | Confident | Optional one-shot layer IS included: export `evaluateMediaQuery`, switch chrome-context `isMobileViewport` internals + terminal-client `isTouch` to it | Backlog marks it "Optional" but spells it out; cheap, removes the last mirrored copies, easily dropped if review objects | S:70 R:85 A:80 D:60 |
| 7 | Certain | New unit test `use-media-query.test.ts` modeled on `use-coarse-pointer.test.ts`; existing tests kept green as regression proof | code-quality.md: changes MUST include tests; the sibling hook test is the established template | S:75 R:90 A:90 D:75 |
| 8 | Confident | Shared hook adopts use-is-mobile's defensive style: `typeof`-based listener checks, update handler re-reads `mql.matches`, effect keyed on `[query]` | Most defensive of the four copies; collapsible-panel's truthiness checks and event-object read are the weaker variants | S:65 R:90 A:85 D:70 |

8 assumptions (6 certain, 2 confident, 0 tentative, 0 unresolved).
