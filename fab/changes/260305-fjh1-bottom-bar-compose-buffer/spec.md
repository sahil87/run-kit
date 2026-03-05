# Spec: Bottom Bar + Compose Buffer

**Change**: 260305-fjh1-bottom-bar-compose-buffer
**Created**: 2026-03-06
**Affected memory**: `docs/memory/run-kit/architecture.md`, `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Modifying the terminal relay (`src/terminal-relay/server.ts`) — it already handles burst text via `ptyProcess.write(message)`
- Mobile Line 2 collapse (`...` button) — separate design concern per `docs/specs/design.md`
- E2E / Playwright tests for mobile viewport — called out as a separate change in design spec

## Bottom Bar

### Requirement: Bottom Bar Rendering

The bottom bar component (`src/components/bottom-bar.tsx`) SHALL render a single row of `<kbd>` styled buttons on the terminal page only. The bar SHALL be injected into the layout's bottom slot via `setBottomBar()` from `ChromeProvider`.

The bar SHALL contain, in order: modifier toggles (`Ctrl`, `Alt`, `Cmd`), a visual separator, arrow keys (`←`, `→`, `↑`, `↓`), a visual separator, `Fn▾` dropdown, `Esc`, `Tab`, and `✎` (compose toggle).

All buttons SHALL have a minimum height of 44px (Apple HIG touch target).

The component SHALL be a Client Component (`"use client"`) that receives a WebSocket ref (`wsRef: React.RefObject<WebSocket | null>`) to send keystrokes directly.

#### Scenario: Bottom bar appears on terminal page

- **GIVEN** a user navigates to a terminal page (`/p/:project/:window`)
- **WHEN** the `TerminalClient` component mounts
- **THEN** `setBottomBar(<BottomBar ... />)` is called with the WebSocket ref
- **AND** the bottom bar renders in the layout's bottom slot with all button groups visible

#### Scenario: Bottom bar absent on non-terminal pages

- **GIVEN** a user is on the Dashboard (`/`) or Project page (`/p/:project`)
- **WHEN** the page renders
- **THEN** the bottom slot is empty (no bottom bar content)

#### Scenario: Bottom bar clears on navigation away

- **GIVEN** the user is on a terminal page with the bottom bar visible
- **WHEN** the user navigates to the Dashboard or Project page
- **THEN** `setBottomBar(null)` is called during cleanup
- **AND** the bottom slot becomes empty

### Requirement: Modifier Toggles

The modifier state SHALL be managed by a custom hook (`src/hooks/use-modifier-state.ts`) exposing `ctrl`, `alt`, `cmd` boolean flags plus `arm`, `disarm`, `toggle`, and `consume` functions.

Clicking a modifier button SHALL toggle its armed state. An armed modifier SHALL display a visual "armed" indicator (accent background or bright border). Armed modifiers SHALL combine with the next key sent through the WebSocket.

`consume()` SHALL return the current modifier state (`{ ctrl, alt, cmd }`) and clear all armed modifiers atomically. It SHALL be called by key-sending functions before transmitting each keystroke.

#### Scenario: Arm and auto-clear a modifier

- **GIVEN** no modifiers are armed
- **WHEN** the user taps `Ctrl`
- **THEN** the `Ctrl` button shows an armed visual state
- **AND** when the user taps `↑` (arrow up)
- **THEN** the ANSI sequence for Ctrl+Up is sent through the WebSocket
- **AND** the `Ctrl` button returns to its default (disarmed) visual state

#### Scenario: Disarm a modifier without sending a key

- **GIVEN** `Alt` is armed
- **WHEN** the user taps `Alt` again
- **THEN** `Alt` is disarmed and returns to default visual state
- **AND** no keystroke is sent

#### Scenario: Multiple modifiers armed simultaneously

- **GIVEN** no modifiers are armed
- **WHEN** the user taps `Ctrl` then taps `Alt`
- **THEN** both `Ctrl` and `Alt` show armed visual state
- **AND** when the user sends any key, both modifiers are combined with that key
- **AND** both modifiers clear after the key is sent

### Requirement: Arrow Keys

The arrow key buttons (`←`, `→`, `↑`, `↓`) SHALL each send the corresponding ANSI escape sequence through the WebSocket when tapped. Arrow keys SHALL respect armed modifiers — e.g., tapping `Ctrl` then `↑` sends the Ctrl+Up sequence.

The ANSI sequences SHALL be:
- `←`: `\x1b[D` (with modifiers: `\x1b[1;{mod}D`)
- `→`: `\x1b[C` (with modifiers: `\x1b[1;{mod}C`)
- `↑`: `\x1b[A` (with modifiers: `\x1b[1;{mod}A`)
- `↓`: `\x1b[B` (with modifiers: `\x1b[1;{mod}B`)

Where `{mod}` is the xterm modifier parameter: 2=Shift, 3=Alt, 4=Shift+Alt, 5=Ctrl, 6=Ctrl+Shift, 7=Ctrl+Alt, 8=Ctrl+Shift+Alt, 9=Cmd (mapped to Meta where applicable).

#### Scenario: Arrow key sends plain sequence

- **GIVEN** no modifiers are armed
- **WHEN** the user taps `↑`
- **THEN** `\x1b[A` is sent through the WebSocket

#### Scenario: Arrow key with armed modifier

- **GIVEN** `Ctrl` is armed
- **WHEN** the user taps `↑`
- **THEN** `\x1b[1;5A` is sent through the WebSocket (Ctrl+Up)
- **AND** `Ctrl` is disarmed

### Requirement: Function Key Dropdown

A `Fn▾` button SHALL open a dropdown menu containing F1-F12, PgUp, PgDn, Home, and End. Each item SHALL send its corresponding ANSI escape sequence when selected. The dropdown SHALL close after each selection.

The dropdown SHALL also close when clicking outside of it or pressing `Escape`.

#### Scenario: Select a function key

- **GIVEN** the `Fn▾` dropdown is closed
- **WHEN** the user taps `Fn▾`
- **THEN** the dropdown opens showing F1-F12, PgUp, PgDn, Home, End
- **AND** when the user taps `F5`
- **THEN** the F5 escape sequence (`\x1b[15~`) is sent through the WebSocket
- **AND** the dropdown closes

#### Scenario: Function key respects armed modifiers

- **GIVEN** `Ctrl` is armed and the `Fn▾` dropdown is open
- **WHEN** the user taps `F5`
- **THEN** the Ctrl+F5 escape sequence (`\x1b[15;5~`) is sent
- **AND** `Ctrl` is disarmed
- **AND** the dropdown closes

#### Scenario: Dismiss dropdown without selection

- **GIVEN** the `Fn▾` dropdown is open
- **WHEN** the user taps outside the dropdown
- **THEN** the dropdown closes
- **AND** no keystrokes are sent

### Requirement: Special Keys

`Esc` and `Tab` buttons SHALL send their respective characters directly through the WebSocket. `Esc` sends `\x1b`. `Tab` sends `\t`. Both SHALL respect armed modifiers.

#### Scenario: Send Esc

- **GIVEN** no modifiers are armed
- **WHEN** the user taps `Esc`
- **THEN** `\x1b` is sent through the WebSocket

#### Scenario: Send Tab

- **GIVEN** no modifiers are armed
- **WHEN** the user taps `Tab`
- **THEN** `\t` is sent through the WebSocket

## Compose Buffer

### Requirement: Compose Buffer Overlay

The compose buffer component (`src/components/compose-buffer.tsx`) SHALL render a native `<textarea>` overlay triggered by the `✎` button on the bottom bar.

When opened, the terminal SHALL dim (`opacity-50`) and the textarea SHALL slide up from the bottom bar. The textarea SHALL receive `autoFocus`. A `Send` button SHALL appear within the compose overlay.

When the compose buffer is visible, the bottom bar SHALL remain visible below it.

#### Scenario: Open compose buffer

- **GIVEN** the user is on a terminal page with the bottom bar visible
- **WHEN** the user taps the `✎` button
- **THEN** a `<textarea>` overlay appears above the bottom bar
- **AND** the terminal output dims to `opacity-50`
- **AND** the textarea is auto-focused

#### Scenario: Compose and send text

- **GIVEN** the compose buffer is open
- **WHEN** the user types "ls -la" and taps the `Send` button
- **THEN** the string "ls -la" is sent as a single WebSocket message
- **AND** the compose buffer closes
- **AND** the terminal output restores to full opacity

#### Scenario: Send via keyboard shortcut (desktop)

- **GIVEN** the compose buffer is open on a desktop browser
- **WHEN** the user types text and presses `Cmd+Enter` (or `Ctrl+Enter` on non-Mac)
- **THEN** the text is sent as a single WebSocket message
- **AND** the compose buffer closes

#### Scenario: Dismiss compose without sending

- **GIVEN** the compose buffer is open
- **WHEN** the user presses `Escape`
- **THEN** the compose buffer closes without sending
- **AND** the terminal output restores to full opacity
- **AND** any typed text is discarded

### Requirement: Desktop Compose Toggle

On desktop, pressing `i` when the terminal has focus (and the compose buffer is not already open) SHALL open the compose buffer. This provides a vim-like "insert mode" mental model.

The `i` key SHALL NOT trigger when the compose buffer is already open (it is a regular character in the textarea). The `i` key SHALL NOT trigger when focus is in another input element (e.g., command palette search).

#### Scenario: Toggle compose with `i` key

- **GIVEN** the terminal page is active and the compose buffer is closed
- **WHEN** the user presses `i` on their physical keyboard
- **THEN** the compose buffer opens with the textarea focused
- **AND** the `i` keypress is NOT sent to the terminal

#### Scenario: `i` key inside compose textarea

- **GIVEN** the compose buffer is open and the textarea is focused
- **WHEN** the user presses `i`
- **THEN** the character `i` is typed into the textarea (normal input behavior)
- **AND** the compose buffer does NOT close

### Requirement: Native Input Features

The compose buffer textarea SHALL support all OS-level input features including:
- iOS dictation (microphone button)
- Autocorrect and predictive text
- Clipboard paste (including large text blocks)
- Multiline input
- IME (Input Method Editor) for CJK languages

These features work because the compose buffer is a real DOM `<textarea>` element, not a canvas.

#### Scenario: Paste large text block

- **GIVEN** the compose buffer is open
- **WHEN** the user pastes a 500-line heredoc from the clipboard
- **THEN** the text appears in the textarea
- **AND** on `Send`, the entire 500 lines are transmitted as one WebSocket message
- **AND** the relay writes it to the pty in a single `write()` call

## iOS Keyboard Detection

### Requirement: Visual Viewport Constraint

A custom hook (`src/hooks/use-visual-viewport.ts`) SHALL use the `window.visualViewport` API to detect the iOS on-screen keyboard and constrain the app's height.

When the visual viewport height changes (keyboard appears/disappears), the hook SHALL set the document's height to match `visualViewport.height`. This keeps the bottom bar pinned above the iOS keyboard.

The terminal (`flex-1`) SHALL shrink as the keyboard takes space. xterm's `FitAddon` SHALL refit to the remaining height automatically (via the existing `ResizeObserver` in `terminal-client.tsx`).

The hook SHALL be a no-op on desktop browsers where the visual viewport matches the layout viewport.

#### Scenario: iOS keyboard appears

- **GIVEN** the user is on a terminal page on an iOS device
- **WHEN** the iOS on-screen keyboard opens (e.g., by tapping the compose textarea)
- **THEN** the app's height is constrained to `visualViewport.height`
- **AND** the bottom bar remains visible above the keyboard
- **AND** the terminal shrinks to fit the reduced space
- **AND** xterm refits its rows/columns to the smaller area

#### Scenario: iOS keyboard dismisses

- **GIVEN** the iOS keyboard is open and the app height is constrained
- **WHEN** the keyboard dismisses
- **THEN** the app height expands back to the full viewport height
- **AND** the terminal and bottom bar resume their normal sizes

#### Scenario: Desktop browser (no-op)

- **GIVEN** the user is on a desktop browser
- **WHEN** the hook is active
- **THEN** no height constraints are applied (visual viewport matches layout viewport)

## Terminal Page Integration

### Requirement: Bottom Bar Injection

The `TerminalClient` component (`src/app/p/[project]/[window]/terminal-client.tsx`) SHALL call `setBottomBar(<BottomBar wsRef={wsRef} />)` in a `useEffect` on mount. It SHALL call `setBottomBar(null)` on cleanup (unmount/navigation away).

The `BottomBar` component SHALL receive the WebSocket ref from `TerminalClient` to send keystrokes and compose buffer text directly through the existing WebSocket connection.

#### Scenario: Mount terminal with bottom bar

- **GIVEN** the WebSocket connection to the relay is established
- **WHEN** the `TerminalClient` mounts
- **THEN** the bottom bar appears in the layout's bottom slot
- **AND** bottom bar buttons can send keystrokes through the WebSocket

#### Scenario: Navigate away clears bottom bar

- **GIVEN** the user is on a terminal page with the bottom bar visible
- **WHEN** the user navigates to `/p/:project` or `/`
- **THEN** the bottom bar is removed from the layout's bottom slot

### Requirement: Compose `i`-key Integration

The `i` key handler for compose toggle SHALL be integrated into `TerminalClient`'s existing keyboard handling. It SHALL NOT conflict with the double-Esc detection or command palette keyboard shortcuts.

The `i` key SHALL be intercepted at the document level (same as double-Esc) and SHALL prevent the keystroke from reaching xterm when opening compose.

#### Scenario: `i` key does not conflict with double-Esc

- **GIVEN** the terminal is active
- **WHEN** the user presses `i` followed by `Esc` `Esc`
- **THEN** the compose buffer opens on `i`
- **AND** the compose buffer closes on the first `Esc` (dismissing compose)
- **AND** the second `Esc` starts a new double-Esc timer (does not navigate back, since the first Esc was consumed by compose dismiss)

## Design Decisions

1. **No relay changes needed**: The existing relay writes any non-JSON WebSocket message to the pty via `ptyProcess.write(message)` (line 93 of `server.ts`). A compose buffer "Send" simply transmits the text as a plain string — the relay handles it naturally.
   - *Why*: Avoids adding a new message type or protocol change.
   - *Rejected*: Adding a `{ type: "compose", text: "..." }` JSON envelope — unnecessary complexity since raw text already works.

2. **Modifier state as a hook, not a component**: Modifiers are reactive state consumed by multiple button groups (arrows, Fn, special keys). A hook is the natural React pattern for shared state without UI.
   - *Why*: Clean separation between state logic and rendering. Testable in isolation.
   - *Rejected*: Context provider for modifiers — overkill for state used only within the bottom bar component tree.

3. **`i` key for compose toggle (vim-like)**: Terminal users expect `i` for "insert mode". Since the terminal is a canvas (not a text input), the `i` key is available for interception at the document level.
   - *Why*: Familiar to the target audience, discoverable via muscle memory.
   - *Rejected*: `Cmd+Shift+Enter` — requires three keys, unfamiliar.

4. **visualViewport API for iOS keyboard**: This is the standard approach for detecting the iOS virtual keyboard. No reliable `keyboard-show` event exists in mobile Safari.
   - *Why*: Works in Safari/Chrome iOS, standard API, no hacks.
   - *Rejected*: `window.innerHeight` comparison — unreliable, doesn't update on keyboard show/hide in all browsers.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Bottom bar layout: `Ctrl Alt Cmd \| <- -> up down \| Fn Esc Tab compose` | Confirmed from intake #1 — Resolved Decision #10 in design spec | S:95 R:90 A:90 D:95 |
| 2 | Certain | Sticky modifiers with visual armed state, auto-clear on next key | Confirmed from intake #2 — Resolved Decision #3 | S:90 R:90 A:85 D:90 |
| 3 | Certain | Fn dropdown closes after each selection | Confirmed from intake #3 — Resolved Decision #6 | S:90 R:95 A:90 D:95 |
| 4 | Certain | Compose buffer as native textarea overlay with dim terminal | Confirmed from intake #4 — full design in spec | S:95 R:85 A:90 D:90 |
| 5 | Certain | Bottom bar terminal page only, injected via ChromeProvider | Confirmed from intake #5 — Resolved Decision #1, ChromeProvider exists | S:90 R:90 A:95 D:95 |
| 6 | Certain | Modifier bar pins above iOS keyboard via visualViewport | Confirmed from intake #6 — Resolved Decision #7 | S:90 R:80 A:80 D:85 |
| 7 | Certain | No relay changes needed — existing relay handles burst text | Verified from source: `server.ts` line 93, `ptyProcess.write(message)` handles any string. Upgraded from intake Confident #9 | S:95 R:95 A:95 D:95 |
| 8 | Confident | 44px minimum tap height for all bottom bar buttons | Apple HIG standard — confirmed from intake #7. Not verified against actual rendering | S:70 R:90 A:90 D:85 |
| 9 | Confident | Desktop compose toggle via `i` key | Vim-like mental model from intake #8. Easily changed, but untested with real users | S:55 R:95 A:75 D:70 |
| 10 | Confident | ANSI escape sequences use xterm modifier parameter encoding | Standard xterm encoding `\x1b[1;{mod}X` — well-documented but needs testing with actual terminals | S:65 R:85 A:80 D:85 |
| 11 | Certain | Compose sends text as raw WebSocket string (not JSON envelope) | Relay already parses JSON for resize only, falls through to raw write. No new protocol needed | S:95 R:90 A:95 D:95 |
| 12 | Certain | WebSocket ref passed as prop from TerminalClient to BottomBar | Existing pattern — TerminalClient owns the WS connection via `wsRef`, natural to pass down | S:90 R:90 A:95 D:95 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).
