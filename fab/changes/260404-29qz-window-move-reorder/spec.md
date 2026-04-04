# Spec: Window Move & Reorder

**Change**: 260404-29qz-window-move-reorder
**Created**: 2026-04-04
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Cross-session window move (separate backlog item [dq70])
- Direct keyboard shortcuts (e.g., Ctrl+Shift+Left) — CmdK palette is the keyboard path
- Drag-and-drop for sessions (only windows within a session)

## Backend: tmux swap-window

### Requirement: SwapWindow function
The `tmux` package SHALL expose a `SwapWindow(session string, srcIndex int, dstIndex int, server string) error` function in `app/backend/internal/tmux/tmux.go`. It MUST call `tmux swap-window -s {session}:{srcIndex} -t {session}:{dstIndex}` via `exec.CommandContext` with the standard `withTimeout()` (10s). It MUST use `serverArgs(server)` for server targeting.

#### Scenario: Swap two adjacent windows
- **GIVEN** session "work" has windows at indices 0, 1, 2 on server "default"
- **WHEN** `SwapWindow("work", 0, 1, "default")` is called
- **THEN** tmux executes `swap-window -s work:0 -t work:1`
- **AND** the function returns nil

#### Scenario: Swap with non-existent index
- **GIVEN** session "work" has windows at indices 0, 1
- **WHEN** `SwapWindow("work", 0, 5, "default")` is called
- **THEN** the function returns an error from tmux (invalid target)

### Requirement: TmuxOps interface update
The `TmuxOps` interface in `app/backend/api/router.go` SHALL include `SwapWindow(session string, srcIndex int, dstIndex int, server string) error`. The `prodTmuxOps` struct SHALL delegate to `tmux.SwapWindow`.

#### Scenario: Interface exposes SwapWindow
- **GIVEN** the `TmuxOps` interface is used by `Server`
- **WHEN** a handler calls `s.tmux.SwapWindow`
- **THEN** it delegates to the concrete `tmux.SwapWindow` function

## Backend: Move Window API Endpoint

### Requirement: POST move endpoint
The server SHALL register `POST /api/sessions/{session}/windows/{index}/move` in `app/backend/api/router.go`. The handler SHALL be `handleWindowMove` in `app/backend/api/windows.go`.

#### Scenario: Successful move
- **GIVEN** a valid session name and window index in the URL
- **AND** a JSON body `{"targetIndex": 2}` where targetIndex is a non-negative integer
- **WHEN** the endpoint receives a POST request
- **THEN** it calls `s.tmux.SwapWindow(session, index, targetIndex, server)`
- **AND** returns `200 {"ok": true}`

#### Scenario: Invalid target index
- **GIVEN** a valid session name and window index
- **WHEN** the body contains `{"targetIndex": -1}` or a non-integer value
- **THEN** the endpoint returns `400` with an error message

#### Scenario: Missing or invalid JSON body
- **GIVEN** a valid session name and window index
- **WHEN** the body is missing or malformed
- **THEN** the endpoint returns `400 {"error": "Invalid JSON body"}`

### Requirement: Handler validation pattern
The handler MUST follow the existing window handler pattern: validate session name via `validate.ValidateName`, parse window index via `parseWindowIndex`, extract server via `serverFromRequest`. The `targetIndex` field MUST be validated as a non-negative integer.

#### Scenario: Invalid session name
- **GIVEN** a session name containing invalid characters
- **WHEN** the endpoint receives a POST request
- **THEN** it returns `400` with the validation message

## Frontend: API Client

### Requirement: moveWindow client function
`app/frontend/src/api/client.ts` SHALL export a `moveWindow(session: string, index: number, targetIndex: number): Promise<{ ok: boolean }>` function. It MUST POST to `/api/sessions/{session}/windows/{index}/move` with body `{ targetIndex }` using the `withServer()` URL helper, following the pattern of `renameWindow`.

#### Scenario: Move window call
- **GIVEN** the frontend needs to reorder a window
- **WHEN** `moveWindow("work", 0, 1)` is called
- **THEN** a POST request is sent to `/api/sessions/work/windows/0/move?server=...` with body `{"targetIndex":1}`

