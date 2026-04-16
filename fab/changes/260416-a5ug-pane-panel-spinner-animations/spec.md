# Spec: Pane Panel Spinner Animations

**Change**: 260416-a5ug-pane-panel-spinner-animations
**Created**: 2026-04-16
**Affected memory**: `docs/memory/run-kit/ui-patterns.md`

## UI Components: Spinner Variants

### Requirement: BrailleSnake Component

A `BrailleSnake` component SHALL be created at `app/frontend/src/components/braille-snake.tsx`. It SHALL cycle through the frames `⣾⣽⣻⢿⡿⣟⣯⣷` at 80ms intervals. The component SHALL accept an optional `className` prop for color styling. The component SHALL render a `<span>` with `aria-hidden="true"`. The implementation SHALL follow the same pattern as the existing `BlockPulse` component (`useState` + `useEffect` + `setInterval`).

#### Scenario: BrailleSnake renders and animates
- **GIVEN** the `BrailleSnake` component is mounted
- **WHEN** 80ms elapses
- **THEN** the displayed character advances to the next frame in the sequence `⣾⣽⣻⢿⡿⣟⣯⣷`
- **AND** the sequence wraps from `⣷` back to `⣾`

#### Scenario: BrailleSnake cleanup on unmount
- **GIVEN** the `BrailleSnake` component is mounted with an active interval
- **WHEN** the component unmounts
- **THEN** the interval is cleared

## Pane Panel: Agent Line Spinner

### Requirement: BrailleSnake on Agent State Line

The Pane panel's `agt` line in `status-panel.tsx` SHALL render a `BrailleSnake` spinner before the agent state text whenever `agentLine` is present. The spinner SHALL use the `text-accent` color class. A single space SHALL separate the spinner from the agent state text.

#### Scenario: Agent state present with spinner
- **GIVEN** a window has `agentState` set (e.g., `"active"` or `"idle"`)
- **WHEN** the Pane panel renders the `agt` line
- **THEN** the line renders as: `agt ⣾ active` (spinner animating, `text-accent` color on spinner, `text-text-primary` on state text)

#### Scenario: No agent state
- **GIVEN** a window has no `agentState`
- **WHEN** the Pane panel renders
- **THEN** no `agt` line is shown and no `BrailleSnake` is rendered

## Deprecated Requirements

### Old BrailleSpinner Component

**Reason**: Replaced by `BlockPulse` (run line) and `BrailleSnake` (agt line). The file `braille-spinner.tsx` no longer exists.
**Migration**: `BlockPulse` in `block-pulse.tsx` replaces all prior `BrailleSpinner` usage on the run/fab lines. `BrailleSnake` in `braille-snake.tsx` is new for the agt line.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | BlockPulse frames: `░▒▓█▓▒` at 150ms | Confirmed from intake #1 — user explicitly chose from preview | S:95 R:90 A:95 D:95 |
| 2 | Certain | BrailleSnake frames: `⣾⣽⣻⢿⡿⣟⣯⣷` at 80ms | Confirmed from intake #2 — user selected "the dense one" | S:90 R:90 A:95 D:95 |
| 3 | Certain | No spinner in Host panel | Confirmed from intake #3 — static metrics, no activity state | S:95 R:95 A:90 D:95 |
| 4 | Confident | BrailleSnake shows for all agent states (active + idle) | Confirmed from intake #4 — spinner indicates agent presence, text differentiates state | S:70 R:85 A:75 D:65 |
| 5 | Confident | BrailleSnake uses `text-accent` color class | Confirmed from intake #5 — green reserved for run line, accent for agent | S:65 R:90 A:70 D:60 |
| 6 | Certain | Component follows BlockPulse pattern (useState + useEffect + setInterval) | Codebase convention — BlockPulse already established the pattern | S:90 R:95 A:95 D:95 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).
