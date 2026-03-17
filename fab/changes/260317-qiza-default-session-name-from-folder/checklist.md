# Quality Checklist: Default Session Name from Folder Path

**Change**: 260317-qiza-default-session-name-from-folder
**Generated**: 2026-03-17
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Name derivation fallback: `handleCreate()` derives name from path when name field is empty
- [x] CHK-002 Create button enablement: Button enabled when path is non-empty and name is empty
- [x] CHK-003 Collision check on derived name: `handleCreate()` checks `existingNames.has()` on derived value

## Behavioral Correctness
- [x] CHK-004 Existing dropdown selection flow unchanged: `selectPath()` still auto-populates name
- [x] CHK-005 Explicit name takes priority: Typed name is used even when path is also set

## Scenario Coverage
- [x] CHK-006 Path typed manually, name empty → session created with derived name
- [x] CHK-007 Both fields empty → Create button disabled
- [x] CHK-008 Derived name collides → creation aborted with error message

## Edge Cases & Error Handling
- [x] CHK-009 Path with trailing slashes: `deriveNameFromPath` handles stripping (existing behavior)
- [x] CHK-010 Path is just `/` or `~` → derived name is empty → creation does not proceed

## Code Quality
- [x] CHK-011 Pattern consistency: New code follows existing patterns in `create-session-dialog.tsx`
- [x] CHK-012 No unnecessary duplication: Reuses existing `deriveNameFromPath()` and `existingNames`

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
