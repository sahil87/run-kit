# Spec: Top Bar & Bottom Bar UI Refresh

**Change**: 260314-9raw-top-bar-bottom-bar-refresh
**Created**: 2026-03-14
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Bottom Bar: Remove Cmd Modifier

### Requirement: Cmd Toggle Removal

The bottom bar SHALL NOT render a `Cmd` (`⌘`) modifier button. The modifier toggles section SHALL contain only `Ctrl` and `Alt`.

#### Scenario: Bottom bar renders without Cmd
- **GIVEN** the bottom bar is rendered
- **WHEN** the user views the modifier toggles section
- **THEN** only `Ctrl` (`^`) and `Alt` (`⌥`) buttons are visible
- **AND** no `Cmd` (`⌘`) button exists in the DOM

### Requirement: Modifier State Cleanup

The `useModifierState` hook SHALL NOT include a `cmd` property. The `ModifierSnapshot` type SHALL contain only `ctrl` and `alt` boolean fields. The `modParam()` function SHALL NOT include a `cmd` branch (`p += 8` removed). The `hasModifiers()` function SHALL check only `ctrl` and `alt`. The `isArmed()` function SHALL check only `ctrl` and `alt`.

#### Scenario: Armed modifier bridging without Cmd
- **GIVEN** the user has armed `Alt` via the bottom bar
- **WHEN** the user presses a physical key
- **THEN** the keydown handler sends the key with ESC prefix (Alt convention)
- **AND** no `cmd` snapshot field is read or checked

## Bottom Bar: Remove Compose Button

### Requirement: Compose Button Removal

The bottom bar SHALL NOT render the compose (`>_`) button. The `BottomBarProps` type SHALL NOT include the `onOpenCompose` callback.

#### Scenario: Bottom bar without compose button
- **GIVEN** the bottom bar is rendered
- **WHEN** the user views the bar
- **THEN** no compose button (`>_`) is present
- **AND** the bar ends after the arrow pad

## Bottom Bar: Increase Button Sizes

### Requirement: Enlarged Touch Targets

The bottom bar `KBD_CLASS` constant SHALL use `min-h-[36px] min-w-[36px]` on desktop (up from `min-h-[32px] min-w-[32px]`) and `coarse:min-h-[44px] coarse:min-w-[36px]` on touch devices (up from `coarse:min-h-[36px] coarse:min-w-[28px]`).

#### Scenario: Touch target sizing on touch devices
- **GIVEN** the bottom bar is rendered on a touch device (`pointer: coarse`)
- **WHEN** the user views any `<kbd>` button
- **THEN** the button has a minimum height of 44px and minimum width of 36px

#### Scenario: Desktop button sizing
- **GIVEN** the bottom bar is rendered on desktop
- **WHEN** the user views any `<kbd>` button
- **THEN** the button has a minimum height of 36px and minimum width of 36px

## Top Bar Left: Hamburger + Session / Window

### Requirement: Hamburger Icon with Animation

The top bar left section SHALL render a hamburger icon (`☰` — three horizontal SVG lines) as the first element, replacing the logo `<img>`. The hamburger SHALL animate to an X (`✕`) when the sidebar (desktop) or drawer (mobile) is open, using CSS `transition-transform` on SVG line elements. The icon state SHALL be driven by `sidebarOpen` (on desktop, `>= 768px`) or `drawerOpen` (on mobile, `< 768px`).

#### Scenario: Hamburger to X animation on sidebar open
- **GIVEN** the sidebar is closed (desktop)
- **WHEN** the user clicks the hamburger icon
- **THEN** the icon animates from three horizontal lines to an X shape
- **AND** the sidebar opens

#### Scenario: X to hamburger animation on drawer close
- **GIVEN** the drawer is open (mobile)
- **WHEN** the user taps the X icon
- **THEN** the icon animates from X back to three horizontal lines
- **AND** the drawer closes

### Requirement: Breadcrumb Format Change

The breadcrumb SHALL use `/` as a plain text separator between session and window names, replacing the `❯` (U+276F) icon-based `BreadcrumbDropdown` triggers. The session name text and window name text themselves SHALL be the dropdown triggers (tappable to open their respective dropdowns). The `❯` icons SHALL be removed.

#### Scenario: Breadcrumb with slash separator
- **GIVEN** the user is on session "run-kit" window "main"
- **WHEN** the top bar renders
- **THEN** the breadcrumb shows `☰  run-kit / main`
- **AND** `/` is a plain text separator with no click handler

#### Scenario: Session name as dropdown trigger
- **GIVEN** the breadcrumb shows the session name
- **WHEN** the user clicks/taps the session name text
- **THEN** the session dropdown opens showing all sessions
- **AND** the dropdown includes a `+ New Session` action item

#### Scenario: Window name as dropdown trigger
- **GIVEN** the breadcrumb shows the window name
- **WHEN** the user clicks/taps the window name text
- **THEN** the window dropdown opens showing all windows in the current session
- **AND** the dropdown includes a `+ New Window` action item

### Requirement: Session Name Truncation

The session name span SHALL have `max-w-[7ch] truncate` classes to cap display at approximately 7 characters with ellipsis overflow.

#### Scenario: Long session name truncation
- **GIVEN** a session named "my-very-long-session-name"
- **WHEN** the breadcrumb renders
- **THEN** the session name displays as approximately "my-very..." (truncated at 7 characters)

### Requirement: Logo Removal from Left

The logo `<img>` element SHALL be removed from the top bar left section entirely. It moves to the right section.

## Top Bar Right: Branding + Controls

### Requirement: Desktop Right Section Layout

