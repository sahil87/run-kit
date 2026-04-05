# Spec: Mobile Keyboard Scroll Lock

**Change**: 260327-4azv-mobile-keyboard-scroll-lock
**Created**: 2026-03-27
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Persisting scroll-lock state across page reloads or navigation — this is transient UI state
- Adding a new button to the bottom bar — the existing keyboard toggle gains the long-press behavior
- Blocking touch scroll gestures (SGR mouse sequences) — only keyboard focus is prevented

## Bottom Bar: Scroll-Lock State

### Requirement: Scroll-Lock Boolean State

The `BottomBar` component SHALL maintain a `scrollLocked` boolean state (default `false`). When `scrollLocked` is `true`, the terminal's soft keyboard MUST NOT appear from any touch interaction on the terminal area.

#### Scenario: Initial state

- **GIVEN** the terminal page loads
- **WHEN** the `BottomBar` renders
- **THEN** `scrollLocked` SHALL be `false`
- **AND** keyboard show/hide behavior works as before (tap terminal = keyboard appears)

#### Scenario: Scroll-lock prevents keyboard

- **GIVEN** `scrollLocked` is `true`
- **WHEN** the user taps on the terminal area
- **THEN** the xterm textarea MUST NOT receive focus
- **AND** the soft keyboard MUST NOT appear

### Requirement: Long-Press Activation

The keyboard toggle button (`⌨` U+2328) SHALL support long-press interaction to toggle scroll-lock mode. Tap behavior (show/hide keyboard) MUST be preserved unchanged.

#### Scenario: Long-press to enable scroll-lock

- **GIVEN** `scrollLocked` is `false`
- **AND** the user is on a touch device (`pointer: coarse`)
- **WHEN** the user presses and holds the keyboard button for >= 500ms
- **THEN** `scrollLocked` SHALL become `true`
- **AND** if the keyboard is currently visible, it SHALL be dismissed (blur terminal)
- **AND** optional haptic feedback via `navigator.vibrate(50)` if available

#### Scenario: Long-press to disable scroll-lock

- **GIVEN** `scrollLocked` is `true`
- **WHEN** the user presses and holds the keyboard button for >= 500ms
- **THEN** `scrollLocked` SHALL become `false`
- **AND** the keyboard MUST NOT automatically appear (user taps terminal to summon it)

#### Scenario: Tap preserved when not long-pressing

- **GIVEN** `scrollLocked` is `false` and the terminal is not focused
- **WHEN** the user taps the keyboard button (touch duration < 500ms)
- **THEN** `onFocusTerminal` SHALL be called (keyboard appears)
- **AND** `scrollLocked` SHALL remain `false`

#### Scenario: Tap in scroll-lock mode unlocks

- **GIVEN** `scrollLocked` is `true`
- **WHEN** the user taps the keyboard button (touch duration < 500ms)
- **THEN** `scrollLocked` SHALL become `false`
- **AND** `onFocusTerminal` SHALL be called (keyboard appears)

### Requirement: Long-Press Detection

Long-press detection SHALL use `touchstart`/`touchend` event timing with a 500ms threshold. The implementation MUST distinguish between tap and long-press without interfering with existing `onClick` and `preventFocusSteal` handlers.

#### Scenario: Touch timing mechanics

- **GIVEN** the keyboard toggle button
- **WHEN** `touchstart` fires
- **THEN** a 500ms timer SHALL start
- **AND** if `touchend` fires before 500ms, the timer is cancelled and the event is treated as a tap (existing `onClick` fires)
- **AND** if the timer expires (500ms reached while still touching), scroll-lock toggles and the subsequent `touchend`/`click` SHALL be suppressed

#### Scenario: Touch move cancels long-press

- **GIVEN** the user starts touching the keyboard button
- **WHEN** the touch moves more than 10px from the start position
- **THEN** the long-press timer SHALL be cancelled
- **AND** the interaction SHALL be treated as a cancelled gesture (no tap, no long-press)

## Terminal Client: Focus Prevention

### Requirement: Focus Interception When Locked

The `TerminalClient` component SHALL accept a `scrollLocked` boolean prop. When `true`, the component MUST prevent the xterm textarea from gaining focus via touch interactions.

#### Scenario: Focus blocked when locked

- **GIVEN** `scrollLocked` is `true`
- **WHEN** any `focusin` event targets an element inside `.xterm`
- **THEN** the focused element SHALL be immediately blurred (`document.activeElement.blur()`)
- **AND** the event SHALL not propagate to cause keyboard appearance

#### Scenario: Touch scroll preserved when locked

- **GIVEN** `scrollLocked` is `true`
- **WHEN** the user swipes vertically on the terminal
- **THEN** SGR mouse scroll sequences SHALL still be sent via WebSocket
- **AND** the scroll behavior SHALL be identical to when `scrollLocked` is `false`

#### Scenario: Focus allowed when unlocked

- **GIVEN** `scrollLocked` is `false`
- **WHEN** the user taps on the terminal area
- **THEN** focus behavior SHALL be unchanged from current implementation

### Requirement: Prop Wiring

`app.tsx` SHALL pass the `scrollLocked` state from `BottomBar` up through the parent and down to `TerminalClient`. The `BottomBar` component SHALL expose the scroll-lock state via a callback prop `onScrollLockChange?: (locked: boolean) => void`.

#### Scenario: State flows through parent

