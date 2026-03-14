# Quality Checklist: Dashboard View

**Change**: 260313-ll1j-dashboard-project-page-views
**Generated**: 2026-03-14
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Dashboard route: `/` renders Dashboard view (not redirect) in the terminal area
- [x] CHK-002 Session cards: each card shows session name, window count, activity summary
- [x] CHK-003 Expandable cards: clicking session card expands to show window cards inline
- [x] CHK-004 Window cards: show name, paneCommand, activity dot, duration, fab info when present
- [x] CHK-005 Window card navigation: clicking window card navigates to `/$session/$window`
- [x] CHK-006 New Session button: visible on Dashboard, opens create session dialog
- [x] CHK-007 New Window button: visible in expanded session card, creates window
- [x] CHK-008 Top bar adaptation: shows "Dashboard" label on `/`, normal breadcrumbs on terminal page
- [x] CHK-009 Bottom bar hidden: not rendered on Dashboard route
- [x] CHK-010 Kill redirect: all kill operations (window, last window, session) redirect to `/`
- [x] CHK-011 Sidebar session name: click navigates to first window, chevron toggles expand/collapse

## Behavioral Correctness
- [x] CHK-012 Auto-redirect removed: `/` no longer redirects to first session's first window
- [x] CHK-013 Stale URL redirect: when session/window disappears (external kill), app navigates to `/`
- [x] CHK-014 Sidebar expand/collapse: chevron still toggles correctly (not broken by split)
- [x] CHK-015 Active window sync: still works correctly on terminal pages (not affected by Dashboard changes)

## Removal Verification
- [x] CHK-016 `hasRedirected` ref and redirect effect removed from `app.tsx`
- [x] CHK-017 Fallback window redirect logic (find next window in same session) removed

## Scenario Coverage
- [x] CHK-018 Dashboard with sessions: stats + cards render correctly
- [x] CHK-019 Dashboard with no sessions: empty state with New Session button
- [x] CHK-020 Session card expand/collapse: toggle works, multiple sessions expandable
- [x] CHK-021 Window card with fab info: change ID + stage badge displayed
- [x] CHK-022 Window card without fab info: only basic info displayed
- [x] CHK-023 Kill window then Dashboard: navigation to `/` happens

## Edge Cases & Error Handling
- [x] CHK-024 Session with 0 windows: session card shows "0 windows" gracefully
- [x] CHK-025 SSE disconnect while on Dashboard: connection indicator shows disconnected, cards remain
- [x] CHK-026 Rapid session creation/deletion: Dashboard updates reactively via SSE

## Code Quality
- [x] CHK-027 Pattern consistency: Dashboard component follows existing component conventions (props interface, design tokens, hooks usage)
- [x] CHK-028 No unnecessary duplication: reuses `getWindowDuration`, `parseFabChange` from `lib/format.ts`
- [x] CHK-029 **N/A**: exec.CommandContext with timeouts: no new subprocess calls (frontend-only change)
- [x] CHK-030 **N/A**: No shell string construction: N/A (frontend-only)
- [x] CHK-031 Existing utilities reused: uses `navigateToWindow`, `createWindow`, `killSession` from existing code
- [x] CHK-032 **N/A**: No inline tmux command construction: N/A (frontend-only)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