The top bar right section on desktop (>= 640px) SHALL render in order: RunKit logo `<img>` (decorative, `aria-hidden="true"`, not a button), "Run Kit" text span (`text-xs text-text-secondary`), green/gray connection dot (no text label), `FixedWidthToggle`, `⌘K` kbd hint, compose button (`>_`).

#### Scenario: Desktop right section elements
- **GIVEN** the viewport is >= 640px
- **WHEN** the top bar renders
- **THEN** the right section shows: logo, "Run Kit" text, connection dot, fixed-width toggle, ⌘K hint, and compose button
- **AND** no "live" or "disconnected" text label appears

### Requirement: Connection Status Text Removal

The connection status text ("live" / "disconnected") SHALL be removed. Only the green/gray dot indicator SHALL remain.

#### Scenario: Connection dot without text
- **GIVEN** the connection is active
- **WHEN** the top bar renders
- **THEN** a green dot is visible
- **AND** no "live" text is present in the DOM

### Requirement: Compose Button in Top Bar

The top bar SHALL render a compose button (`>_`) as the rightmost item. The `TopBarProps` type SHALL include an `onOpenCompose` callback. The button SHALL toggle the compose buffer overlay.

#### Scenario: Compose button opens compose buffer
- **GIVEN** the compose buffer is closed
- **WHEN** the user clicks the `>_` button in the top bar
- **THEN** the compose buffer overlay opens
- **AND** the terminal dims to `opacity-50`

### Requirement: Mobile Right Section

On mobile (< 640px), the top bar right section SHALL show only `⋯` (command palette trigger) and `>_` (compose button). All other elements (logo, "Run Kit" text, dot, toggle, ⌘K) SHALL be hidden via `hidden sm:flex` / `hidden sm:inline-flex`.

#### Scenario: Mobile right section visibility
- **GIVEN** the viewport is < 640px
- **WHEN** the top bar renders
- **THEN** only `⋯` and `>_` are visible in the right section
- **AND** the logo, "Run Kit" text, connection dot, toggle, and ⌘K are hidden

## App Shell: Wire Compose to Top Bar

### Requirement: Compose Prop Migration

`app.tsx` SHALL pass `onOpenCompose` to `<TopBar>` as a new prop. `app.tsx` SHALL NOT pass `onOpenCompose` to `<BottomBar>`. The `BottomBarProps` type SHALL NOT include `onOpenCompose`.

#### Scenario: Compose wiring
- **GIVEN** the app shell renders
- **WHEN** the compose toggle state changes
- **THEN** `TopBar` receives `onOpenCompose` and can trigger the compose buffer
- **AND** `BottomBar` receives only `wsRef` (no compose callback)

## Deprecated Requirements

### Cmd Modifier Toggle
**Reason**: Dead weight — on desktop users hold the real Cmd key; on mobile Cmd combos aren't used in terminal workflows.
**Migration**: Removed from `use-modifier-state.ts` type, state, and all consumer code.

### Connection Status Text ("live" / "disconnected")
**Reason**: The green/gray dot color alone communicates the connection state. Text is redundant.
**Migration**: Removed from top bar. Dot indicator retained.

### Logo as Sidebar Toggle
**Reason**: Replaced by hamburger icon with ☰ → ✕ animation, which is universally understood as a menu toggle.
**Migration**: Logo moves to right side as branding element. Hamburger icon takes over toggle duty.

### `❯` Separator as Dropdown Trigger
**Reason**: Replaced by name-text dropdown triggers and `/` plain separator.
**Migration**: Session and window name text become the dropdown triggers.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Remove Cmd toggle from bottom bar | Confirmed from intake #1 — user explicitly confirmed | S:95 R:90 A:95 D:95 |
| 2 | Certain | Move compose button entirely to top bar (no duplication) | Confirmed from intake #2 — user said "move entirely" | S:95 R:85 A:90 D:95 |
| 3 | Certain | Hamburger icon animates to X when sidebar/drawer open | Confirmed from intake #3 — user explicitly specified animation | S:95 R:90 A:85 D:95 |
| 4 | Certain | Session/window name text are dropdown triggers (not separator) | Confirmed from intake #4 — user confirmed names become dropdowns | S:95 R:85 A:90 D:95 |
| 5 | Certain | Mobile right side keeps both ⋯ and >_ visible | Confirmed from intake #5 — user said both stay | S:95 R:85 A:90 D:95 |
| 6 | Certain | Session name max 7 chars with truncation | Confirmed from intake #6 | S:90 R:90 A:90 D:90 |
| 7 | Certain | Green dot only, no "live"/"disconnected" text | Confirmed from intake #7 | S:90 R:95 A:90 D:90 |
| 8 | Certain | Right side order: logo + "Run Kit" + dot + toggle + ⌘K + >_ | Confirmed from intake #8 | S:90 R:85 A:85 D:90 |
| 9 | Confident | Hamburger → X via CSS transform on SVG lines | Confirmed from intake #9 — standard pattern, easily reversed | S:70 R:90 A:85 D:80 |
| 10 | Confident | Bottom bar sizes: 36px desktop, 44px/36px touch | Confirmed from intake #10 — follows Apple HIG | S:75 R:90 A:85 D:80 |
| 11 | Confident | `/` is plain separator (no dropdown role) | Confirmed from intake #11 — user specified format | S:80 R:90 A:85 D:85 |
| 12 | Certain | BreadcrumbDropdown refactored: name text triggers dropdown, icon prop removed | Codebase shows icon prop on BreadcrumbDropdown used as ❯ trigger; this change makes the name label the trigger instead. Consistent with intake design | S:85 R:80 A:85 D:85 |

12 assumptions (9 certain, 3 confident, 0 tentative, 0 unresolved).
