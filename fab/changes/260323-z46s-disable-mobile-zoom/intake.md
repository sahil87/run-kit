# Intake: Disable Mobile Zoom on Input Focus

**Change**: 260323-z46s-disable-mobile-zoom
**Created**: 2026-03-23
**Status**: Draft

## Origin

> Backlog [z46s]: "the interface shouldn't zoom in or out on mobile. Today when there's a text input, interface auto zooms. this breaks mobile ui. Is there some html tag hint we can provide to the browser for this?"

Conversational mode. User and agent discussed three approaches: (1) bump input font-size to 16px, (2) add `maximum-scale=1` to the viewport meta tag, (3) add `user-scalable=no`. User chose option (2) — viewport meta tag approach — as the simplest fix for a keyboard-first tool dashboard where pinch-to-zoom is not needed.

## Why

iOS Safari automatically zooms in when the user focuses a text input with `font-size < 16px`. In run-kit's mobile UI, this auto-zoom displaces the entire interface — the terminal, bottom bar, and top bar all shift, and the user must manually pinch-to-zoom back out after dismissing the keyboard. This breaks the mobile experience on every text input interaction (command palette, compose buffer, text input dialog).

If left unfixed, every mobile user hitting a text input will experience the zoom disruption. Since run-kit is keyboard-first with frequent text input interactions, this is a high-friction pain point.

Adding `maximum-scale=1` to the viewport meta tag prevents the browser from zooming beyond 1x, eliminating the auto-zoom behavior entirely. This is a one-line HTML change with no code-level side effects.

## What Changes

### Viewport Meta Tag — `app/frontend/index.html`

Current tag:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, interactive-widget=resizes-content" />
```

Updated tag:
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, interactive-widget=resizes-content" />
```

Adding both `maximum-scale=1.0` and `user-scalable=no` for comprehensive coverage:
- `maximum-scale=1.0` — prevents zoom beyond 1x (the primary fix)
- `user-scalable=no` — explicitly disables pinch-to-zoom (belt-and-suspenders; some older WebViews only respect this one)

Note: `interactive-widget=resizes-content` is preserved — it controls how the virtual keyboard affects layout and is unrelated to zoom.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document the viewport zoom-prevention approach and rationale

## Impact

- **Files changed**: `app/frontend/index.html` (1 line)
- **Accessibility tradeoff**: Disabling pinch-to-zoom removes a zoom affordance. Acceptable for run-kit because: (a) it's a keyboard-first tool dashboard, not a content site, (b) terminal text is fixed-width and zoom doesn't improve readability, (c) the zoom disruption is worse than losing zoom capability
- **No impact on**: terminal rendering, xterm.js, WebSocket connections, SSE, backend

## Open Questions

None — the approach is straightforward and well-understood.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `maximum-scale=1.0` on viewport meta tag | Discussed — user chose this approach over font-size bump | S:95 R:90 A:90 D:95 |
| 2 | Certain | Also add `user-scalable=no` for broader browser coverage | Standard practice — belt-and-suspenders with maximum-scale | S:80 R:90 A:85 D:85 |
| 3 | Certain | Preserve existing `interactive-widget=resizes-content` | Unrelated to zoom; controls keyboard layout behavior | S:90 R:95 A:90 D:95 |
| 4 | Confident | Accessibility tradeoff is acceptable for this app | run-kit is a keyboard-first tool dashboard, not a content site | S:70 R:80 A:75 D:80 |
| 5 | Certain | Single file change: `app/frontend/index.html` | Viewport meta is the only file involved | S:95 R:95 A:95 D:95 |

5 assumptions (4 certain, 1 confident, 0 tentative, 0 unresolved).
