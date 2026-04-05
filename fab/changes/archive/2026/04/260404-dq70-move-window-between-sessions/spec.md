# Spec: Move Window Between Sessions

**Change**: 260404-dq70-move-window-between-sessions
**Created**: 2026-04-04
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/tmux-sessions.md`

## Non-Goals

- Specifying the destination window index — tmux auto-assigns the next available index in the target session
- Moving multiple windows at once (batch move)
- Moving windows between different tmux servers (only within the active server)

## Backend: tmux Function

### Requirement: MoveWindowToSession

The `internal/tmux` package SHALL expose a `MoveWindowToSession(srcSession string, srcIndex int, dstSession string, server string) error` function that wraps `tmux move-window -s {srcSession}:{srcIndex} -t {dstSession}:`.

The function MUST use `tmuxExecServer` with `withTimeout()` context, consistent with existing tmux functions (`SwapWindow`, `KillWindow`).

#### Scenario: Successful cross-session move
- **GIVEN** session "alpha" has a window at index 2 and session "bravo" exists
- **WHEN** `MoveWindowToSession("alpha", 2, "bravo", server)` is called
- **THEN** tmux executes `move-window -s alpha:2 -t bravo:`
- **AND** the function returns nil

#### Scenario: Source window does not exist
- **GIVEN** session "alpha" has no window at index 99
- **WHEN** `MoveWindowToSession("alpha", 99, "bravo", server)` is called
- **THEN** the function returns the tmux error (e.g., "can't find window 99")

#### Scenario: Destination session does not exist
- **GIVEN** session "nonexistent" does not exist
- **WHEN** `MoveWindowToSession("alpha", 0, "nonexistent", server)` is called
- **THEN** the function returns the tmux error

## Backend: API Endpoint

### Requirement: Move-to-session endpoint

The server SHALL expose `POST /api/sessions/{session}/windows/{index}/move-to-session` in `api/windows.go`.

The request body MUST contain:
```json
{ "targetSession": "string" }
```

The handler MUST validate:
1. Source `session` name via `validate.ValidateName`
2. Window `index` via `parseWindowIndex`
3. `targetSession` via `validate.ValidateName`
4. `targetSession` MUST differ from `session` — return 400 `"targetSession must differ from source session"` if equal

On success: return `200 { "ok": true }`.

The `TmuxOps` interface in `router.go` MUST be extended with:
```go
MoveWindowToSession(srcSession string, srcIndex int, dstSession string, server string) error
```

The `prodTmuxOps` struct MUST delegate to `tmux.MoveWindowToSession`.

The route MUST be registered alongside existing window routes in the router.

#### Scenario: Valid cross-session move via API
- **GIVEN** the server is running and sessions "alpha" and "bravo" exist
- **WHEN** `POST /api/sessions/alpha/windows/1/move-to-session` with body `{"targetSession": "bravo"}` and `?server=default`
- **THEN** response is `200 {"ok": true}`
- **AND** window 1 is no longer in session "alpha"

#### Scenario: Same session rejected
- **GIVEN** session "alpha" exists
- **WHEN** `POST /api/sessions/alpha/windows/0/move-to-session` with body `{"targetSession": "alpha"}`
- **THEN** response is `400 {"error": "targetSession must differ from source session"}`

#### Scenario: Invalid target session name
- **WHEN** `POST /api/sessions/alpha/windows/0/move-to-session` with body `{"targetSession": "bad;name"}`
- **THEN** response is `400` with validation error

#### Scenario: Missing targetSession field
- **WHEN** `POST /api/sessions/alpha/windows/0/move-to-session` with body `{}`
- **THEN** response is `400 {"error": "targetSession is required"}`

## Frontend: API Client

### Requirement: moveWindowToSession function

`api/client.ts` SHALL export a `moveWindowToSession(session: string, index: number, targetSession: string): Promise<{ ok: boolean }>` function.

The function MUST call `POST /api/sessions/{session}/windows/{index}/move-to-session` with body `{ "targetSession": targetSession }` and include the `?server=` parameter via `withServer()`.

#### Scenario: Client function calls correct endpoint
- **GIVEN** the API client is configured with server "runkit"
- **WHEN** `moveWindowToSession("alpha", 2, "bravo")` is called
- **THEN** a POST request is sent to `/api/sessions/alpha/windows/2/move-to-session?server=runkit` with body `{"targetSession":"bravo"}`

## Frontend: CmdK Action

### Requirement: Move to Session command palette actions

The `app.tsx` command palette actions SHALL include dynamically generated "Window: Move to {sessionName}" actions for each session other than the current one.
<!-- clarified: flat action list per session — confirmed by codebase analysis: PaletteAction type has no sub-menu/children support, existing actions are all direct-execute -->

The actions MUST only appear when:
1. A window is currently selected (`currentWindow` exists)
2. There are at least 2 sessions in the sessions list

Each action:
- **ID**: `move-window-to-session-{sessionName}`
- **Label**: `Window: Move to {sessionName}`
- **onSelect**: Calls `moveWindowToSession(currentSession, currentWindow.index, targetSession)`, then navigates to `/$server` (the server dashboard view)
<!-- clarified: route structure has no /$server/$session path — only /$server (dashboard) and /$server/$session/$window (terminal). Post-move navigation goes to /$server which shows all sessions. -->

Navigation goes to the server dashboard (not a specific window) because tmux auto-assigns the window index in the destination session and there is no session-only route (`/$server/$session` does not exist).

#### Scenario: Two sessions — one action appears
- **GIVEN** sessions "alpha" and "bravo" exist and the user is viewing window 0 in "alpha"
- **WHEN** the user opens the command palette
- **THEN** the action "Window: Move to bravo" is visible
- **AND** no "Window: Move to alpha" action exists

#### Scenario: Three sessions — two actions appear
- **GIVEN** sessions "alpha", "bravo", and "charlie" exist and the user is viewing window 0 in "alpha"
- **WHEN** the user opens the command palette
- **THEN** actions "Window: Move to bravo" and "Window: Move to charlie" are visible

#### Scenario: Single session — no action
- **GIVEN** only session "alpha" exists
- **WHEN** the user opens the command palette
- **THEN** no "Window: Move to..." actions appear

#### Scenario: No window selected — no action
- **GIVEN** sessions "alpha" and "bravo" exist but no window is selected (dashboard view)
- **WHEN** the user opens the command palette
- **THEN** no "Window: Move to..." actions appear

#### Scenario: Successful move navigates to target session
- **GIVEN** the user is viewing window 1 in "alpha" and selects "Window: Move to bravo"
- **WHEN** the move API call succeeds
- **THEN** the browser navigates to `/$server` (server dashboard)

## Frontend: Cross-Session Drag-and-Drop

### Requirement: Cross-session drag to session header

The sidebar (`sidebar.tsx`) SHALL allow dropping a window onto a different session's header to move it to that session.

The `handleDragOver` function MUST accept drag events on session headers for windows from a different session. The existing same-session window-to-window drag-and-drop MUST remain unchanged.

When a window is dropped on a different session's header:
1. Call `moveWindowToSession(sourceSession, sourceIndex, targetSession)`
2. On success, navigate to `/$server` via `navigate({ to: "/$server", params: { server } })` (server dashboard — no session-only route exists)

Visual feedback: The session header MUST show an accent border (`border-accent`) when a valid cross-session drop is hovering over it.

#### Scenario: Drag window from alpha to bravo session header
- **GIVEN** the user is dragging window 2 from session "alpha"
- **WHEN** the user drops it on the "bravo" session header
- **THEN** `moveWindowToSession("alpha", 2, "bravo")` is called
- **AND** the browser navigates to `/$server` (server dashboard)

#### Scenario: Drag window onto same session header — no-op
- **GIVEN** the user is dragging window 1 from session "alpha"
- **WHEN** the user hovers over the "alpha" session header
- **THEN** no drop indicator appears (same session, not a valid cross-session target)

#### Scenario: Visual feedback on valid cross-session hover
- **GIVEN** the user is dragging a window from session "alpha"
- **WHEN** the user hovers over the "bravo" session header
- **THEN** the "bravo" header shows an accent border highlight

#### Scenario: Within-session drag-and-drop unchanged
- **GIVEN** the user is dragging window 0 within session "alpha"
- **WHEN** the user drops it on window 2 in session "alpha"
- **THEN** the existing `moveWindow` (swap) behavior executes as before

## Design Decisions

1. **Flat action list instead of sub-picker**: Generate one CmdK action per target session ("Window: Move to {name}") rather than a two-step "Move to Session..." → session picker flow.
   - *Why*: The existing `PaletteAction` type has no sub-menu concept. A flat list works well for typical session counts (2-5) and requires zero changes to the command palette component.
   - *Rejected*: Sub-picker / nested menu — would require new `PaletteAction` semantics (`children` or `subActions`), more complex keyboard navigation, and the palette already has good text filtering for quick access.

2. **Session header as drop target instead of window-to-window cross-session drops**: Only allow cross-session drops on session headers, not on individual windows in other sessions.
   - *Why*: Dropping on another session's window would be ambiguous — does it mean "move to that session" or "swap with that window across sessions"? Session header is unambiguous: "put this window in that session." tmux auto-assigns the index anyway.
   - *Rejected*: Window-to-window cross-session drop — semantically ambiguous, tmux `move-window` doesn't support placing at a specific index.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `tmux move-window` for cross-session moves | Confirmed from intake #1 — canonical tmux command, no alternative | S:90 R:95 A:95 D:95 |
| 2 | Certain | Navigate to server dashboard (`/$server`) after move | Clarified — no `/$server/$session` route exists; server dashboard is the correct landing; tmux auto-assigns index | S:80 R:90 A:85 D:90 |
| 3 | Certain | Separate endpoint `/move-to-session` from existing `/move` | Confirmed from intake #3 — different tmux commands, different semantics | S:85 R:85 A:90 D:90 |
| 4 | Certain | Drop on session header for cross-session moves | Upgraded from intake #4 Confident — spec analysis confirms this is unambiguous vs window-to-window which would be ambiguous | S:80 R:85 A:85 D:90 |
| 5 | Certain | Flat CmdK action list per session instead of sub-picker | Upgraded from intake #5 Confident — `PaletteAction` type has no sub-menu support, flat list works for typical session counts, zero palette changes needed | S:85 R:90 A:90 D:85 |
| 6 | Certain | Return 400 when source and target session are the same | Confirmed from intake #6 — clear boundary | S:85 R:90 A:90 D:95 |
| 7 | Certain | Only session-header drops for cross-session (not window-to-window) | Derived from design decision #2 — avoids ambiguity, aligns with tmux semantics | S:80 R:85 A:85 D:90 |
| 8 | Confident | No optimistic UI for cross-session moves | Cross-session moves change the session structure itself; SSE will reflect the new state within 2.5s polling cycle. Optimistic update would require predicting the auto-assigned index. | S:70 R:80 A:75 D:70 |

8 assumptions (7 certain, 1 confident, 0 tentative, 0 unresolved).
