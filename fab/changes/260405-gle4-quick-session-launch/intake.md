# Intake: Quick Session/Window Launch Without Folder Selection

**Change**: 260405-gle4-quick-session-launch
**Created**: 2026-04-06
**Status**: Draft

## Origin

> Quick session/window launch without folder selection — Currently creating a new session requires entering a folder path, which is slow. This change reimagines the launch flow: (1) The default '+' button and Cmd+K 'New Session' action should create a session immediately (no folder prompt) — the session starts in a default or last-used directory. (2) 'Start session at folder' becomes a separate, secondary action accessible only from Cmd+K. (3) Shift importance from 'initial folder' to 'current folder' — what matters is where the terminal IS now, not where it started. The sidebar/UI should reflect the current working directory of each pane rather than the initial creation folder. Same pattern for new windows within a session. Discuss: how to detect current working directory of a tmux pane (OSC 7, /proc, lsof), default directory strategy, and UI changes needed.

One-shot input. The description is detailed and covers three distinct sub-changes: (1) instant session creation, (2) folder-picker as secondary action, (3) CWD tracking and display.

## Why

Creating a new session in run-kit currently forces the user through a folder-picker dialog (`CreateSessionDialog`). This is a multi-step flow: type a path, wait for directory suggestions (debounced API call to `GET /api/directories`), select a suggestion, optionally edit the derived session name, then click Create. For users who just want a new terminal — the most common case — this is unnecessary friction. The folder the session *starts in* is far less important than the folder the terminal *is in right now*, since users `cd` immediately after creation.

If left unchanged, the launch flow remains the slowest part of the session management experience, discouraging quick exploratory sessions and making run-kit feel heavier than a raw terminal.

The approach splits the current single flow into two: a fast default path (instant creation, no prompt) and an optional power-user path (folder-picker via Cmd+K). This aligns with Constitution VII (Convention Over Configuration) — derive defaults rather than ask.

## What Changes

### 1. Instant Session Creation (Default Path)

The `+` button in the sidebar and the Cmd+K "New Session" action SHALL create a session immediately without opening any dialog:

- **Session name**: Auto-generated using an incrementing pattern (e.g., `session_1`, `session_2`, ...) or derived from a default directory name. The exact naming strategy needs discussion.
- **Working directory**: The session starts in a default directory. Candidates:
  - The home directory (`~`)
  - The last-used directory from the most recent session/pane
  - A configurable default in `run-kit.yaml` or `.env`
- **No dialog**: The `CreateSessionDialog` component is no longer opened by the `+` button or the primary Cmd+K action. The session appears instantly in the sidebar (via the existing optimistic/ghost mechanism in `OptimisticContext`).

Backend already supports this — `handleSessionCreate` in `app/backend/api/sessions.go` accepts `cwd` as an optional field. When empty, tmux creates the session in the server's working directory.

### 2. "Start Session at Folder" as Secondary Cmd+K Action

The current folder-picker flow (`CreateSessionDialog`) moves to a dedicated Cmd+K action:

- **Cmd+K palette**: Add a new action "New Session at Folder..." (or similar) that opens the existing `CreateSessionDialog` with path input and directory autocomplete.
- **Sidebar `+` button**: No longer opens the dialog — it triggers instant creation (see above).
- **Window creation**: Same pattern — the `+` button on a session in the sidebar creates a window instantly. A separate Cmd+K action "New Window at Folder..." allows specifying a path.

The existing `CreateSessionDialog` component can be retained (possibly renamed to `CreateSessionAtFolderDialog`) for this secondary flow.

### 3. CWD Tracking and Sidebar Display

The sidebar currently shows session names and window names/indices. This change proposes reflecting the *current* working directory of each pane in the UI:

- **Detection mechanisms** (discussion needed — platform-dependent):
  - **OSC 7** (shell integration): The shell emits `\e]7;file://hostname/path\e\\` on each directory change. xterm.js can intercept this via `Terminal.parser.registerOscHandler(7, ...)`. This is the most reliable approach but requires shell configuration (most modern shells support it, zsh does by default with `PROMPT_COMMAND` or `chpwd`).
  - **`/proc/{pid}/cwd`** (Linux only): Read the symlink for the pane's foreground process PID. Reliable on Linux, not available on macOS.
  - **`lsof -p {pid}`** (macOS/Linux): Query the CWD of the foreground process. Works cross-platform but slower (subprocess per pane).
  - **`tmux display-message -p '#{pane_current_path}'`**: tmux tracks `pane_current_path` internally. This is the simplest approach — tmux already derives it from the foreground process. Requires tmux 1.9+.
  
