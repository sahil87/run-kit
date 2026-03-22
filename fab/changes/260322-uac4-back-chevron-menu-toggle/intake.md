# Intake: Back Chevron Menu Toggle

**Change**: 260322-uac4-back-chevron-menu-toggle
**Created**: 2026-03-22
**Status**: Draft

## Origin

> The top left X icon isn't intuitive, change to < icon to indicate menu closer

One-shot request. The user finds the current hamburger-to-X animation unclear when the sidebar/drawer is open, and wants it replaced with a back chevron (`<`) that better communicates "close this panel."

## Why

The hamburger icon in the top-left of the top bar animates into an X shape when the sidebar (desktop) or drawer (mobile) is open. The X is ambiguous — it could mean "close the app," "cancel," or "dismiss." A left-pointing chevron (`<`) is a well-established pattern for "go back" / "close panel" and provides a clearer affordance that tapping it will collapse the navigation.

If left as-is, users may hesitate or misinterpret the X icon, especially on mobile where the drawer overlay adds to the confusion.

## What Changes

### Replace X animation with back chevron in `HamburgerIcon`

**File**: `app/frontend/src/components/top-bar.tsx` — `HamburgerIcon` component (lines 27-78)

Currently, when `isOpen` is true:
- Top line rotates +45deg and translates to form the top half of an X
- Middle line fades out
- Bottom line rotates -45deg and translates to form the bottom half of an X

**New behavior** when `isOpen` is true: the three lines animate into a left-pointing chevron (`<`):
- Top line rotates to angle downward-left (forming the top stroke of `<`)
- Middle line fades out or shortens
- Bottom line rotates to angle upward-left (forming the bottom stroke of `<`)

The closed state (three horizontal lines = hamburger) remains unchanged. The transition should use the same 200ms ease timing for visual continuity.

### Update test assertions

**File**: `app/frontend/src/components/top-bar.test.tsx`

The test at line 137 ("renders hamburger icon (not logo img) as navigation toggle") may need updating if it asserts on specific SVG transforms or the X shape.

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update navigation toggle icon description — hamburger animates to back chevron instead of X

## Impact

- **Frontend only**: Single component change in `top-bar.tsx`
- **No API changes**: Pure presentational
- **Accessibility**: `aria-label="Toggle navigation"` remains correct — the label describes the action, not the icon shape
- **Touch targets**: No size changes — same `min-w`/`min-h` constraints apply

## Open Questions

None — the scope is clear and self-contained.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Hamburger (closed) icon stays the same | User only requested changing the open state icon | S:90 R:95 A:90 D:95 |
| 2 | Certain | Use CSS transform animation on existing SVG lines | Existing pattern uses CSS transforms on `<line>` elements; same approach for chevron | S:80 R:90 A:95 D:90 |
| 3 | Confident | Chevron points left (`<`) not right (`>`) | Left-pointing chevron is the standard "close sidebar" / "go back" affordance | S:75 R:90 A:85 D:80 |
| 4 | Confident | Keep 200ms ease transition timing | Matches existing animation duration; no reason to change | S:70 R:95 A:85 D:85 |
| 5 | Certain | No aria-label changes needed | Current label "Toggle navigation" describes the action, not icon shape | S:85 R:95 A:90 D:95 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).
