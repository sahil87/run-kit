# Tasks: Dashboard View

**Change**: 260313-ll1j-dashboard-project-page-views
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Create Dashboard component skeleton at `app/frontend/src/components/dashboard.tsx` — accepts `sessions: ProjectSession[]` prop, renders a placeholder div. Export the component.

## Phase 2: Core Implementation

- [x] T002 Implement session cards in `app/frontend/src/components/dashboard.tsx` — stats line at top ("N sessions, M windows"), grid of session cards (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`). Each card shows session name, window count, activity summary ("N active, M idle"). Cards use `bg-bg-card border border-border rounded` tokens. Include "New Session" button.
- [x] T003 Implement expandable session cards with window cards in `app/frontend/src/components/dashboard.tsx` — click session card to toggle expand, show window cards inline. Each window card shows: window name, paneCommand, activity dot + label, idle duration (via `getWindowDuration` from `lib/format.ts`), fab info (change ID via `parseFabChange` + stage badge). Click window card navigates via `onNavigate` callback. Expanded card includes "New Window" button.
- [x] T004 Wire Dashboard into `app/frontend/src/app.tsx` — replace the placeholder div (`"Select a window..."` / `"No sessions..."`) with `<Dashboard>` component. Pass `sessions`, `onNavigate={navigateToWindow}`, `onCreateSession`, `onCreateWindow` props.
- [x] T005 Remove auto-redirect logic from `app/frontend/src/app.tsx` — delete the `hasRedirected` ref and the `useEffect` that redirects `/` to the first session's first window (lines ~125-143).
- [x] T006 Update kill redirect logic in `app/frontend/src/app.tsx` — modify the stale-URL redirect effect (lines ~161-176) so that when `currentSession` disappears OR `currentWindow` disappears, always navigate to `/` instead of trying to find a fallback window.
- [x] T007 Update `useDialogState` kill handler in `app/frontend/src/hooks/use-dialog-state.ts` — after `killWindow` API call, navigate to `/`. Accept a `navigate` function or `onKillComplete` callback to trigger redirect.

## Phase 3: Integration & Edge Cases

- [x] T008 Adapt top bar in `app/frontend/src/components/top-bar.tsx` — when `sessionName` is empty (Dashboard route), show "Dashboard" text after the logo instead of session/window breadcrumbs. Connection indicator, FixedWidthToggle, and `⌘K`/`⋯` render normally.
- [x] T009 Hide bottom bar on Dashboard in `app/frontend/src/app.tsx` — conditionally render `<BottomBar>` only when `sessionName && windowIndex` (terminal view active). Move bottom bar inside the terminal branch.
- [x] T010 Update sidebar session name click behavior in `app/frontend/src/components/sidebar.tsx` — split the session row: clicking the session name text navigates to `/$session/0` (first window) via `onSelectWindow(session.name, session.windows[0]?.index ?? 0)`. The chevron/triangle becomes a separate button that toggles expand/collapse.
- [x] T011 [P] Add Dashboard unit tests in `app/frontend/src/components/dashboard.test.tsx` — test: renders stats line, renders session cards, expands to show window cards, window card click calls onNavigate, new session button calls onCreateSession, empty state shows new session button.
- [x] T012 [P] Update sidebar tests in `app/frontend/src/components/sidebar.test.tsx` — test: session name click navigates (not toggles), chevron click toggles expand/collapse.
- [x] T013 [P] Update top-bar tests in `app/frontend/src/components/top-bar.test.tsx` — test: shows "Dashboard" when no session selected, shows breadcrumbs when session selected.

---

## Execution Order

- T001 blocks T002, T003
- T002 blocks T003 (session card structure needed before window cards)
- T003 blocks T004 (Dashboard must be complete before wiring)
- T005, T006, T007 are independent of T001-T004 but should run after T004 for integration
- T008, T009, T010 are independent of each other, can run after T004
- T011, T012, T013 are parallelizable, run after their respective implementation tasks