## Frontend: Command Palette Actions

### Requirement: Move Left action
The `windowActions` array in `app/frontend/src/app.tsx` SHALL include a "Window: Move Left" action with id `"move-window-left"`. It MUST be present only when `currentWindow` exists (same conditional as rename/kill). On select, it SHALL call `moveWindow(sessionName, currentWindow.index, currentWindow.index - 1)`. It SHALL be a no-op (not included in actions) when `currentWindow.index` is the minimum window index in the current session.
<!-- clarified: No-op via exclusion from actions list when at boundary — confirmed assumption #10; matches existing conditional action pattern in app.tsx -->

#### Scenario: Move window left
- **GIVEN** the user is on window index 2 in session "work"
- **AND** window index 1 exists
- **WHEN** the user selects "Window: Move Left" from the command palette
- **THEN** `moveWindow("work", 2, 1)` is called
- **AND** SSE refreshes the window list with updated indices

#### Scenario: Already leftmost window
- **GIVEN** the user is on the window with the lowest index in the session
- **WHEN** the command palette is opened
- **THEN** "Window: Move Left" is NOT shown in the action list

### Requirement: Move Right action
The `windowActions` array SHALL include a "Window: Move Right" action with id `"move-window-right"`. Same conditional pattern as Move Left but using `currentWindow.index + 1` as target. It SHALL be excluded when `currentWindow.index` is the maximum window index in the current session.

#### Scenario: Move window right
- **GIVEN** the user is on window index 1 in session "work"
- **AND** window index 2 exists
- **WHEN** the user selects "Window: Move Right" from the command palette
- **THEN** `moveWindow("work", 1, 2)` is called

#### Scenario: Already rightmost window
- **GIVEN** the user is on the window with the highest index in the session
- **WHEN** the command palette is opened
- **THEN** "Window: Move Right" is NOT shown in the action list

### Requirement: Navigation after move
After a successful `moveWindow` call from a CmdK action, the frontend SHALL navigate to `/${server}/${session}/${targetIndex}` so the user follows their window to its new position. The swap means the current window's content is now at `targetIndex`.
<!-- clarified: Navigate to targetIndex after swap — confirmed assumption #9; swap moves window content to target position, URL must update to keep user on same terminal -->

#### Scenario: URL updates after move left
- **GIVEN** the user is viewing `/$server/work/2`
- **WHEN** "Window: Move Left" swaps window 2 with window 1
- **THEN** the browser navigates to `/$server/work/1`

## Frontend: Sidebar Drag-and-Drop

### Requirement: Draggable window items
Each window item in the sidebar (`app/frontend/src/components/sidebar.tsx`) SHALL have `draggable={true}` on its container element. The `onDragStart` handler MUST set `dataTransfer` data containing the session name and window index via `e.dataTransfer.setData("application/json", JSON.stringify({ session, index }))`.
<!-- clarified: JSON in dataTransfer for structured drag data — confirmed assumption #8; standard HTML5 DnD pattern for carrying session + index -->

#### Scenario: User starts dragging a window
- **GIVEN** the sidebar shows windows for session "work"
- **WHEN** the user starts dragging window "alpha" (index 1)
- **THEN** the drag data contains `{"session":"work","index":1}`
- **AND** a drag ghost image is shown

### Requirement: Drop zone indicators
During a drag, each window item in the **same session** SHALL show a visual drop indicator (a 2px accent-colored line) above or below the item based on cursor position. Window items in **other sessions** SHALL NOT show drop indicators (drag is constrained to same session).

#### Scenario: Dragging within same session
- **GIVEN** the user is dragging window index 0 from session "work"
- **WHEN** the cursor hovers over window index 2 in session "work"
- **THEN** a horizontal accent line appears indicating the drop position

#### Scenario: Dragging over different session
- **GIVEN** the user is dragging window index 0 from session "work"
- **WHEN** the cursor hovers over window index 1 in session "dev"
- **THEN** no drop indicator is shown
- **AND** `onDragOver` does NOT call `e.preventDefault()` (disabling drop)

### Requirement: Drop handler
On drop, the sidebar SHALL parse the drag data, verify source and target are in the same session, call `moveWindow(session, sourceIndex, targetIndex)`, and navigate to `/${server}/${session}/${targetIndex}`.

