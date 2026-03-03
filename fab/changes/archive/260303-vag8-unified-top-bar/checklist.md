# Quality Checklist: Unified Top Bar

**Change**: 260303-vag8-unified-top-bar
**Generated**: 2026-03-03
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Unified breadcrumb: TopBar renders correct breadcrumb segments on all three pages (Dashboard, project, terminal)
- [ ] CHK-002 Connection indicator: Green/gray dot + label visible on all three pages via useSessions isConnected
- [ ] CHK-003 ⌘K hint badge: Visible on all three pages including terminal
- [ ] CHK-004 Dashboard action bar: "+ New Session" button, always-visible search input, session/window summary
- [ ] CHK-005 Project action bar: "+ New Window" button, "Send Message" button (disabled when no focus), window count
- [ ] CHK-006 Terminal action bar: "Kill Window" button with confirmation, activity dot, fab stage badge
- [ ] CHK-007 Inline window kill: ✕ button on every SessionCard with confirmation dialog
- [ ] CHK-008 Inline session kill: ✕ button on session group headers with confirmation dialog
- [ ] CHK-009 killSession API: POST /api/sessions accepts killSession action, validates input, kills tmux session
- [ ] CHK-010 Terminal command palette: ⌘K opens palette with kill/back-to-project/back-to-dashboard actions
- [ ] CHK-011 Window name resolution: Terminal breadcrumb shows window name from query param, falls back to index

## Behavioral Correctness

- [ ] CHK-012 Always-visible search: Filter input visible without pressing `/`; `/` focuses the input instead of toggling
- [ ] CHK-013 Card ✕ stopPropagation: Clicking card kill button does not trigger card navigation
- [ ] CHK-014 Session kill visual distinction: Session ✕ visually different from window ✕ (larger, red hover)
- [ ] CHK-015 Kill from terminal navigates back: After killing window from terminal page, user navigates to project page

## Removal Verification

- [ ] CHK-016 Back arrow removed: No ← button on project or terminal pages (replaced by breadcrumb)
- [ ] CHK-017 Toggle filter removed: No showFilter state or toggle behavior in dashboard
- [ ] CHK-018 Shortcut badges removed: No n/x/s kbd badges in project page header

## Scenario Coverage

- [ ] CHK-019 Dashboard breadcrumb: Shows "Dashboard" only, non-clickable
- [ ] CHK-020 Project breadcrumb: Shows "Dashboard › project: {name}", Dashboard clickable
- [ ] CHK-021 Terminal breadcrumb: Shows "Dashboard › project: {name} › window: {name}", first two clickable
- [ ] CHK-022 Terminal fallback: Without name query param, breadcrumb shows "window: {index}"
- [ ] CHK-023 Kill session flow: Click ✕ → confirm → POST killSession → SSE removes session
- [ ] CHK-024 Kill window from card: Click ✕ → confirm → POST killWindow → SSE removes window

## Edge Cases & Error Handling

- [ ] CHK-025 SSE disconnection: Connection indicator shows gray/"disconnected" on all pages when SSE drops
- [ ] CHK-026 Kill non-existent session: API returns 500 with tmux error, UI does not crash
- [ ] CHK-027 Empty state preserved: Dashboard "No active sessions" and project "No windows" empty states still work
- [ ] CHK-028 Send Message disabled: Button visually disabled when no window is focused on project page

## Code Quality

- [ ] CHK-029 Pattern consistency: New code follows naming and structural patterns of surrounding code
- [ ] CHK-030 No unnecessary duplication: Existing utilities reused (Dialog component, useSessions hook, validateName)
- [ ] CHK-031 execFile with argument arrays: killSession uses execFile via tmuxExec, never exec or template strings
- [ ] CHK-032 Server Components default: TopBar is Client Component only because it needs isConnected (justified)
- [ ] CHK-033 No useEffect for data fetching: Terminal page uses useSessions hook (SSE), not useEffect + fetch
- [ ] CHK-034 Existing utilities reused: tmuxExec, validateName, Dialog component, useSessions hook all reused
- [ ] CHK-035 No inline tmux commands: killSession goes through lib/tmux.ts
- [ ] CHK-036 No magic strings: Action names, timeout values use existing constants

## Security

- [ ] CHK-037 killSession input validation: Session name validated via validateName() before reaching tmux
- [ ] CHK-038 killSession timeout: tmux kill-session call includes timeout (TMUX_TIMEOUT)
- [ ] CHK-039 No shell injection: killSession uses execFile with argument array, not exec or template string

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
