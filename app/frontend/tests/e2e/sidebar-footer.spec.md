# sidebar-footer.spec.ts

Verifies the **sidebar footer is MOBILE-ONLY** (260815-19me composed-frame
unification). The footer itself is unchanged from 260812-d1at — a **passive**
`justify-between` row: readouts LEFT (connection dot with
`role="status"` + `aria-label="Connected"/"Disconnected"`, version
click-to-copy) and a quiet status/hints slot RIGHT (empty at rest; the
update-available hint is unit-tested in `sidebar/index.test.tsx`). What
changed is WHERE it renders:

- **Desktop** renders no sidebar footer at all. The full-width **status bar**
  (`data-testid="status-bar"`, host cluster `status-bar-host`) at the bottom
  of desktop routes owns the connection dot and the version readout
  (`v0.9.3`, or the bare `dev` sentinel).
- **Mobile** has no status bar, so the drawer keeps the footer byte-identical.

## Shared setup

- Real isolated tmux server (`rk-test-e2e`, port 3020 via `just test-e2e`).
- **Desktop case:** default desktop viewport — the sidebar is open by default.
  Readiness gates on the STATUS BAR's `Connected` dot — also
  `gotoServerReady`'s gate since `_ready.ts` was retargeted (the desktop
  sidebar footer is gone).
- **Mobile cases:** `test.use({ hasTouch: true, viewport: 375x812 })` —
  `hasTouch` flips Chromium's `(pointer: coarse)` so `useIsMobile()` reports
  mobile (the sidebar-panels.spec.ts seam). `gotoDrawer` navigates, waits for
  the always-mounted `Toggle navigation` hamburger, clicks it, and returns
  the drawer (`role="dialog"`); footer locators are scoped to the drawer's
  `navigation[name='Sessions']`.

## Tests

### `desktop: the sidebar has NO footer — the status bar owns the connection dot + version readout`

**What it proves:** on desktop the Sessions nav contains no footer readouts
(no connection dot, no version copy button), while the status bar's host
cluster carries both the `Connected` dot and the version readout.

**Steps:**
1. `page.goto('/<e2e server>')`.
2. Wait for the status bar's `Connected` dot (readiness gate + proof of the
   dot's new home).
3. Assert the Sessions nav is visible and contains zero
   `[aria-label='Connected']`/`[aria-label='Disconnected']` elements and zero
   `RunKit … (copy)` buttons.
4. Assert the status-bar host cluster shows the version readout (anchored
   `dev` / `v…` regex matches the version span, not the hostname parent).

### `the drawer keeps the footer: connection dot present, status bar absent`

**What it proves:** on mobile the footer's connection dot keeps its semantics
inside the drawer's Sessions nav, and no status bar renders to duplicate it.

**Steps:**
1. `gotoDrawer('/<e2e server>')` (hamburger → drawer visible).
2. Assert `[aria-label='Connected']` is visible inside the drawer's
   `navigation[name='Sessions']`.
3. Assert `data-testid="status-bar"` has zero matches on the page.

### `version readout copies the displayed version form`

**What it proves:** the drawer footer's version line renders once the daemon
reports a version and click-copies exactly the displayed form (`v0.9.3`, or
the bare `dev` sentinel on a dev daemon).

**Steps:**
1. Grant clipboard permissions; `gotoDrawer('/<e2e server>')`.
2. Wait for the `RunKit … (copy)` button in the drawer; read its text.
3. Click it and assert the clipboard equals the displayed text.
