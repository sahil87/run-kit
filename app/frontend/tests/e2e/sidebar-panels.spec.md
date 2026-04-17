# sidebar-panels.spec.ts

Behavioural contract for the `CollapsiblePanel`-based Host and Pane panels
pinned to the bottom of the sidebar. Validates that SSE-driven host metrics
render, window context updates when a window is selected, and the
collapse/expand state persists via `localStorage`.

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

## Tests

### `Host panel shows real system metrics via SSE`

**What it proves:** The Host collapsible panel is open by default and
populated with real metrics (CPU, memory, load, disk, uptime) received via
SSE within one tick.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
2. Locate the header button with `name: /^Host/`; assert visible and
   `aria-expanded="true"`.
3. Walk up to the outer panel (`locator("../..")`).
4. Inside that subtree, assert the presence of:
   - `cpu` label (within 8s, covers first SSE tick)
   - a percentage rendering (`text=/%/`)
   - `mem` label, `^ld`, `dsk`, `up `
5. Assert memory is not rendered as `0/0` (sentinel for missing data).
6. Assert disk renders as `\d+/\d+G`.

### `Window panel shows selected window info`

**What it proves:** The Pane panel shows a "No window selected" fallback
when on the dashboard, then swaps to tmux metadata (`tmx`, `cwd`, …) when
a window is selected.

**Steps:**
1. Navigate to `/${TMUX_SERVER}` and wait for `Connected`.
2. Locate the header button with `name: /^Pane/`; assert visible and
   expanded.
3. Walk up to the outer panel.
4. Assert `text=No window selected` is visible.
5. Click the sidebar's `Navigate to ${TEST_SESSION}` button (selects the
   first window in that session).
6. Within 3s, assert lines `^tmx ` and `^cwd ` appear inside the Pane panel.

### `Collapsible panel toggle and persistence`

**What it proves:** Clicking the Host header collapses/expands the panel,
the state is mirrored into `localStorage`, and it survives a full page
reload.

**Steps:**
1. Navigate and wait for `Connected` + the `cpu` line (metrics rendered).
2. Click the Host header to collapse; assert `aria-expanded="false"`.
3. Read `localStorage.getItem('runkit-panel-host')` and assert it equals
   the string `"false"`.
4. `page.reload()`; re-wait for `Connected`.
5. Re-locate the Host header; assert it is still collapsed
   (`aria-expanded="false"`).
6. Click to expand; assert `aria-expanded="true"` and the `cpu` line
   reappears within 8s.
7. Clean up the `runkit-panel-host` localStorage key for the next test.

### `Host panel metrics update over multiple SSE ticks`

**What it proves:** Metrics don't stop rendering after the first tick —
they remain populated across at least two full SSE cycles (~5s).

**Steps:**
1. Navigate and wait for `Connected`.
2. Locate the Host outer panel via `../..` from the header button.
3. Assert `cpu` appears within 8s.
4. `waitForTimeout(5500)` — covers ≥2 SSE ticks (2.5s apart).
5. Assert `cpu`, `mem`, `^ld`, and `dsk` are all still visible. A
   disconnection, stale buffer, or unmounted HostPanel would fail here.
