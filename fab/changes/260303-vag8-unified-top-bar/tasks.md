# Tasks: Unified Top Bar

**Change**: 260303-vag8-unified-top-bar
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 Add `killSession` function to `src/lib/tmux.ts` — `tmuxExec(["kill-session", "-t", session])`, matching the existing `killWindow` pattern with default `TMUX_TIMEOUT`
- [x] T002 Create shared `TopBar` component in `src/components/top-bar.tsx` — accepts `breadcrumbs: { label: string; href?: string }[]` (last segment has no href = non-clickable), `isConnected: boolean`, and `children` (action bar content for Line 2). Renders breadcrumb segments separated by `›`, connection dot + label, and `⌘K` hint badge on Line 1

## Phase 2: Core Implementation

- [x] T003 Add `killSession` action to `POST /api/sessions` in `src/app/api/sessions/route.ts` — validate session via `validateName()`, call `killSession()` from `src/lib/tmux.ts`. Import the new function
- [x] T004 Refactor `src/app/dashboard-client.tsx` — replace `<header>` with `<TopBar>`, add Line 2 action bar: always-visible search input (remove `showFilter` state and toggle), "+ New Session" button, right-aligned `{N} sessions, {M} windows` summary. Update `/` shortcut to focus input ref instead of toggling visibility
- [x] T005 Add inline `✕` kill button to `src/components/session-card.tsx` — accept `onKill?: (e: React.MouseEvent) => void` prop, render a subtle `✕` button (dimmed by default, visible on card hover via `group` + `group-hover:opacity-100`). Call `onKill(e)` on click with `e.stopPropagation()`
- [x] T006 Add session group `✕` kill button to `src/app/dashboard-client.tsx` — add a `✕` button to each session group header with red hover styling, add confirmation dialog "Kill session **{name}** and all {N} windows?", call `POST /api/sessions { action: "killSession", session }`
- [x] T007 Add kill window confirmation dialog to `src/app/dashboard-client.tsx` — when card `✕` is clicked, show confirmation "Kill window **{name}**?", call `POST /api/sessions { action: "killWindow", session, index }`
- [x] T008 Refactor `src/app/p/[project]/project-client.tsx` — replace `<header>` with `<TopBar>` (breadcrumbs: Dashboard → project: {name}), add Line 2 action bar: "+ New Window" button, "Send Message" button (disabled when no focus), right-aligned window count. Remove keyboard hint badges from old header
- [x] T009 Refactor `src/app/p/[project]/[window]/terminal-client.tsx` — add `useSessions` hook, replace top bar with `<TopBar>` (breadcrumbs: Dashboard → project → window), add Line 2 action bar: "Kill Window" button with confirmation + navigate back, right-aligned activity dot + fab stage badge. Add `CommandPalette` with kill/navigate actions

## Phase 3: Integration & Edge Cases

- [x] T010 Update terminal navigation paths to include `?name=` query param — update `DashboardClient.navigateToWindow()`, `ProjectClient.navigateToTerminal()`, and all command palette terminal actions to push `/p/{project}/{index}?name={windowName}`
- [x] T011 Read `name` search param in `src/app/p/[project]/[window]/page.tsx` — pass `windowName` prop to `TerminalClient` (from `searchParams.name` with fallback to `windowIndex`), update `TerminalClient` props type to accept `windowName: string`
- [x] T012 Ensure terminal page `⌘K` does not conflict with xterm key capture — verify that `CommandPalette`'s global `Cmd+K` listener fires before xterm captures the keystroke (xterm attaches to its container element, `CommandPalette` attaches to `document` — document listener should win)

---

## Execution Order

- T001 blocks T003 (killSession function needed before API route)
- T002 blocks T004, T008, T009 (TopBar component needed before page refactors)
- T005 blocks T006, T007 (SessionCard onKill prop needed before dashboard kill logic)
- T004 blocks T006, T007 (dashboard must use TopBar before adding kill dialogs)
- T010 blocks T011 (navigation must pass name param before terminal reads it)
- T009 depends on T002, T010, T011 (terminal needs TopBar, name resolution, and query param)
