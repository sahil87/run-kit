# Quality Checklist: Rename Action + Kill Label Cleanup

**Change**: 260307-r3yv-action-buttons-rename-kill
**Generated**: 2026-03-07
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 tmux.ts renameWindow: Function exported, calls `rename-window` with correct `-t session:index name` args
- [x] CHK-002 API renameWindow action: POST handler accepts `renameWindow`, validates all inputs, calls tmux function
- [x] CHK-003 Project page rename dialog: Opens pre-filled with current name, auto-selected, submits via API, closes on success
- [x] CHK-004 Project page rename button: Visible in Line 2 left, disabled when no windows
- [x] CHK-005 Project page rename palette action: "Rename focused window" with shortcut `r`
- [x] CHK-006 Terminal page rename dialog: Same behavior as project page, focus returns to terminal after close
- [x] CHK-007 Terminal page rename button: Visible in Line 2 left alongside kill button
- [x] CHK-008 Terminal page rename palette action: "Rename window" with shortcut `r`
- [x] CHK-009 Terminal kill button label: Shows "Kill" not "Kill Window"
- [x] CHK-010 Terminal kill palette label: Shows "Kill window" not "Kill this window"

## Behavioral Correctness
- [x] CHK-011 Kill button label changed: Terminal page button text is "Kill", no other kill behavior affected
- [x] CHK-012 Rename updates propagate: After rename, SSE pushes updated window name to connected clients

## Scenario Coverage
- [x] CHK-013 Rename via keyboard shortcut `r` on project page opens dialog
- [x] CHK-014 Rename via Cmd+K palette on terminal page opens dialog
- [x] CHK-015 Cancel rename (Escape/backdrop click) closes dialog without API call
- [x] CHK-016 Invalid rename name rejected by API (forbidden characters)

## Edge Cases & Error Handling
- [x] CHK-017 Rename button disabled when project page has zero windows
- [x] CHK-018 Empty name submission prevented (empty string not sent to API)

## Code Quality
- [x] CHK-019 Pattern consistency: `renameWindow` follows same signature pattern as `killWindow(session, index)` in tmux.ts
- [x] CHK-020 No unnecessary duplication: Reuses Dialog component, validateName, existing button styling
- [x] CHK-021 execFile with argument arrays: renameWindow uses tmuxExec (no shell strings)
- [x] CHK-022 No inline tmux commands: All tmux interaction via lib/tmux.ts

## Security
- [x] CHK-023 Input validation: New name validated via `validateName` before reaching tmux subprocess
