# lanes.spec.ts

Behavioural contract for the Pane Lanes feature. Validates the `/lanes` route
renders correct empty state, that pins persisted in `localStorage` produce
visible lanes after reload, and that removing pins restores the empty state.

## Shared setup

- `afterEach` clears the `runkit-lanes-pins` localStorage key so each test
  starts with a clean slate.

## Tests

### `empty state renders when no pins exist`

**What it proves:** Navigating to `/lanes` with no pins in localStorage shows
the empty-state guidance UI with the expected copy and a back link.

**Steps:**
1. Navigate to `/lanes`.
2. Assert "No panes pinned" text is visible.
3. Assert the subtext guidance message is visible.
4. Assert "Back to server list" link is visible.

### `Lanes title and chrome are present`

**What it proves:** The LanesPage renders its own minimal chrome — a "Lanes"
title and a "Run Kit" back link pointing to `/`.

**Steps:**
1. Navigate to `/lanes`.
2. Assert "Lanes" text is visible.
3. Locate the "Run Kit" link and assert it has `href="/"`.

### `pin a window via localStorage and verify lane appears after reload`

**What it proves:** When a pin is written to `localStorage` (simulating what
the sidebar or command palette does), reloading the lanes page renders the
corresponding lane component with the correct aria-label, and the pin count
badge updates.

**Steps:**
1. Navigate to `/lanes` and confirm empty state.
2. Inject `[{ server: "default", session: "test-session", windowIndex: 0 }]`
   into `localStorage` under `runkit-lanes-pins`.
3. Reload the page.
4. Assert "No panes pinned" is no longer visible.
5. Assert a lane element with `aria-label="Lane: default/test-session/0"` is
   visible within 10s.
6. Assert the header badge shows "1".

### `unpin via localStorage and verify lane removal after reload`

**What it proves:** Removing a pin from `localStorage` and reloading the page
causes the lane to disappear and the empty state to return.

**Steps:**
1. Pre-seed a pin via `localStorage` and reload to render the lane.
2. Confirm the lane is visible.
3. Overwrite `localStorage` with an empty array.
4. Reload.
5. Assert "No panes pinned" is visible again.

### `multiple pins render multiple lanes`

**What it proves:** Multiple pins across different servers and sessions each
produce a distinct lane, and the pin count badge reflects the total.

**Steps:**
1. Navigate to `/lanes`.
2. Inject 3 pins (2 on "default" server, 1 on "remote") into `localStorage`.
3. Reload.
4. Assert all three lane elements are visible by their `aria-label`.
5. Assert the header badge shows "3".
