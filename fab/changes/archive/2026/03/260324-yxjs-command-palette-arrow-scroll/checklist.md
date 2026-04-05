# Quality Checklist: Command Palette Arrow Key Scroll

**Change**: 260324-yxjs-command-palette-arrow-scroll
**Generated**: 2026-03-24
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Scroll-into-view on arrow key navigation: `listRef` attached to listbox, `useEffect` calls `scrollIntoView({ block: "nearest" })` on `[aria-selected="true"]` element
- [x] CHK-002 Listbox ref attachment: `<div role="listbox">` has `ref={listRef}` attribute
- [x] CHK-003 No wrapping behavior change: ArrowDown at last item stays on last, ArrowUp at first stays on first

## Behavioral Correctness
- [x] CHK-004 Arrow down past visible area scrolls container down
- [x] CHK-005 Arrow up past visible area scrolls container up
- [x] CHK-006 Selection within visible area does not trigger unnecessary scroll

## Scenario Coverage
- [x] CHK-007 Palette reopens with selection at top and list unscrolled
- [x] CHK-008 scrollIntoView called on ArrowDown: test exists in command-palette.test.tsx

## Edge Cases & Error Handling
- [x] CHK-009 Empty filtered list: no scroll-into-view error when no items match query
- [x] CHK-010 Single item list: arrow keys don't cause scroll errors

## Code Quality
- [x] CHK-011 Pattern consistency: scroll-into-view implementation matches theme-selector.tsx pattern
- [x] CHK-012 No unnecessary duplication: reuses existing `useRef`/`useEffect` patterns, no new utilities

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
