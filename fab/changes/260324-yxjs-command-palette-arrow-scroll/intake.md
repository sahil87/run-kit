# Intake: Command Palette Arrow Key Scroll

**Change**: 260324-yxjs-command-palette-arrow-scroll
**Created**: 2026-03-24
**Status**: Draft

## Origin

> Moving up and down the Command Palette using arrow keys don't automatically scroll it when you reach the bottom (& also when you reach the top)

One-shot bug report. The Command Palette list container has `max-h-64 overflow-y-auto` but no scroll-into-view logic — when keyboard navigation moves the selection beyond the visible area, the viewport doesn't follow.

## Why

The Command Palette is the primary discovery mechanism for actions (Constitution V: Keyboard-First). When the list is long enough to scroll (more items than fit in the 256px `max-h-64` container), arrow-key navigation moves the `selectedIndex` and updates `aria-selected` but the scroll position stays put. The selected item disappears below or above the visible area, making keyboard-only navigation effectively broken for long lists.

Without this fix, users must resort to mouse scrolling to find items beyond the visible area, which violates the keyboard-first principle.

## What Changes

### Add scroll-into-view on selection change

Add a `useEffect` that scrolls the currently selected item into view whenever `selectedIndex` changes. The implementation follows the existing pattern in `app/frontend/src/components/theme-selector.tsx` (lines 69-76):

1. Add a `listRef` (`useRef<HTMLDivElement>`) to the listbox container (`<div id={listId} role="listbox">`)
2. Add a `useEffect` that fires on `[selectedIndex, open]` changes:
   - Query `listRef.current` for the element with `[aria-selected="true"]`
   - Call `selected.scrollIntoView({ block: "nearest" })` — this scrolls with minimal movement (only scrolls if the element is outside the visible area)

Target file: `app/frontend/src/components/command-palette.tsx`

### No behavioral changes

- Arrow key clamping (min 0, max length-1) remains unchanged
- No wrapping behavior added (that's a separate concern)
- No mouse-enter suppression needed (Command Palette doesn't have hover-to-select during keyboard nav)

## Affected Memory

- `run-kit/ui-patterns`: (modify) Document scroll-into-view as a standard pattern for keyboard-navigable lists

## Impact

- **Files changed**: `app/frontend/src/components/command-palette.tsx` (add ref + useEffect)
- **Tests**: `app/frontend/src/components/command-palette.test.tsx` (add test for scroll-into-view behavior)
- **Risk**: Minimal — additive change, no existing behavior modified

## Open Questions

None — the fix is well-scoped and follows an established pattern in the codebase.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `scrollIntoView({ block: "nearest" })` | Established pattern in theme-selector.tsx; standard DOM API | S:90 R:95 A:95 D:95 |
| 2 | Certain | Add `listRef` to the listbox container | Required for querying `aria-selected` elements; same pattern as theme-selector | S:90 R:95 A:95 D:95 |
| 3 | Certain | Keep clamped navigation (no wrap-around) | Description only mentions scroll; wrapping is a separate concern | S:85 R:90 A:90 D:90 |
| 4 | Confident | No mouse-enter suppression needed | Command Palette doesn't have hover-to-select during keyboard nav (unlike theme-selector which previews on hover) | S:75 R:90 A:80 D:85 |

4 assumptions (3 certain, 1 confident, 0 tentative, 0 unresolved).
