# Quality Checklist: Session and Window Color Tinting

**Change**: 260416-jn4h-session-window-color-tinting
**Generated**: 2026-04-16
**Spec**: `spec.md`

## Functional Completeness

- [ ] CHK-001 Session color persistence: `run-kit.yaml` with `session_color` is read by `FetchSessions()` and value appears in SSE stream as `sessionColor`
- [ ] CHK-002 Window color storage: `#{@color}` tmux user option is read by `ListWindows()` and appears in SSE stream as `color`
- [ ] CHK-003 Set window color endpoint: `POST /api/sessions/:session/windows/:index/color` sets `@color` via tmux
- [ ] CHK-004 Clear window color endpoint: same endpoint with `null` clears `@color` via `set-option -wu`
- [ ] CHK-005 Set session color endpoint: `POST /api/sessions/:session/color` writes `session_color` to `run-kit.yaml`
- [ ] CHK-006 Clear session color endpoint: same endpoint with `null` removes `session_color` from `run-kit.yaml`
- [ ] CHK-007 Pre-blended row tint: colored rows use `blendHex()` at 12% base / 18% hover / 22% selected
- [ ] CHK-008 13-color picker: swatch popover shows indices 1-6, 8-14 (excludes 0, 7, 15)
- [ ] CHK-009 Activity dot shape-based: filled circle = active, hollow ring = idle, always `text-secondary`
- [ ] CHK-010 Command palette actions: "Session: Set Color" and "Window: Set Color" registered
- [ ] CHK-011 Hover indicator: color swatch icon appears on hover for both session and window rows
- [ ] CHK-012 Frontend types: `ProjectSession.sessionColor` and `WindowInfo.color` fields added

## Behavioral Correctness

- [ ] CHK-013 Selected colored row: uses 22% blend background + full-saturation ANSI left border (replaces `bg-accent/10`)
- [ ] CHK-014 Hover colored row: uses 18% blend background (replaces existing hover bg)
- [ ] CHK-015 Uncolored rows: existing styling unchanged (no regression)

## Scenario Coverage

- [ ] CHK-016 Session with no `run-kit.yaml`: no error, sessionColor omitted
- [ ] CHK-017 Window with no `@color`: color field omitted, row renders normally
- [ ] CHK-018 Invalid color value (out of range): 400 error from API
- [ ] CHK-019 Clear color then verify: row returns to default styling after clear
- [ ] CHK-020 Theme switch with colors: swatch popover and row tints update live

## Edge Cases & Error Handling

- [ ] CHK-021 `run-kit.yaml` exists but malformed: no crash, sessionColor omitted
- [ ] CHK-022 `run-kit.yaml` write to read-only directory: error returned to client
- [ ] CHK-023 Swatch popover dismiss: Escape and outside-click close without action
- [ ] CHK-024 Concurrent SSE clients: color changes propagated to all connected tabs

## Code Quality

- [ ] CHK-025 Pattern consistency: new endpoints follow existing handler structure (validate → execute → writeJSON)
- [ ] CHK-026 No unnecessary duplication: reuses `blendHex()`, `validate.ValidateName()`, existing tmux command patterns
- [ ] CHK-027 All subprocess calls use `exec.CommandContext` with timeout
- [ ] CHK-028 No shell string construction for tmux commands — argument slices only
- [ ] CHK-029 No inline tmux command construction — all through `internal/tmux/`
- [ ] CHK-030 New keyboard action registered in command palette
- [ ] CHK-031 No polling from client — color changes flow through existing SSE stream

## Security

- [ ] CHK-032 Session name validated via `validate.ValidateName()` before tmux commands
- [ ] CHK-033 Window index validated as non-negative integer
- [ ] CHK-034 Color value validated as integer 0-15 (rejects out-of-range, non-integer)

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
