# Spec: Mobile Bar Keyboard Toggle

**Change**: 260327-bkm8-mobile-bar-keyboard-toggle
**Created**: 2026-03-27
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Bottom Bar: Escape Relocation

### Requirement: Escape Button in Function Menu

The standalone Escape button (`⎋`) SHALL be removed from the bottom bar's main row. Escape SHALL be added as the first item in the Fn dropdown menu's bottom section (extended-keys grid), before PgUp.

The extended-keys grid SHALL contain 7 items in a 3-column layout:
```
Esc    PgUp   PgDn
Home   End    Ins
Del
```

Escape in the Fn menu SHALL send `\x1b` via WebSocket, identical to the current standalone button. Modifier bridging (Alt prefix, Ctrl stays armed) SHALL apply to Escape in the Fn menu via the existing `sendSpecial` path.

#### Scenario: User sends Escape via Fn menu
- **GIVEN** the Fn dropdown is open
- **WHEN** the user taps the Escape button in the extended-keys section
- **THEN** `\x1b` is sent via WebSocket
- **AND** the Fn dropdown closes

#### Scenario: Escape with Alt modifier via Fn menu
- **GIVEN** the Alt modifier is armed
- **AND** the Fn dropdown is open
- **WHEN** the user taps Escape in the extended-keys section
- **THEN** `\x1b\x1b` (ESC prefix + ESC) is sent via WebSocket
- **AND** the Alt modifier is consumed

