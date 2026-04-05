# Spec: Default Session Name from Folder Path

**Change**: 260317-qiza-default-session-name-from-folder
**Created**: 2026-03-17
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## UI: Create Session Dialog — Name Derivation Fallback

### Requirement: Derive session name from path on submit

When the user submits the Create Session dialog with an empty session name field but a non-empty path field, the dialog SHALL derive the session name from the path using the existing `deriveNameFromPath()` function before calling `createSession()`.

#### Scenario: User types path manually without setting name

- **GIVEN** the Create Session dialog is open
- **AND** the user has typed a path (e.g., `~/code/wvrdz/run-kit`) in the path field
- **AND** the session name field is empty
- **WHEN** the user clicks Create or presses Enter
- **THEN** the session name SHALL be derived as `deriveNameFromPath(path.trim())` (yielding `run_kit`)
- **AND** the session SHALL be created with that derived name

#### Scenario: User selects path from dropdown (existing behavior preserved)

- **GIVEN** the Create Session dialog is open
- **WHEN** the user selects a path from the autocomplete dropdown
- **THEN** the session name SHALL be auto-populated via `selectPath()` as before
- **AND** no behavioral change occurs

#### Scenario: User explicitly sets a name

- **GIVEN** the Create Session dialog is open
- **AND** the user has typed a name in the session name field
- **WHEN** the user clicks Create
- **THEN** the explicitly typed name SHALL be used (not overridden by path derivation)

### Requirement: Create button enabled when path is provided

The Create button SHALL be enabled when the path field is non-empty, even if the session name field is empty. The previous condition `!name.trim()` SHALL be relaxed to `!name.trim() && !path.trim()`.

#### Scenario: Path set, name empty — button enabled

- **GIVEN** the path field contains `~/code/project`
- **AND** the session name field is empty
- **WHEN** the user views the Create button
- **THEN** the button SHALL be enabled (not disabled)

#### Scenario: Both empty — button disabled

- **GIVEN** both the path field and session name field are empty
- **WHEN** the user views the Create button
- **THEN** the button SHALL be disabled

### Requirement: Collision check on derived name

When the session name is derived from the path at submit time, `handleCreate()` SHALL check `existingNames.has(trimmedName)` on the derived value. If a collision is detected, the creation SHALL be aborted (same behavior as the existing `nameCollision` guard for explicitly typed names), and an error SHALL be set to inform the user.

#### Scenario: Derived name collides with existing session

- **GIVEN** a session named `run_kit` already exists
- **AND** the user types path `~/code/wvrdz/run-kit` with an empty name field
- **WHEN** the user clicks Create
- **THEN** the session SHALL NOT be created
- **AND** an error message SHALL indicate the name collision

#### Scenario: Derived name is unique

- **GIVEN** no session named `my_project` exists
- **AND** the user types path `~/code/my-project` with an empty name field
- **WHEN** the user clicks Create
- **THEN** the session SHALL be created with name `my_project`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use existing `deriveNameFromPath()` for name derivation | Confirmed from intake #1 — function already exists with tmux/byobu sanitization | S:90 R:95 A:95 D:95 |
| 2 | Certain | Frontend-only change, no backend modification | Confirmed from intake #2 — backend `ValidateName()` already handles any valid name | S:85 R:90 A:95 D:95 |
| 3 | Certain | Enable Create button when path is provided but name is empty | Confirmed from intake #3 — user confirmed | S:95 R:90 A:80 D:75 |
| 4 | Certain | Check derived name collision in `handleCreate` directly | Confirmed from intake #4 — `nameCollision` memo watches `name` state which stays empty | S:95 R:85 A:80 D:70 |
| 5 | Certain | Show error message on derived name collision | Codebase already has `setError()` pattern in `handleCreate()` — reuse existing error display | S:85 R:95 A:90 D:90 |
| 6 | Certain | No test file changes needed | Existing `create-session-dialog.tsx` has no colocated test file; behavior is UI interaction that would be covered by e2e | S:80 R:90 A:85 D:90 |

6 assumptions (6 certain, 0 confident, 0 tentative, 0 unresolved).
