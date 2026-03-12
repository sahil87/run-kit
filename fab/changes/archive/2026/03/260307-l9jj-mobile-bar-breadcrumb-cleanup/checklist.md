# Quality Checklist: Mobile Bottom Bar & Breadcrumb Cleanup

**Change**: 260307-l9jj-mobile-bar-breadcrumb-cleanup
**Generated**: 2026-03-07
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 Combined popup: F▴ button opens single popup with F1-F12 (4-col) + divider + PgUp/PgDn/Home/End/Ins/Del (3-col)
- [ ] CHK-002 Upload in compose: Paperclip button exists in compose buffer action row, left of Send
- [ ] CHK-003 Keyboard dismiss: ⌄ button exists in bottom bar, calls blur() on click
- [ ] CHK-004 Icon triggers dropdown: Breadcrumb icons (⬡, ❯) serve as dropdown toggle buttons

## Behavioral Correctness
- [ ] CHK-005 Extended keys still send correct escape sequences from combined popup (with modifier support)
- [ ] CHK-006 Upload file picker still triggers and passes FileList to onUploadFiles from compose buffer
- [ ] CHK-007 Breadcrumb dropdown keyboard navigation (ArrowUp/Down, Escape) still works with icon trigger
- [ ] CHK-008 Breadcrumb dropdown outside-click dismiss still works

## Removal Verification
- [ ] CHK-009 No ⋯ button or "Extended keys" aria-label in bottom-bar.tsx
- [ ] CHK-010 No 📎 button or file input in bottom-bar.tsx, no onUploadFiles in BottomBarProps
- [ ] CHK-011 No ▾ character rendered in breadcrumb-dropdown.tsx
- [ ] CHK-012 No passive icon `<span aria-hidden="true">` for crumb.icon in top-bar-chrome.tsx (icon now inside BreadcrumbDropdown)

## Scenario Coverage
- [ ] CHK-013 Combined popup opens and closes correctly (click, outside-click, Escape)
- [ ] CHK-014 Upload from compose buffer appends paths to textarea via initialText
- [ ] CHK-015 Bottom bar has exactly 9 interactive elements in correct order

## Edge Cases & Error Handling
- [ ] CHK-016 Breadcrumbs without dropdownItems still render correctly (no icon button when no dropdown)
- [ ] CHK-017 Compose buffer upload works when compose is already open with existing text

## Code Quality
- [ ] CHK-018 Pattern consistency: New code follows KBD_CLASS, existing dropdown popup patterns, and component prop conventions
- [ ] CHK-019 No unnecessary duplication: Reuses sendWithMods for extended keys, existing compose buffer initialText mechanism for upload
- [ ] CHK-020 No exec() or shell string commands (constitution compliance)
- [ ] CHK-021 Server Components by default — no unnecessary Client Component additions

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
