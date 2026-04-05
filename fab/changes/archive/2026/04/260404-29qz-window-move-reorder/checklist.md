# Quality Checklist: Window Move & Reorder

**Change**: 260404-29qz-window-move-reorder
**Generated**: 2026-04-04
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 SwapWindow function: `tmux.SwapWindow` exists, calls `swap-window -s -t` with correct target format, uses `withTimeout()` and `serverArgs`
- [x] CHK-002 TmuxOps interface: `SwapWindow` added to interface and `prodTmuxOps` implementation delegates to `tmux.SwapWindow`
- [x] CHK-003 Move endpoint: `POST /api/sessions/{session}/windows/{index}/move` registered in router, handler validates inputs and calls `SwapWindow`
- [x] CHK-004 API client: `moveWindow` exported from `client.ts`, POSTs with `{ targetIndex }` body and `withServer()`
- [x] CHK-005 CmdK Move Left: action present when `currentWindow` exists and not at min index, calls `moveWindow` with `index - 1`
- [x] CHK-006 CmdK Move Right: action present when `currentWindow` exists and not at max index, calls `moveWindow` with `index + 1`
- [x] CHK-007 Navigation after CmdK move: browser navigates to `/${server}/${session}/${targetIndex}` after successful move
- [x] CHK-008 Sidebar drag: window items are `draggable`, `onDragStart` sets JSON `{session, index}`
- [x] CHK-009 Drop indicators: 2px accent line shown for same-session targets, no indicator for cross-session
- [x] CHK-010 Drop handler: parses drag data, calls `moveWindow`, navigates to target index, no-op on same position
- [x] CHK-011 Drag cleanup: all visual state cleared on `onDragEnd` and `onDrop`

## Behavioral Correctness

- [x] CHK-012 Swap semantics: only two window indices change position (not insert-and-renumber)
- [x] CHK-013 Boundary exclusion: Move Left hidden at min index, Move Right hidden at max index

## Scenario Coverage

- [x] CHK-014 Swap adjacent windows: verified via test
- [x] CHK-015 Swap with non-existent index: returns error
- [x] CHK-016 Move left from non-leftmost: succeeds and navigates
- [x] CHK-017 Move right from non-rightmost: succeeds and navigates
- [x] CHK-018 Drop on same position: no API call
- [x] CHK-019 Drag over different session: no drop indicator shown
- [x] CHK-020 Drag cancelled: visual state cleaned up

## Edge Cases & Error Handling

- [x] CHK-021 Invalid JSON body on move endpoint: returns 400
- [x] CHK-022 Negative targetIndex: returns 400
- [x] CHK-023 Invalid session name: returns 400 with validation message
- [x] CHK-024 tmux swap-window failure: error propagated to HTTP 500 response

## Code Quality

- [x] CHK-025 Pattern consistency: handler follows existing window handler pattern (ValidateName, parseWindowIndex, serverFromRequest)
- [x] CHK-026 No unnecessary duplication: reuses `tmuxExecServer`, `withTimeout`, `serverArgs` from tmux package
- [x] CHK-027 No shell string construction: all subprocess calls use `exec.CommandContext` with argument slices
- [x] CHK-028 No inline tmux commands: all tmux interaction through `internal/tmux/`
- [x] CHK-029 No polling from client: relies on SSE stream for state refresh after move
- [x] CHK-030 New CmdK actions registered in command palette action list

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
