# Intake: Inline Tab Rename on Double-Click

**Change**: 260318-dcl9-inline-tab-rename-double-click
**Created**: 2026-03-18
**Status**: Draft

## Origin

> "With multiple tabs always open in Run Kit, it becomes very difficult to understand what is happening. We need an easier mechanism to rename the windows which are open in any session." — followed by clarification: "I am talking about double-click on tab name to rename inline."

One-shot input with one clarification round. The user wants to bypass the command palette → dialog flow and rename tabs directly in the sidebar by double-clicking the window name.

## Why

1. **Discoverability**: The current rename flow requires knowing about the command palette (`Cmd+K` → "Rename current window"). Users with many open tabs need a faster, more intuitive path.
2. **Friction**: Opening a modal dialog to rename a tab is heavyweight — the user must open the palette, find the action, confirm in a dialog. Double-click inline editing is a well-established UX pattern (file managers, browser tabs, IDE tabs) that users expect.
3. **Multi-tab workflows**: When orchestrating multiple agents across many windows, quickly renaming tabs to reflect their purpose (e.g., "auth-refactor", "test-runner") is essential for orientation.

## What Changes

### Sidebar Window Name — Inline Editing (`app/frontend/src/components/sidebar.tsx`)

The window name `<span>` at line 146 (`<span className="truncate">{win.name}</span>`) becomes an inline-editable element on double-click:

- **Double-click** on the window name text → the `<span>` is replaced with a text `<input>` pre-filled with the current name, auto-focused and text-selected.
- **Enter** or **blur** (click away) → commits the rename by calling `renameWindow(session, index, newName)` from `api/client.ts`. On success, SSE pushes the updated name automatically.
- **Escape** → cancels editing, reverts to the original name, no API call.
- **Empty input** → cancels (same as Escape) — do not allow renaming to an empty string.
- **Single-click** behavior is preserved — it navigates to the window as before. Only double-click triggers editing.

### State Management

Inline editing state can be local to the sidebar component (no need to modify `use-dialog-state.ts`):
- Track which window is being edited: `editingWindow: { session: string; index: number } | null`
- Track the current input value: `editingName: string`

### Existing Rename Dialog

The command palette "Rename current window" action and its dialog remain unchanged — this is an additional, faster path, not a replacement.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document inline editing pattern for sidebar tab names

## Impact

- **Frontend only** — no backend changes needed. The `renameWindow()` API client function already exists at `app/frontend/src/api/client.ts:84`.
- **Sidebar component** (`app/frontend/src/components/sidebar.tsx`) — primary change target.
- **No new dependencies** — standard React state + input element.
- **Keyboard-first principle** preserved — Enter/Escape key handling is part of the design.

## Open Questions

- None — the interaction model is well-understood (double-click to edit inline is a standard pattern).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use existing `renameWindow()` API client | API already exists at `client.ts:84`, no backend changes needed | S:90 R:95 A:95 D:95 |
| 2 | Certain | Keep existing command palette rename action | User clarified this is an additional path, not a replacement | S:85 R:95 A:90 D:95 |
| 3 | Certain | Enter commits, Escape cancels | Universal inline-edit convention | S:80 R:95 A:95 D:95 |
| 4 | Confident | Blur (click away) commits the rename | Most common inline-edit pattern — some apps cancel on blur, but commit-on-blur matches browser tab and file manager behavior | S:70 R:90 A:75 D:60 |
| 5 | Certain | Inline edit state is local to sidebar component | No cross-component coordination needed — simple local state | S:85 R:95 A:90 D:90 |
| 6 | Certain | Empty input cancels the rename | Preventing empty names is consistent with backend validation and UX convention | S:80 R:95 A:90 D:90 |
| 7 | Confident | Auto-select all text in input on double-click activation | Standard inline-edit UX — lets user type to fully replace or click to position cursor | S:70 R:95 A:80 D:70 |

7 assumptions (5 certain, 2 confident, 0 tentative, 0 unresolved).
