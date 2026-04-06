# Spec: Quick Session/Window Launch Without Folder Selection

**Change**: 260405-gle4-quick-session-launch
**Created**: 2026-04-06
**Affected memory**: `docs/memory/run-kit/ui-patterns.md` (modify)

## Non-Goals

- CWD tracking or real-time pane CWD polling — handled separately in `260405-rx38-pane-cwd-tracking`
- Renaming or restructuring `CreateSessionDialog` — it is reused as-is for the "at folder" secondary flow
- Backend changes — `handleSessionCreate` already accepts optional `cwd`; no API modifications needed
- Window naming changes — window names remain `zsh` (existing behavior); only session names are derived from CWD
- Persisting "last-used directory" across restarts — CWD comes from the active pane's `worktreePath` at click time only

---

## Frontend: Session Creation Flow

### Requirement: Instant Session Creation via Sidebar and Primary Palette Action

The sidebar `+` button and the Cmd+K "Session: Create" action SHALL create a session immediately without opening any dialog. No path prompt, no confirmation. The session appears in the sidebar via the existing optimistic/ghost mechanism.

- **Working directory**: The active window's `worktreePath` (from `WindowInfo`), passed as the `cwd` argument to `createSession()`. If no active window exists (e.g., on the dashboard with no sessions), `cwd` is omitted and tmux defaults to its server CWD.
- **Session name**: Derived by calling the existing `deriveNameFromPath(worktreePath)` utility. If the result is empty (CWD is `/`, `~`, or `worktreePath` is undefined), the fallback name is `session`.
- **Deduplication**: Before creating, the derived name is checked against the current `sessions` list. If taken, append `-2`, `-3`, … up to `-10`. If all ten suffixes are taken, use the base name with suffix `-11` (best-effort; collision at this level is negligible in practice).

#### Scenario: Instant session from sidebar `+` button with active window

- **GIVEN** a terminal route is active and `currentWindow.worktreePath` is `/home/user/code/run-kit`
- **WHEN** the user clicks the `+` button in the sidebar
- **THEN** `createSession("run-kit", "/home/user/code/run-kit")` is called immediately
- **AND** no dialog is opened
- **AND** the session appears in the sidebar via the optimistic ghost mechanism

#### Scenario: Instant session from Cmd+K "Session: Create" with active window

- **GIVEN** a terminal route is active and `currentWindow.worktreePath` is `/home/user/projects/api`
- **WHEN** the user opens Cmd+K and selects "Session: Create"
- **THEN** `createSession("api", "/home/user/projects/api")` is called immediately
- **AND** the command palette closes
- **AND** no dialog is opened

#### Scenario: Name deduplication when derived name already exists

- **GIVEN** sessions named `run-kit` and `run-kit-2` already exist
- **WHEN** the user triggers instant session creation with `worktreePath` = `/home/user/code/run-kit`
- **THEN** `createSession("run-kit-3", "/home/user/code/run-kit")` is called

#### Scenario: Fallback name when CWD is root or home

- **GIVEN** `currentWindow.worktreePath` is `/` (or `~`, or `deriveNameFromPath` returns empty string)
- **WHEN** the user triggers instant session creation
- **THEN** the derived name is `session` (after deduplication if needed)
- **AND** `createSession("session", "/")` is called

#### Scenario: No active window (dashboard, zero sessions)

- **GIVEN** the user is on the server dashboard with no existing sessions
- **WHEN** the user clicks the `+` button in the sidebar empty state or "New Session" on the dashboard
- **THEN** `createSession("session")` is called (no `cwd` argument)
- **AND** tmux creates the session in its default CWD

### Requirement: "Session: Create at Folder" as Secondary Cmd+K Action

A new Cmd+K action "Session: Create at Folder" SHALL open the existing `CreateSessionDialog`. This is the only remaining entry point for folder-prompted session creation.

- The action appears in the command palette under the session actions group.
- The `CreateSessionDialog` SHALL pre-fill the path input with the active pane's `worktreePath`. <!-- clarified: pre-filling confirmed as default per Constitution VII (Convention Over Configuration). Requires adding `defaultPath?: string` prop to CreateSessionDialog and initializing `path` state from it. If CWD is unavailable the field starts empty. --> This requires a minimal prop addition: `CreateSessionDialogProps` gains `defaultPath?: string`, and `useState("")` for `path` becomes `useState(defaultPath ?? "")`. The dialog behavior is otherwise unchanged.
- The dialog behavior is otherwise unchanged (directory autocomplete, name derivation, Create button).

#### Scenario: "Session: Create at Folder" from Cmd+K

- **GIVEN** the user opens Cmd+K
- **WHEN** the user selects "Session: Create at Folder"
- **THEN** `CreateSessionDialog` opens
- **AND** the path input is pre-filled with `currentWindow.worktreePath` (or empty if no active window)

#### Scenario: Dialog creation flow is unaffected

- **GIVEN** `CreateSessionDialog` is opened via "Session: Create at Folder"
- **WHEN** the user selects a path and clicks Create
- **THEN** `createSession(name, cwd)` is called as before (existing dialog behavior unchanged)

