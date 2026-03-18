# Spec: Inline Tab Rename on Double-Click

**Change**: 260318-dcl9-inline-tab-rename-double-click
**Created**: 2026-03-18
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Sidebar: Inline Window Rename

### Requirement: Double-Click Activates Inline Editing

The sidebar window name `<span>` SHALL enter inline editing mode when the user double-clicks on it. The `<span>` MUST be replaced with a text `<input>` pre-filled with the current window name, auto-focused, with all text selected. Single-click behavior (navigate to window) MUST be preserved — only double-click triggers editing.

#### Scenario: Double-click to start editing
- **GIVEN** a sidebar with at least one session and window visible
- **WHEN** the user double-clicks on a window name
- **THEN** the window name text is replaced with a focused `<input>` containing the current name
- **AND** all text in the input is selected

#### Scenario: Single-click navigates normally
- **GIVEN** a sidebar with a window name visible
- **WHEN** the user single-clicks on the window name
- **THEN** navigation occurs to that window (`onSelectWindow` is called)
- **AND** no inline editing is triggered

### Requirement: Enter or Blur Commits Rename

Pressing Enter or blurring the input (clicking away) SHALL commit the rename by calling `renameWindow(session, index, newName)` from `api/client.ts`. The input SHALL be dismissed after the API call. SSE pushes the updated name automatically — no optimistic UI update is required.

#### Scenario: Commit via Enter
- **GIVEN** inline editing is active on a window name
- **WHEN** the user types a new name and presses Enter
- **THEN** `renameWindow(session, index, newName)` is called
- **AND** the input is dismissed and replaced with the updated name span

#### Scenario: Commit via blur
- **GIVEN** inline editing is active on a window name
- **WHEN** the user clicks outside the input (blur event)
- **THEN** `renameWindow(session, index, newName)` is called
- **AND** the input is dismissed

#### Scenario: Name unchanged — no API call
- **GIVEN** inline editing is active on a window name
- **WHEN** the user presses Enter without changing the name
- **THEN** the input is dismissed without calling `renameWindow`

### Requirement: Escape Cancels Editing

Pressing Escape SHALL cancel inline editing, revert to the original name, and make no API call.

#### Scenario: Cancel via Escape
- **GIVEN** inline editing is active on a window name
- **WHEN** the user presses Escape
- **THEN** the input is dismissed
- **AND** the original window name is restored
- **AND** no `renameWindow` API call is made

### Requirement: Empty Input Cancels

Submitting an empty or whitespace-only input SHALL cancel the rename (same behavior as Escape) — renaming to an empty string MUST NOT be allowed.

#### Scenario: Empty input on Enter
- **GIVEN** inline editing is active on a window name
- **WHEN** the user clears the input and presses Enter
- **THEN** the input is dismissed without an API call
- **AND** the original name is restored

#### Scenario: Empty input on blur
- **GIVEN** inline editing is active on a window name
- **WHEN** the user clears the input and clicks away
- **THEN** the input is dismissed without an API call
- **AND** the original name is restored

### Requirement: Inline Edit State is Local

Editing state SHALL be managed as local state within the `Sidebar` component. The state SHALL track which window is being edited (`{ session: string; index: number } | null`) and the current input value. Only one window MAY be in editing mode at a time — starting a new edit SHALL cancel any active edit.

#### Scenario: Only one edit active at a time
- **GIVEN** inline editing is active on window A
- **WHEN** the user double-clicks on window B's name
- **THEN** window A's edit is cancelled (reverts to original name)
- **AND** window B enters inline editing mode

### Requirement: Existing Rename Dialog Unchanged

The command palette "Rename current window" action and its dialog SHALL remain unchanged. Inline double-click editing is an additional path, not a replacement.

#### Scenario: Command palette rename still works
- **GIVEN** the command palette is open
- **WHEN** the user selects "Rename current window"
- **THEN** the rename dialog opens as before (unaffected by this change)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use existing `renameWindow()` API client | Confirmed from intake #1 — API exists at `client.ts:84`, no backend changes needed | S:90 R:95 A:95 D:95 |
| 2 | Certain | Keep existing command palette rename action | Confirmed from intake #2 — additional path, not replacement | S:85 R:95 A:90 D:95 |
| 3 | Certain | Enter commits, Escape cancels | Confirmed from intake #3 — universal inline-edit convention | S:80 R:95 A:95 D:95 |
| 4 | Confident | Blur commits the rename (unless empty) | Confirmed from intake #4 — commit-on-blur matches browser tab and file manager patterns. Cancel-on-blur is also valid but less common | S:70 R:90 A:75 D:60 |
| 5 | Certain | Inline edit state local to Sidebar component | Confirmed from intake #5 — simple `useState`, no cross-component coordination | S:85 R:95 A:90 D:90 |
| 6 | Certain | Empty input cancels the rename | Confirmed from intake #6 — prevents empty window names | S:80 R:95 A:90 D:90 |
| 7 | Confident | Auto-select all text in input on activation | Confirmed from intake #7 — standard inline-edit UX for full replacement or cursor positioning | S:70 R:95 A:80 D:70 |
| 8 | Certain | No API call when name is unchanged | Obvious optimization — codebase convention is to avoid unnecessary API calls | S:85 R:95 A:90 D:95 |
| 9 | Certain | Double-click event distinguished from single-click via `onDoubleClick` handler | React supports `onDoubleClick` natively — well-established pattern, no custom timer needed | S:90 R:95 A:95 D:95 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).
