# Quality Checklist: Fix Dashboard and Dropdown Scrollability

**Change**: 260404-xmrw-fix-dashboard-dropdown-scroll
**Generated**: 2026-04-04
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Dashboard root has `min-h-0`: `dashboard.tsx` root div className includes `min-h-0` alongside `flex-1 flex flex-col`
- [ ] CHK-002 BreadcrumbDropdown menu has height cap: menu container className includes `max-h-60` and `overflow-y-auto`

## Behavioral Correctness

- [ ] CHK-003 Dashboard scrolls with many sessions: card area scrolls vertically (not page overflow) when card grid exceeds viewport height
- [ ] CHK-004 Dropdown caps at 240px: BreadcrumbDropdown does not grow beyond `max-h-60` (240px) when items exceed visible limit

## Scenario Coverage

- [ ] CHK-005 Dashboard root className test passes: `dashboard.test.tsx` asserts root element contains `min-h-0`
- [ ] CHK-006 Dropdown menu scroll classes test passes: `breadcrumb-dropdown.test.tsx` asserts open menu contains `overflow-y-auto` and `max-h-60`
- [ ] CHK-007 Dropdown with few items still works: Dropdown with 3 items opens and shows all items normally (no regression)

## Edge Cases & Error Handling

- [ ] CHK-008 Dropdown empty state: BreadcrumbDropdown with 0 items renders menu without errors
- [ ] CHK-009 Dashboard empty state: Dashboard with 0 sessions renders without errors (existing empty state test still passes)

## Code Quality

- [ ] CHK-010 Pattern consistency: `min-h-0` placement is consistent with other `flex-1 flex flex-col` containers in the codebase (`app.tsx` patterns)
- [ ] CHK-011 Pattern consistency: `max-h-60 overflow-y-auto` on dropdown is consistent with `command-palette.tsx` and `create-session-dialog.tsx` patterns
- [ ] CHK-012 No unnecessary duplication: No new utilities or abstractions introduced — changes are direct Tailwind class additions
- [ ] CHK-013 All frontend tests pass: `just test-frontend` exits 0
- [ ] CHK-014 TypeScript clean: `npx tsc --noEmit` exits 0

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-xxx **N/A**: {reason}`
