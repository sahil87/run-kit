# status-dot-tip.spec.ts

Verifies the **custom status-dot hover-card** (`StatusDotTip`) that replaces the
native HTML `title` tooltip on the sidebar window-row status dots: it opens on
hover and on keyboard focus, carries the dot's label text plus a docs link on
every dot and an "Open PR #N" link on PR-phase dots, dismisses on Escape, and
its links do not select/navigate the underlying window row.

## Shared setup

- Fully mocked — no tmux server, no `gh`, no real backend reads. The isolated
  e2e tmux server has no change-bound PRs and `gh` is unavailable in CI, so the
  spec injects the data via `page.route`:
  - `**/api/servers` → a single server `default` (so the app attaches exactly
    one SSE connection).
  - `**/api/windows/*/select` → 200 (window-select POSTs don't error on click).
  - `**/relay/*` WebSocket → accepted and held open (terminal relay stubbed).
  - `**/api/sessions/stream*` → one `event: sessions` frame whose payload is a
    session `dev` with two windows:
    - `@1` "feature-work" — change-bound (`fabChange` set) with `prNumber: 386`,
      `prUrl`, `prState: open`, `prChecks: pass` → a purple **"PR — open"** dot
      that gets the PR link.
    - `@2` "scratch-shell" — no `fabChange` → a gray **"idle"** dot with no PR
      link (docs link only).
- `beforeEach` installs the routes, navigates to `/default`, and waits for the
  "PR — open" dot to render (SSE payload landed).
- The dot is located by its accessible name (`getByRole("img", { name })`); the
  card by `data-testid="status-dot-tip"`, the links by `dot-tip-pr-link` /
  `dot-tip-docs-link`.

## Tests

### `hovering a PR dot opens a card with the label, PR link, and docs link`

**What it proves:** hovering a PR-phase dot opens the custom card, which shows
the dot's label text ("PR — open"), an "Open PR #386" link to `prUrl` (new tab,
`rel="noopener noreferrer"`), and the always-present docs link to the
GitHub-hosted status-dot doc (new tab).

**Steps:**
1. Hover the "PR — open" dot.
2. Assert the card (`status-dot-tip`) is visible and contains "PR — open".
3. Assert the PR link is visible, has text "Open PR #386", `href` = the PR URL,
   `target="_blank"`, `rel="noopener noreferrer"`.
4. Assert the docs link is visible, has the GitHub blob `href` for
   `docs/site/status-dot.md`, and `target="_blank"`.

### `a non-PR dot's card shows the docs link but NO PR link`

**What it proves:** non-PR dots (here the tmux-fallback "idle" dot) get the docs
link but no PR link — the PR link is gated on PR phase.

**Steps:**
1. Hover the "idle" dot (the scratch window).
2. Assert the card is visible and contains "idle".
3. Assert the docs link is visible and the PR link has count 0.

### `the PR link does not select/navigate the window row (stopPropagation)`

**What it proves:** clicking a card link does not bubble to the clickable window
row (no window select/navigate) — the `stopPropagation` guard mirrors the
PrStatusLine link pattern.

**Steps:**
1. Hover the "PR — open" dot; assert the card is visible.
2. Remove the PR link's `href` (so the click doesn't trigger a real new-tab
   navigation) and click it.
3. Assert the URL is still the server route (`/default`), not a window route —
   the click did not reach the row.

### `focusing the dot via keyboard opens the card (keyboard-first)`

**What it proves:** the card opens on keyboard focus of the dot, not hover only
(Constitution V — keyboard-first).

**Steps:**
1. Focus the "PR — open" dot.
2. Assert the card is visible and contains "PR — open".

### `Escape dismisses an open card`

**What it proves:** Escape closes an open card (floating-ui `useDismiss`).

**Steps:**
1. Hover the "PR — open" dot; assert the card is visible.
2. Press Escape.
3. Assert the card has count 0 (removed).
