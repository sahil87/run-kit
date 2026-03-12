# Quality Checklist: Mobile Responsive Polish

**Change**: 260305-ol5d-mobile-responsive-polish
**Generated**: 2026-03-07
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Line 2 mobile collapse: `line2Left` hidden below 640px on all three pages
- [ ] CHK-002 `⋯` button: Visible below 640px, hidden above, dispatches `palette:open` event
- [ ] CHK-003 Status text repositioned: `line2Right` renders left-aligned on mobile
- [ ] CHK-004 Command palette external open: `palette:open` event opens the palette
- [ ] CHK-005 `⌘K` badge hidden: Not visible below 640px, connection indicator remains
- [ ] CHK-006 Touch targets: All specified elements have 44px min-height on `pointer: coarse`
- [ ] CHK-007 Bottom bar 44px: `KBD_CLASS` uses `min-h-[44px]` unconditionally
- [ ] CHK-008 Terminal font: 11px below 640px, 13px above
- [ ] CHK-009 Responsive padding: `px-3 sm:px-6` on all three chrome zones

## Behavioral Correctness

- [ ] CHK-010 `⋯` button opens same palette as `⌘K`: Same actions available, same search behavior
- [ ] CHK-011 Desktop unchanged: No visual regressions on viewports >= 640px
- [ ] CHK-012 `⌘K` still works on desktop: Keyboard shortcut not broken by event listener addition

## Scenario Coverage

- [ ] CHK-013 Dashboard mobile: Status text left-aligned, actions hidden, `⋯` visible
- [ ] CHK-014 Project mobile: Status text left-aligned, actions hidden, `⋯` visible
- [ ] CHK-015 Terminal mobile: Activity/fab badge left-aligned, actions hidden, `⋯` visible
- [ ] CHK-016 Terminal font init: `fontSize` set based on `matchMedia` at initialization

## Edge Cases & Error Handling

- [ ] CHK-017 No palette actions: `⋯` button still opens palette (shows "No results" if empty)
- [ ] CHK-018 Resize across breakpoint: Layout adjusts correctly when window crosses 640px
- [ ] CHK-019 `palette:open` without mounted palette: No errors if event fires before palette mounts

## Code Quality

- [ ] CHK-020 Pattern consistency: New responsive classes follow existing Tailwind patterns (`hidden sm:block`, `px-3 sm:px-6`)
- [ ] CHK-021 No unnecessary duplication: `coarse:` variant defined once in globals.css, reused across components
- [ ] CHK-022 `execFile` with argument arrays: No `exec()` or shell strings introduced
- [ ] CHK-023 No `useEffect` for data fetching: No new client-side data fetching patterns
- [ ] CHK-024 Server Components default: No components converted to Client Components unnecessarily

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
