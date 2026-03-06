# Spec: Fix iOS Terminal Touch Scroll

**Change**: 260307-8n60-fix-ios-terminal-touch-scroll
**Created**: 2026-03-07
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`, `docs/memory/run-kit/architecture.md`

## Non-Goals

- JavaScript `touchmove` event handlers with `preventDefault()` — CSS `touch-action` is sufficient and lighter
- Changing scroll behavior on dashboard or project pages — those need normal touch scrolling
- Modifying xterm.js internals or its touch handling — the issue is page-level, not terminal-level

## Terminal: Touch Scroll Prevention

### Requirement: Terminal container MUST prevent browser touch scrolling

The terminal container div (`terminalRef` in `terminal-client.tsx`) SHALL have `touch-action: none` applied via CSS class. This tells the browser not to handle any touch gestures (scroll, zoom, pan) on the terminal area, allowing xterm.js to handle touch-based scrollback natively.

#### Scenario: Touch scroll on terminal area on iOS

- **GIVEN** the terminal page is open on iOS Safari
- **WHEN** the user touches the xterm canvas area and swipes up/down
- **THEN** the page does NOT scroll
- **AND** xterm.js scrollback buffer scrolls (if scrollback content exists)

#### Scenario: Pinch-to-zoom prevented on terminal

- **GIVEN** the terminal page is open on iOS Safari
- **WHEN** the user performs a pinch gesture on the terminal area
- **THEN** the page does NOT zoom
- **AND** the terminal layout remains stable

### Requirement: Body/html MUST prevent overflow scrolling in fullbleed mode

When the terminal page is active (fullbleed mode), the `html` and `body` elements SHALL have `overflow: hidden` and `overscroll-behavior: none` applied. This prevents iOS Safari's elastic bounce scrolling on the outermost elements.

These styles MUST only apply when the terminal page is active. Dashboard and project pages MUST retain normal scrolling behavior.

#### Scenario: No page bounce on terminal page

- **GIVEN** the terminal page is open on iOS Safari (fullbleed active)
- **WHEN** the user swipes at the top or bottom edge of the screen
- **THEN** there is no elastic bounce or page scroll
- **AND** the page layout remains fixed

#### Scenario: Normal scrolling on non-terminal pages

- **GIVEN** the dashboard page is open on iOS Safari (fullbleed not active)
- **WHEN** the user scrolls the page via touch
- **THEN** the page scrolls normally with standard iOS elastic behavior

### Requirement: Compose buffer MUST retain normal touch behavior

The compose buffer textarea (`ComposeBuffer` component) SHALL NOT be affected by the terminal's `touch-action: none`. The textarea needs normal touch behavior for text selection, scrolling within the textarea, and iOS dictation gestures.

#### Scenario: Touch scroll within compose buffer

- **GIVEN** the compose buffer is open on iOS Safari
- **WHEN** the user touches the textarea area and swipes
- **THEN** the textarea content scrolls (if content exceeds visible area)
- **AND** the page does NOT scroll

### Requirement: Bottom bar MUST retain touch interactivity

The bottom bar buttons SHALL remain tappable on iOS. The `touch-action: none` on the terminal container MUST NOT cascade to the bottom bar (which is a sibling element in the layout, not a child of the terminal container).

#### Scenario: Tap bottom bar button on iOS

- **GIVEN** the terminal page is open on iOS Safari
- **WHEN** the user taps a bottom bar button (e.g., Ctrl, arrow key)
- **THEN** the button activates normally

## Design Decisions

1. **CSS-only approach over JavaScript touch handlers**
   - *Why*: `touch-action: none` is the standard, declarative way to prevent browser touch gesture handling. It's simpler, more performant, and doesn't risk interfering with xterm.js's own touch handling.
   - *Rejected*: `touchmove` event listener with `preventDefault()` — adds complexity, must be passive-false (performance warning), and can conflict with xterm's own touch listeners.

2. **Fullbleed-conditional body overflow via `useEffect` toggling a class on `document.documentElement`**
   - *Why*: The `fullbleed` state already correctly identifies the terminal page. Toggling a CSS class on `<html>` when fullbleed activates is the cleanest way to apply body/html overflow rules without affecting other pages. Using a class on `<html>` (rather than inline styles) keeps the styling in CSS where it belongs.
   - *Rejected*: Global `overflow: hidden` on body in `globals.css` — would break scrolling on all pages.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `touch-action: none` on the terminal container div | Confirmed from intake #1 — standard CSS for canvas-based UIs; xterm.js docs recommend it | S:85 R:90 A:95 D:90 |
| 2 | Certain | Apply `overscroll-behavior: none` on html/body in fullbleed mode | Confirmed from intake #2 — well-known iOS Safari fix | S:85 R:95 A:90 D:90 |
| 3 | Certain | Scope to fullbleed mode via class toggle on `<html>` element | Upgraded from intake #3 Confident — fullbleed flag is already the terminal page discriminator; `useEffect` in ContentSlot or layout to toggle class | S:80 R:90 A:90 D:85 |
| 4 | Confident | CSS-only fix, no JS touch handlers needed | Confirmed from intake #4 — `touch-action` + `overscroll-behavior` covers the reported behavior; JS fallback only if CSS proves insufficient on specific iOS versions | S:70 R:90 A:75 D:70 |
| 5 | Certain | Compose buffer unaffected — it's not a child of the terminal container | Compose buffer renders as a sibling to the terminal div, not inside it; `touch-action: none` doesn't cascade to siblings | S:90 R:95 A:95 D:95 |
| 6 | Certain | Bottom bar unaffected — sibling in layout, not child of terminal | Bottom bar renders via `BottomSlot` in layout, entirely outside `ContentSlot`; no inheritance of terminal's `touch-action` | S:90 R:95 A:95 D:95 |

6 assumptions (5 certain, 1 confident, 0 tentative, 0 unresolved).
