# Quality Checklist: Feature Tests for tmux, Keyboard Nav, and Sessions API

**Change**: 260305-vq7h-feature-tests-tmux-keyboard-api
**Generated**: 2026-03-05
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 listSessions parse: Test covers standard session parsing from tab-delimited output
- [ ] CHK-002 listSessions filter: Test covers session-group copy filtering (grouped=1, name!=group excluded)
- [ ] CHK-003 listSessions keep group-named: Test covers group-named session retention (grouped=1, name===group)
- [ ] CHK-004 listSessions error: Test covers tmux-not-running returning []
- [ ] CHK-005 listWindows active: Test covers active window activity computation within threshold
- [ ] CHK-006 listWindows idle: Test covers idle window activity computation beyond threshold
- [ ] CHK-007 listWindows fields: Test covers full field parsing (index, name, worktreePath, activity)
- [ ] CHK-008 listWindows error: Test covers session-not-found returning []
- [ ] CHK-009 j/k navigation: Test covers j increment, k decrement, clamping at bounds
- [ ] CHK-010 Enter select: Test covers Enter calling onSelect with focusedIndex
- [ ] CHK-011 Input skip: Test covers ignoring keys in input/textarea/contentEditable
- [ ] CHK-012 itemCount clamp: Test covers focusedIndex clamping when itemCount decreases
- [ ] CHK-013 Custom shortcuts: Test covers shortcuts map invocation on key press
- [ ] CHK-014 createSession valid/invalid: Tests cover valid name and empty/forbidden char rejection
- [ ] CHK-015 createWindow valid/invalid: Tests cover valid params and missing field rejection
- [ ] CHK-016 killSession valid: Test covers valid session name dispatch
- [ ] CHK-017 killWindow valid/invalid: Tests cover valid dispatch and non-integer index rejection
- [ ] CHK-018 sendKeys valid/invalid: Tests cover valid dispatch and empty keys rejection
- [ ] CHK-019 Unknown/missing action: Tests cover unknown action 400 and missing action field 400
- [ ] CHK-020 tmux error 500: Test covers tmux function throwing producing 500 response

## Scenario Coverage

- [ ] CHK-021 All GIVEN/WHEN/THEN scenarios from spec have corresponding test cases
- [ ] CHK-022 Each test file exercises both success and error paths

## Code Quality

- [ ] CHK-023 Pattern consistency: Test files follow naming/structural patterns of existing tests (validate.test.ts, config.test.ts)
- [ ] CHK-024 No unnecessary duplication: Shared mock setup factored where appropriate
- [ ] CHK-025 execFile mocking: tmux.ts tests mock child_process.execFile, not tmux functions directly
- [ ] CHK-026 tmux module mocking: Route tests mock @/lib/tmux, not child_process.execFile
- [ ] CHK-027 No magic strings: Constants like ACTIVITY_THRESHOLD_SECONDS imported from source, not hardcoded

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
