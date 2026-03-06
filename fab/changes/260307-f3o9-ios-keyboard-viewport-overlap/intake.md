# Intake: iOS Keyboard Viewport Overlap

**Change**: 260307-f3o9-ios-keyboard-viewport-overlap
**Created**: 2026-03-07
**Status**: Draft

## Origin

> entering text in ios is still a problem. 1) The bottom of the terminal isn't always visible on a phone. When tapping on the terminal open the keyboard, the keyboard comes on top of the terminal - so you can't see what you are typing

User reports that despite existing iOS keyboard support (`useVisualViewport` hook + `--app-height` CSS property), the keyboard still covers the bottom of the terminal on iOS Safari. The bottom bar and terminal output are not visible while typing.

## Why

The existing `useVisualViewport` hook (`src/hooks/use-visual-viewport.ts`) only listens to the `resize` event on `window.visualViewport` and sets `--app-height` to `visualViewport.height`. This is insufficient on iOS Safari because:

1. **Missing `scroll` event**: When the iOS keyboard opens, Safari may scroll the document to keep the focused element visible. The `visualViewport` fires a `scroll` event (not just `resize`) and `offsetTop` changes to reflect the scroll offset. The current hook ignores this.
2. **No offset compensation**: The layout's flex container (`height: var(--app-height, 100vh)`) is positioned relative to the document top. When iOS scrolls the page upward, the container moves with it — the bottom portion (bottom bar, last terminal lines) slides below the visual viewport, behind the keyboard.
3. **Result**: The user taps the terminal or compose buffer, the keyboard rises, iOS scrolls the page, and the bottom of the app disappears behind the keyboard.

If we don't fix it, the terminal page is effectively unusable for text input on iOS — users can't see what they're typing, can't see the bottom bar buttons, and must dismiss the keyboard to read terminal output.

## What Changes

### Fix `useVisualViewport` hook to account for viewport scroll offset

The hook at `src/hooks/use-visual-viewport.ts` needs two changes:

1. **Listen to both `resize` AND `scroll` events** on `window.visualViewport`
2. **Set `--app-offset-top`** CSS custom property from `visualViewport.offsetTop` in addition to `--app-height` from `visualViewport.height`

### Pin the layout container to the visual viewport

The flex container in `src/app/layout.tsx` (line 25) currently uses only `height: var(--app-height, 100vh)`. It needs to also apply a `translateY` or `top` offset derived from `--app-offset-top` so the container stays pinned to the actual visible area when iOS scrolls the page.

Approach: use `position: fixed` with `top: var(--app-offset-top, 0px)` and `height: var(--app-height, 100vh)` on the outer container, or apply `transform: translateY(var(--app-offset-top, 0px))` to keep it in flow. The fixed-position approach is more reliable for this use case since it completely decouples from document scroll.
<!-- assumed: fixed positioning approach — eliminates document scroll dependency entirely, more robust than translateY for iOS keyboard scenarios -->

## Affected Memory

- `run-kit/architecture`: (modify) Update iOS Keyboard Support section to document the scroll+offset fix
- `run-kit/ui-patterns`: (modify) Update iOS Keyboard Support section with corrected behavior description

## Impact

- **`src/hooks/use-visual-viewport.ts`** — add `scroll` listener, set `--app-offset-top` property
- **`src/app/layout.tsx`** — update flex container styling to use offset
- **`src/app/globals.css`** — potentially add styles for fixed positioning on fullbleed

Scope is narrow: two files modified, one CSS tweak. Only affects the terminal page (fullbleed mode) — dashboard and project pages use regular document flow with `100vh`.

## Open Questions

- None — the iOS `visualViewport` API behavior is well-documented and the fix pattern is established.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `visualViewport.offsetTop` to track iOS scroll offset | This is the standard API for this purpose; no alternative exists | S:80 R:90 A:95 D:95 |
| 2 | Certain | Listen to both `resize` and `scroll` events on `visualViewport` | iOS fires `scroll` (not `resize`) when the page scrolls to accommodate the keyboard | S:80 R:90 A:95 D:95 |
| 3 | Confident | Use `position: fixed` + `top`/`height` for the app container when fullbleed | More reliable than `translateY` for decoupling from iOS page scroll; only applies in fullbleed (terminal page) | S:60 R:75 A:70 D:65 |
| 4 | Certain | Only the terminal page (fullbleed mode) is affected | Dashboard and project pages don't trigger the keyboard in a way that matters; they use normal overflow | S:85 R:90 A:90 D:90 |
| 5 | Certain | Fix type is `fix` — correcting existing iOS keyboard support | Mechanism exists but doesn't work correctly; this patches it | S:90 R:95 A:95 D:95 |

5 assumptions (4 certain, 1 confident, 0 tentative, 0 unresolved).
