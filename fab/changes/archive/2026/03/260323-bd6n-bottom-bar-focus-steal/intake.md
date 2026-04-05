# Intake: Bottom Bar Focus Steal Fix

**Change**: 260323-bd6n-bottom-bar-focus-steal
**Created**: 2026-03-23
**Status**: Draft

## Origin

> Backlog [bd6n]: "Tapping on any of the bottom bar buttons (except cmdK) shouldn't steal away focus from the terminal. Right now clicking on them brings the iOS keyboard down. probably because a text element lost focus"

One-shot from backlog item. Prior `/fab-discuss` session identified the root cause and fix approach.

## Why

On iOS (and other touch devices), tapping a bottom bar button (Esc, Tab, Ctrl, Alt, Fn, Compose) causes the browser to shift focus from xterm.js's hidden textarea to the tapped `<button>`. When the textarea loses focus, iOS dismisses the on-screen keyboard. The user must then tap the terminal again to bring the keyboard back — disrupting the flow of terminal interaction.

This is especially frustrating because these buttons exist to *augment* terminal input (sending escape sequences, toggling modifiers). Having them dismiss the keyboard defeats their purpose.

If not fixed, the bottom bar remains effectively unusable on mobile for sequential key presses — users can't tap Ctrl then type a letter without the keyboard disappearing between taps.

## What Changes

### Prevent default on mousedown/touchstart for bottom bar buttons

Add `onMouseDown={(e) => e.preventDefault()}` to all `<button>` elements in `bottom-bar.tsx` that should not steal focus from the terminal. This prevents the browser's default focus-shift behavior while still allowing `onClick` handlers to fire.

**Affected buttons:**
- Escape (`⎋`)
- Tab (`⇥`)
- Ctrl (`^`) and Alt (`⌥`) modifier toggles
- Function key trigger (`F▴`)
- Function key menu items (F1–F12, PgUp, PgDn, Home, End, Ins, Del)
- Compose (`>_`)

**Excluded:** The Command Palette button (`⌘K`) — this intentionally opens a dialog that takes focus, so stealing focus from the terminal is expected behavior.

### Pattern reference

`ArrowPad` (`arrow-pad.tsx`) already handles this correctly with `onMouseDown` and `onTouchStart` handlers that prevent default. The fix follows the same pattern.

### Implementation detail

A shared `onMouseDown` handler or inline `onMouseDown={(e) => e.preventDefault()}` on each button. The simplest approach: add the handler to the toolbar `<div>` container itself with a single `onMouseDown` handler, then exempt the CmdK button by stopping propagation. Alternatively, add it per-button. The per-button approach is more explicit and matches `ArrowPad`'s pattern.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the focus-preservation pattern for mobile toolbar buttons

## Impact

- **Files**: `app/frontend/src/components/bottom-bar.tsx` (primary), possibly `app/frontend/src/components/arrow-pad.tsx` (reference only, no changes needed)
- **Testing**: Playwright e2e test on mobile viewport to verify keyboard stays visible after button taps
- **Risk**: Low — `preventDefault` on mousedown is a well-understood pattern; `onClick` still fires normally

## Open Questions

None — the approach is well-understood and matches the existing `ArrowPad` pattern.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `onMouseDown={(e) => e.preventDefault()}` pattern | Discussed — standard browser focus-prevention technique, matches existing ArrowPad pattern in codebase | S:90 R:95 A:95 D:95 |
| 2 | Certain | Exclude CmdK button from focus prevention | Discussed — CmdK intentionally opens command palette which needs focus | S:85 R:90 A:90 D:95 |
| 3 | Confident | Apply per-button rather than container-level handler | Per-button is more explicit and matches ArrowPad's existing pattern; container-level would need exemption logic | S:70 R:90 A:80 D:70 |
| 4 | Certain | Change type is `fix` | This is a bug fix — existing functionality (bottom bar buttons) has broken behavior on mobile | S:95 R:95 A:95 D:95 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
