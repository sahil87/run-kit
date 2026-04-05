# Quality Checklist: Copy tmux Attach Command

**Change**: 260327-k4l2-copy-tmux-attach-command
**Generated**: 2026-03-27
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Palette action registered: "Copy: tmux Attach Command" action exists with ID `copy-tmux-attach`
- [x] CHK-002 Clipboard copy: Selecting the action copies `tmux attach-session -t {session}:{window}` to clipboard
- [x] CHK-003 Conditional visibility: Action only appears when `currentWindow` is available

## Scenario Coverage
- [x] CHK-004 Terminal route: Action visible in palette when on `/$server/$session/$window`
- [x] CHK-005 Dashboard route: Action hidden when on `/$server` (no window selected)
- [x] CHK-006 Correct command format: Copied string uses session name and window name from route

## Edge Cases & Error Handling
- [x] CHK-007 Clipboard API failure: Error silently caught via `.catch(() => {})`
- [x] CHK-008 No visual feedback: No toast or notification after copy

## Code Quality
- [x] CHK-009 Pattern consistency: Action follows existing palette action structure (ID, label, onSelect, conditional block)
- [x] CHK-010 No unnecessary duplication: Uses existing `sessionName` and `currentWindow` variables

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
