# Quality Checklist: Close Pane Button

**Change**: 260326-tbmj-close-pane-button
**Generated**: 2026-03-27
**Spec**: `spec.md`

## Functional Completeness
- [ ] CHK-001 KillActivePane function: `tmux.KillActivePane` exists in `internal/tmux/tmux.go` and targets `session:window`
- [ ] CHK-002 TmuxOps interface: `KillActivePane` method added to interface and `prodTmuxOps`
- [ ] CHK-003 Close pane endpoint: `POST /api/sessions/{session}/windows/{index}/close-pane` registered and returns `{"ok": true}`
- [ ] CHK-004 API client function: `closePane` exported from `api/client.ts` with correct signature
- [ ] CHK-005 ClosePaneButton component: Renders in top bar after split buttons, before FixedWidthToggle
- [ ] CHK-006 Command palette action: "Pane: Close" listed after "Window: Split Horizontal"

## Behavioral Correctness
- [ ] CHK-007 Button click kills active pane: Clicking the close button calls the API and tmux kills the active pane
- [ ] CHK-008 Last pane behavior: Closing the last pane kills the window; frontend handles redirect via existing logic

## Scenario Coverage
- [ ] CHK-009 Multi-pane close: Split a window, click close pane, verify one pane removed
- [ ] CHK-010 Desktop visibility: Button visible at viewport >= 640px
- [ ] CHK-011 Mobile hidden: Button not visible at viewport < 640px
- [ ] CHK-012 Dashboard route: Button not rendered when no window is selected
- [ ] CHK-013 Invalid input: Bad session name or window index returns 400

## Edge Cases & Error Handling
- [ ] CHK-014 Pane already dead: API call doesn't error (silently ignored)
- [ ] CHK-015 Best-effort error handling: Frontend `.catch(() => {})` — no unhandled promise rejection

## Code Quality
- [ ] CHK-016 Pattern consistency: `ClosePaneButton` follows `SplitButton` styling and structure exactly
- [ ] CHK-017 No unnecessary duplication: Reuses `parseWindowIndex`, `validate.ValidateName`, `serverFromRequest`
- [ ] CHK-018 exec.CommandContext with timeout: `KillActivePane` uses `withTimeout()` context (constitution I)
- [ ] CHK-019 No shell string construction: Target formatted via `fmt.Sprintf` with argument slices (anti-pattern check)

## Security
- [ ] CHK-020 Input validation: Session name validated via `validate.ValidateName`, window index via `parseWindowIndex`
