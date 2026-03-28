# Quality Checklist: Tmux Commands Dialog

**Change**: 260328-6xey-tmux-commands-dialog
**Generated**: 2026-03-28
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Dialog component: `TmuxCommandsDialog` renders inside `Dialog` with title "tmux commands"
- [x] CHK-002 Three command rows: Attach, New window, Detach — each with label, code block, copy button
- [x] CHK-003 Server-aware commands: `-L {server}` present for named servers, omitted for `"default"`
- [x] CHK-004 Copy to clipboard: each copy button writes the correct command via `navigator.clipboard.writeText`
- [x] CHK-005 Copy feedback: icon swaps to checkmark for ~1.5s after successful copy
- [x] CHK-006 Command palette action: label is "Copy: tmux Commands", opens dialog instead of direct copy

## Behavioral Correctness
- [x] CHK-007 Attach command targets `{session}:{window}`, new-window and detach target `{session}` only
- [x] CHK-008 Dialog only available when `currentWindow` exists (terminal pages only)
- [x] CHK-009 Dialog close: Escape and backdrop click both close the dialog

## Scenario Coverage
- [x] CHK-010 Named server scenario: commands include `-L runkit` flag
- [x] CHK-011 Default server scenario: commands omit `-L` flag entirely
- [x] CHK-012 Clipboard unavailable scenario: no error thrown, no feedback shown

## Edge Cases & Error Handling
- [x] CHK-013 Copy feedback timer cleanup: no setState-after-unmount if dialog closes during feedback timeout
- [x] CHK-014 Dialog state added to `dialogOpenRef` check (prevents activeWindow effect conflicts)

## Code Quality
- [x] CHK-015 Pattern consistency: component follows existing dialog patterns (`dialog.tsx`, server create/kill dialogs)
- [x] CHK-016 No unnecessary duplication: reuses `Dialog` component, no reimplemented modal logic
- [x] CHK-017 No magic strings: command templates use interpolated variables, not hardcoded session/window names
- [x] CHK-018 Type narrowing over assertions: props typed explicitly, no `as` casts

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
