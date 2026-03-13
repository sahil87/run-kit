# Quality Checklist: Dashboard & Project Page Views

**Change**: 260313-ll1j-dashboard-project-page-views
**Generated**: 2026-03-14
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Three-tier URL structure: `/` renders Dashboard, `/$session` renders Project page, `/$session/$window` renders Terminal
- [x] CHK-002 Dashboard layout: stats line with session/window counts, session card grid, "New Session" button
- [x] CHK-003 Session card content: session name, window count, activity summary (active/idle counts)
- [x] CHK-004 Session card navigation: clicking a session card navigates to `/$session`
- [x] CHK-005 Card styling: `bg-bg-card border border-border rounded p-4 hover:border-text-secondary`, responsive grid `auto-fill minmax(240px, 1fr)`
- [x] CHK-006 Project page layout: window card grid, "New Window" button, session-not-found handling
- [x] CHK-007 Window card content: window name, paneCommand, activity dot+label, duration, fab stage badge
- [x] CHK-008 Window card navigation: clicking a window card navigates to `/$session/$window`
- [x] CHK-009 Top bar breadcrumbs adapt per view: logo only (Dashboard), logo+session (Project), logo+session+window (Terminal)
- [x] CHK-010 Line 2 actions adapt per view: `[+ Session]` only (Dashboard), `[+ Session]`+`[+ Window]` (Project), `[+ Session]`+`[Rename]`+`[Kill]` (Terminal)
- [x] CHK-011 Bottom bar hidden on Dashboard and Project page, visible on Terminal
- [x] CHK-012 Kill redirects: window kill → `/$session`, session kill → `/`
- [x] CHK-013 Sidebar session name click navigates to `/$session`, chevron toggles expand/collapse
- [x] CHK-014 Active session highlight in sidebar when on `/$session` route

## Behavioral Correctness
- [x] CHK-015 Auto-redirect on root removed: `/` always shows Dashboard (never redirects to terminal) — activeWindow sync effect (app.tsx:152) now guards `!windowIndex`, preventing redirect from Dashboard/Project page
- [x] CHK-016 Sidebar kill session redirects to `/` after API success
- [x] CHK-017 Line 2 right-side status and fixed-width toggle only render on Terminal view

## Removal Verification
- [x] CHK-018 `hasRedirected` ref and auto-redirect `useEffect` removed from `app.tsx`
- [x] CHK-019 "Select a window from the sidebar" placeholder text removed

## Scenario Coverage
- [x] CHK-020 Root with sessions shows Dashboard (not redirect) — test exists
- [x] CHK-021 Root with no sessions shows empty Dashboard with "New Session" button — test exists
- [x] CHK-022 Stats line uses singular ("1 session, 1 window") for count of 1 — test exists
- [x] CHK-023 Unknown session on `/$session` shows "Session not found" with link to `/` — test exists
- [x] CHK-024 Window card shows fab stage badge when fabStage present — test exists
- [x] CHK-025 Kill non-last window redirects to `/$session` — verified via code path: onKillWindow calls navigateToSession
- [x] CHK-026 Kill session redirects to `/` — verified via code path: onKillSession calls navigateToDashboard


## Edge Cases & Error Handling
- [x] CHK-027 Empty session (0 windows) on Project page shows "New Window" prompt (not blank)
- [x] CHK-028 Dashboard with no sessions shows "No sessions" and "New Session" button
- [x] CHK-029 Session name with special characters (spaces, slashes) URL-encodes correctly in navigation

## Code Quality
- [x] CHK-030 Pattern consistency: new components follow existing naming, styling, and prop patterns (compare with sidebar.tsx, top-bar.tsx)
- [x] CHK-031 No unnecessary duplication: reuses `getWindowDuration()`, `parseFabChange()` from `lib/format.ts`, existing Dialog and CreateSessionDialog
- [x] CHK-032 Type narrowing over type assertions: route param detection uses proper guards, not `as` casts
- [x] CHK-033 No god functions: Dashboard and ProjectPage components are focused, not bloated
- [x] CHK-034 No magic strings: route IDs and view names use constants or type-safe comparisons
- [x] CHK-035 No inline tmux command construction or shell strings (Go backend not touched, but verify no accidental changes)
- [x] CHK-036 No polling from client: new views use SSE data from `useSessions()`, not `setInterval` + fetch

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