### Requirement: "Window: Create at Folder" as Secondary Cmd+K Action

A new Cmd+K action "Window: Create at Folder" SHALL open the existing `CreateSessionDialog` extended with a `mode: "window"` prop for specifying a window's starting directory. Only available when a session is active.

> <!-- clarified: `CreateSessionDialog` is reused with a `mode?: "session" | "window"` prop addition. In window mode, the dialog title becomes "Create window at folder", the session name input is hidden (window name is always "zsh"), and `handleCreate` calls `createWindow(sessionName, "zsh", cwd)` instead of `createSession`. This avoids a new file (Constitution IV: Minimal Surface Area) and keeps non-goal "Renaming or restructuring CreateSessionDialog" satisfied — it is extended minimally, not renamed or restructured. -->

#### Scenario: "Window: Create at Folder" from Cmd+K

- **GIVEN** the user is on a terminal route (session and window are active)
- **WHEN** the user opens Cmd+K and selects "Window: Create at Folder"
- **THEN** a dialog opens allowing the user to specify a starting directory for the new window
- **AND** on confirmation `createWindow(session, "zsh", cwd)` is called

### Requirement: Sidebar `+` Button Behavior

The sidebar `+` button for sessions SHALL trigger instant creation (not open a dialog). The sidebar `+` button for windows SHALL trigger instant creation (existing `executeCreateWindow` behavior, which already passes `activeWin?.worktreePath` as CWD).

- The `onCreateSession` prop passed to `Sidebar` SHALL invoke `executeCreateSessionInstant` (the new instant-creation function in `app.tsx`), not `dialogs.openCreateDialog`.
- The `onCreateWindow` prop behavior is unchanged.

#### Scenario: Sidebar `+` creates session instantly

- **GIVEN** the sidebar is visible
- **WHEN** the user clicks the session-level `+` button
- **THEN** instant session creation fires (see Instant Session Creation requirement)
- **AND** `CreateSessionDialog` is NOT opened

#### Scenario: Sidebar window `+` is unchanged

- **GIVEN** a session row is expanded in the sidebar
- **WHEN** the user clicks the window-level `+` button
- **THEN** `createWindow(session, "zsh", activeWin?.worktreePath)` is called as before

### Requirement: Dashboard "New Session" Button

The Dashboard's "New Session" dashed-border card SHALL trigger instant session creation (not open `CreateSessionDialog`). The button calls `onCreateSession`, which now resolves to `executeCreateSessionInstant`.

#### Scenario: Dashboard "New Session" creates instantly

- **GIVEN** the user is on the server dashboard
- **WHEN** the user clicks the "New Session" card
- **THEN** instant session creation fires (see Instant Session Creation requirement)
- **AND** no dialog is opened

### Requirement: Top-Bar Breadcrumb Dropdown "New Session" Item

The breadcrumb dropdown's `+ New Session` action item SHALL trigger instant session creation.

#### Scenario: Top-bar breadcrumb "New Session" creates instantly

- **GIVEN** the user is on a terminal route and taps the session name in the top bar
- **WHEN** the user taps `+ New Session` in the session dropdown
- **THEN** instant session creation fires
- **AND** no dialog is opened

### Requirement: Command Palette Action List

The command palette's session-creation actions SHALL be updated as follows:

| Old action | New action |
|-----------|-----------|
| `id: "create-session"` "Session: Create" (opened dialog) | `id: "create-session"` "Session: Create" — triggers instant creation |
| _(did not exist)_ | `id: "create-session-at-folder"` "Session: Create at Folder" — opens `CreateSessionDialog` |
| `id: "create-window"` "Window: Create" (existing instant) | Unchanged |
| _(did not exist)_ | `id: "create-window-at-folder"` "Window: Create at Folder" — opens folder dialog |

#### Scenario: Cmd+K session actions list

- **GIVEN** the command palette is open
- **WHEN** the user types "session" or "create"
- **THEN** both "Session: Create" and "Session: Create at Folder" appear in results
- **AND** "Session: Create" triggers instant creation on select
- **AND** "Session: Create at Folder" opens the dialog on select

---

## Deprecated Requirements

### Old Requirement: Sidebar `+` Opens CreateSessionDialog

**Reason**: Replaced by instant session creation. The dialog is too slow for the common case (just want a new terminal).

**Migration**: Use "Session: Create at Folder" in the Cmd+K palette for folder-prompted session creation.

### Old Requirement: Dashboard "New Session" Opens CreateSessionDialog

**Reason**: Same as above — unified instant creation across all primary entry points.

**Migration**: Use "Session: Create at Folder" in the Cmd+K palette.

---

## Design Decisions

1. **Instant-by-default, dialog-as-secondary**: The primary entry points (sidebar `+`, dashboard card, breadcrumb dropdown, "Session: Create" in palette) create sessions instantly. The folder picker moves to a dedicated Cmd+K secondary action.
   - *Why*: The folder the session starts in is less important than the folder the terminal is in right now — users `cd` immediately. Forcing a multi-step path picker for the common case is friction with no benefit. Constitution VII (Convention Over Configuration) supports deriving the CWD default rather than asking.
   - *Rejected*: Keep dialog as default but pre-fill with CWD — this still requires a click to dismiss. Users who want instant creation would have to click "Create" without changing anything, every time.

