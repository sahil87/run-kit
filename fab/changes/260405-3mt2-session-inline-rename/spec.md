# Spec: Session Name Inline Rename

**Change**: 260405-3mt2-session-inline-rename
**Created**: 2026-04-05
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Removing or modifying the dialog-based session rename in `app.tsx` — the inline rename is additive
- Adding inline rename to the breadcrumb session name in the top bar (separate surface)
- Any backend changes — the `POST /api/sessions/{session}/rename` endpoint already exists

## Sidebar: Session Name Inline Rename

### Requirement: Double-Click Activates Inline Edit

The session name `<span>` in the sidebar's session row SHALL respond to `onDoubleClick` by replacing itself with an `<input>` element pre-populated with the current session name.

#### Scenario: Double-click opens input
- **GIVEN** the sidebar is rendered with sessions
- **WHEN** the user double-clicks on a session name span
- **THEN** an `<input aria-label="Rename session">` appears in place of the span
- **AND** the input contains the current session name
- **AND** the input is focused and text is selected

#### Scenario: Single-click does not trigger edit
- **GIVEN** the sidebar is rendered
- **WHEN** the user single-clicks a session name
- **THEN** `onSelectWindow` is called with the session's first window
- **AND** no rename input appears

### Requirement: Enter Commits the Rename

When the rename input is active, pressing Enter SHALL commit the rename if the trimmed value is non-empty and differs from the original name.

#### Scenario: Enter with changed name
- **GIVEN** a rename input is active for session "dev"
- **WHEN** the user types "staging" and presses Enter
- **THEN** `renameSession("dev", "staging")` is called
- **AND** the input is replaced by the updated session name span (optimistic update)

#### Scenario: Enter with empty input
- **GIVEN** a rename input is active
- **WHEN** the user clears the input and presses Enter
- **THEN** `renameSession` is NOT called
- **AND** the input is dismissed without change

#### Scenario: Enter with unchanged name
- **GIVEN** a rename input is active for session "dev"
- **WHEN** the user presses Enter without modifying the value
- **THEN** `renameSession` is NOT called
- **AND** the input is dismissed

### Requirement: Escape Cancels the Rename

Pressing Escape while a rename input is active SHALL cancel the edit without calling the API.

#### Scenario: Escape cancels
- **GIVEN** a rename input is active with a modified value
- **WHEN** the user presses Escape
- **THEN** `renameSession` is NOT called
- **AND** the input is dismissed, session name unchanged

### Requirement: Blur Commits the Rename

When the rename input loses focus (blur), the rename SHALL be committed using the same logic as Enter (non-empty, changed name required).

#### Scenario: Blur commits
- **GIVEN** a rename input is active for session "dev" with value "staging"
- **WHEN** the input loses focus (blur)
- **THEN** `renameSession("dev", "staging")` is called
- **AND** the input is dismissed

### Requirement: Optimistic Update on Rename

The session rename SHALL use the optimistic action pattern: the UI updates immediately on submit, rolls back on API failure, and shows a toast on error.

#### Scenario: Optimistic rename update
- **GIVEN** a rename is committed for session "dev" → "staging"
- **WHEN** the API call is in-flight
- **THEN** the sidebar immediately displays "staging" in the session row
- **AND** on API failure, the name reverts to "dev" and a toast error is shown

### Requirement: Cross-Cancellation of Inline Edits

Only one inline edit (window or session) SHALL be active at a time. Starting a new inline edit (session or window) MUST cancel any currently active inline edit without committing it.

#### Scenario: Starting session edit cancels active window edit
- **GIVEN** a window rename input is active for window "main" with a modified value
- **WHEN** the user double-clicks a session name
- **THEN** the window rename input is dismissed without calling `renameWindow`
- **AND** the session rename input activates

#### Scenario: Starting window edit cancels active session edit
- **GIVEN** a session rename input is active with a modified value
- **WHEN** the user double-clicks a window name
- **THEN** the session rename input is dismissed without calling `renameSession`
- **AND** the window rename input activates

#### Scenario: Starting session B edit cancels session A edit
- **GIVEN** a rename input is active for session A with a modified value
- **WHEN** the user double-clicks session B's name
- **THEN** session A's rename input is dismissed without committing
- **AND** session B's rename input activates

### Requirement: Input Does Not Trigger Navigation

Clicks and mousedown events on the rename input SHALL be stopped from propagating to the parent navigation button, preventing accidental navigation while editing.

#### Scenario: Input click does not navigate
- **GIVEN** a session rename input is active
- **WHEN** the user clicks inside the input
- **THEN** `onSelectWindow` is NOT called

## Design Decisions

1. **Input placement inside the existing navigation button**: The `<input>` replaces the `<span>` inside the `<button>` that handles navigation (matching window rename pattern). `onClick` and `onMouseDown` on the input use `e.stopPropagation()` to prevent the button from firing.
   - *Why*: Minimal DOM restructuring, exact parity with window rename.
   - *Rejected*: Restructuring the session row to put input outside the button — adds complexity with no UX benefit.

2. **Cancel-not-commit on cross-edit switch**: When editing session A and double-clicking session B, A's edit is cancelled (not committed). Matches existing window-to-window behaviour.
   - *Why*: Consistent with window rename. Blur-commit does not apply when the blur is caused by another inline edit starting, because `cancelledRef` / `sessionCancelledRef` is set to `true` before the state switch.
   - *Rejected*: Auto-committing the previous edit — unexpected side effect when the user intended to abandon.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Mirror window inline rename pattern exactly | User said "just like window name"; confirmed from intake #1 — direct API/pattern exists | S:90 R:90 A:90 D:95 |
| 2 | Certain | Input placed inside existing navigation button with stopPropagation | Design decision codified — only viable approach given current DOM structure; window rename does the same | S:90 R:90 A:95 D:95 |
| 3 | Confident | Cross-cancel: starting any inline edit cancels any other active inline edit | Confirmed from intake #2 — extended to session-to-session case | S:65 R:85 A:85 D:85 |
| 4 | Confident | Keep dialog-based rename in app.tsx unchanged | Confirmed from intake #3 — "also" implies additive | S:85 R:60 A:90 D:90 |
| 5 | Confident | Blur commits rename (non-empty, changed only) | Confirmed from intake #4 — full behavioural parity with window rename | S:65 R:90 A:90 D:90 |
| 6 | Certain | renameSession optimistic action uses markRenamed("session", oldName, newName) / unmarkRenamed(oldName) | use-dialog-state.ts already uses this exact pattern for session rename — confirmed by reading the code | S:95 R:90 A:95 D:95 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved). Run /fab-clarify to review.
