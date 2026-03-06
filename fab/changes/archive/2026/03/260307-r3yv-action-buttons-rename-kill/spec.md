# Spec: Rename Action + Kill Label Cleanup

**Change**: 260307-r3yv-action-buttons-rename-kill
**Created**: 2026-03-07
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Backend: Rename Window

### Requirement: tmux.ts renameWindow function

`src/lib/tmux.ts` SHALL export an async function `renameWindow(session: string, index: number, name: string): Promise<void>` that executes `tmux rename-window -t {session}:{index} {name}` via `tmuxExec`.

#### Scenario: Successful rename
- **GIVEN** a tmux session `myproject` with window index `2` named `old-name`
- **WHEN** `renameWindow("myproject", 2, "new-name")` is called
- **THEN** tmux executes `rename-window -t myproject:2 new-name`
- **AND** the function resolves without error

### Requirement: API renameWindow action

`POST /api/sessions` SHALL accept `{ action: "renameWindow", session, index, name }`. The handler SHALL validate `session` via `validateName(session, "Session name")`, validate `index` as a non-negative integer, and validate `name` via `validateName(name, "Window name")`. On success, it SHALL call `renameWindow(session, index, name)` and return `{ ok: true }`.

#### Scenario: Valid rename request
- **GIVEN** a running tmux session `myproject` with window index `1`
- **WHEN** `POST /api/sessions` receives `{ action: "renameWindow", session: "myproject", index: 1, name: "agent" }`
- **THEN** response is `200 { ok: true }`
- **AND** the window is renamed in tmux

#### Scenario: Invalid name rejected
- **GIVEN** any request state
- **WHEN** `POST /api/sessions` receives `{ action: "renameWindow", session: "myproject", index: 1, name: "bad;name" }`
- **THEN** response is `400` with an error message from `validateName`

## Project Page: Rename Action

### Requirement: Rename palette action and shortcut

The project page (`/p/:project`) SHALL register a palette action `"Rename focused window"` with shortcut `r`. The shortcut SHALL be added to the `shortcuts` map in `useKeyboardNav`. The action SHALL open a rename dialog when a window is focused.

#### Scenario: Rename via keyboard shortcut
- **GIVEN** the project page with windows, focus on window index 1 named `old-name`
- **WHEN** the user presses `r`
- **THEN** a rename dialog opens pre-filled with `old-name`

#### Scenario: Rename via command palette
- **GIVEN** the project page with windows
- **WHEN** the user opens Cmd+K and selects "Rename focused window"
- **THEN** a rename dialog opens pre-filled with the focused window's name

### Requirement: Rename dialog behavior

The rename dialog SHALL use the existing `Dialog` component with title `"Rename window"`. It SHALL contain a text input pre-filled with the current window name (auto-selected for easy replacement) and a "Rename" submit button. On submit, it SHALL call `POST /api/sessions` with `{ action: "renameWindow", session, index, name }`. The dialog SHALL close after successful submission. Pressing Enter in the input SHALL submit. The input SHALL be auto-focused.

#### Scenario: Submit rename
- **GIVEN** the rename dialog is open for window `old-name` at index `2` in session `myproject`
- **WHEN** the user changes the name to `new-name` and presses Enter
- **THEN** `POST /api/sessions` is called with `{ action: "renameWindow", session: "myproject", index: 2, name: "new-name" }`
- **AND** the dialog closes

#### Scenario: Cancel rename
- **GIVEN** the rename dialog is open
- **WHEN** the user clicks the backdrop or presses Escape
- **THEN** the dialog closes without making any API call

### Requirement: Rename button in Line 2

The project page SHALL add a "Rename" button in the Line 2 left slot, alongside the existing "+ New Window" and "Send Message" buttons. The button SHALL be disabled when no windows exist. Clicking it SHALL open the rename dialog for the focused window.

