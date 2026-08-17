# sidebar-panels.spec.ts

Behavioural contract for the `CollapsiblePanel`-based Host and Pane panels.
Since iha5 the panels are **visibility-gated per section** (the
`runkit-sidebar-section-pane|host` booleans), both defaulting OFF on every
viewport — the `260814-ldbs` drawer-only fork became a default, not a hard
`isMobile` gate. The panel tests run on a **mobile viewport with the drawer
open** (`hasTouch: true` + 375×812) and first opt both sections in via
`addInitScript` seeds. A desktop test pins the default-off contract.
Validates that SSE-driven host metrics render, window context updates when a
window is selected, and the collapse/expand state persists via
`localStorage`.

## DOM note

`CollapsiblePanel` renders as:

```
<div class="border-t …">        ← outer panel wrapper
  <div class="flex …">            ← header wrapper
    <button>…title…</button>
  </div>
  <div>…content…</div>
</div>
```

Two `..` levels from the title button reach the outer wrapper; one level
only reaches the header. These tests deliberately use `locator("../..")`.

## Shared setup

- `beforeAll` creates `e2e-panels-<timestamp>` so the Pane panel has a real
  window to display once selected; `afterAll` kills it.
- The `mobile drawer` describe runs `test.use({ hasTouch: true, viewport:
  375×812 })` — `hasTouch` flips Chromium's `(pointer: coarse)` media query
  (the `bottom-bar-chip-size.spec.ts` seam), so `useIsMobile()` reports
  mobile and the sidebar renders as the drawer. Its `beforeEach` seeds
  `runkit-sidebar-section-pane=true` and `runkit-sidebar-section-host=true`
  via `addInitScript` (both sections default OFF since iha5; the seed
  re-runs on every navigation, so in-test reloads keep the panels mounted).
- `gotoDrawer(page, path)` navigates, then opens the drawer via the
  `Toggle navigation` button and returns the `role="dialog"` drawer. It
  gates on the toggle, NOT the sidebar-footed `Connected` dot — a closed
  drawer leaves it unmounted.
- `ensureDrawerOpen(page)` re-opens the drawer when a destination tap
  auto-closed it (or a reload landed on the persisted sidebar preference).

## Tests

### `desktop sidebar renders NO PANE/HOST panels under the defaults (both sections default off; the status bar carries the registers)`

**What it proves:** The default-visibility contract — on a desktop (fine
pointer, wide) with nothing seeded, the sidebar renders no Pane/Host panels
(both sections default off); the registers' home (the status bar) is present
instead. (Desktop opt-in via the rail is covered by
`sidebar-section-rail.spec.ts`.)

**Steps:**
1. `gotoServerReady(TMUX_SERVER)` (desktop default).
2. Assert zero buttons named `/^Pane/` or `/^Host/`.
3. Assert the `status-bar` testid is visible.

### `Host panel shows real system metrics via SSE` (mobile drawer)

**What it proves:** The Host collapsible panel is open by default and
populated with real metrics (CPU, memory, load, disk, uptime) received via
SSE within one tick.

**Steps:**
1. `gotoDrawer(/${TMUX_SERVER})`.
2. Locate the header button with `name: /^Host/`; assert visible and
   `aria-expanded="true"`.
3. Walk up to the outer panel (`locator("../..")`).
4. Inside that subtree, assert the presence of:
   - `cpu` label (within 8s, covers first SSE tick)
   - a percentage rendering (`text=/%/`)
   - `mem` label, `^ld`, `dsk`, `up `
5. Assert memory is not rendered as `0/0` (sentinel for missing data).
6. Assert disk renders as `\d+/\d+G`.

### `Window panel shows selected window info` (mobile drawer)

**What it proves:** The Pane panel shows a "No window selected" fallback
when on the dashboard, then swaps to tmux metadata (`tmx`, `cwd`, …) when
a window is selected.

**Steps:**
1. `gotoDrawer(/${TMUX_SERVER})`.
2. Locate the header button with `name: /^Pane/`; assert visible and
   expanded.
3. Walk up to the outer panel.
4. Assert `text=No window selected` is visible.
5. Click the sidebar's `Navigate to ${TEST_SESSION}` button (selects the
   first window in that session) — the drawer auto-closes on the
   destination tap, so re-open it via `ensureDrawerOpen`.
6. Within 3s, assert lines `^tmx ` and `^cwd ` appear inside the Pane panel.

### `Collapsible panel toggle and persistence` (mobile drawer)

**What it proves:** Clicking the Host header collapses/expands the panel,
the state is mirrored into `localStorage`, and it survives a full page
reload.

**Steps:**
1. `gotoDrawer` and wait for the `cpu` line (metrics rendered).
2. Click the Host header to collapse; assert `aria-expanded="false"`.
3. Read `localStorage.getItem('runkit-panel-host')` and assert it equals
   the string `"false"`.
4. `page.reload()`; re-open the drawer via `ensureDrawerOpen` (the reload
   lands on the persisted sidebar preference, open or closed).
5. Re-locate the Host header; assert it is still collapsed
   (`aria-expanded="false"`).
6. Click to expand; assert `aria-expanded="true"` and the `cpu` line
   reappears within 8s.
7. Clean up the `runkit-panel-host` localStorage key for the next test.

### `board route populates PANE (focused tile) and HOST (host-metrics fallback)` (mobile drawer)

**What it proves:** On `/board/$name` — where the route provides no server
param and both bottom panels used to render empty by construction — the PANE
panel follows the board's focused tile (resolving the pinned window's
enriched home-session copy by `windowId` from the sessions stream) and the
HOST panel falls back to the host-global metrics broadcast (260720-zx4i).
The HOST header carries no connection dot — the sidebar footer dot owns that
signal.

**Steps:**
1. Resolve the test session's window id via `tmux list-windows` and pin it
   to a fresh board (`panels<suffix>`) via `POST /api/boards/{name}/pin`.
2. `gotoDrawer(/board/${boardName})`.
3. Locate the Pane header button, walk up to the outer panel, and assert
   `^tmx ` and `^cwd ` rows appear (within 10s) while
   `No window selected` is absent — the focused-tile fallback filled the
   panel.
4. Locate the Host outer panel and assert `cpu` (within 8s, first metrics
   tick) and `mem` rows render, `No metrics` is absent, and no element with
   an `SSE` title exists (the header connection dot was removed).
5. `finally`: unpin the window via the API so the shared server carries no
   leftover board.

### `Host panel metrics update over multiple SSE ticks` (mobile drawer)

**What it proves:** Metrics don't stop rendering after the first tick —
they remain populated across at least two full SSE cycles (~5s).

**Steps:**
1. `gotoDrawer` and wait for `Connected`-equivalent panel content.
2. Locate the Host outer panel via `../..` from the header button.
3. Assert `cpu` appears within 8s.
4. `waitForTimeout(5500)` — covers ≥2 SSE ticks (2.5s apart).
5. Assert `cpu`, `mem`, `^ld`, and `dsk` are all still visible. A
   disconnection, stale buffer, or unmounted HostPanel would fail here.