#### Scenario: Drop window to new position
- **GIVEN** the user is dragging window index 0 from session "work"
- **WHEN** the user drops it at the position of window index 2
- **THEN** `moveWindow("work", 0, 2)` is called
- **AND** the browser navigates to `/$server/work/2`

#### Scenario: Drop on same position
- **GIVEN** the user drags window index 1
- **WHEN** the user drops it back on index 1
- **THEN** no API call is made (source === target)

### Requirement: Drag state cleanup
The sidebar MUST clear all drag visual state (drop indicators, drag-over highlights) on `onDragEnd` and `onDrop`. If the user drags outside the sidebar and releases, `onDragEnd` fires and cleans up.

#### Scenario: Drag cancelled
- **GIVEN** the user is dragging a window and drop indicators are visible
- **WHEN** the user presses Escape or drags outside the sidebar
- **THEN** all drop indicators are removed and drag state is reset

## Design Decisions

1. **Swap semantics over insert-and-renumber**: tmux `swap-window` exchanges two windows' positions. An insert-and-renumber approach (`move-window` with `-r`) would cascade index changes, potentially breaking open WebSocket connections that reference specific window indices.
   - *Why*: Minimal blast radius — only two indices change. Existing WebSocket relays at `/relay/{session}/{window}` continue working for all unaffected windows.
   - *Rejected*: `tmux move-window -r` (renumber) — would require closing and reopening all WebSocket connections for windows whose indices shifted.

2. **Native HTML5 DnD over library**: No external drag-and-drop library. The sidebar's flat window list (no nesting, no cross-container) is well-served by native `dragstart`/`dragover`/`drop` events.
   - *Why*: Constitution IV (minimal surface area), zero new dependencies, sidebar structure is simple enough.
   - *Rejected*: `react-beautiful-dnd`, `@dnd-kit/core` — unnecessary complexity for a flat, single-container reorder.

## Clarifications

### Session 2026-04-04 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 5 | Confirmed | — |
| 6 | Confirmed | — |
| 7 | Confirmed | — |
| 8 | Confirmed | — |
| 9 | Confirmed | — |
| 10 | Confirmed | — |
| 11 | Confirmed | — |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `tmux swap-window` for the underlying operation | Confirmed from intake #1 — tmux natively supports it; constitution III mandates wrapping | S:90 R:85 A:95 D:90 |
| 2 | Certain | Use `exec.CommandContext` with standard `withTimeout()` (10s) | Confirmed from intake #2 — constitution I mandates context+timeout for all subprocesses | S:95 R:90 A:95 D:95 |
| 3 | Certain | No external DnD library — native HTML5 drag-and-drop | Confirmed from intake #3 — constitution IV, flat list doesn't need library | S:80 R:85 A:90 D:85 |
| 4 | Certain | Follow existing handler validation pattern (ValidateName, parseWindowIndex, serverFromRequest) | Codebase inspection confirms all window handlers use this exact pattern | S:95 R:90 A:95 D:95 |
| 5 | Certain | Swap semantics, not insert/renumber | Clarified — user confirmed | S:95 R:70 A:80 D:65 |
| 6 | Certain | POST `/{index}/move` endpoint shape | Clarified — user confirmed | S:95 R:80 A:85 D:70 |
| 7 | Certain | No keyboard shortcuts for move actions (CmdK only) | Clarified — user confirmed | S:95 R:90 A:70 D:65 |
| 8 | Certain | Constrain drag to within same session | Clarified — user confirmed | S:95 R:75 A:80 D:80 |
| 9 | Certain | Navigate to targetIndex after swap | Clarified — user confirmed | S:95 R:75 A:80 D:70 |
| 10 | Certain | Exclude move actions from palette when at boundary (not disabled) | Clarified — user confirmed | S:95 R:85 A:80 D:70 |
| 11 | Certain | Use adjacent window index for CmdK move (not arbitrary target) | Clarified — user confirmed | S:95 R:80 A:75 D:75 |

11 assumptions (11 certain, 0 confident, 0 tentative, 0 unresolved).
