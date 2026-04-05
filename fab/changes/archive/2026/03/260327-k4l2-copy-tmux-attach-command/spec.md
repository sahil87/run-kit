# Spec: Copy tmux Attach Command

**Change**: 260327-k4l2-copy-tmux-attach-command
**Created**: 2026-03-27
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Command Palette: Copy tmux Attach Command

### Requirement: Palette Action Registration

The command palette SHALL include a "Copy: tmux Attach Command" action with ID `copy-tmux-attach`. The action SHALL only be visible when `currentWindow` is available (terminal route `/$server/$session/$window` is active).

#### Scenario: Action visible on terminal route

- **GIVEN** the user is on a terminal route `/$server/$session/$window`
- **WHEN** the command palette is opened
- **THEN** the action "Copy: tmux Attach Command" is listed among the available actions

#### Scenario: Action hidden on non-terminal routes

- **GIVEN** the user is on the dashboard route `/$server` (no session/window selected)
- **WHEN** the command palette is opened
- **THEN** the "Copy: tmux Attach Command" action is not listed

### Requirement: Clipboard Copy Behavior

When the "Copy: tmux Attach Command" action is selected, the system SHALL copy the string `tmux attach-session -t {sessionName}:{windowName}` to the clipboard, where `{sessionName}` is the current session name and `{windowName}` is `currentWindow.name`.

#### Scenario: Copy attach command for active session and window

- **GIVEN** the user is viewing session `main` and window `editor`
- **WHEN** the user selects "Copy: tmux Attach Command" from the palette
- **THEN** the string `tmux attach-session -t main:editor` is copied to the clipboard

#### Scenario: Session or window name with special characters

- **GIVEN** the user is viewing session `my-project` and window `build-watch`
- **WHEN** the user selects "Copy: tmux Attach Command" from the palette
- **THEN** the string `tmux attach-session -t my-project:build-watch` is copied to the clipboard

### Requirement: Error Handling

The clipboard write SHALL use fire-and-forget error handling (`.catch(() => {})`), consistent with existing palette actions that perform best-effort operations.

#### Scenario: Clipboard API failure

- **GIVEN** the Clipboard API is unavailable or permission is denied
- **WHEN** the user selects "Copy: tmux Attach Command"
- **THEN** the error is silently caught and no exception propagates

### Requirement: No Visual Feedback

The action SHALL NOT display a toast, notification, or other visual feedback after copying. No toast system exists in the codebase.

#### Scenario: Copy completes silently

- **GIVEN** the user selects "Copy: tmux Attach Command"
- **WHEN** the clipboard write succeeds
- **THEN** no additional UI feedback is displayed beyond the palette closing

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Command format is `tmux attach-session -t <session>:<window>` | Confirmed from intake #1 — user specified single format | S:95 R:90 A:90 D:95 |
| 2 | Certain | Palette label is "Copy: tmux Attach Command" | Confirmed from intake #2 — user chose this label | S:95 R:95 A:90 D:95 |
| 3 | Certain | Action lives in command palette only | Confirmed from intake #3 — user excluded breadcrumb and shortcut | S:95 R:95 A:85 D:95 |
| 4 | Certain | Session and window names from route params | Confirmed from intake #4 — user specified source | S:95 R:90 A:95 D:95 |
| 5 | Certain | Conditional on terminal route (currentWindow present) | Confirmed from intake #5 — matches codebase pattern for window-scoped actions | S:90 R:95 A:95 D:90 |
| 6 | Confident | Fire-and-forget clipboard error handling | Confirmed from intake #6 — `.catch(() => {})` matches existing palette action pattern | S:75 R:90 A:85 D:80 |
| 7 | Confident | Window name (not index) in attach command | Confirmed from intake #7 — tmux convention, `currentWindow.name` available | S:80 R:85 A:80 D:75 |
| 8 | Confident | No visual feedback after copy | Confirmed from intake #8 — no toast system exists, adding one expands scope | S:70 R:85 A:80 D:70 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).