- **GIVEN** the terminal page renders `TerminalClient` and `BottomBar` as siblings in the terminal column
- **WHEN** `BottomBar` toggles scroll-lock
- **THEN** `app.tsx` updates local state via `onScrollLockChange`
- **AND** passes the new value to `TerminalClient` as `scrollLocked` prop

## Bottom Bar: Visual Indicator

### Requirement: Locked-State Styling

When `scrollLocked` is `true`, the keyboard toggle button SHALL visually indicate the locked state using the same armed-state pattern as Ctrl/Alt modifier toggles.

#### Scenario: Locked visual state

- **GIVEN** `scrollLocked` is `true`
- **WHEN** the keyboard toggle button renders
- **THEN** the button SHALL have classes `bg-accent/20 border-accent text-accent`
- **AND** the icon SHALL change from `⌨` (U+2328) to `🔒` (U+1F512)
- **AND** `aria-label` SHALL be `"Scroll lock on — tap to unlock"`

#### Scenario: Unlocked visual state

- **GIVEN** `scrollLocked` is `false`
- **WHEN** the keyboard toggle button renders
- **THEN** the button SHALL have its current styling (`text-text-secondary`, default border)
- **AND** the icon SHALL be `⌨` (U+2328)
- **AND** `aria-label` SHALL reflect keyboard show/hide state as before

## State Lifecycle

### Requirement: Session-Scoped State

Scroll-lock state SHALL be component-local React state. It MUST NOT be persisted to localStorage, API, or any external store.

#### Scenario: Navigation resets scroll-lock

- **GIVEN** `scrollLocked` is `true`
- **WHEN** the user navigates to a different session/window
- **THEN** `scrollLocked` SHALL reset to `false` (component unmounts and remounts)

#### Scenario: Compose buffer unaffected

- **GIVEN** `scrollLocked` is `true` and the compose buffer is open
- **WHEN** the user types in the compose buffer textarea
- **THEN** the compose buffer input SHALL accept focus and keyboard input normally
- **AND** scroll-lock SHALL only affect the terminal area

### Requirement: Keyboard Dismissal on Lock

When scroll-lock is activated while the keyboard is visible, the keyboard SHALL be immediately dismissed.

#### Scenario: Auto-dismiss on lock

- **GIVEN** the terminal is focused (keyboard visible)
- **WHEN** scroll-lock is activated via long-press
- **THEN** `document.activeElement.blur()` SHALL be called
- **AND** the keyboard SHALL disappear

## Design Decisions

1. **Long-press on existing button vs. new button**: Reuse the keyboard toggle button with long-press for scroll-lock.
   - *Why*: Bottom bar is already full at 375px width. Long-press is a standard mobile secondary-action pattern.
   - *Rejected*: Separate scroll-lock button — no space in the bar; would create UI clutter.

2. **Focus interception vs. touch overlay**: Prevent focus via `focusin` event interception rather than placing a transparent overlay.
   - *Why*: An overlay would block the touch scroll gesture translation (SGR mouse sequences). Focus interception is lighter and preserves existing touch scroll behavior.
   - *Rejected*: `pointer-events: none` overlay — would require re-implementing touch scroll on the overlay.

3. **Tap in locked mode unlocks + focuses**: When scroll-locked, a tap on the keyboard button both unlocks and summons the keyboard in one action.
   - *Why*: Matches user intent — if they're tapping the keyboard button while locked, they want to type. Requiring two taps (unlock, then show keyboard) adds friction.
   - *Rejected*: Tap only unlocks (no keyboard) — extra step with no benefit.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Long-press on existing keyboard button (not a new button) | Confirmed from intake #1 — user explicitly requested | S:90 R:85 A:90 D:90 |
| 2 | Certain | Scroll-lock is session-scoped, not persisted | Confirmed from intake #2 — component-local state | S:70 R:95 A:90 D:90 |
| 3 | Certain | 500ms long-press threshold | Confirmed from intake #3 — user confirmed | S:95 R:95 A:80 D:75 |
| 4 | Certain | Accent color pattern (`bg-accent/20 border-accent text-accent`) for locked indicator | Confirmed from intake #4 — user confirmed | S:95 R:90 A:85 D:70 |
| 5 | Certain | Focus interception via `focusin` listener, not overlay | Confirmed from intake #5 — user confirmed | S:95 R:75 A:80 D:65 |
| 6 | Certain | Icon changes to lock symbol when locked | Confirmed from intake #6 — user confirmed | S:95 R:90 A:75 D:65 |
| 7 | Tentative | Haptic feedback via `navigator.vibrate(50)` on lock toggle | Confirmed from intake #7 — user said "good but not deal breaker" | S:50 R:95 A:60 D:50 |
| 8 | Certain | Tap in locked mode unlocks AND summons keyboard in one action | Codebase pattern: keyboard button's intent is keyboard access; double-tap would add friction | S:80 R:90 A:85 D:85 |
| 9 | Certain | `onScrollLockChange` callback prop on BottomBar for parent state wiring | Follows existing pattern: `onFocusTerminal` callback in BottomBarProps | S:85 R:90 A:90 D:85 |
| 10 | Certain | Touch move > 10px cancels long-press | Standard gesture disambiguation; matches ArrowPad's drag threshold pattern | S:70 R:95 A:85 D:80 |
| 11 | Certain | `scrollLocked` prop on TerminalClient for focus prevention | Direct prop passing — simplest wiring through app.tsx, consistent with existing props | S:85 R:90 A:90 D:85 |

11 assumptions (10 certain, 0 confident, 1 tentative, 0 unresolved).
