# Quality Checklist: Per-Region Scroll Behavior

**Change**: 260315-lnrb-dashboard-scroll-behavior
**Generated**: 2026-03-15
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Fullbleed activation: `document.documentElement` has `fullbleed` class after app mounts
- [x] CHK-002 Fullbleed cleanup: `fullbleed` class removed when `useVisualViewport` hook unmounts
- [x] CHK-003 Stats line pinned: stats line does not scroll when card area scrolls
- [x] CHK-004 Card area scrollable: session cards grid has `overflow-y-auto` and scrolls independently

## Behavioral Correctness
- [x] CHK-005 Terminal no browser scrollbar: xterm.js output growth does not produce page-level scrollbar
- [x] CHK-006 Dashboard scroll within fullbleed: Dashboard internal scroll works with html/body `overflow: hidden`
- [x] CHK-007 Visual consistency: padding/spacing matches previous layout when content doesn't overflow

## Scenario Coverage
- [x] CHK-008 Few sessions: no scrollbar appears when cards fit within viewport
- [x] CHK-009 Many sessions: stats pinned, cards scroll, all cards reachable
- [x] CHK-010 React strict mode: no duplicate `fullbleed` class or errors on double-invoke

## Edge Cases & Error Handling
- [x] CHK-011 Empty state: Dashboard with 0 sessions renders correctly with pinned stats and scrollable area
- [x] CHK-012 Sidebar scroll: sidebar `overflow-y-auto` behavior unchanged by fullbleed changes

## Code Quality
- [x] CHK-013 Pattern consistency: new code follows naming and structural patterns of surrounding code
- [x] CHK-014 No unnecessary duplication: existing utilities reused where applicable
- [x] CHK-015 Readability: layout intent clear from class names and structure
- [x] CHK-016 No god functions: changes stay within reasonable function/component size
- [x] CHK-017 No magic strings: class names follow Tailwind conventions consistently

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