- **Sidebar display**: Each window entry in the sidebar could show a truncated CWD path (e.g., `~/code/my-project` or just `my-project`) beneath or alongside the window name. This replaces or supplements the current display of static window info.

- **Polling/streaming**: CWD changes need to propagate to the UI. Options:
  - Include `pane_current_path` in the SSE session state stream (already fetched via `tmux list-windows`/`tmux list-panes`).
  - Poll periodically from the frontend.
  - Use OSC 7 events from the WebSocket terminal stream.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Sidebar display changes, dialog flow changes, Cmd+K action additions
- `run-kit/tmux-sessions`: (modify) Session/window creation flow changes, CWD tracking mechanism
- `run-kit/architecture`: (modify) New data flow for CWD from tmux to frontend

## Impact

**Frontend** (`app/frontend/src/`):
- `components/create-session-dialog.tsx` — repurposed as secondary flow only
- `components/sidebar.tsx` — `+` button behavior changes, CWD display added
- `app.tsx` — Cmd+K action routing changes
- `hooks/use-dialog-state.ts` — dialog trigger logic changes
- `api/client.ts` — `createSession()` called without CWD for instant creation
- `contexts/session-context.tsx` — SSE data may include CWD info

**Backend** (`app/backend/`):
- `internal/tmux/tmux.go` — may need to expose `pane_current_path` in session/pane data
- `api/sessions.go` — session creation already supports optional CWD (no change needed)

**Tests**: Unit tests for sidebar, create-session-dialog, and Cmd+K actions will need updates. E2E tests for session creation flow will change.

## Open Questions

- What should the default directory be for instant session creation? Home directory, last-used, or configurable?
- What naming strategy for auto-created sessions? Incremental (`session_1`), timestamp-based, or random?
- Which CWD detection mechanism to use? `tmux display-message` with `pane_current_path` seems simplest — is it reliable enough?
- Should CWD tracking be real-time (OSC 7 via WebSocket) or periodic (included in SSE state updates)?
- How should the sidebar display CWD — as a subtitle under the window name, or replacing the window name entirely?
- Should this change be split into phases (instant creation first, CWD tracking later)?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Backend already supports optional CWD in session creation | `handleSessionCreate` in `sessions.go` treats empty `cwd` as valid — tmux defaults to server CWD | S:95 R:95 A:95 D:95 |
| 2 | Certain | Cmd+K is the primary action discovery mechanism | Constitution V mandates keyboard-first with Cmd+K as primary discovery | S:90 R:90 A:95 D:95 |
| 3 | Confident | The `+` button should trigger instant creation, not open a dialog | Description is explicit about this. Reversible — can always re-add dialog trigger | S:80 R:85 A:70 D:75 |
| 4 | Confident | `tmux pane_current_path` is the primary CWD detection mechanism | tmux already tracks this internally; simplest cross-platform approach. OSC 7 could augment later | S:65 R:80 A:75 D:60 |
| 5 | Confident | The existing `CreateSessionDialog` is retained for the secondary "at folder" flow | Description says folder-picker becomes secondary, not removed. Reuse is efficient | S:75 R:90 A:80 D:80 |
| 6 | Tentative | CWD info will be included in the SSE session state stream rather than a separate polling mechanism | SSE already streams session state; adding `pane_current_path` to the existing payload is natural. But polling frequency and data volume need consideration | S:50 R:75 A:60 D:50 |
<!-- assumed: CWD delivery via SSE — SSE already carries session state, extending it is the path of least resistance -->
| 7 | Tentative | Auto-generated session names will use an incrementing pattern (session_1, session_2, ...) | No explicit preference stated. Incrementing is simple and familiar. Could also be timestamp or folder-derived | S:40 R:85 A:50 D:45 |
<!-- assumed: incremental naming — simplest approach, easily changed later -->
| 8 | Tentative | This is a single change covering all three sub-features (instant creation, secondary dialog, CWD tracking) | Description presents them as a unified change. Could be phased, but they're conceptually linked | S:55 R:60 A:50 D:50 |
<!-- assumed: single change scope — described together, but phasing is an open question -->
| 9 | Unresolved | Default directory strategy for instant session creation | Multiple valid options (home, last-used, configurable) with different tradeoffs. User preference needed | S:30 R:60 A:20 D:20 |

9 assumptions (2 certain, 3 confident, 3 tentative, 1 unresolved). Run /fab-clarify to review.
