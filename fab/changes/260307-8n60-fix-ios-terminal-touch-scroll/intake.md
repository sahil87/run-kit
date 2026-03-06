# Intake: Fix iOS Terminal Touch Scroll

**Change**: 260307-8n60-fix-ios-terminal-touch-scroll
**Created**: 2026-03-07
**Status**: Draft

## Origin

> "I am unable to touch scroll the terminal on the phone (iOS) still. the whole page scrolls."

One-shot bug report. The user cannot scroll the terminal output on iOS — touch gestures scroll the entire page instead of scrolling within the xterm terminal.

## Why

On iOS Safari, touching the terminal area and swiping scrolls the entire page instead of scrolling the xterm terminal's scrollback buffer. This makes the terminal unusable on mobile — the user cannot review output history, and the page bounces/shifts unexpectedly.

The terminal page already sets `fullbleed(true)` which applies `overflow-hidden` on the `ContentSlot` (`src/contexts/chrome-context.tsx:85`), but iOS Safari ignores `overflow: hidden` for touch-initiated scrolling on the body/html elements. The outer flex container and `body` have no touch-action or overscroll-behavior constraints, so iOS elastic scrolling kicks in.

xterm.js handles mouse wheel scrolling natively but does not automatically prevent touch event propagation on its canvas element. Without explicit `touch-action: none` on the terminal container, the browser claims the touch gesture for page scrolling before xterm can process it.

## What Changes

### Prevent page scroll on terminal page

The fix needs to stop iOS Safari from scrolling the page when the user touches the terminal area. Two complementary approaches:

1. **CSS `touch-action: none` on the terminal container** — The `terminalRef` div in `terminal-client.tsx` (line 307) needs `touch-action: none` to tell the browser not to handle touch gestures (scroll, zoom) on the terminal area. xterm.js has its own touch handling for scrollback.

2. **CSS `overscroll-behavior: none` on the body** — When the terminal page is active (fullbleed mode), prevent iOS elastic/bounce scrolling from the body element. This can be applied globally or conditionally via the `--app-height` CSS custom property context.

3. **`overflow: hidden` on `html` and `body`** — iOS Safari sometimes ignores overflow on inner containers but respects it on `html`/`body`. The fullbleed terminal page should ensure these elements cannot scroll.

### Key files

- `src/app/globals.css` — global body/html overflow rules for iOS
- `src/components/terminal-client.tsx` or `src/app/p/[project]/[window]/terminal-client.tsx` — `touch-action: none` on the terminal div
- `src/contexts/chrome-context.tsx` — potentially tie body overflow to fullbleed state

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document touch-action handling for terminal page on iOS
- `run-kit/architecture`: (modify) Note iOS touch scroll prevention in Chrome Architecture section

## Impact

- **Terminal page** — primary fix target, touch behavior changes
- **Other pages** — must NOT be affected; dashboard and project pages need normal touch scrolling
- **Bottom bar** — already has `touch-none` on individual buttons (arrow-pad), should remain unaffected
- **Compose buffer** — textarea overlay needs normal touch behavior (scroll within textarea), must not be blocked

## Open Questions

- None — the fix is well-understood CSS/touch-action work.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `touch-action: none` on the terminal container div | Standard CSS solution for preventing browser touch handling on canvas-based UIs; xterm.js expects this | S:80 R:90 A:95 D:90 |
| 2 | Certain | Apply `overscroll-behavior: none` to prevent iOS bounce scroll | Well-known iOS Safari fix; no downside when page doesn't need elastic scrolling | S:80 R:95 A:90 D:90 |
| 3 | Confident | Scope overflow/touch changes to fullbleed mode only | Non-terminal pages (dashboard, project) need normal scroll behavior; fullbleed flag already distinguishes terminal page | S:70 R:85 A:80 D:75 |
| 4 | Confident | No JavaScript touch event handlers needed — CSS-only fix | `touch-action: none` + `overscroll-behavior: none` should suffice; JS `preventDefault()` on touchmove is a heavier fallback if CSS alone doesn't work on iOS Safari | S:65 R:90 A:70 D:65 |

4 assumptions (2 certain, 2 confident, 0 tentative, 0 unresolved).
