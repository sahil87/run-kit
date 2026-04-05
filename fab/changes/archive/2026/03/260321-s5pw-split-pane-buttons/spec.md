# Spec: Split Pane Buttons

**Change**: 260321-s5pw-split-pane-buttons
**Created**: 2026-03-21
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## API: Split Window Endpoint

### Requirement: Split Window API

The server MUST expose `POST /api/sessions/{session}/windows/{index}/split` to split a tmux pane.

The request body MUST accept a JSON object with a `horizontal` boolean field. When `horizontal` is `true`, tmux SHALL split left/right (`-h` flag). When `false`, tmux SHALL split top/bottom (default).

The response MUST return `{ "ok": "true", "pane_id": "{id}" }` on success.

#### Scenario: Horizontal Split

- **GIVEN** a terminal session "work" with window index 0
- **WHEN** `POST /api/sessions/work/windows/0/split` with `{ "horizontal": true }`
- **THEN** tmux splits the pane left/right
- **AND** the response contains the new pane ID

#### Scenario: Vertical Split

- **GIVEN** a terminal session "work" with window index 0
- **WHEN** `POST /api/sessions/work/windows/0/split` with `{ "horizontal": false }`
- **THEN** tmux splits the pane top/bottom
- **AND** the response contains the new pane ID

#### Scenario: Invalid Session

- **GIVEN** session name contains invalid characters
- **WHEN** the split endpoint is called
- **THEN** the server MUST return 400 with validation error

## UI Chrome: Split Buttons

### Requirement: Split Buttons in Top Bar

The top bar MUST render two split buttons between the FixedWidthToggle and ThemeToggle when a window is selected (`currentWindow` exists).

The first button MUST trigger a horizontal split (vertical divider icon). The second button MUST trigger a vertical split (horizontal divider icon).

Both buttons MUST be hidden on mobile (`hidden sm:flex`), use `text-text-secondary` default color, and follow the standard toolbar button sizing pattern.

#### Scenario: Split Buttons Visible on Desktop

- **GIVEN** a terminal page with an active window
- **WHEN** the top bar renders on a desktop viewport (>= 640px)
- **THEN** both split buttons are visible between FixedWidthToggle and ThemeToggle

#### Scenario: Split Buttons Hidden on Mobile

- **GIVEN** a terminal page with an active window
- **WHEN** the top bar renders on a mobile viewport (< 640px)
- **THEN** split buttons are not visible

#### Scenario: No Window Selected

- **GIVEN** the Dashboard route (`/`) with no window selected
- **WHEN** the top bar renders
- **THEN** split buttons are not rendered

### Requirement: Best-Effort Error Handling

Split button click errors MUST be silently swallowed. Tmux MAY reject a split if the pane is too small — there is no meaningful recovery action for the user.

#### Scenario: Tmux Rejects Split

- **GIVEN** the current pane is too small to split
- **WHEN** the user clicks a split button
- **THEN** the error is caught and no error UI is shown

## Backend: SplitWindow Function

### Requirement: Horizontal Flag Support

The `tmux.SplitWindow` function MUST accept a `horizontal bool` parameter. When true, it MUST pass `-h` to `tmux split-window`. The function MUST use `exec.CommandContext` with timeout per constitution.

#### Scenario: Horizontal Flag Passed

- **GIVEN** `SplitWindow` is called with `horizontal=true`
- **WHEN** the tmux command is constructed
- **THEN** the args slice includes `-h` before `-t`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Split buttons hidden on mobile | Confirmed from intake #1 — follows existing `hidden sm:flex` pattern | S:90 R:85 A:90 D:95 |
| 2 | Certain | Best-effort error handling | Confirmed from intake #2 — no recovery action possible | S:85 R:90 A:85 D:90 |
| 3 | Certain | Buttons conditional on `currentWindow` | Confirmed from intake #3 — can't split without window context | S:90 R:90 A:95 D:95 |

3 assumptions (3 certain, 0 confident, 0 tentative, 0 unresolved).
