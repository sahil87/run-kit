# Spec: Close Pane Button

**Change**: 260326-tbmj-close-pane-button
**Created**: 2026-03-27
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Pane ID tracking on the frontend — not needed since we target the active pane by window
- Multi-pane selection or bulk close — only the active pane of the current window is closed
- Confirmation dialog — the split buttons don't confirm, and closing a pane is low-stakes (tmux processes survive)

## Backend: Kill Active Pane

### Requirement: KillActivePane tmux function

The `internal/tmux` package SHALL provide a `KillActivePane(session string, window int, server string) error` function that kills the active pane of the specified window by targeting `session:window` with `tmux kill-pane -t`.

#### Scenario: Kill active pane in multi-pane window
- **GIVEN** a tmux window `mysession:0` has 2+ panes
- **WHEN** `KillActivePane("mysession", 0, "default")` is called
- **THEN** the active pane of window 0 is killed
- **AND** the remaining panes stay alive
- **AND** the function returns `nil`

#### Scenario: Kill last pane in window
- **GIVEN** a tmux window `mysession:0` has exactly 1 pane
- **WHEN** `KillActivePane("mysession", 0, "default")` is called
- **THEN** tmux kills the pane (which destroys the window)
- **AND** the function returns `nil` (errors silently ignored, matching `KillPane` pattern)

#### Scenario: Pane already dead
- **GIVEN** the target pane has already been killed
- **WHEN** `KillActivePane` is called
- **THEN** the function returns `nil` (tmux error silently ignored)

### Requirement: TmuxOps interface extension

The `TmuxOps` interface in `api/router.go` SHALL include `KillActivePane(session string, window int, server string) error`. The `prodTmuxOps` struct SHALL delegate to `tmux.KillActivePane`.

#### Scenario: Interface wiring
- **GIVEN** the `TmuxOps` interface includes `KillActivePane`
- **WHEN** `prodTmuxOps.KillActivePane("s", 0, "default")` is called
- **THEN** it delegates to `tmux.KillActivePane("s", 0, "default")`

### Requirement: Close Pane API endpoint

The server SHALL expose `POST /api/sessions/{session}/windows/{index}/close-pane` that kills the active pane of the specified window.

#### Scenario: Successful close
- **GIVEN** session `main` exists with window index `0` containing 2+ panes
- **WHEN** `POST /api/sessions/main/windows/0/close-pane` is sent
- **THEN** response status is `200 OK`
- **AND** response body is `{"ok": true}`
- **AND** the active pane of `main:0` is killed

#### Scenario: Invalid session name
- **GIVEN** session name contains invalid characters
- **WHEN** `POST /api/sessions/<invalid>/windows/0/close-pane` is sent
- **THEN** response status is `400 Bad Request`
- **AND** response body contains `{"error": "..."}`

#### Scenario: Invalid window index
- **GIVEN** window index is not a non-negative integer
- **WHEN** `POST /api/sessions/main/windows/abc/close-pane` is sent
- **THEN** response status is `400 Bad Request`

## Frontend: Close Pane Button

### Requirement: ClosePaneButton component

The `top-bar.tsx` file SHALL include a `ClosePaneButton` component rendered in the top bar right section, positioned after the two `SplitButton` instances and before the `FixedWidthToggle`.

The button SHALL:
- Use the same base styling as `SplitButton`: `min-w-[24px] min-h-[24px] rounded border border-border text-text-secondary hover:border-text-secondary transition-colors flex items-center justify-center`
- Display a close icon (X shape) as an SVG with `width="14" height="14" viewBox="0 0 24 24"` matching the split button icon convention
- Be wrapped in `<span className="hidden sm:flex">` (hidden on mobile, matching split buttons)
- Only render when `currentWindow` exists (matching split button conditional)

#### Scenario: Button renders on desktop with a window selected
- **GIVEN** the user is on a terminal route (`/$server/$session/$window`) at viewport >= 640px
- **WHEN** the top bar renders
- **THEN** the close pane button appears after the split buttons and before the fixed-width toggle
- **AND** the button has `aria-label="Close pane"`

#### Scenario: Button hidden on mobile
- **GIVEN** viewport width < 640px
- **WHEN** the top bar renders
- **THEN** the close pane button is not visible (`hidden sm:flex`)

#### Scenario: Button not rendered on dashboard
- **GIVEN** the user is on the dashboard route (no window selected)
- **WHEN** the top bar renders
- **THEN** no close pane button appears

### Requirement: Close pane API client function

The `api/client.ts` file SHALL export a `closePane(session: string, index: number)` function that POSTs to `/api/sessions/{session}/windows/{index}/close-pane`.

