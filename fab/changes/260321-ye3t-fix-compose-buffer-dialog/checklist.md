# Quality Checklist: Fix Compose Buffer Dialog

**Change**: 260321-ye3t-fix-compose-buffer-dialog
**Generated**: 2026-03-21
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 Upload hook returns `{ path, file }[]` tuples instead of `string[]`
- [x] CHK-002 Terminal client threads file metadata to compose buffer props
- [x] CHK-003 Image thumbnails render above textarea using blob URLs
- [x] CHK-004 Non-image files show filename text in preview strip
- [x] CHK-005 X button on each preview item removes file and path
- [x] CHK-006 Click thumbnail toggles larger preview
- [x] CHK-007 Blob URLs revoked on dialog close
- [x] CHK-008 Textarea uses imperative ref only (no `defaultValue`)
- [x] CHK-009 Dialog uses `fixed inset-0 z-40` with separate backdrop
- [x] CHK-010 ARIA attributes: `role="dialog"`, `aria-modal`, `aria-labelledby`
- [x] CHK-011 Focus trap cycles Tab/Shift+Tab within dialog
- [x] CHK-012 Click-outside close uses two-layer pattern

## Behavioral Correctness

- [x] CHK-013 Path text appears exactly once in textarea on initial open (duplication fix verified)
- [x] CHK-014 Additional uploads append new paths without duplicating existing ones
- [x] CHK-015 Removing a preview item updates textarea to match remaining files

## Scenario Coverage

- [x] CHK-016 Single image paste: preview thumbnail shown, path in textarea, send works
- [x] CHK-017 Multiple file drop: all thumbnails shown, all paths in textarea
- [x] CHK-018 Paperclip upload while compose is open: new file appended correctly
- [x] CHK-019 Mixed image/non-image upload: images get thumbnails, non-images get filename text

## Edge Cases & Error Handling

- [x] CHK-020 Zero files uploaded: compose opens with empty textarea, no preview strip
- [x] CHK-021 Failed upload excluded from results (no broken preview/path)
- [x] CHK-022 Dialog close via Escape revokes blob URLs same as close button

## Code Quality

- [x] CHK-023 Pattern consistency: compose buffer structure matches dialog.tsx pattern
- [x] CHK-024 No unnecessary duplication: reuses existing patterns (dialog ARIA, focus trap logic)
- [x] CHK-025 **N/A** No `exec()` or shell string construction (frontend-only change)
- [x] CHK-026 Type narrowing preferred over type assertions

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
