# Quality Checklist: Mobile Bar Keyboard Toggle

**Change**: 260327-bkm8-mobile-bar-keyboard-toggle
**Generated**: 2026-03-27
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Escape in Fn menu: Escape button appears in extended-keys section of Fn dropdown, sends `\x1b` on click
- [ ] CHK-002 Escape removed from main row: No standalone Escape button in the bottom bar
- [ ] CHK-003 Keyboard toggle renders: `⌨` button visible on touch devices, hidden on desktop
- [ ] CHK-004 Keyboard dismiss works: Tapping toggle when terminal focused blurs active element
- [ ] CHK-005 Keyboard summon works: Tapping toggle when terminal not focused calls `onFocusTerminal`
- [ ] CHK-006 Bottom bar layout: Tab, Ctrl, Alt, Fn, ArrowPad, divider, Compose, ⌘K, hostname, keyboard toggle — in order

## Behavioral Correctness
- [ ] CHK-007 Escape modifier bridging: Alt+Esc sends `\x1b\x1b`, Ctrl stays armed after Esc
- [ ] CHK-008 Fn menu closes after Escape tap: Dropdown dismisses after Escape key selection
- [ ] CHK-009 Focus preservation: `preventFocusSteal` on keyboard toggle prevents focus theft on dismiss

## Scenario Coverage
- [ ] CHK-010 Scenario: dismiss keyboard when terminal focused — active element blurs
- [ ] CHK-011 Scenario: summon keyboard when not focused — terminal regains focus
- [ ] CHK-012 Scenario: Escape via Fn menu with Alt modifier — correct escape sequence sent
- [ ] CHK-013 Scenario: bottom bar at 375px — no wrapping, all buttons visible

## Edge Cases & Error Handling
- [ ] CHK-014 No `onFocusTerminal` callback: Toggle in summon mode is a graceful no-op
- [ ] CHK-015 No `onOpenCompose` callback: Compose button absent, layout unaffected

## Code Quality
- [ ] CHK-016 Pattern consistency: New code follows naming and structural patterns of surrounding bottom-bar code
- [ ] CHK-017 No unnecessary duplication: Escape in Fn menu reuses existing key-send patterns
- [ ] CHK-018 No inline tmux command construction: N/A (frontend-only change)
- [ ] CHK-019 Type safety: No `as` type assertions — proper narrowing and discriminated unions

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
