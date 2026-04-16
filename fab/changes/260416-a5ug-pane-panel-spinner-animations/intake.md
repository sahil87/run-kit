# Intake: Pane Panel Spinner Animations

**Change**: 260416-a5ug-pane-panel-spinner-animations
**Created**: 2026-04-16
**Status**: Draft

## Origin

> User explored terminal-style animation options for the Pane panel's "run" line. A live preview page (10 spinner variants) was built and shown via iframe window. User selected **Block Pulse** (`░▒▓█▓▒` at 150ms) for the run line and **Braille Snake** (`⣾⣽⣻⢿⡿⣟⣯⣷` at 80ms) for the agt line. The Host panel was evaluated and ruled out — all its data is static metrics with no "in progress" state that warrants animation.

## Why

The Pane panel's activity indicators need distinct visual treatments for different states. The run line (active process) and agt line (agent activity) serve different purposes — a calm pulse for "something is running" vs a denser spinner for "an agent is actively working." The previous `BrailleSpinner` component was used for both, losing that semantic distinction.

## What Changes

### 1. BlockPulse on `run` line (already implemented)

- Renamed `braille-spinner.tsx` to `block-pulse.tsx`
- Renamed `BrailleSpinner` component to `BlockPulse`
- Changed frames from braille dots (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` at 80ms) to block pulse (`░▒▓█▓▒` at 150ms)
- Updated import in `status-panel.tsx`

### 2. BrailleSnake on `agt` line (pending)

- Create a new `BrailleSnake` component in `app/frontend/src/components/braille-snake.tsx`
- Frames: `⣾⣽⣻⢿⡿⣟⣯⣷` at 80ms — dense braille grid, dot chases the edge
- Add to the `agt` line in `status-panel.tsx` when agent state is present, with `text-accent` color class
- The spinner should show regardless of whether the agent is active or idle — it indicates agent presence

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the two spinner variants and their semantic usage

## Impact

- `app/frontend/src/components/braille-snake.tsx` — new file
- `app/frontend/src/components/sidebar/status-panel.tsx` — add BrailleSnake import and render in agt line

## Open Questions

None — all design decisions were made during the discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | BlockPulse frames: `░▒▓█▓▒` at 150ms | Discussed — user explicitly chose Block Pulse from 10 options | S:95 R:90 A:95 D:95 |
| 2 | Certain | BrailleSnake frames: `⣾⣽⣻⢿⡿⣟⣯⣷` at 80ms | Discussed — user selected "the dense one" for agt line | S:90 R:90 A:95 D:95 |
| 3 | Certain | No spinner in Host panel | Discussed — user and agent agreed Host panel has no "in progress" state | S:95 R:95 A:90 D:95 |
| 4 | Confident | BrailleSnake shows for all agent states (active + idle) | Agent presence itself is the signal worth indicating; idle duration text differentiates state | S:70 R:85 A:75 D:65 |
| 5 | Confident | BrailleSnake uses `text-accent` color class | Consistent with fab line spinner color; green reserved for run line | S:65 R:90 A:70 D:60 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).
