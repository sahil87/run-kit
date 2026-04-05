# Spec: Fix tmux scrolling on mobile

**Change**: 260325-8kuf-tmux-mobile-scroll
**Created**: 2026-03-25
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## Terminal: Touch Scroll Behavior

### Requirement: Vertical touch scrolling SHALL work in the terminal area

The terminal container (`terminal-client.tsx`) SHALL use `touch-pan-y` instead of `touch-none` for its CSS `touch-action` property. This allows the browser to handle vertical swipe gestures natively, delegating scroll to the xterm.js `.xterm-viewport` element (which has `overflow-y: scroll`).

#### Scenario: Swipe up to scroll back through terminal output

- **GIVEN** a user on a touch device viewing a terminal with scrollback history
- **WHEN** the user swipes upward in the terminal area
- **THEN** the xterm.js viewport scrolls up, revealing earlier terminal output
- **AND** the page does not bounce or scroll behind the terminal

#### Scenario: Swipe down to scroll forward

- **GIVEN** a user on a touch device who has scrolled up in the terminal
- **WHEN** the user swipes downward in the terminal area
- **THEN** the xterm.js viewport scrolls down toward the latest output

#### Scenario: Desktop behavior is unchanged

- **GIVEN** a user on a non-touch device (mouse/trackpad)
- **WHEN** the user interacts with the terminal
- **THEN** behavior is identical to before — `touch-pan-y` has no effect on mouse-driven input

### Requirement: Horizontal touch panning SHALL remain blocked

The terminal container SHALL NOT allow horizontal touch panning. The CSS `touch-pan-y` value explicitly permits only vertical panning, blocking horizontal gestures that could cause page-level horizontal scroll (tmux's hard minimum ~80 columns exceeds most phone screen widths).

#### Scenario: Horizontal swipe does not scroll the page

- **GIVEN** a user on a touch device viewing a terminal where tmux content exceeds viewport width
- **WHEN** the user swipes horizontally in the terminal area
- **THEN** the page does not scroll horizontally
- **AND** the terminal area does not shift

### Requirement: Overscroll behavior SHALL remain suppressed

The existing `overscroll-behavior: none` on `.xterm .xterm-viewport` in `globals.css` MUST be preserved. This prevents scroll chaining from the xterm viewport to the parent page on iOS Safari.

#### Scenario: Scrolling past terminal bounds does not bounce the page

- **GIVEN** a user on iOS Safari who has scrolled to the top of terminal scrollback
- **WHEN** the user continues swiping upward
- **THEN** the page does not exhibit rubber-band bounce behavior

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Replace `touch-none` with `touch-pan-y` on terminal container | Confirmed from intake #1 — CSS-only, simplest approach, convention over configuration | S:85 R:95 A:90 D:90 |
| 2 | Certain | Keep `overscroll-behavior: none` on `.xterm-viewport` | Confirmed from intake #2 — already proven in globals.css | S:90 R:95 A:95 D:95 |
| 3 | Confident | xterm.js handles scroll natively with `touch-pan-y` | Confirmed from intake #3 — `.xterm-viewport` has `overflow-y: scroll`, browser delegates touch scroll to it | S:75 R:90 A:75 D:80 |
| 4 | Certain | Apply universally, not behind media query | Confirmed from intake #4, upgraded — harmless on non-touch, avoids hybrid device edge cases | S:70 R:95 A:85 D:90 |
| 5 | Certain | No backend changes needed | Confirmed from intake #5 — purely frontend CSS | S:95 R:95 A:95 D:95 |
| 6 | Certain | Single class change in terminal-client.tsx | Codebase confirms: line 350 has `touch-none` in the className string — replace with `touch-pan-y` | S:95 R:95 A:95 D:95 |

6 assumptions (5 certain, 1 confident, 0 tentative, 0 unresolved).
