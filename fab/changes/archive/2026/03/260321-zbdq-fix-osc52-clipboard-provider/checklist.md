# Quality Checklist: Fix OSC 52 Clipboard Provider

**Change**: 260321-zbdq-fix-osc52-clipboard-provider
**Generated**: 2026-03-21
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Empty selection accepted: ClipboardAddon with custom provider accepts `""` selection and calls `navigator.clipboard.writeText()`
- [x] CHK-002 Explicit clipboard accepted: Custom provider accepts `"c"` selection and calls `navigator.clipboard.writeText()`
- [x] CHK-003 Default base64 preserved: ClipboardAddon receives `undefined` as first arg, built-in base64 handler used

## Behavioral Correctness
- [x] CHK-004 Non-clipboard selections rejected: Custom provider returns early for `"p"`, `"s"`, `"0"`–`"7"` without calling clipboard API

## Scenario Coverage
- [x] CHK-005 Tmux yank scenario: Text yanked in tmux copy mode arrives on system clipboard via OSC 52 with empty selection
- [x] CHK-006 Explicit `c` selection: Programs sending `]52;c;` still work correctly

## Edge Cases & Error Handling
- [x] CHK-007 Clipboard API failure: If `navigator.clipboard.writeText()` rejects, the error does not crash the terminal

## Code Quality
- [x] CHK-008 Pattern consistency: Custom provider follows existing addon loading pattern in `terminal-client.tsx`
- [x] CHK-009 No unnecessary duplication: No duplicate clipboard logic introduced
