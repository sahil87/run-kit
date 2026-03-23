# Intake: Arrow Pad Focus Steal & Popup Persistence

**Change**: 260323-k26m-arrow-pad-focus-popup
**Created**: 2026-03-23
**Status**: Draft

## Origin

> fix: prevent arrow pad from stealing terminal focus and keep popup open for repeated taps

Conversational — user identified two issues with the `ArrowPad` component during mobile testing:
1. Tapping the arrow icon dismisses the mobile keyboard (steals focus from xterm textarea)
2. Tapping any directional arrow in the popup closes it immediately, preventing repeated arrow key input

## Why

On mobile, the bottom bar buttons use `preventDefault` on `mousedown` to prevent focus from moving away from xterm's hidden textarea (which keeps the on-screen keyboard open). The `ArrowPad` component was missing this treatment — its `handleMouseDown` callback tracked drag start coordinates but didn't call `preventDefault`, so tapping the arrow icon dismissed the keyboard.

Separately, the popup arrow buttons (`Up`, `Down`, `Left`, `Right`) each called `setOpen(false)` after sending the arrow sequence. This forced users to re-open the popup for every arrow press — unusable for navigation tasks that require multiple consecutive arrow key inputs (e.g., scrolling through command history, navigating editors).

Without this fix, mobile users cannot use arrow keys without repeatedly re-opening the keyboard and the popup.

## What Changes

### 1. Focus steal prevention on ArrowPad trigger button

Add `e.preventDefault()` to the existing `handleMouseDown` callback in `arrow-pad.tsx`. This matches the `preventFocusSteal` pattern used by all other buttons in `bottom-bar.tsx`. The drag-detection logic (start coordinates, threshold check) is preserved — `preventDefault` is called before setting the start position.

A local `preventFocusSteal` helper is added to `arrow-pad.tsx` (same implementation as `bottom-bar.tsx`'s) for use on the popup buttons.

### 2. Focus steal prevention on popup arrow buttons

Add `onMouseDown={preventFocusSteal}` to all four directional arrow buttons in the popup (`Up`, `Down`, `Left`, `Right`).

### 3. Popup stays open for repeated taps

Remove `setOpen(false)` from all four popup arrow button `onClick` handlers. The popup now stays open until the user taps outside it, which is handled by the existing `mousedown` document listener (lines 82–91 in the original file).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document ArrowPad focus-steal prevention and popup persistence behavior

## Impact

- **File changed**: `app/frontend/src/components/arrow-pad.tsx`
- **No API changes** — purely frontend component behavior
- **No new dependencies**
- **Mobile UX improvement** — arrow keys now usable without keyboard dismissal or popup re-opening

## Open Questions

None — implementation is straightforward and matches established patterns.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `e.preventDefault()` on mousedown to prevent focus steal | Discussed — matches exact pattern from bottom-bar.tsx `preventFocusSteal` | S:95 R:90 A:95 D:95 |
| 2 | Certain | Remove `setOpen(false)` from popup arrow buttons | Discussed — user explicitly requested popup stay open for repeated taps | S:95 R:95 A:90 D:95 |
| 3 | Certain | Outside-click listener handles popup dismissal | Existing behavior — document mousedown listener already closes popup on outside click | S:90 R:95 A:95 D:95 |
| 4 | Confident | Local `preventFocusSteal` helper rather than importing from bottom-bar | bottom-bar.tsx doesn't export it; one-liner not worth extracting to shared module | S:70 R:90 A:85 D:80 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