#### Scenario: Rename button visible
- **GIVEN** the project page with at least one window
- **WHEN** the page renders
- **THEN** Line 2 left shows buttons: "+ New Window", "Send Message", "Rename"
- **AND** the "Rename" button is enabled

#### Scenario: Rename button disabled when no windows
- **GIVEN** the project page with zero windows
- **WHEN** the page renders
- **THEN** the "Rename" button is disabled (same style as disabled "Send Message")

## Terminal Page: Rename Action

### Requirement: Rename button in Line 2

The terminal page SHALL add a "Rename" button in the Line 2 left slot, alongside the existing kill button. Clicking it SHALL open a rename dialog pre-filled with the current window name.

#### Scenario: Rename from terminal page
- **GIVEN** the terminal page for window `agent` at index `1` in session `myproject`
- **WHEN** the user clicks "Rename"
- **THEN** a rename dialog opens pre-filled with `agent`

### Requirement: Rename palette action on terminal page

The terminal page SHALL register a palette action `"Rename window"` with shortcut `r`. Selecting it SHALL open the rename dialog.

#### Scenario: Rename via palette on terminal page
- **GIVEN** the terminal page for any window
- **WHEN** the user opens Cmd+K and selects "Rename window"
- **THEN** a rename dialog opens pre-filled with the current window name

### Requirement: Rename dialog on terminal page

The rename dialog on the terminal page SHALL behave identically to the project page rename dialog (same Dialog component, pre-filled input, auto-select, Enter to submit, Escape to cancel). On submit, it SHALL call `POST /api/sessions` with `{ action: "renameWindow", session, index, name }`. After submission, focus SHALL return to the terminal (via `xtermRef.current?.focus()`).

#### Scenario: Focus returns to terminal after rename
- **GIVEN** the rename dialog is open on the terminal page
- **WHEN** the user submits a new name
- **THEN** the dialog closes
- **AND** the terminal regains focus

## Terminal Page: Kill Label

### Requirement: Shortened kill button label

The terminal page Line 2 button label SHALL be `"Kill"` (not `"Kill Window"`).

#### Scenario: Kill button displays shortened label
- **GIVEN** the terminal page for any window
- **WHEN** the page renders
- **THEN** Line 2 left shows a button labeled `"Kill"` (not `"Kill Window"`)

### Requirement: Kill palette action label

The terminal page command palette entry for killing SHALL use the label `"Kill window"` (lowercase "w", retains "window" for palette searchability).

#### Scenario: Kill palette label
- **GIVEN** the terminal page command palette is open
- **WHEN** the user sees the kill action
- **THEN** it is labeled `"Kill window"`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `tmux rename-window` for rename | Confirmed from intake #1 — only tmux API for window rename; codebase pattern in tmux.ts | S:80 R:90 A:95 D:95 |
| 2 | Certain | Reuse existing Dialog component | Confirmed from intake #2 — all dialogs use `src/components/dialog.tsx` | S:85 R:95 A:95 D:95 |
| 3 | Certain | Register all actions in command palette | Confirmed from intake #3 — Constitution V mandates keyboard-first | S:90 R:90 A:95 D:95 |
| 4 | Confident | Shortcut `r` for rename | Confirmed from intake #4 — available key, mnemonic, consistent with n/x/s pattern | S:70 R:90 A:80 D:75 |
| 5 | Certain | Auto-select input text in rename dialog | Pre-selecting the current name makes replacement faster — standard UX for rename operations | S:75 R:95 A:90 D:90 |
| 6 | Certain | Rename button position: after existing buttons | Follows left-to-right importance: create > send > rename on project page; rename + kill on terminal | S:75 R:95 A:85 D:90 |
| 7 | Certain | Validate new name via existing `validateName` | Same validation as create window — reuse, don't reinvent (Constitution III) | S:85 R:95 A:95 D:95 |

7 assumptions (6 certain, 1 confident, 0 tentative, 0 unresolved).