2. **Name derived from CWD last path component via `deriveNameFromPath`**: Reuses the existing utility already used in `CreateSessionDialog`.
   - *Why*: No new logic introduced. Consistent naming whether user went through the dialog or instant creation.
   - *Rejected*: A generic incrementing name like `session`, `session-2`, etc. — less meaningful, harder to identify sessions in the sidebar.

3. **Deduplication limit of 10 suffixes**: After trying `name`, `name-2`, …, `name-10`, fall back to `name-11` without checking.
   - *Why*: Having more than 10 sessions with the same name is an edge case that doesn't justify a retry loop or error state.
   - *Rejected*: Error toast and no creation — worse UX; a slightly redundant name is better than a failure.

4. **Window names stay as `zsh`**: Only session names are derived from CWD. Window names are less prominent and less important for identification.
   - *Why*: Consistent with existing `handleCreateWindow` behavior. Avoids scope creep.
   - *Rejected*: Derive window names from CWD too — adds complexity with little value since sessions are the primary named unit in the sidebar.

5. **`executeCreateSessionInstant` lives in `app.tsx`**: The instant creation logic is a thin function next to `executeCreateWindow` and `handleCreateWindow`.
   - *Why*: Keeps all session/window creation orchestration in one place; no need for a new hook.
   - *Rejected*: Custom hook `useInstantSessionCreate` — adds indirection for a simple function.

---

## Clarifications

### Session 2026-04-06 (auto)

| # | Action | Detail |
|---|--------|--------|
| 7 | Resolved | Pre-fill confirmed as default — `defaultPath?: string` prop added to `CreateSessionDialog`; aligns with Constitution VII |
| — | Resolved | Window-at-folder dialog: `CreateSessionDialog` extended with `mode?: "session" \| "window"` prop rather than new component; aligns with Constitution IV |

---

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Backend already supports optional CWD in session creation | Confirmed from intake #1. `handleSessionCreate` in `sessions.go` treats empty `cwd` as valid — tmux defaults to server CWD | S:95 R:95 A:95 D:95 |
| 2 | Certain | Cmd+K is the primary action discovery mechanism | Confirmed from intake #2. Constitution V mandates keyboard-first with Cmd+K as primary discovery | S:90 R:90 A:95 D:95 |
| 3 | Certain | The sidebar `+` button triggers instant creation, not a dialog | Confirmed from intake #3. Core behavioral requirement of this change | S:95 R:95 A:95 D:95 |
| 4 | Certain | Default CWD is the active pane's `worktreePath` from `WindowInfo` | Confirmed from intake #4. `worktreePath` is already passed to `executeCreateWindow` — same pattern for sessions | S:95 R:95 A:95 D:95 |
| 5 | Certain | Session name is derived from last path component of CWD via `deriveNameFromPath`, deduplicated with numeric suffix, fallback `session` | Confirmed from intake #5 and design session notes. `deriveNameFromPath` already exists in `create-session-dialog.tsx` | S:90 R:95 A:90 D:90 |
| 6 | Confident | Existing `CreateSessionDialog` is reused (minimally extended) for secondary flows | Confirmed from intake #6. No rename or structural changes required. Two backward-compatible optional props added: `defaultPath?: string` (pre-fill) and `mode?: "session" \| "window"` (window-at-folder). Existing callers pass neither prop and behavior is unchanged | S:85 R:90 A:85 D:85 |
| 7 | Certain | "Session: Create at Folder" dialog pre-fills path with active pane's CWD | Clarified — resolved from context. Constitution VII (Convention Over Configuration) supports deriving defaults. Requires adding `defaultPath?: string` prop to `CreateSessionDialog`; `path` state initializes from it | S:90 R:90 A:90 D:90 |
| 8 | Confident | No new files required — all changes are edits to existing source files | Derived from scope analysis: `app.tsx`, `sidebar.tsx`, `dashboard.tsx`, `top-bar.tsx` cover all entry points. `use-dialog-state.ts` and `create-session-dialog.tsx` minimally extended | S:80 R:85 A:80 D:80 |
| 9 | Confident | `deriveNameFromPath` and `toTmuxSafeName` utilities in `create-session-dialog.tsx` are importable and reusable in `app.tsx` without copying | Standard module import; no circular dependency expected | S:75 R:85 A:80 D:75 |
| 10 | Certain | `CreateSessionDialog` is extended with `mode?: "session" \| "window"` prop for window-at-folder flow | Clarified — resolved from context. Avoids new component (Constitution IV: Minimal Surface Area). In window mode: title changes, session name input hidden, `handleCreate` calls `createWindow`. Non-goal satisfied — not renamed or restructured | S:90 R:90 A:90 D:85 |

10 assumptions (7 certain, 3 confident, 0 tentative, 0 unresolved).
