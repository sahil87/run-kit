# Tasks: iOS Keyboard Viewport Overlap

**Change**: 260307-f3o9-ios-keyboard-viewport-overlap
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 [P] Add `scroll` event listener to `useVisualViewport` hook in `src/hooks/use-visual-viewport.ts` — subscribe to both `resize` and `scroll` events on `window.visualViewport`, remove both on cleanup
- [x] T002 [P] Add `app-shell` class to the root flex container div in `src/app/layout.tsx`
- [x] T003 Add fullbleed fixed-positioning CSS rule in `src/app/globals.css` — when `html.fullbleed`, apply `position: fixed; inset: 0; width: 100%; height: var(--app-height, 100vh)` to `.app-shell`

## Phase 2: Verification

- [x] T004 Run `pnpm exec tsc --noEmit` to verify no type errors
- [x] T005 Run `pnpm test` to verify no test regressions (91 passed)

---

## Execution Order

- T001 and T002 are independent, can run in parallel
- T003 depends on T002 (needs the `app-shell` class to exist)
- T004 and T005 depend on T001-T003
