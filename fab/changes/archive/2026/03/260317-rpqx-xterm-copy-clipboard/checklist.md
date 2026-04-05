# Quality Checklist: Fix xterm Terminal Copy to Clipboard

**Change**: 260317-rpqx-xterm-copy-clipboard
**Generated**: 2026-03-17
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Clipboard copy with fallback: Cmd+C/Ctrl+C copies selected text to clipboard in both secure and non-secure contexts
- [x] CHK-002 Fallback implementation: `document.execCommand('copy')` with temporary textarea works when Clipboard API unavailable

## Behavioral Correctness
- [x] CHK-003 SIGINT passthrough: Ctrl+C without selection still sends SIGINT to terminal
- [x] CHK-004 Selection cleared: Terminal selection is cleared after copy attempt

## Scenario Coverage
- [x] CHK-005 Secure context copy: Verify `navigator.clipboard.writeText()` path works on HTTPS/localhost
- [x] CHK-006 Non-secure context copy: Verify fallback path works on plain HTTP
- [x] CHK-007 No selection SIGINT: Verify Ctrl+C without selection passes through to xterm
- [x] CHK-008 Both mechanisms fail: Verify silent failure, no error thrown, selection still cleared

## Edge Cases & Error Handling
- [x] CHK-009 Textarea cleanup: Temporary textarea is removed from DOM even if `execCommand` fails
- [x] CHK-010 Empty selection: Handler correctly detects `hasSelection()` and doesn't attempt copy on empty selection

## Code Quality
- [x] CHK-011 Pattern consistency: New code follows existing `terminal-client.tsx` patterns (async/void, error handling style)
- [x] CHK-012 No unnecessary duplication: Clipboard logic consolidated in a single helper function
- [x] CHK-013 Type narrowing: No `as` casts — proper type guards used
- [x] CHK-014 No shell string construction: N/A for frontend-only change

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
