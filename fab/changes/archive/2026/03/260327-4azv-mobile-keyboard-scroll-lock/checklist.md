# Quality Checklist: Mobile Keyboard Scroll Lock

**Change**: 260327-4azv-mobile-keyboard-scroll-lock
**Generated**: 2026-03-27
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Scroll-lock state: `scrollLocked` boolean state exists in BottomBar, defaults to `false`
- [x] CHK-002 Long-press activation: Holding keyboard button >= 500ms toggles `scrollLocked`
- [x] CHK-003 Tap preserved: Short tap (< 500ms) on keyboard button still shows/hides keyboard
- [x] CHK-004 Focus prevention: When `scrollLocked` is `true`, tapping terminal does not focus xterm textarea
- [x] CHK-005 Visual indicator: Keyboard button shows `bg-accent/20 border-accent text-accent` and lock icon when locked
- [x] CHK-006 Prop wiring: `scrollLocked` flows from BottomBar → app.tsx → TerminalClient via callback + prop
- [x] CHK-007 Auto-dismiss: Activating scroll-lock while keyboard is visible dismisses the keyboard
- [x] CHK-008 Haptic feedback: `navigator.vibrate(50)` called on lock toggle (graceful no-op if unavailable)

## Behavioral Correctness
- [x] CHK-009 Tap in locked mode: Tapping keyboard button when locked unlocks AND summons keyboard in one action
- [x] CHK-010 Touch scroll preserved: SGR mouse scroll sequences still sent when `scrollLocked` is `true`
- [x] CHK-011 Compose buffer unaffected: Compose buffer textarea accepts focus/input regardless of scroll-lock state

## Scenario Coverage
- [x] CHK-012 Long-press enable: Test long-press sets `scrollLocked` to `true`
- [x] CHK-013 Long-press disable: Test long-press when locked sets `scrollLocked` to `false`
- [x] CHK-014 Touch move cancels: Test touch move > 10px cancels long-press (no toggle, no tap)
- [x] CHK-015 Navigation reset: Navigating to different session/window resets scroll-lock to `false`
- [x] CHK-016 Focus blocked: Test focusin on `.xterm` element is blocked when locked
- [x] CHK-017 Focus allowed: Test focusin on `.xterm` element proceeds when unlocked

## Edge Cases & Error Handling
- [x] CHK-018 Desktop unaffected: Long-press uses touch events — desktop keyboard toggle click behavior unchanged
- [x] CHK-019 Aria labels: `aria-label` correctly reflects locked/unlocked/show/hide states

## Code Quality
- [x] CHK-020 Pattern consistency: Long-press handler follows same event pattern as ArrowPad drag detection
- [x] CHK-021 No unnecessary duplication: Reuses existing `preventFocusSteal`, `KBD_CLASS`, modifier armed-state styling
- [x] CHK-022 Focus preservation: All buttons still use `preventFocusSteal` on mousedown
- [x] CHK-023 No magic numbers: 500ms threshold and 10px move threshold are named constants
- [x] CHK-024 Type safety: All new props typed in BottomBarProps and TerminalClientProps

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
