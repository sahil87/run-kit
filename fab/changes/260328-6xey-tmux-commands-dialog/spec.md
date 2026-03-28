# Spec: Tmux Commands Dialog

**Change**: 260328-6xey-tmux-commands-dialog
**Created**: 2026-03-28
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## UI: Tmux Commands Dialog Component

### Requirement: Dialog Component

A new `TmuxCommandsDialog` component (`app/frontend/src/components/tmux-commands-dialog.tsx`) SHALL render inside the existing `Dialog` wrapper with the title "tmux commands". The component MUST accept props: `server: string`, `session: string`, `window: string`, `onClose: () => void`.

The dialog SHALL display three command rows, each containing:
1. A label (`text-text-secondary text-[11px]`)
2. The full tmux command in a bordered code block (`bg-bg-inset border border-border rounded px-2 py-1.5 font-mono text-[11px]`)
3. A copy icon button aligned to the right of the code block

#### Scenario: Dialog renders three commands
- **GIVEN** the tmux commands dialog is open with server `runkit`, session `devshell`, window `editor`
- **WHEN** the dialog renders
- **THEN** three command rows are visible with labels "Attach", "New window", "Detach"
- **AND** each row contains a copy button

#### Scenario: Dialog closes on Escape
- **GIVEN** the tmux commands dialog is open
- **WHEN** the user presses Escape
- **THEN** the dialog closes (inherited from `Dialog`)

#### Scenario: Dialog closes on backdrop click
- **GIVEN** the tmux commands dialog is open
- **WHEN** the user clicks the backdrop overlay
- **THEN** the dialog closes (inherited from `Dialog`)

### Requirement: Server-Aware Command Generation

Commands MUST include the `-L {server}` flag when the server is NOT `"default"`. Commands MUST omit the `-L` flag when the server IS `"default"`. This matches the `tmuxExecServer` convention in the backend.

The three commands SHALL be:

| Label | Named server | Default server |
|-------|-------------|----------------|
| Attach | `tmux -L {server} attach-session -t {session}:{window}` | `tmux attach-session -t {session}:{window}` |
| New window | `tmux -L {server} new-window -t {session}` | `tmux new-window -t {session}` |
| Detach | `tmux -L {server} detach-client -t {session}` | `tmux detach-client -t {session}` |

#### Scenario: Named server commands include -L flag
- **GIVEN** the current server is `runkit`
- **WHEN** the tmux commands dialog is rendered
- **THEN** the attach command reads `tmux -L runkit attach-session -t devshell:editor`
- **AND** the new window command reads `tmux -L runkit new-window -t devshell`
- **AND** the detach command reads `tmux -L runkit detach-client -t devshell`

#### Scenario: Default server commands omit -L flag
- **GIVEN** the current server is `default`
- **WHEN** the tmux commands dialog is rendered
- **THEN** the attach command reads `tmux attach-session -t devshell:editor`
- **AND** the new window command reads `tmux new-window -t devshell`
- **AND** the detach command reads `tmux detach-client -t devshell`

### Requirement: Copy to Clipboard with Feedback

Each copy button MUST write the corresponding command text to the clipboard via `navigator.clipboard.writeText`. On successful copy, the icon MUST change from a copy icon to a checkmark for approximately 1.5 seconds, then revert. The copy SHOULD fail silently (`.catch(() => {})`) if the clipboard API is unavailable.

#### Scenario: Copy button copies command and shows feedback
- **GIVEN** the tmux commands dialog is open with the attach command `tmux -L runkit attach-session -t devshell:editor`
- **WHEN** the user clicks the copy button on the attach row
- **THEN** `tmux -L runkit attach-session -t devshell:editor` is written to the clipboard
- **AND** the copy icon changes to a checkmark
- **AND** the checkmark reverts to the copy icon after ~1.5 seconds

#### Scenario: Clipboard unavailable
- **GIVEN** `navigator.clipboard.writeText` is not available
- **WHEN** the user clicks a copy button
- **THEN** nothing happens (no error thrown, no feedback)

## UI: Command Palette Integration

### Requirement: Updated Command Palette Action

The existing command palette action with id `copy-tmux-attach` SHALL be updated:
- The label MUST change from `"Copy: tmux Attach Command"` to `"Copy: tmux Commands"`
- The `onSelect` handler MUST open the tmux commands dialog instead of writing directly to the clipboard
- The action MUST remain gated on `currentWindow` (only available on terminal pages)

#### Scenario: Command palette opens dialog
- **GIVEN** the user is on a terminal page with an active session and window
- **WHEN** the user opens the command palette and selects "Copy: tmux Commands"
- **THEN** the tmux commands dialog opens with the current server, session, and window name

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use existing `Dialog` component | Confirmed from intake #1 — reusable component used throughout `app.tsx` | S:85 R:90 A:95 D:95 |
| 2 | Certain | Omit `-L` flag when server is `"default"` | Confirmed from intake #2 — matches `tmuxExecServer` convention | S:90 R:85 A:95 D:95 |
| 3 | Certain | Three commands: attach, new-window, detach | Confirmed from intake #3 — user explicitly confirmed in discussion | S:95 R:90 A:90 D:95 |
| 4 | Certain | Implement as `tmux-commands-dialog.tsx` component | Upgraded from intake #4 Confident — consistent with `dialog.tsx`, `theme-selector.tsx` pattern | S:80 R:90 A:90 D:90 |
| 5 | Confident | Copy feedback via checkmark icon swap (~1.5s) | Confirmed from intake #5 — standard clipboard feedback pattern | S:55 R:95 A:75 D:70 |
| 6 | Certain | Attach targets `session:window`, new-window and detach target session only | Upgraded from intake #6 — tmux semantics are deterministic here | S:85 R:90 A:90 D:90 |
| 7 | Confident | Dialog state managed via simple `useState` boolean in `app.tsx` | Pattern used by `showCreateServerDialog` and `showKillServerConfirm` — simpler than adding to `useDialogState` | S:65 R:95 A:85 D:70 |

7 assumptions (5 certain, 2 confident, 0 tentative, 0 unresolved).
