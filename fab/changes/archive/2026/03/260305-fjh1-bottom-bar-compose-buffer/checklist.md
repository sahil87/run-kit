# Quality Checklist: Bottom Bar + Compose Buffer

**Change**: 260305-fjh1-bottom-bar-compose-buffer
**Generated**: 2026-03-06
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 Bottom bar rendering: All button groups present (modifiers, arrows, Fn, Esc, Tab, compose) in correct order
- [x] CHK-002 Modifier toggles: Ctrl/Alt/Cmd arm on tap, show visual armed state, auto-clear after key send
- [x] CHK-003 Arrow keys: Each sends correct ANSI sequence, respects armed modifiers with xterm parameter encoding
- [x] CHK-004 Function key dropdown: Opens on Fn tap, contains F1-F12/PgUp/PgDn/Home/End, closes after selection
- [x] CHK-005 Special keys: Esc sends `\x1b`, Tab sends `\t`, both respect armed modifiers — Ctrl re-armed after Esc/Tab since terminal semantics treat them as already-Ctrl characters
- [x] CHK-006 Compose buffer: Opens on compose tap, textarea with autoFocus, Send transmits as single WebSocket message
- [x] CHK-007 Visual viewport: Hook constrains height when iOS keyboard appears, no-op on desktop
- [x] CHK-008 Terminal integration: setBottomBar called on mount, cleared on unmount

## Behavioral Correctness

- [x] CHK-009 Modifier consume atomicity: `consume()` returns all armed modifiers and clears them in one call
- [x] CHK-010 Multiple modifiers: Arming Ctrl then Alt results in both being applied to next key
- [x] CHK-011 Compose send: Text sent as raw string (not JSON), relay writes to pty in one call
- [x] CHK-012 Compose dismiss: Escape closes compose without sending, text discarded

## Scenario Coverage

- [x] CHK-013 Bottom bar absent on Dashboard/Project pages: No bottom bar content when not on terminal page
- [x] CHK-014 Desktop `i` key toggle: Opens compose when terminal focused, doesn't fire when compose already open or input focused
- [x] CHK-015 Compose Cmd/Ctrl+Enter: Keyboard shortcut sends text and closes compose
- [x] CHK-016 Fn dropdown dismiss: Clicking outside closes dropdown without sending keystrokes

## Edge Cases & Error Handling

- [x] CHK-017 WebSocket closed: Bottom bar buttons are no-op when `wsRef.current` is null or not OPEN
- [x] CHK-018 `i` key vs double-Esc: No conflict — compose Escape consumed before double-Esc timer

## Code Quality

- [x] CHK-019 Pattern consistency: New code follows existing naming and structural patterns (hooks in `src/hooks/`, components in `src/components/`, Client Component directive)
- [x] CHK-020 No unnecessary duplication: Existing utilities reused (ChromeProvider setBottomBar, existing wsRef pattern)
- [x] CHK-021 **N/A**: No subprocess calls in this change — pure client-side code
- [x] CHK-022 Server Components default: Bottom bar and compose buffer are Client Components only because they need interactivity — justified per code-quality principles
- [x] CHK-023 No `useEffect` for data fetching: Data flows from props/context, not effect-based fetching
- [x] CHK-024 Functions focused: No god functions >50 lines without clear reason
- [x] CHK-025 No magic strings: ANSI sequences defined as named constants (`ARROWS`, `FN_KEYS`) and lookup objects

## Security

- [x] CHK-026 No shell injection: All WebSocket sends are raw strings to pty, no subprocess construction from user input

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