#### Scenario: Escape with Ctrl modifier via Fn menu
- **GIVEN** the Ctrl modifier is armed
- **AND** the Fn dropdown is open
- **WHEN** the user taps Escape in the extended-keys section
- **THEN** `\x1b` is sent (Ctrl stays armed — Esc IS Ctrl+[)
- **AND** the Fn dropdown closes
- **AND** the Ctrl modifier remains armed

### Requirement: Simplified Bottom Bar Layout

After Escape removal, the bottom bar main row SHALL contain these elements in order:
1. Tab (`⇥`)
2. Ctrl (`^`)
3. Alt (`⌥`)
4. Fn (`F▴`) with dropdown
5. ArrowPad
6. Vertical divider
7. Compose (`>_`) — conditional on `onOpenCompose` prop
8. Command palette (`⌘K`)
9. Hostname — right-aligned, hidden on small screens (`hidden sm:inline`)
10. Keyboard toggle (`⌨`) — right-aligned, touch-only (`hidden coarse:inline-flex`)

No other changes to existing button behavior, styling, or sizing.

#### Scenario: Bottom bar renders on 375px mobile viewport
- **GIVEN** a terminal page on a 375px-wide touch device
- **WHEN** the bottom bar renders
- **THEN** all buttons fit in a single row without wrapping
- **AND** the Escape button is not present in the main row
- **AND** the keyboard toggle button is visible (right-aligned)

## Bottom Bar: Keyboard Toggle

### Requirement: Bidirectional Keyboard Toggle

The current keyboard-dismiss button (down caret `⌄`) SHALL be replaced with a keyboard toggle button using the `⌨` (U+2328) icon.

The button SHALL be visible only on touch/coarse-pointer devices (`hidden coarse:inline-flex`), right-aligned via `ml-auto`.

The button SHALL toggle the virtual keyboard:
- **Dismiss**: When `document.activeElement` is an element inside the terminal container (xterm's hidden textarea), tapping SHALL call `document.activeElement.blur()`.
- **Summon**: When `document.activeElement` is NOT inside the terminal container, tapping SHALL focus the terminal to bring up the virtual keyboard.

#### Scenario: Dismiss keyboard when terminal is focused
- **GIVEN** the terminal's hidden textarea is focused (keyboard visible)
- **WHEN** the user taps the keyboard toggle button
- **THEN** `document.activeElement.blur()` is called
- **AND** the virtual keyboard dismisses

#### Scenario: Summon keyboard when terminal is not focused
- **GIVEN** no element is focused (keyboard hidden, e.g., after previous dismiss)
- **WHEN** the user taps the keyboard toggle button
- **THEN** the terminal is focused
- **AND** the virtual keyboard appears

#### Scenario: Summon keyboard after accidental dismiss
- **GIVEN** the user previously dismissed the keyboard via the toggle button
- **WHEN** the user taps the keyboard toggle button again
- **THEN** the terminal regains focus
- **AND** the virtual keyboard reappears

### Requirement: Focus Terminal Callback

`BottomBar` SHALL accept an optional `onFocusTerminal` callback prop (`() => void`). When the keyboard toggle detects that the terminal is not focused, it SHALL call `onFocusTerminal()` to summon the keyboard.

The parent (`app.tsx`) SHALL pass a callback that focuses the terminal. The `TerminalClient` component SHALL expose a mechanism (imperative handle or callback) for the parent to trigger `.focus()` on the xterm instance.

#### Scenario: Parent wires focus callback
- **GIVEN** `BottomBar` receives an `onFocusTerminal` callback
- **WHEN** the keyboard toggle fires in "summon" mode
- **THEN** the callback is invoked
- **AND** the terminal gains focus

#### Scenario: No focus callback provided
- **GIVEN** `BottomBar` does not receive `onFocusTerminal`
- **WHEN** the keyboard toggle fires in "summon" mode
- **THEN** no error occurs (graceful no-op)

### Requirement: Accessibility Labels

The keyboard toggle button SHALL have a dynamic `aria-label`:
- `"Hide keyboard"` when the terminal is focused (dismiss mode)
- `"Show keyboard"` when the terminal is not focused (summon mode)

The button SHALL use `preventFocusSteal` (`onMouseDown={e => e.preventDefault()}`) to avoid stealing focus from the terminal when tapping to dismiss.

#### Scenario: Screen reader announces toggle state
- **GIVEN** the terminal is focused
- **WHEN** the screen reader reads the keyboard toggle button
- **THEN** it announces "Hide keyboard"

#### Scenario: Screen reader announces summon state
- **GIVEN** the terminal is not focused
- **WHEN** the screen reader reads the keyboard toggle button
- **THEN** it announces "Show keyboard"

## Design Decisions

1. **Callback prop vs DOM query for terminal focus**: Callback prop (`onFocusTerminal`)
   - *Why*: `xtermRef` is internal to `TerminalClient`; querying `.xterm-helper-textarea` is fragile and depends on xterm.js internals. A callback through the parent is clean and testable.
   - *Rejected*: Direct DOM query — couples to xterm.js internal class names that may change across versions.

2. **Escape in extended-keys section (not F-keys section)**: Bottom grid
   - *Why*: Escape is semantically a special/navigation key, not a function key (F1-F12). It belongs with PgUp, Home, Del, etc.
   - *Rejected*: Adding to the F-keys 4-column grid — would break the grid alignment and confuse users expecting only F1-F12 there.

3. **Static icon (no state-dependent icon change)**: Single `⌨` icon
   - *Why*: The button's behavior is a toggle; the icon represents "keyboard control." Animating between up/down states adds visual complexity without improving discoverability.
   - *Rejected*: Dual-icon approach (keyboard-up/keyboard-down) — more complex, less consistent with other bottom bar buttons that use static icons.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Escape goes in Fn bottom section (extended keys), not F-key grid | Confirmed from intake #1 — Escape is a special key, not F1-F12 | S:90 R:90 A:95 D:95 |
| 2 | Certain | Keyboard toggle uses callback prop to focus terminal | Spec-level analysis: `xtermRef` is internal to `TerminalClient`; callback is the clean pattern | S:90 R:85 A:95 D:90 |
| 3 | Confident | Unicode `⌨` (U+2328) for icon | Confirmed from intake #3 — consistent with `⎋`, `⇥` style | S:70 R:90 A:75 D:70 |
| 4 | Certain | Toggle detection via `document.activeElement` | Confirmed from intake #4 — standard DOM API, no extra state needed | S:85 R:95 A:90 D:90 |
| 5 | Confident | Fn extended-keys grid becomes 3x3 (7 items) | Confirmed from intake #5 — natural extension of existing 3-column grid | S:75 R:85 A:80 D:75 |
| 6 | Certain | No modifier bridging changes — Escape uses existing `sendSpecial` | Confirmed from intake #6 — `sendSpecial` handles Alt prefix and Ctrl re-arm already | S:90 R:95 A:90 D:95 |
| 7 | Confident | Dynamic `aria-label` ("Show keyboard" / "Hide keyboard") | Confirmed from intake #7 — best practice for toggle buttons | S:70 R:95 A:80 D:85 |
| 8 | Certain | `TerminalClient` exposes focus via imperative handle or callback | Codebase uses `useRef` for xterm; `useImperativeHandle` or lifted callback are standard React patterns | S:85 R:85 A:90 D:85 |
| 9 | Certain | `preventFocusSteal` on toggle button (dismiss mode) | Required by existing pattern — all bottom bar buttons that interact with terminal use this | S:90 R:95 A:95 D:95 |

9 assumptions (6 certain, 3 confident, 0 tentative, 0 unresolved).
