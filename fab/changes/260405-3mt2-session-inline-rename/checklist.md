# Quality Checklist: Session Name Inline Rename

**Change**: 260405-3mt2-session-inline-rename
**Generated**: 2026-04-05
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Double-click activates inline edit: double-clicking a session name span shows `<input aria-label="Rename session">` pre-populated with the current name
- [ ] CHK-002 Enter commits rename: pressing Enter with a changed, non-empty name calls `renameSession` and dismisses the input
- [ ] CHK-003 Escape cancels rename: pressing Escape dismisses the input without calling `renameSession`
- [ ] CHK-004 Blur commits rename: input losing focus calls `renameSession` (same rules as Enter — non-empty and changed)
- [ ] CHK-005 Optimistic update: session name updates immediately in the UI before API response; reverts and shows toast on failure
- [ ] CHK-006 Cross-cancellation: only one inline edit active at a time — starting any edit cancels any other without committing

## Behavioral Correctness

- [ ] CHK-007 Single-click still navigates: single-clicking the session name calls `onSelectWindow` and does NOT open a rename input
- [ ] CHK-008 Input click does not navigate: clicking inside the rename input does not trigger `onSelectWindow`
- [ ] CHK-009 Empty input skips API: Enter/blur with an empty (or whitespace-only) value dismisses without calling `renameSession`
- [ ] CHK-010 Unchanged name skips API: Enter/blur with the same name as the original does not call `renameSession`

## Scenario Coverage

- [ ] CHK-011 Scenario "Double-click session B cancels session A": starting edit on session B while editing session A dismisses A without committing; B's input shows B's current name
- [ ] CHK-012 Scenario "Starting window edit cancels active session edit": double-clicking a window name while editing a session name dismisses the session input without calling `renameSession`
- [ ] CHK-013 Scenario "Starting session edit cancels active window edit": double-clicking a session name while editing a window name dismisses the window input without calling `renameWindow`

## Edge Cases & Error Handling

- [ ] CHK-014 API failure rolls back: when `renameSession` rejects, the optimistic name is reverted and a toast is shown
- [ ] CHK-015 Ghost sessions: double-click on ghost (optimistic) session does not break (ghost sessions have `optimistic: true`; no crash, graceful no-op if click reaches handler)

## Code Quality

- [ ] CHK-016 Pattern consistency: session rename code mirrors window rename code in structure (same state shape, same ref pattern, same handler names with `Session` infix), no structural divergence
- [ ] CHK-017 No unnecessary duplication: `executeRenameSession` uses the same `useOptimisticAction` hook and `markRenamed`/`unmarkRenamed` pattern already used for windows — no reinvented logic
- [ ] CHK-018 No god functions: handlers remain under 15 lines each; no logic inlined into JSX beyond what windows already do
- [ ] CHK-019 No type assertions: no `as` casts introduced; `editingSession` typed as `string | null` (matching `editingWindow` shape equivalently)
- [ ] CHK-020 Tests colocated: new tests added to `app/frontend/src/components/sidebar.test.tsx` alongside existing window rename tests

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-001 **N/A**: {reason}`
