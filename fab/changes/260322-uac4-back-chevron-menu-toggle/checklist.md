# Quality Checklist: Back Chevron Menu Toggle

**Change**: 260322-uac4-back-chevron-menu-toggle
**Generated**: 2026-03-22
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Chevron open state: HamburgerIcon renders left-pointing chevron when isOpen=true
- [ ] CHK-002 Closed state unchanged: Three horizontal lines render when isOpen=false
- [ ] CHK-003 Animation continuity: Transition uses 200ms ease timing with transformOrigin 9px 9px
- [ ] CHK-004 Accessibility preserved: aria-label="Toggle navigation" unchanged, touch targets unchanged

## Behavioral Correctness
- [ ] CHK-005 Desktop sidebar toggle: Clicking hamburger on desktop (>=768px) toggles sidebar and animates icon between hamburger and chevron
- [ ] CHK-006 Mobile drawer toggle: Clicking hamburger on mobile (<768px) toggles drawer and animates icon between hamburger and chevron

## Scenario Coverage
- [ ] CHK-007 Initial render: Fresh page load shows three horizontal lines (not chevron)
- [ ] CHK-008 Round-trip animation: Open then close produces smooth hamburger→chevron→hamburger transition

## Code Quality
- [ ] CHK-009 Pattern consistency: New transforms follow the same CSS inline style pattern as existing HamburgerIcon transforms
- [ ] CHK-010 No unnecessary duplication: No new components or utilities introduced for this simple transform change

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
