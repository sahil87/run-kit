# Spec: Mobile Responsive Polish

**Change**: 260305-ol5d-mobile-responsive-polish
**Created**: 2026-03-07
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Non-Goals

- Gesture interactions (swipe-to-kill, pull-to-refresh) — separate concern
- Landscape-specific layouts beyond what responsive breakpoints provide
- Mobile viewport E2E tests (noted as future work in design spec)

## UI: Line 2 Mobile Collapse

### Requirement: Hide action buttons on narrow screens

On viewports narrower than `sm` (640px), the `line2Left` slot content SHALL be hidden via CSS (`hidden sm:block` wrapping in `TopBarChrome`). Desktop rendering is unchanged.

#### Scenario: Dashboard on mobile
- **GIVEN** viewport width < 640px
- **WHEN** the dashboard page renders Line 2
- **THEN** the "+ New Session" button is hidden
- **AND** the status text ("{N} sessions, {M} windows") renders left-aligned

#### Scenario: Project page on mobile
- **GIVEN** viewport width < 640px
- **WHEN** the project page renders Line 2
- **THEN** the "+ New Window", "Send Message", and "Rename" buttons are hidden
- **AND** the status text ("{N} windows") renders left-aligned

#### Scenario: Terminal page on mobile
- **GIVEN** viewport width < 640px
- **WHEN** the terminal page renders Line 2
- **THEN** the "Rename" and "Kill" buttons are hidden
- **AND** the activity indicator + fab badge renders left-aligned

### Requirement: Mobile command palette trigger via `⋯` button

On viewports narrower than `sm` (640px), a `⋯` button SHALL appear at the right edge of Line 2. The button is hidden on desktop (`hidden` default, `sm:hidden` effectively — visible only below `sm`). Tapping the button SHALL open the command palette by dispatching a `palette:open` CustomEvent on `document`.

#### Scenario: Tapping `⋯` opens palette
- **GIVEN** viewport width < 640px
- **AND** the `⋯` button is visible in Line 2
- **WHEN** the user taps the `⋯` button
- **THEN** the command palette opens with empty query and focus on search input

#### Scenario: `⋯` not visible on desktop
- **GIVEN** viewport width >= 640px
- **WHEN** Line 2 renders
- **THEN** the `⋯` button is not visible

### Requirement: Reposition status text on mobile

On viewports narrower than `sm` (640px), the `line2Right` content SHALL render left-aligned (flex-start) instead of right-aligned. The layout becomes: `{status text} ... [⋯]`.

#### Scenario: Status text position on mobile
- **GIVEN** viewport width < 640px
- **WHEN** Line 2 renders
- **THEN** status text appears at the left edge
- **AND** the `⋯` button appears at the right edge

## UI: Command Palette External Open

### Requirement: Custom event listener for palette open

The `CommandPalette` component SHALL listen for a `palette:open` CustomEvent on `document`. When received, it SHALL open the palette (same as `⌘K`): reset query, reset selection, open dialog, focus input.

#### Scenario: External trigger opens palette
- **GIVEN** `CommandPalette` is mounted
- **WHEN** `document.dispatchEvent(new CustomEvent('palette:open'))` fires
- **THEN** the palette opens with empty query
- **AND** focus moves to the search input

### Requirement: Hide `⌘K` badge on mobile

On viewports narrower than `sm` (640px), the `⌘K` kbd badge in Line 1 SHALL be hidden (`hidden sm:inline-flex`). The connection indicator (green/gray dot + label) SHALL remain visible.

#### Scenario: `⌘K` badge hidden on mobile
- **GIVEN** viewport width < 640px
- **WHEN** Line 1 renders
- **THEN** the `⌘K` kbd badge is not visible
- **AND** the connection indicator remains visible

## UI: Touch Targets

### Requirement: 44px minimum tap height for touch devices

On devices with `pointer: coarse`, all interactive elements outside the bottom bar SHALL have a minimum tap target height of 44px. A Tailwind custom variant `coarse:` SHALL be defined in `globals.css`:

```css
@custom-variant coarse (@media (pointer: coarse));
```

Elements requiring `coarse:min-h-[44px]`:
- Line 2 action buttons (currently `py-1` ~28px)
- Session group kill button (✕) on dashboard
- Window card kill button (✕) in `SessionCard`
- Breadcrumb dropdown chevron (currently `min-h-[24px]`)
- `⋯` button in Line 2
- Search input on dashboard

#### Scenario: Touch target on action button
- **GIVEN** a coarse pointer device (touch screen)
- **WHEN** the project page Line 2 renders the "+ New Window" button
- **THEN** the button has at least 44px tap height

#### Scenario: Touch target on kill button
- **GIVEN** a coarse pointer device
- **WHEN** a `SessionCard` renders the ✕ kill button
- **THEN** the kill button's tap target is at least 44px in height

#### Scenario: Touch target on breadcrumb dropdown
- **GIVEN** a coarse pointer device
- **WHEN** a breadcrumb dropdown chevron (▾) renders
- **THEN** the chevron's tap target is at least 44px in height

### Requirement: Bottom bar 44px height unconditionally

Bottom bar `<kbd>` buttons SHALL use `min-h-[44px]` on all viewport sizes. The `KBD_CLASS` constant in `bottom-bar.tsx` SHALL change from `min-h-[30px]` to `min-h-[44px]`. This is not gated on `pointer: coarse` — the bottom bar is touch-primary.

