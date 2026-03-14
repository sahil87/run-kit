# Quality Checklist: Remove Top Bar Line 2

**Change**: 260313-zvgc-remove-top-bar-line-2
**Generated**: 2026-03-13
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Line 2 Removal: The entire Line 2 `<div>` (action buttons + status) is deleted from `top-bar.tsx`
- [ ] CHK-002 FixedWidthToggle Relocation: Toggle renders in Line 1 between connection label and `⌘K`
- [ ] CHK-003 Session Dropdown Action: `+ New Session` appears as first item in session breadcrumb dropdown with divider
- [ ] CHK-004 Window Dropdown Action: `+ New Window` appears as first item in window breadcrumb dropdown with divider
- [ ] CHK-005 Sidebar Empty State: `+ New Session` button displayed when no sessions exist
- [ ] CHK-006 Unused Props Removed: `onRename` and `onKill` removed from `TopBarProps` and parent call sites

## Behavioral Correctness

- [ ] CHK-007 FixedWidthToggle Behavior: Toggle click still toggles between fixed/full width with correct visual states
- [ ] CHK-008 Session Creation from Dropdown: Clicking `+ New Session` in dropdown opens session creation dialog
- [ ] CHK-009 Window Creation from Dropdown: Clicking `+ New Window` creates new window in current session
- [ ] CHK-010 Action Item Not Highlighted: `+ New` items do not receive `text-accent` current-item styling
- [ ] CHK-011 Dropdown Keyboard Nav: ArrowUp/ArrowDown keyboard navigation skips the action item

## Removal Verification

- [ ] CHK-012 No Line 2 Remnants: No markup, data-testid, conditional renders, or className references to Line 2 remain
- [ ] CHK-013 No Dead Imports: `parseFabChange` and `getWindowDuration` imports removed from `top-bar.tsx` if no longer referenced
- [ ] CHK-014 No Dead Props: `onRename` and `onKill` not passed anywhere to `TopBar`

## Scenario Coverage

- [ ] CHK-015 Desktop Viewport: FixedWidthToggle visible in Line 1 on desktop (>= 640px)
- [ ] CHK-016 Mobile Viewport: FixedWidthToggle visible on mobile (< 640px) — previously hidden with Line 2
- [ ] CHK-017 Empty Sidebar: `+ New Session` button renders when `sessions.length === 0`
- [ ] CHK-018 Dropdown Opens with Action: Session/window dropdowns render action item + divider + selection list

## Edge Cases & Error Handling

- [ ] CHK-019 No Sessions, Dropdown: Session dropdown still functions when no sessions exist (empty list, action item still clickable)
- [ ] CHK-020 Single Window: Window dropdown action works when session has only one window

## Code Quality

- [ ] CHK-021 Pattern consistency: New code follows naming and structural patterns of surrounding code
- [ ] CHK-022 No unnecessary duplication: Existing utilities reused where applicable
- [ ] CHK-023 Readability: FixedWidthToggle placement in Line 1 JSX is clear, not buried
- [ ] CHK-024 Type narrowing: No `as` casts introduced — use proper TypeScript guards
- [ ] CHK-025 No duplicated utilities: `BreadcrumbDropdown` action prop reuses existing dropdown patterns
- [ ] CHK-026 No magic strings: Action labels defined clearly, not scattered

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
