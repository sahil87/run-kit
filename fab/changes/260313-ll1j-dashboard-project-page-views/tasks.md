# Tasks: Dashboard & Project Page Views

**Change**: 260313-ll1j-dashboard-project-page-views
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Add `sessionRoute` (`/$session`) to TanStack Router in `app/frontend/src/router.tsx` — new route between `indexRoute` and `sessionWindowRoute` with `$session` param parsing

## Phase 2: Core Implementation

- [x] T002 Create Dashboard component at `app/frontend/src/components/dashboard.tsx` — stats line ("{N} sessions, {M} windows" with singular/plural), session card grid (`auto-fill, minmax(240px, 1fr)`), each card shows session name, window count, activity summary (active/idle counts), "New Session" button. Cards use `bg-bg-card border border-border rounded p-4 hover:border-text-secondary` styling. Click navigates to `/$session`
- [x] T003 Create ProjectPage component at `app/frontend/src/components/project-page.tsx` — window card grid (same grid pattern), each card shows window name, paneCommand, activity dot+label, duration via `getWindowDuration()`, fab stage badge + change ID. "New Window" button calls `createWindow` API. Click navigates to `/$session/$window`. Handle "session not found" with link to `/`. Handle empty session (no windows) with "New Window" prompt
- [x] T004 Wire Dashboard and ProjectPage into `app/frontend/src/app.tsx` — replace the terminal placeholder (lines 332-348) with route-based branching: `/$session/$window` → TerminalClient, `/$session` → ProjectPage, `/` → Dashboard. Detect route via `useMatches()` route ID. Remove `hasRedirected` ref and auto-redirect `useEffect`. Pass sessions, navigate callbacks, and dialog openers as props

## Phase 3: Integration & Edge Cases

- [x] T005 Adapt TopBar (`app/frontend/src/components/top-bar.tsx`) for view-dependent chrome — breadcrumbs: Dashboard shows logo only, Project page shows `logo ❯ session`, Terminal unchanged. Line 2 left: Dashboard shows `[+ Session]` only, Project page shows `[+ Session]` + `[+ Window]`, Terminal unchanged. Line 2 right status + fixed-width toggle: Terminal only. Add `view` prop (or derive from sessionName/windowName presence) and a `sessionName` prop for the `[+ Window]` callback
- [x] T006 Add kill redirect logic — in `app/frontend/src/hooks/use-dialog-state.ts` (or `app.tsx`): after `killWindow` API succeeds, navigate to `/$session`; after `killSession` API succeeds, navigate to `/`. Sidebar `handleKillSession` in `app/frontend/src/components/sidebar.tsx` needs an `onNavigate` callback to redirect to `/` after kill. Pass navigate function from app.tsx
- [x] T007 Split sidebar session row interaction in `app/frontend/src/components/sidebar.tsx` — session name click navigates to `/$session` (via new `onSelectSession` prop), chevron/triangle is a separate button for expand/collapse. Highlight active session when on `/$session` route (compare `currentSession` param). Add `onSelectSession` prop to `SidebarProps`
- [x] T008 Conditionally render bottom bar in `app/frontend/src/app.tsx` — only render `<BottomBar>` when on the terminal view (`/$session/$window`). On Dashboard and Project page, omit the bottom bar entirely (not just hidden)

## Phase 4: Polish

- [x] T009 [P] Add unit tests for Dashboard component at `app/frontend/src/components/dashboard.test.tsx` — stats line singular/plural, card content, card navigation click, empty state
- [x] T010 [P] Add unit tests for ProjectPage component at `app/frontend/src/components/project-page.test.tsx` — window cards with fab info, idle duration, navigation click, session not found, empty session
- [x] T011 [P] Update existing sidebar test at `app/frontend/src/components/sidebar.test.tsx` — test split session row (name click navigates, chevron toggles), active session highlight
- [x] T012 [P] Update existing top-bar test at `app/frontend/src/components/top-bar.test.tsx` — test view-dependent breadcrumbs and Line 2 actions for Dashboard/Project/Terminal views

---

## Execution Order

- T001 blocks T004 (route must exist before wiring)
- T002 and T003 are independent, can run alongside T001
- T004 blocks T005, T006, T007, T008 (app.tsx wiring must be in place before integration)
- T005, T006, T007, T008 are mostly independent but touch overlapping props — execute sequentially
- T009-T012 are parallelizable after all implementation tasks complete
