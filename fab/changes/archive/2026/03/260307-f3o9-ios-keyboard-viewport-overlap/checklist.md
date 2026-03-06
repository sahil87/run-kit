# Quality Checklist: iOS Keyboard Viewport Overlap

**Change**: 260307-f3o9-ios-keyboard-viewport-overlap
**Generated**: 2026-03-07
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Visual Viewport Scroll Listener: `useVisualViewport` subscribes to both `resize` and `scroll` events on `window.visualViewport`
- [x] CHK-002 Fixed Positioning in Fullbleed: `html.fullbleed .app-shell` CSS rule applies `position: fixed` with correct `inset`, `width`, and `height`
- [x] CHK-003 Width Constraint Preserved: `max-w-4xl mx-auto` and `px-6` padding still apply to top bar, content, and bottom bar

## Behavioral Correctness
- [x] CHK-004 Dashboard/project pages unaffected: no `position: fixed` applied when fullbleed class is absent
- [x] CHK-005 Navigation cleanup: leaving terminal page removes fullbleed class and fixed positioning reverts

## Scenario Coverage
- [x] CHK-006 Hook cleanup: both `resize` and `scroll` listeners removed on unmount, `--app-height` property removed
- [x] CHK-007 Terminal refit: existing ResizeObserver triggers `fitAddon.fit()` when container height changes

## Code Quality
- [x] CHK-008 Pattern consistency: new CSS follows existing fullbleed rule patterns in `globals.css`
- [x] CHK-009 No unnecessary duplication: reuses existing `--app-height` mechanism, no parallel state

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
