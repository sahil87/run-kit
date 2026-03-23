# Spec: Bottom Bar Focus Steal Fix

**Change**: 260323-bd6n-bottom-bar-focus-steal
**Created**: 2026-03-23
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## UI: Bottom Bar Focus Preservation

### Requirement: Focus-preserving buttons

All bottom bar buttons that send terminal input or toggle modifier state MUST prevent the browser's default focus-shift behavior on `mousedown`. This ensures the xterm.js terminal retains focus and the on-screen keyboard remains visible on touch devices.

The following buttons SHALL include `onMouseDown={(e) => e.preventDefault()}`:
- Escape (`⎋`)
- Tab (`⇥`)
- Ctrl (`^`) modifier toggle
- Alt (`⌥`) modifier toggle
- Function key trigger (`F▴`)
- Compose (`>_`)

#### Scenario: Tap Escape on iOS with keyboard visible
- **GIVEN** the terminal has focus and the iOS on-screen keyboard is visible
- **WHEN** the user taps the Escape button in the bottom bar
- **THEN** the escape sequence is sent to the terminal via WebSocket
- **AND** the terminal retains focus (keyboard stays visible)

#### Scenario: Tap Ctrl then type a letter
- **GIVEN** the terminal has focus and the on-screen keyboard is visible
- **WHEN** the user taps the Ctrl modifier toggle, then types `c` on the keyboard
- **THEN** `Ctrl+C` is sent to the terminal
- **AND** the keyboard remains visible throughout the sequence

#### Scenario: Tap Tab on desktop browser
- **GIVEN** the terminal has focus in a desktop browser
- **WHEN** the user clicks the Tab button in the bottom bar
- **THEN** a tab character is sent to the terminal
- **AND** the terminal retains focus

### Requirement: Function key menu focus preservation

Buttons inside the function key popup menu (F1–F12, PgUp, PgDn, Home, End, Ins, Del) MUST also prevent focus steal via `onMouseDown={(e) => e.preventDefault()}`.

#### Scenario: Tap F5 from function key menu on mobile
- **GIVEN** the function key menu is open and the terminal had focus
- **WHEN** the user taps F5
- **THEN** the F5 escape sequence is sent to the terminal
- **AND** the function key menu closes
- **AND** the terminal retains focus (keyboard stays visible)

### Requirement: Command Palette button excluded

The Command Palette button (`⌘K`) SHALL NOT include focus-prevention handlers. It intentionally opens a dialog that requires focus.

#### Scenario: Tap CmdK button
- **GIVEN** the terminal has focus
- **WHEN** the user taps the `⌘K` button
- **THEN** the command palette opens and receives focus
- **AND** the on-screen keyboard MAY dismiss (this is expected behavior)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `onMouseDown={(e) => e.preventDefault()}` | Confirmed from intake #1 — standard browser pattern, matches ArrowPad | S:90 R:95 A:95 D:95 |
| 2 | Certain | Exclude CmdK button | Confirmed from intake #2 — CmdK intentionally opens dialog needing focus | S:85 R:90 A:90 D:95 |
| 3 | Confident | Per-button handlers, not container-level | Confirmed from intake #3 — explicit, matches ArrowPad pattern, avoids exemption logic | S:70 R:90 A:80 D:70 |
| 4 | Certain | No changes needed to ArrowPad | ArrowPad already has its own mousedown/touchstart handling — verified in source | S:95 R:95 A:95 D:95 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
