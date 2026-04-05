# Intake: Fix tmux scrolling on mobile

**Change**: 260325-8kuf-tmux-mobile-scroll
**Created**: 2026-03-25
**Status**: Draft

## Origin

> fix tmux scrolling on mobile - when you scroll in the terminal area on a touch device, tmux doesn't scroll properly

One-shot request. User reports that swiping up/down in the terminal area on a mobile (touch) device does not scroll the tmux scrollback buffer.

## Why

On mobile/touch devices, users cannot scroll through tmux output history. The terminal container has `touch-none` applied (`app/frontend/src/components/terminal-client.tsx:350`), which tells the browser to suppress all touch gestures — including vertical swipe-to-scroll. This means:

1. **No scrollback access on mobile** — users on phones/tablets cannot review previous output, which is a core terminal workflow.
2. **No workaround** — tmux's keyboard-based scroll (`Ctrl+b [`) is impractical on a mobile soft keyboard, and the bottom bar doesn't expose a scroll mode toggle.

The `touch-none` was likely added to prevent touch events from interfering with xterm.js rendering or causing page-level scroll bounce. The fix needs to restore vertical scroll capability without reintroducing page bounce or breaking xterm.js input.

## What Changes

### Terminal touch event handling

The `touch-none` CSS class on the terminal container (`terminal-client.tsx:350`) needs to be replaced or supplemented with a mechanism that:

1. **Allows vertical swipe** gestures to scroll the xterm.js viewport (which maps to tmux scrollback)
2. **Prevents horizontal swipe** from causing page-level overflow (tmux hard-minimum ~80 cols exceeds phone screens)
3. **Prevents page bounce** — the existing `overscroll-behavior: none` on `.xterm-viewport` in `globals.css:103-105` should remain

Possible approaches:
- Replace `touch-none` with `touch-pan-y` — allows vertical panning while blocking horizontal. This is the simplest CSS-only fix.
- Use a JS touch handler that translates vertical swipes into xterm scroll commands — more control but more complexity.
- Leverage xterm.js's built-in touch support (if present in v5) — need to verify whether xterm.js handles touch scrolling natively when `touch-action` is not `none`.

### Files likely affected

- `app/frontend/src/components/terminal-client.tsx` — terminal container `touch-none` class
- `app/frontend/src/globals.css` — potentially additional `.xterm-viewport` touch rules
- Possibly a new touch/scroll hook if the CSS-only approach is insufficient

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document mobile touch scroll behavior for the terminal

## Impact

- **Frontend only** — no backend changes needed
- **Terminal component** — `terminal-client.tsx` is the main change target
- **CSS** — `globals.css` may need `.xterm-viewport` touch-action rules
- **Mobile UX** — directly improves usability on phones and tablets
- **Desktop** — no impact expected (touch events irrelevant on non-touch devices)

## Open Questions

- Does xterm.js v5 handle touch-based scrolling natively when `touch-action` allows it, or do we need a JS-level touch handler?
- Should `touch-pan-y` be applied only on touch devices (via `@media (pointer: coarse)`) or universally?

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | CSS-first approach — try `touch-pan-y` before JS handlers | Constitution VII (convention over configuration), simplest fix first | S:80 R:95 A:90 D:90 |
| 2 | Certain | Keep `overscroll-behavior: none` on `.xterm-viewport` | Already in globals.css, prevents page bounce — proven pattern | S:90 R:95 A:95 D:95 |
| 3 | Confident | xterm.js likely handles scroll natively when touch-action allows it | xterm.js v5 has a `.xterm-viewport` with `overflow-y: scroll` — touch-pan-y should let the browser delegate scroll to it | S:70 R:90 A:70 D:75 |
| 4 | Confident | Apply `touch-pan-y` universally, not behind `@media (pointer: coarse)` | Harmless on non-touch devices, simpler implementation, avoids edge cases with hybrid devices (Surface, iPad with keyboard) | S:65 R:90 A:80 D:70 |
| 5 | Certain | No backend changes needed | Scroll is purely a frontend/CSS concern — tmux scrollback is already accessible via the xterm viewport | S:95 R:95 A:95 D:95 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).
