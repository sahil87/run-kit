# Quality Checklist: Fix tmux scrolling on mobile

**Change**: 260325-8kuf-tmux-mobile-scroll
**Generated**: 2026-03-25
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Vertical touch scroll: Terminal container uses `touch-pan-y` instead of `touch-none`
- [x] CHK-002 Horizontal block: `touch-pan-y` blocks horizontal panning (inherent in the CSS value)
- [x] CHK-003 Overscroll preserved: `overscroll-behavior: none` remains on `.xterm .xterm-viewport` in globals.css

## Behavioral Correctness
- [x] CHK-004 Desktop unchanged: `touch-pan-y` has no effect on mouse/trackpad interaction
- [x] CHK-005 No new JS handlers: Fix is CSS-only, no touch event listeners added

## Scenario Coverage
- [x] CHK-006 Mobile vertical swipe: xterm viewport scrolls up/down on vertical touch gesture
- [x] CHK-007 iOS overscroll: Page does not rubber-band when scrolling past terminal bounds
- [x] CHK-008 Horizontal swipe blocked: Horizontal gesture does not shift the page

## Code Quality
- [x] CHK-009 Pattern consistency: Change follows existing Tailwind class patterns in terminal-client.tsx
- [x] CHK-010 No unnecessary duplication: No redundant touch-action rules introduced

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