#### Scenario: Bottom bar button height
- **GIVEN** the terminal page with bottom bar visible
- **WHEN** any bottom bar button renders
- **THEN** the button has at least 44px height regardless of device type

## UI: Terminal Font Scaling

### Requirement: Responsive terminal font size

On viewports narrower than `sm` (640px), the xterm terminal SHALL use `fontSize: 11`. On wider viewports, it SHALL use `fontSize: 13` (current). Screen width SHALL be checked at initialization via `window.matchMedia('(min-width: 640px)')`.

#### Scenario: Terminal font size on mobile
- **GIVEN** viewport width < 640px
- **WHEN** the xterm Terminal initializes
- **THEN** `fontSize` is set to 11
- **AND** the FitAddon calculates columns based on 11px character width

#### Scenario: Terminal font size on desktop
- **GIVEN** viewport width >= 640px
- **WHEN** the xterm Terminal initializes
- **THEN** `fontSize` is set to 13

## UI: Responsive Container Width

### Requirement: Reduced padding on narrow screens

On viewports narrower than `sm` (640px), all three chrome zones SHALL use `px-3` horizontal padding. On wider viewports, they SHALL use `px-6`. Tailwind pattern: `px-3 sm:px-6`.

Affected locations:
- Top chrome wrapper in `src/app/layout.tsx` (currently `px-6`)
- `ContentSlot` inner wrapper in `src/contexts/chrome-context.tsx` (currently `px-6`)
- `BottomSlot` inner wrapper in `src/contexts/chrome-context.tsx` (currently `px-6`)

#### Scenario: Narrow screen padding
- **GIVEN** viewport width < 640px
- **WHEN** any page renders
- **THEN** horizontal padding is 12px (`px-3`) on each side

#### Scenario: Wide screen padding
- **GIVEN** viewport width >= 640px
- **WHEN** any page renders
- **THEN** horizontal padding is 24px (`px-6`) on each side

## Design Decisions

1. **Custom DOM event (`palette:open`) for command palette trigger**: TopBarChrome and CommandPalette are in separate component trees (layout vs page). A custom event is the lightest decoupling mechanism.
   - *Why*: No additional context state, no prop threading. CommandPalette already listens to document keydown.
   - *Rejected*: Adding `commandPaletteOpen` to ChromeContext — adds state management overhead and couples layout/page concerns for a simple fire-and-forget trigger.

2. **Tailwind custom variant `coarse:` for touch targets**: `@custom-variant coarse (@media (pointer: coarse))` in `globals.css`.
   - *Why*: Correctly targets touch devices regardless of screen size (iPad landscape is large but touch). Keeps desktop compact.
   - *Rejected*: Breakpoint-based sizing — incorrectly equates small screen with touch device.

3. **Bottom bar 44px unconditionally**: The bottom bar is designed for touch interaction (modifier keys, Fn dropdown). 44px benefits all pointer types.
   - *Why*: Even on desktop, bottom bar buttons are clicked infrequently. Consistent height is simpler.
   - *Rejected*: `coarse:` gating — inconsistent height, minimal benefit for 14px savings.

4. **Terminal font: 11px on mobile**: Balances column count (~75-80 cols on 390px) with readability.
   - *Why*: 10px is at readability edge for JetBrains Mono. 11px is the sweet spot.
   - *Rejected*: 10px — too small. 13px unchanged — only ~50 columns, unusable for real terminal work.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Line 2 actions collapse into command palette on mobile | Confirmed from intake #1 — Resolved Decision #9 | S:95 R:90 A:90 D:95 |
| 2 | Certain | `⋯` button as mobile command palette trigger | Confirmed from intake #2 — replaces `⌘K` on mobile | S:90 R:90 A:90 D:90 |
| 3 | Certain | 44px minimum touch targets (Apple HIG) | Confirmed from intake #3 — Principle 6 | S:85 R:90 A:90 D:90 |
| 4 | Certain | Responsive padding (`px-3 sm:px-6`) for narrow screens | Confirmed from intake #4 — mobile-first pattern | S:85 R:95 A:90 D:90 |
| 5 | Certain | Custom DOM event for palette trigger | Architecture decision — decoupled, no context overhead | S:80 R:95 A:90 D:85 |
| 6 | Confident | Terminal font 11px on mobile | Confirmed from intake #5 — exact value is a tradeoff, needs testing | S:65 R:95 A:75 D:70 |
| 7 | Certain | Hide `⌘K` on mobile | Confirmed from intake #6 — `⋯` in Line 2 is sufficient | S:85 R:95 A:80 D:90 |
| 8 | Certain | `@custom-variant coarse` for touch-specific sizing | Confirmed from intake #7 — Tailwind 4 supports it | S:80 R:95 A:90 D:85 |
| 9 | Certain | Bottom bar 44px unconditionally | Touch-primary interface, 44px benefits all devices | S:85 R:95 A:90 D:90 |
| 10 | Certain | `sm:` breakpoint (640px) for mobile collapse | Standard Tailwind breakpoint, matches design spec threshold | S:90 R:95 A:95 D:95 |

10 assumptions (9 certain, 1 confident, 0 tentative, 0 unresolved).
