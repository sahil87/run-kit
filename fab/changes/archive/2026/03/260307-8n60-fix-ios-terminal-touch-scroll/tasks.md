# Tasks: Fix iOS Terminal Touch Scroll

**Change**: 260307-8n60-fix-ios-terminal-touch-scroll
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Core Implementation

- [x] T001 [P] Add `touch-action: none` CSS class to the terminal container div in `src/app/p/[project]/[window]/terminal-client.tsx` — add `touch-none` (Tailwind class) to the `terminalRef` div's className
- [x] T002 [P] Add fullbleed body/html overflow prevention in `src/app/globals.css` — add a CSS rule for `html.fullbleed` that sets `overflow: hidden` and `overscroll-behavior: none` on both `html` and `body`
- [x] T003 Toggle `fullbleed` class on `document.documentElement` — in `src/contexts/chrome-context.tsx` `ContentSlot`, add a `useEffect` that adds/removes the `fullbleed` class on the `<html>` element when `fullbleed` state changes

## Phase 2: Verification

- [x] T004 Run `npx tsc --noEmit` to verify no type errors
- [x] T005 Run `pnpm build` to verify production build succeeds

---

## Execution Order

- T001, T002, T003 are independent ([P]) — can execute in parallel
- T004, T005 run after all Phase 1 tasks complete
