# Tasks: Fixed Chrome Architecture

**Change**: 260305-emla-fixed-chrome-architecture
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create `src/contexts/chrome-context.tsx` — ChromeProvider with breadcrumbs, line2Left, line2Right, bottomBar slots and their setters
- [x] T002 Create `src/components/top-bar-chrome.tsx` — reads from ChromeProvider context, renders fixed two-line top bar with icon breadcrumbs, connection indicator, ⌘K badge, and always-rendered Line 2 (min-h-[36px])

## Phase 2: Core Implementation

- [x] T003 Refactor `src/app/layout.tsx` — wrap children in ChromeProvider, add h-screen flex-col skeleton with three zones: top chrome (shrink-0, max-w-4xl), content (flex-1 overflow-y-auto, max-w-4xl), bottom slot (shrink-0 empty BottomSlot)
- [x] T004 Rewire `src/app/dashboard-client.tsx` — remove TopBar import/render and max-w-4xl wrapper, add useEffect that sets breadcrumbs (empty), line2Left (+ New Session button, search input), line2Right (session/window counts) via ChromeProvider, cleanup on unmount
- [x] T005 Rewire `src/app/p/[project]/project-client.tsx` — remove TopBar import/render and max-w-4xl wrapper, add useEffect that sets breadcrumbs ([⬡ projectName]), line2Left (+ New Window, Send Message), line2Right (window count), cleanup on unmount
- [x] T006 Rewire `src/app/p/[project]/[window]/terminal-client.tsx` — remove TopBar import/render, h-screen flex-col container, max-w-[900px] widths, add useEffect for breadcrumbs ([⬡ projectName, ❯ windowName]), line2Left (Kill Window), line2Right (activity dot + fab badge), terminal ref div uses flex-1 min-h-0

## Phase 3: Integration & Edge Cases

- [x] T007 Update `src/components/session-card.tsx` — change kill button from `opacity-0 group-hover:opacity-100 transition-opacity` to `text-text-secondary hover:text-text-primary transition-colors` (always visible)
- [x] T008 Delete `src/components/top-bar.tsx` and remove all remaining imports referencing it
- [x] T009 Verify terminal xterm.js FitAddon sizing — confirm terminal fills available space correctly under the new layout-owned flex container, check ResizeObserver triggers fit on navigation

## Phase 4: Polish

- [x] T010 Run `npx tsc --noEmit` and `pnpm build` — fix any type errors or build failures introduced by the refactor

---

## Execution Order

- T001 blocks T002 (TopBarChrome reads from ChromeProvider)
- T001 + T002 block T003 (layout references both)
- T003 blocks T004, T005, T006 (pages depend on layout providing the chrome skeleton)
- T004, T005, T006 are independent of each other
- T008 requires T004 + T005 + T006 complete (all TopBar imports removed before deleting)
- T007 is independent, can run alongside any phase
- T009 requires T006 complete
- T010 runs last
