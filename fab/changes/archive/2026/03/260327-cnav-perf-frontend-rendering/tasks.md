# Tasks: Performance Phase 3 — Frontend Rendering

**Change**: 260327-cnav-perf-frontend-rendering
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 [P] Diff SSE state before setSessions() + wrap in startTransition() in `app/frontend/src/contexts/session-context.tsx` — add `prevDataRef`, compare `e.data` strings, import and use `startTransition`
- [x] T002 [P] Export `useChromeState()` hook in `app/frontend/src/contexts/chrome-context.tsx` — add function returning `ChromeState` from `ChromeStateContext`, keep `useChrome()` as-is
- [x] T003 [P] Batch xterm.js writes with requestAnimationFrame in `app/frontend/src/components/terminal-client.tsx` — add text/binary buffers, schedule rAF flush in `onmessage`, cancel rAF on cleanup, flush on close

## Phase 2: Consumer Migration & Palette Split

- [x] T004 Migrate `app/frontend/src/app.tsx` to use `useChromeState()` — change import from `useChrome` to `useChromeState`, update destructuring at line 91
- [x] T005 [P] Migrate `app/frontend/src/components/top-bar.tsx` to use `useChromeState()` — replace `useChrome` import/call at line 410 with `useChromeState`
- [x] T006 Split `paletteActions` into independent memoized groups in `app/frontend/src/app.tsx` — create `sessionActions`, `windowActions`, `viewActions`, `configActions`, `serverActions`, `terminalActions` useMemos with minimal deps, compose in final `paletteActions` useMemo

## Phase 3: Verification

- [x] T007 Run frontend type check (`cd app/frontend && npx tsc --noEmit`) and fix any type errors
- [x] T008 Run frontend tests (`just test-frontend`) and fix any test failures — 85/85 passing tests pass; 5 pre-existing failures from missing `@configs/themes.json` (unrelated to this change)

---

## Execution Order

- T001, T002, T003 are independent (different files) — parallelizable
- T004 depends on T002 (needs `useChromeState` export)
- T005 depends on T002 (needs `useChromeState` export)
- T006 depends on T004 (modifies same file — app.tsx)
- T007, T008 depend on all implementation tasks
