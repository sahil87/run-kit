# Intake: Close Pane Button

**Change**: 260326-tbmj-close-pane-button
**Created**: 2026-03-27
**Status**: Draft

## Origin

> In the top bar next to horizontal and vertical split pane buttons, add a close pane button.

One-shot request. The user wants a UI button in the top bar to close/kill the current tmux pane, positioned alongside the existing split pane buttons.

## Why

The top bar currently has buttons to split panes (vertical and horizontal) but no way to close a pane. Users who split panes via the UI have no corresponding UI affordance to close them — they must either use tmux keybindings (`prefix + x`) or the command palette's "Window: Kill" action (which kills the entire window, not just a pane). This is an asymmetry: if you can create panes from the top bar, you should be able to close them there too.

Without this, users unfamiliar with tmux keybindings have no discoverable way to close individual panes they've split.

## What Changes

### Frontend: Close Pane Button in Top Bar

Add a `ClosePaneButton` component in `app/frontend/src/components/top-bar.tsx`, rendered next to the two existing `SplitButton` instances. The button:

- Uses the same styling pattern as `SplitButton` (24x24 min size, rounded border, hover state)
- Shows an "X" or close icon (an SVG matching the 14x14 viewBox convention used by the split icons)
- Is hidden on mobile (`hidden sm:flex`) like the split buttons
- Calls a new `closePane` API client function targeting the active pane by window (no pane ID tracking needed)

### Frontend: API Client Function

Add a `closePane(session: string, index: number)` function in `app/frontend/src/api/client.ts` that POSTs to `POST /api/sessions/{session}/windows/{index}/close-pane`.

### Backend: Close Pane API Endpoint

Add a new route `POST /api/sessions/{session}/windows/{index}/close-pane` in `app/backend/api/router.go` with a handler that kills the active pane of the specified window. Uses a `KillActivePane` tmux function that targets the active pane by window — no pane ID tracking or frontend-to-backend pane ID plumbing required.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the close pane button pattern in the top bar actions section

## Impact

- **Frontend**: `top-bar.tsx` (new button component), `client.ts` (new API function), types if pane ID needs threading
- **Backend**: `router.go` (new route), new handler function (or addition to existing handler file like `windows.go`)
- **Existing tests**: Mock interface `mockTmuxOps` already implements `KillPane` — backend test infrastructure is ready
- **Command palette**: May want a corresponding "Pane: Kill" action for keyboard-first users (constitution V)

## Open Questions

- How does the frontend currently know the active pane ID? Is it available from the WebSocket connection context or does it need to be added to the SSE session state?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Button placement next to split buttons in top bar | Explicit in user request | S:95 R:90 A:95 D:95 |
| 2 | Certain | Same styling as existing split buttons (24x24, border, hover) | Codebase pattern — all top bar buttons use identical styling | S:80 R:95 A:95 D:95 |
| 3 | Certain | Hidden on mobile (`hidden sm:flex`) like split buttons | Codebase pattern — split buttons already use this | S:75 R:90 A:95 D:95 |
| 4 | Certain | Use existing `tmux.KillPane` backend function | Already implemented in tmux.go and wired in router.go interface | S:85 R:95 A:95 D:95 |
| 5 | Confident | API route follows `POST /api/sessions/{session}/windows/{index}/panes/{paneId}/kill` pattern | Follows existing route convention (`/kill` suffix for destructive actions) | S:70 R:80 A:80 D:70 |
| 6 | Confident | Button shows an X/close icon | Standard UI convention for close actions, consistent with the minimal icon style | S:70 R:90 A:75 D:70 |
| 7 | Tentative | Pane ID is available from the WebSocket/terminal connection context | Need to verify how pane info flows to the frontend — may require threading pane ID from SSE or WebSocket handshake | S:50 R:60 A:50 D:50 |
<!-- assumed: Pane ID availability — assumed derivable from existing connection context, but may need additional plumbing -->
| 8 | Confident | Add corresponding "Pane: Close" command palette action | Constitution V (keyboard-first) requires every action be keyboard-reachable | S:65 R:85 A:90 D:80 |

8 assumptions (4 certain, 3 confident, 1 tentative, 0 unresolved). Run /fab-clarify to review.
