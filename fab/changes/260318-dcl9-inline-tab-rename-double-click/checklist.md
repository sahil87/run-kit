# Quality Checklist: Inline Tab Rename on Double-Click

**Change**: 260318-dcl9-inline-tab-rename-double-click
**Generated**: 2026-03-18
**Spec**: `spec.md`

## Functional Completeness
- [x] CHK-001 Double-click activates inline editing: Window name span replaced with focused input on double-click
- [x] CHK-002 Enter commits rename: Pressing Enter calls `renameWindow` API and dismisses input
- [x] CHK-003 Blur commits rename: Clicking away calls `renameWindow` API and dismisses input
- [x] CHK-004 Escape cancels editing: Pressing Escape dismisses input without API call, restores original name
- [x] CHK-005 Empty input cancels: Empty or whitespace-only input treated as cancel on both Enter and blur
- [x] CHK-006 Unchanged name skips API call: No `renameWindow` call when submitted name equals original
- [x] CHK-007 Text auto-selected on activation: Input text is fully selected when editing starts
- [x] CHK-008 Editing state is local to Sidebar: Uses `useState` within Sidebar component, no cross-component state
- [x] CHK-009 Existing rename dialog unchanged: Command palette rename action still works independently

## Behavioral Correctness
- [x] CHK-010 Single-click still navigates: `onSelectWindow` fires on single-click, no edit triggered
- [x] CHK-011 Only one edit at a time: Double-clicking a second window cancels the first edit

## Scenario Coverage
- [x] CHK-012 Double-click to edit scenario: Test or manual verification of double-click → input activation
- [x] CHK-013 Commit via Enter scenario: Test verifies Enter keydown triggers rename API call
- [x] CHK-014 Commit via blur scenario: Test verifies blur triggers rename API call
- [x] CHK-015 Cancel via Escape scenario: Test verifies Escape dismisses without API call
- [x] CHK-016 Empty input scenario: Test verifies empty input on Enter/blur cancels

## Edge Cases & Error Handling
- [x] CHK-017 Whitespace-only input treated as empty: Trimmed empty string cancels rename
- [x] CHK-018 API error on rename: Editing dismisses gracefully even if `renameWindow` throws (SSE reflects actual state)

## Code Quality
- [x] CHK-019 Pattern consistency: Inline edit follows existing Sidebar patterns (state hooks, event handlers, Tailwind classes)
- [x] CHK-020 No unnecessary duplication: Uses existing `renameWindow` from `api/client.ts`, no duplicated API logic
- [x] CHK-021 No magic strings: Event keys use string constants (`Enter`, `Escape`)
- [x] CHK-022 Type narrowing over assertions: Editing state typed as discriminated union, no `as` casts

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`
