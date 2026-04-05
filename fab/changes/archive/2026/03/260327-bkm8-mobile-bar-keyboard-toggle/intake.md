# Intake: Mobile Bar Keyboard Toggle

**Change**: 260327-bkm8-mobile-bar-keyboard-toggle
**Created**: 2026-03-27
**Status**: Draft

## Origin

> Move the escape button from the bottom bar into the Function button menu. Only tab, ctrl, alt, fn, arrow inputs remain in the bottom bar, then console (text input) and Cmd K buttons. Also a right-aligned down caret in mobile view. Change the down caret icon to a keyboard icon and make it toggle instead of just keyboard-down — in mobile I should also be able to bring the keyboard up with its help.

One-shot request. User wants to declutter the bottom bar by relocating the Escape button into the existing Fn dropdown menu, and to convert the mobile keyboard-dismiss button from a one-way dismiss into a bidirectional toggle that can also summon the keyboard.

## Why

The bottom bar on mobile is space-constrained at 375px. The Escape button occupies a slot that could be freed — Escape is infrequently tapped compared to Tab/Ctrl/Alt, and it fits naturally alongside the other special keys already in the Fn menu (PgUp, PgDn, Home, End, Ins, Del).

The current keyboard-dismiss button (down caret `⌄`) is one-way: it calls `document.activeElement.blur()` to hide the virtual keyboard, but there's no way to bring it back without tapping into the terminal area. This is a usability gap on mobile — if the user accidentally dismisses the keyboard, recovery requires knowing to tap the terminal canvas to refocus xterm's hidden textarea. A toggle button that can both dismiss and summon the keyboard solves this.

Changing the icon from a down caret to a keyboard icon also improves discoverability — the caret's meaning ("dismiss keyboard") is ambiguous without context.

## What Changes

### 1. Move Escape to Function Menu

Remove the standalone `Esc` (`⎋`) button from the bottom bar's main row. Add it as the first item in the Fn dropdown menu's bottom section (the extended-keys grid that currently has PgUp, PgDn, Home, End, Ins, Del).

**Fn menu new bottom section layout** (3-column grid → 3x3):
```
Esc    PgUp   PgDn
Home   End    Ins
Del
```

Escape in the Fn menu sends `\x1b` exactly as the standalone button does today. It respects the same modifier bridging (Alt prefix, Ctrl stays armed).

### 2. Simplify Bottom Bar Layout

After removing Escape, the bottom bar main row becomes:

```
Tab  Ctrl  Alt  Fn▴  ArrowPad  |  >_  ⌘K  [hostname]  ⌨
```

- `Tab`, `Ctrl`, `Alt`, `Fn▴`, `ArrowPad` — unchanged
- Vertical divider — unchanged
- `>_` (Compose) — unchanged (only renders when `onOpenCompose` is provided)
- `⌘K` (Command Palette) — unchanged
- `[hostname]` — unchanged (hidden on small screens)
- `⌨` (Keyboard Toggle) — replaces the old down-caret `⌄`, right-aligned, touch-only (`hidden coarse:inline-flex`)

### 3. Keyboard Toggle Button

Replace the current keyboard-dismiss button (down caret `⌄`, `hidden coarse:inline-flex`) with a keyboard icon (`⌨` U+2328 or an SVG keyboard icon) that **toggles** the virtual keyboard:

- **When keyboard is visible** (xterm textarea is focused): tapping the button calls `document.activeElement?.blur()` to dismiss the keyboard — same as current behavior.
- **When keyboard is hidden** (nothing focused / xterm textarea lost focus): tapping the button focuses xterm's hidden textarea to summon the virtual keyboard. The xterm terminal instance exposes a `.focus()` method, and the component already has access to the terminal ref via `termRef`.

**Implementation approach**: The toggle needs to detect whether the keyboard is currently visible. The most reliable signal is whether `document.activeElement` is the xterm hidden textarea (or any input/textarea element within the terminal container). If active element is inside the terminal → blur (dismiss). Otherwise → call `termRef.current?.focus()` (summon).

The button's icon should visually indicate its toggle nature. A keyboard icon (`⌨`) is appropriate — it communicates "keyboard control" regardless of direction. The icon does NOT need to change between states (no animate between keyboard-up/keyboard-down).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Update Bottom Bar section to reflect new layout (Escape removed from main row), Fn menu section to include Escape, and keyboard toggle behavior replacing dismiss-only caret.

## Impact

- **`app/frontend/src/components/bottom-bar.tsx`** — Primary file. Remove Esc button from main row, add Esc to Fn menu grid, replace dismiss button with toggle button.
- **No backend changes** — purely frontend.
- **No new dependencies** — uses existing xterm `.focus()` API.
- **No API changes** — no new routes or WebSocket messages.
- **Accessibility** — `aria-label` on the keyboard toggle should describe current action ("Show keyboard" / "Hide keyboard").

## Open Questions

None — the scope is well-defined and all implementation details are clear from the existing codebase.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Escape goes into Fn menu bottom section, not top (F-key) section | Escape is a special/extended key like PgUp/Del, not a function key | S:90 R:90 A:95 D:95 |
| 2 | Certain | Keyboard toggle uses xterm's `.focus()` to summon keyboard | Codebase already has `termRef` access; `.focus()` is the standard xterm.js API for this | S:85 R:90 A:95 D:90 |
| 3 | Confident | Use Unicode `⌨` (U+2328) for the keyboard icon rather than a custom SVG | Consistent with existing bottom bar style (Esc uses `⎋`, Tab uses `⇥`); simpler than adding SVG | S:70 R:90 A:75 D:70 |
| 4 | Certain | Toggle detection uses `document.activeElement` comparison | Standard DOM API; no need for a separate "keyboard visible" state variable | S:85 R:95 A:90 D:90 |
| 5 | Confident | Fn menu bottom section becomes 3x3 grid (was 2x3) to accommodate Escape | 7 items in a 3-column grid = 3 rows; natural extension of existing layout | S:75 R:85 A:80 D:75 |
| 6 | Certain | No changes needed to modifier bridging — Escape in Fn menu uses same `sendKey` path | Fn menu keys already go through the same send mechanism with modifier support | S:90 R:95 A:90 D:95 |
| 7 | Confident | `aria-label` toggles between "Show keyboard" and "Hide keyboard" | Best practice for toggle buttons; the active state is derivable from `document.activeElement` | S:70 R:95 A:80 D:85 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).