#### Scenario: Successful API call
- **GIVEN** a valid session and window index
- **WHEN** `closePane("main", 0)` is called
- **THEN** a `POST` request is sent to `/api/sessions/main/windows/0/close-pane?server=...`
- **AND** the function returns `Promise<{ ok: boolean }>`

### Requirement: Button click behavior

When the close pane button is clicked, it SHALL call `closePane(session, windowIndex)` with best-effort error handling (`.catch(() => {})`) matching the split button pattern.

#### Scenario: User clicks close pane
- **GIVEN** the user is viewing `session:window` with multiple panes
- **WHEN** the user clicks the close pane button
- **THEN** the active pane is killed via API call
- **AND** the terminal view updates via SSE (remaining panes visible)

#### Scenario: Last pane closed
- **GIVEN** the user is viewing `session:window` with exactly 1 pane
- **WHEN** the user clicks the close pane button
- **THEN** the pane (and window) is killed
- **AND** the SSE update reflects the window removal
- **AND** the existing window-killed redirect logic handles navigation

## Frontend: Command Palette Action

### Requirement: Pane close command palette entry

The command palette in `app.tsx` SHALL include a "Pane: Close" action, positioned after the "Window: Split Horizontal" entry within the `currentWindow` conditional block.

#### Scenario: User invokes close pane via command palette
- **GIVEN** the user has a window selected and opens the command palette
- **WHEN** the user selects "Pane: Close"
- **THEN** `closePane(session, windowIndex)` is called
- **AND** the command palette closes

#### Scenario: No window selected
- **GIVEN** the user is on the dashboard (no window selected)
- **WHEN** the command palette opens
- **THEN** "Pane: Close" is not listed

## Design Decisions

1. **Target active pane by window, not by pane ID**: Kill the active pane using `tmux kill-pane -t session:window` rather than tracking individual pane IDs on the frontend.
   - *Why*: The frontend has no pane ID state — WebSocket connects to windows, SSE broadcasts window-level data. Adding pane tracking would be a disproportionate change for this feature.
   - *Rejected*: Passing pane IDs from split responses to a close button — would require new state management, and the split response's pane ID may be stale if the user switches panes in tmux.

2. **New `KillActivePane` function rather than reusing `KillPane`**: The existing `KillPane(paneID, server)` expects a pane ID string. Rather than passing `session:window` to a parameter named `paneID`, create a semantically clear `KillActivePane(session, window, server)`.
   - *Why*: Type safety and readability — the parameter names document intent.
   - *Rejected*: Reusing `KillPane` with a window target — technically works but semantically misleading.

3. **No confirmation dialog**: Matches the split buttons which also have no confirmation. Closing a pane is low-stakes — tmux processes continue, and the action is easily undone by splitting again.
   - *Why*: Consistency with existing pane actions (split) and the principle that the UI should be fast for keyboard-first users.
   - *Rejected*: Confirm dialog like "Window: Kill" — window kill is higher stakes (loses all panes); pane close only affects one pane.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Button placement after split buttons, before FixedWidthToggle | Explicit in user request + natural grouping (pane actions together) | S:95 R:90 A:95 D:95 |
| 2 | Certain | Same styling as SplitButton (24x24, border, hover) | Codebase pattern — all top bar buttons use identical styling | S:85 R:95 A:95 D:95 |
| 3 | Certain | Hidden on mobile (`hidden sm:flex`) | Codebase pattern — split buttons already use this | S:80 R:90 A:95 D:95 |
| 4 | Certain | Use `tmux kill-pane -t session:window` (active pane targeting) | Investigated — frontend has no pane IDs; window targeting is the clean approach | S:90 R:90 A:95 D:95 |
| 5 | Certain | New `KillActivePane` function in tmux package | Semantically distinct from existing `KillPane(paneID)` — different targeting | S:85 R:90 A:90 D:90 |
| 6 | Certain | Route `POST /api/sessions/{session}/windows/{index}/close-pane` | Follows existing route patterns (`/kill`, `/split` under windows) | S:80 R:85 A:90 D:85 |
| 7 | Certain | X icon for the button SVG | Universal close icon, consistent with minimal icon style | S:75 R:95 A:90 D:90 |
| 8 | Certain | No confirmation dialog | Consistent with split buttons; pane close is low-stakes | S:80 R:85 A:85 D:90 |
| 9 | Certain | Command palette "Pane: Close" action | Constitution V (keyboard-first) — every action must be keyboard-reachable | S:75 R:90 A:95 D:90 |
| 10 | Certain | Best-effort error handling (`.catch(() => {})`) | Matches split button pattern — tmux may reject | S:80 R:95 A:95 D:95 |
| 11 | Confident | Last-pane-close handled by existing window-kill redirect logic | SSE update removes window; existing frontend handles missing windows | S:70 R:75 A:75 D:75 |

11 assumptions (10 certain, 1 confident, 0 tentative, 0 unresolved).
