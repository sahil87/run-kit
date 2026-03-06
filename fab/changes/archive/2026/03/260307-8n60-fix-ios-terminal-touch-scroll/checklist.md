# Quality Checklist: Fix iOS Terminal Touch Scroll

**Change**: 260307-8n60-fix-ios-terminal-touch-scroll
**Generated**: 2026-03-07
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 Terminal touch-action: `touch-none` class present on terminal container div
- [x] CHK-002 Body overflow prevention: `html.fullbleed` CSS rule sets `overflow: hidden` and `overscroll-behavior: none`
- [x] CHK-003 Fullbleed class toggle: `useEffect` in ContentSlot adds/removes `fullbleed` class on `<html>` element

## Behavioral Correctness

- [x] CHK-004 Fullbleed class only applied when terminal page is active (fullbleed=true)
- [x] CHK-005 Fullbleed class removed on cleanup (component unmount / page navigation away)

## Scenario Coverage

- [x] CHK-006 Terminal container has `touch-none` — prevents browser touch scroll on canvas area
- [x] CHK-007 Non-terminal pages unaffected — no `fullbleed` class on `<html>` when on dashboard/project pages
- [x] CHK-008 Compose buffer not inside terminal container — touch behavior unblocked for textarea
- [x] CHK-009 Bottom bar is sibling to content — not affected by terminal touch-action

## Edge Cases & Error Handling

- [x] CHK-010 Class cleanup on unmount: navigating away from terminal removes `fullbleed` class from `<html>`

## Code Quality

- [x] CHK-011 Pattern consistency: CSS approach matches existing project patterns (Tailwind classes, globals.css for global rules)
- [x] CHK-012 No unnecessary duplication: no redundant overflow handling introduced
- [x] CHK-013 Server Components unaffected: changes only in Client Components and CSS

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
