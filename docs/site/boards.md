# Boards — watch many panes at once

A **board** is a named, cross-server pane dashboard. Pin any tmux window from any server into a board, and the board renders all pinned panes side-by-side in a horizontally-scrollable layout — perfect for watching three parallel agent sessions, or comparing a `just dev` server's output against the agent that's editing it.

## Pinning a window

Four ways to pin a window to a board:

1. **Sidebar pin icon** — every window row in the sidebar has a pin icon. Click it to open a popover listing existing boards (click to pin/unpin), plus a "Pin to new board…" input that creates a new board on first pin.
2. **Command palette (`Cmd+K`)** — `Board: Pin Current Window`, `Board: Unpin Current Window`, `Board: Switch to <name>`, `Board: Leave Board View`.
3. **Board pane header** — each pinned pane shows an unpin button in its header for one-click removal.
4. **From the shell / an agent** — `rk board pin <name> @N` pins a window by id (needs `rk serve` up); `rk board show|unpin|reorder` cover the rest of the board surface.

## Inside a board

- **`Cmd+]` / `Cmd+[`** cycles pane focus to the next / previous pane (wraps).
- **Click a pane** to focus it; keystrokes route to that pane's terminal.
- **Drag the pane edge** to resize (desktop only; widths persist per-board in `localStorage`).
- **On mobile**, panes render as a single-pane swipe carousel.

## Where pin state lives

Pin state lives in tmux (via the `@rk_ses_pin_board` session option on the window's `_rk-pin-*` pin session) so it follows the window, not the browser — open the same board URL on your phone and you see the same panes. Pane widths are intentionally local to each device.
