# Quality Checklist: Ctrl+Click Force Kill Window

**Change**: 260403-d3i1-ctrl-click-force-kill-window
**Generated**: 2026-04-03
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 Window kill button Ctrl+Click bypass: Ctrl/Cmd+clicking window × calls `killWindowApi` directly without confirmation dialog
- [x] CHK-002 Session kill button Ctrl+Click bypass: Ctrl/Cmd+clicking session × calls `killSessionApi` directly without confirmation dialog
- [x] CHK-003 No backend changes: Kill API endpoints are unmodified
- [x] CHK-004 No top bar changes: `ClosePaneButton` is unmodified

## Behavioral Correctness

- [x] CHK-005 Normal click preserved (window): Clicking window × without modifier still shows confirmation dialog
- [x] CHK-006 Normal click preserved (session): Clicking session × without modifier still shows confirmation dialog

## Scenario Coverage

- [x] CHK-007 Ctrl+Click kills window immediately: Verify no dialog appears and kill API is invoked
- [x] CHK-008 Ctrl+Click kills session immediately: Verify no dialog appears and kill API is invoked
- [x] CHK-009 Normal click shows confirmation: Verify dialog appears for both session and window × buttons

## Edge Cases & Error Handling

- [x] CHK-010 Best-effort error handling: Force kill uses `.catch(() => {})` — API errors don't surface to user (SSE reflects actual state)
- [x] CHK-011 Event propagation: Window × Ctrl+Click does not trigger window selection (parent button click)

## Code Quality

- [x] CHK-012 Pattern consistency: Modifier detection uses `e.ctrlKey || e.metaKey` matching ThemeToggle pattern
- [x] CHK-013 No unnecessary duplication: Reuses existing `killWindowApi` and `killSessionApi` imports

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
