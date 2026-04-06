# Intake: Quick Session/Window Launch Without Folder Selection

**Change**: 260405-gle4-quick-session-launch
**Created**: 2026-04-06
**Status**: Draft

## Origin

> Quick session/window launch without folder selection — Currently creating a new session requires entering a folder path, which is slow. This change reimagines the launch flow: (1) The default '+' button and Cmd+K 'New Session' action should create a session immediately (no folder prompt) — the session starts in a default or last-used directory. (2) 'Start session at folder' becomes a separate, secondary action accessible only from Cmd+K. Same pattern for new windows within a session.

CWD tracking and pane data are handled separately in change 260405-rx38-pane-cwd-tracking.

## Why

Creating a new session in run-kit currently forces the user through a folder-picker dialog (`CreateSessionDialog`). This is a multi-step flow: type a path, wait for directory suggestions (debounced API call to `GET /api/directories`), select a suggestion, optionally edit the derived session name, then click Create. For users who just want a new terminal — the most common case — this is unnecessary friction. The folder the session *starts in* is far less important than the folder the terminal *is in right now*, since users `cd` immediately after creation.

If left unchanged, the launch flow remains the slowest part of the session management experience, discouraging quick exploratory sessions and making run-kit feel heavier than a raw terminal.

The approach splits the current single flow into two: a fast default path (instant creation, no prompt) and an optional power-user path (folder-picker via Cmd+K). This aligns with Constitution VII (Convention Over Configuration) — derive defaults rather than ask.

## What Changes

### 1. Instant Session Creation (Default Path)

The `+` button in the sidebar and the Cmd+K "New Session" action SHALL create a session immediately without opening any dialog:

- **Session name**: Derived from the last path component of the default directory (e.g., CWD is `~/code/run-kit` → name is `run-kit`). Deduplicated with a numeric suffix if the name already exists (`run-kit-2`, `run-kit-3`). Fallback to `session` when CWD is `/` or `~`.
- **Working directory**: The current active pane's CWD (from the currently focused window/session). This is available from `worktreePath` on the current `WindowInfo`.
- **No dialog**: The `CreateSessionDialog` component is no longer opened by the `+` button or the primary Cmd+K action. The session appears instantly in the sidebar via the existing optimistic/ghost mechanism in `OptimisticContext`.

Backend already supports this — `handleSessionCreate` in `app/backend/api/sessions.go` accepts `cwd` as an optional field.

### 2. "Start Session at Folder" as Secondary Cmd+K Action

The current folder-picker flow moves to a dedicated Cmd+K action:

- **Cmd+K palette**: Add a new action "New Session at Folder..." that opens the existing `CreateSessionDialog` with path input and directory autocomplete.
- **Sidebar `+` button**: No longer opens the dialog — it triggers instant creation (see above).
- **Window creation**: Same pattern — the `+` button on a session in the sidebar creates a window instantly in the active pane's CWD. A separate Cmd+K action "New Window at Folder..." allows specifying a path.

The existing `CreateSessionDialog` component is retained (possibly renamed to `CreateSessionAtFolderDialog`) for this secondary flow.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Dialog flow changes, Cmd+K action additions
- `run-kit/tmux-sessions`: (modify) Session/window creation flow — instant creation with CWD default

## Impact

**Frontend** (`app/frontend/src/`):
- `components/create-session-dialog.tsx` — repurposed as secondary flow only
- `components/sidebar.tsx` — `+` button behavior changes for sessions and windows
- `app.tsx` — Cmd+K action routing changes (add "New Session at Folder", "New Window at Folder")
- `hooks/use-dialog-state.ts` — dialog trigger logic changes
- `api/client.ts` — `createSession()` and `createWindow()` called with CWD but without dialog for instant path

**Backend** (`app/backend/`):
- `api/sessions.go` — session creation already supports optional CWD (no change needed)

**Tests**: Unit tests for sidebar and Cmd+K actions will need updates.

## Open Questions

- Should the Cmd+K "New Session at Folder..." action pre-fill the path with the active pane's CWD, or start empty?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Backend already supports optional CWD in session creation | `handleSessionCreate` in `sessions.go` treats empty `cwd` as valid — tmux defaults to server CWD | S:95 R:95 A:95 D:95 |
| 2 | Certain | Cmd+K is the primary action discovery mechanism | Constitution V mandates keyboard-first with Cmd+K as primary discovery | S:90 R:90 A:95 D:95 |
| 3 | Certain | The `+` button triggers instant creation, not a dialog | Discussed and confirmed in design session | S:95 R:95 A:95 D:95 |
| 4 | Certain | Default directory is the active pane's CWD | Discussed and confirmed — uses `worktreePath` from the current `WindowInfo` | S:95 R:95 A:95 D:95 |
| 5 | Certain | Session name is derived from last path component of CWD, deduplicated with numeric suffix | Discussed and confirmed — fallback to `session` for `/` or `~` | S:90 R:95 A:90 D:90 |
| 6 | Confident | The existing `CreateSessionDialog` is retained for the secondary "at folder" flow | Description says folder-picker becomes secondary, not removed. Reuse is efficient | S:75 R:90 A:80 D:80 |
| 7 | Tentative | "New Session at Folder..." pre-fills with active pane's CWD | Natural starting point; user can edit. But could also start empty. Needs decision | S:55 R:75 A:60 D:55 |

7 assumptions (3 certain, 2 confident, 1 tentative, 1 open question). Ready for spec.
