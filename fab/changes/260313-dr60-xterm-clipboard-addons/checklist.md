# Quality Checklist: xterm Clipboard & Addons

**Change**: 260313-dr60-xterm-clipboard-addons
**Generated**: 2026-03-13
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Clipboard copy: `attachCustomKeyEventHandler` intercepts Cmd+C/Ctrl+C and copies when text selected
- [x] CHK-002 SIGINT passthrough: Cmd+C/Ctrl+C without selection sends SIGINT normally
- [x] CHK-003 ClipboardAddon: `@xterm/addon-clipboard` loaded via dynamic import in init()
- [x] CHK-004 WebLinksAddon: `@xterm/addon-web-links` loaded via dynamic import in init()
- [x] CHK-005 WebglAddon: `@xterm/addon-webgl` loaded with try/catch silent fallback

## Behavioral Correctness
- [x] CHK-006 Key handler only intercepts keydown events — keyup passes through
- [x] CHK-007 All other key combinations pass through unchanged (return true)
- [x] CHK-008 WebGL failure does not log errors or show user-visible messages

## Scenario Coverage
- [x] CHK-009 Copy selected text scenario: selected text → clipboard write → no SIGINT
- [x] CHK-010 SIGINT scenario: no selection → normal SIGINT behavior
- [x] CHK-011 WebGL fallback scenario: canvas renderer continues on WebGL failure

## Edge Cases & Error Handling
- [x] CHK-012 WebGL context creation failure caught silently
- [x] CHK-013 navigator.clipboard.writeText works in secure context (localhost)

## Code Quality
- [x] CHK-014 Pattern consistency: dynamic imports match existing FitAddon pattern
- [x] CHK-015 No unnecessary duplication: addons loaded in single init() function
- [x] CHK-016 Addon loading order: FitAddon → fit() → ClipboardAddon → WebLinksAddon → WebglAddon (last)
- [x] CHK-017 No shell string construction or exec calls (constitution: security-first)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
