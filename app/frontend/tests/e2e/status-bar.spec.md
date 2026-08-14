# status-bar.spec.ts

Proves the **status bar** (change `260814-ldbs-shell-stage-status-bar`): the
full-width attached frame strip at the shell bottom on desktop, which absorbs
the sidebar's retired desktop PANE/HOST panels (left = current-window
registers, terminal route only; right = host segments + the ⌘K/compose hints
the deleted fine-pointer bottom bar used to hold). Also pins the R3
fine-pointer bottom-bar deletion and the R5 no-scroll degradation ladder with
its `…` overflow chevron.

## Shared setup

- **Fully mocked** (no tmux/gh) — the `pane-register-panel.spec.ts` /
  `tooltips.spec.ts` idiom: `mockStateSocket` (`_state-socket-mock.ts`)
  delivers one session (`dev`) with one window (`@1`, all signal layers:
  waiting agent, fab change, open PR, git branch), a host-metrics snapshot
  (`e2e-box`), and a version slot (`0.9.3`). `/ws/terminals` is stubbed;
  `/api/servers` + window-select are fulfilled inline.
- **Locators**: the `status-bar` testid (the strip), `status-bar-window` /
  `status-bar-host` (the two clusters), `status-bar-overflow` (the `…`
  chevron), `status-bar-compose` (the `a▏` compose hint), and the bottom
  bar's `Terminal keys` toolbar role (asserted ABSENT on fine pointers).
- Default Playwright desktop viewport (1280px) unless a test resizes.

## Tests

### `desktop terminal route: status bar present with BOTH clusters; no bottom bar exists`

**What it proves:** R3 + R4 on the terminal route — the status bar renders;
the fine-pointer bottom bar is gone from the DOM entirely; the window cluster
mirrors the current window's registers (tmux pane, cwd basename, git branch,
agent state, fab change, PR as an open-first anchor); the host cluster shows
compact metrics, host+version, and the connection dot.

**Steps:**
1. Navigate to `/default/1`; wait for the status bar.
2. Assert zero `Terminal keys` toolbars in the DOM.
3. Assert the window cluster's register values (`pane 1/1 %1`, `wt`, `main`,
   `waiting 3m`, the fab line, the `Open PR #603` link).
4. Assert the host cluster (`17%`, `e2e-box`, `v0.9.3`) and the `Connected`
   dot.

### `server route (no window): host cluster only — no window cluster, no errors`

**What it proves:** R4/A-014 — off the terminal route the status bar still
renders (uniform frame), but with the host cluster only; a route with no live
window data renders no window segments and no placeholder rows, and the
bottom bar is absent there too.

**Steps:**
1. Navigate to `/default`; wait for the status bar.
2. Assert no `status-bar-window` element exists.
3. Assert the host cluster shows the hostname and server name.
4. Assert zero `Terminal keys` toolbars.

### `narrow desktop width: low-priority segments drop (never scroll) and the … chevron lists them`

**What it proves:** R5/A-011 — the degradation ladder at the ~800px band:
deterministic CSS breakpoint classes hide cwd (≥xl), tmx (≥lg) and out
(≥900px) while git/agt/fab/PR survive; the bar never scrolls; the `…`
chevron (hidden at full width) appears and its menu lists the dropped
segments; the menu's rows are keyboard-reachable by arrow-nav, which skips the
rows a breakpoint currently hides; Escape closes it.

**Steps:**
1. Navigate to `/default/1`; wait for the window cluster.
2. At 1440px assert all window segments visible and the chevron hidden.
3. Resize to 800×600; assert cwd/tmx hidden, git/agt still visible, and
   `scrollWidth ≤ clientWidth` on the bar.
4. Click the chevron; assert the menu lists `cwd`/`tmx` rows.
5. Assert focus entered the panel on the first visible row (`cwd`), that
   ArrowDown/ArrowUp move to `tmx` and back, and that ArrowUp off the first row
   wraps to the last VISIBLE row (the compose action) rather than the
   breakpoint-hidden version row — a `display: none` row cannot take focus, so
   arrow-nav must skip it. This is the browser-only half of the contract; the
   unit suite covers the rove itself, where jsdom computes no layout.
6. Press Escape; assert the menu closes.

### `the compose hint opens the compose strip (the relocated bottom-bar affordance)`

**What it proves:** R7 — the status bar's `a▏` hint is the desktop compose
opener (same action as the deleted bar's chip): clicking it mounts the strip
and the hint reflects the pressed state.

**Steps:**
1. Navigate to `/default/1`; wait for the `status-bar-compose` button.
2. Click it; assert the `compose-strip` element renders.
3. Assert the hint is `aria-pressed="true"`.

### `mobile viewport: no status bar at all (the drawer keeps the panels)`

**What it proves:** The mobile rejection — below the desktop breakpoint the
status bar does not exist (mobile keeps its own chrome; the PANE/HOST panels
live in the drawer, covered by `sidebar-panels.spec.ts`).

**Steps:**
1. Set a 375×812 viewport; navigate to `/default/1`; gate on the
   `Toggle navigation` button (the sidebar-footed `Connected` dot is
   unmounted with the closed drawer).
2. Assert zero `status-bar` elements in the DOM.

### `coarse + wide = mobile experience: chip bar present, NO status bar`

**What it proves:** The revised device rule (rework cycle 1, R3/A-013) —
`useIsMobile()` is width-OR-coarse, so a coarse pointer at a DESKTOP width
(an iPad in landscape) renders the mobile experience app-wide: the key-chip
bar survives (coarse → today's bar), and the status bar does NOT exist (the
status bar lives exactly where the desktop grids live — `!isMobile` — on
every route, host page included).

**Steps:**
1. `test.use({ hasTouch: true, viewport: 1440×800 })` — `hasTouch` flips
   Chromium's `(pointer: coarse)` at a desktop width (the
   bottom-bar-chip-size seam).
2. Navigate to `/default/1`; gate on the `Toggle navigation` button.
3. Assert the `Terminal keys` toolbar (the chip bar) IS visible.
4. Assert zero `status-bar` elements in the DOM.
