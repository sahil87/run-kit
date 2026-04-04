# Quality Checklist: Move Window Between Sessions

**Change**: 260404-dq70-move-window-between-sessions
**Generated**: 2026-04-04
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 MoveWindowToSession: tmux function exists and wraps `move-window -s {src}:{idx} -t {dst}:`
- [x] CHK-002 API endpoint: `POST .../move-to-session` registered and returns `200 {"ok": true}` on valid input
- [x] CHK-003 Client function: `moveWindowToSession()` exported from `api/client.ts` and calls correct endpoint
- [x] CHK-004 CmdK actions: "Window: Move to {name}" actions appear for each other session
- [x] CHK-005 Drag-and-drop: Session header accepts cross-session window drops

## Behavioral Correctness
- [x] CHK-006 Same-session rejection: API returns 400 when targetSession equals source session
- [x] CHK-007 Missing targetSession: API returns 400 with descriptive error
- [x] CHK-008 Invalid session name: API validates targetSession via `validate.ValidateName`
- [x] CHK-009 Navigation after move: Both CmdK and drag-and-drop navigate to `/$server` (server dashboard)
- [x] CHK-010 Existing within-session drag-and-drop: Same-session window swap still works unchanged

## Scenario Coverage
- [x] CHK-011 Two sessions: exactly one "Move to" action in CmdK
- [x] CHK-012 Three sessions: two "Move to" actions in CmdK
- [x] CHK-013 Single session: no "Move to" actions in CmdK
- [x] CHK-014 No window selected (dashboard): no "Move to" actions in CmdK
- [x] CHK-015 Cross-session drag to session header triggers move
- [x] CHK-016 Drag to same session header shows no drop indicator

## Edge Cases & Error Handling
- [x] CHK-017 Source window does not exist: API returns tmux error (500)
- [x] CHK-018 Destination session does not exist: API returns tmux error (500)
- [x] CHK-019 API client handles error responses (`.catch(() => {})` pattern)

## Code Quality
- [x] CHK-020 Pattern consistency: Handler follows existing `handleWindowMove` structure (validate, decode, call tmux, write JSON)
- [x] CHK-021 No unnecessary duplication: Uses existing `validate.ValidateName`, `parseWindowIndex`, `serverFromRequest`, `withServer()`
- [x] CHK-022 Go subprocess: Uses `exec.CommandContext` via `tmuxExecServer` with timeout — no shell strings
- [x] CHK-023 No inline tmux commands: All tmux interaction through `internal/tmux/`
- [x] CHK-024 New feature includes tests covering added behavior

## Security
- [x] CHK-025 Session name validation: Both source and target session names validated before reaching tmux subprocess
- [x] CHK-026 No shell injection: `MoveWindowToSession` uses argument slices via `tmuxExecServer`, never shell strings

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
