# row-identity-tips.spec.ts

Verifies the **session-row and server-tile identity tips** (xb77) — the two new
slim hover-cards that share the window flyout's title-bar grammar at tier-1
weight: an inset `PopupTitleBar` carrying the row's **identity** (the full
untruncated session name / the server name) over a single plain-text **body**
line of facts the rows cannot show (the tmux `$N` session id, window count, and
`~`-abbreviated session root path / the `tmux -L <socket>` flag and session
count). The cards are non-interactive (no icons, links, or registers), open on
row hover (fine pointer) and keyboard row focus, and dismiss on Escape; the
server tile's native `title` attribute is removed in favor of the card (the
double-tooltip rule).

## Shared setup

- Fully mocked — no tmux server, no real backend reads (the row-flyout.spec.ts
  idiom):
  - `**/api/servers` → a single server `default` with `sessionCount: 1`.
  - `/ws/terminals` WebSocket → accepted and held open.
  - `/ws/state` (via `mockStateSocket`) → one session `dev` carrying the new
    `sessionId: "$4"` / `sessionPath: "/home/sahil/code/sahil87/run-kit"` fields
    with two plain windows (`@1`, `@2`).
- The session row is located by `[role='treeitem'][data-session-row='default:dev']`,
  the server tile by its `role="option"` accessible name, and the cards by
  `data-testid="session-tip"` / `data-testid="server-tip"` (title bar via the
  shared `popup-title-bar` testid).

## Tests

### `hovering a session row opens its identity tip (full name + $N · N windows · ~/path)`

**What it proves:** hovering a session row (fine pointer, after the plain 300ms
delay) opens the session identity tip: the title bar reads `Session dev` and
the body reads `$4 · 2 windows · ~/code/sahil87/run-kit` — the tmux id, the
window count, and the root path with `$HOME` abbreviated to `~`. The card holds
no interactive content (tier-1 weight lives in the body, not the chrome).

**Steps:**
1. Assert no `session-tip` card exists at rest.
2. Hover the `dev` session row.
3. Assert the card is visible, its title bar contains "Session dev", the card
   contains "$4 · 2 windows · ~/code/sahil87/run-kit", and it contains no
   anchors or buttons.

### `keyboard: focusing a session row opens the tip; Escape dismisses it`

**What it proves:** the session tip is keyboard-reachable (Constitution V) —
focusing the row's treeitem opens it without a pointer, and Escape dismisses it
(floating-ui `useDismiss`).

**Steps:**
1. Focus the `dev` session row.
2. Assert the `session-tip` card appears.
3. Press Escape; assert the card is removed.

### `hovering a server tile opens its identity tip (socket flag); the tile has no native title`

**What it proves:** hovering a server tile opens the server identity tip:
title bar `Server default`, body `tmux -L default · 1 session` — the socket
flag composed frontend-side from the server name (server names ARE socket
names) and shown uniformly, plus the session count. The tile's native `title`
attribute is gone (never both — the OS bubble would double the styled card),
and the card is non-interactive.

**Steps:**
1. Assert the `default` tile has no `title` attribute and no `server-tip` card
   exists at rest.
2. Hover the tile.
3. Assert the card is visible, its title bar contains "Server default", the
   card contains "tmux -L default · 1 session", and it contains no anchors or
   buttons.
