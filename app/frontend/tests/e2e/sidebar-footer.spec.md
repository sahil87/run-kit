# sidebar-footer.spec.ts

Verifies the **sidebar footer status row** (260812-d1at): after the four
action chips (Help · Keyboard · Theme · Gear) relocated to the top bar — the
gear as a right-cluster chip, the other three as chevron-menu App-section rows
— the footer is a **passive** `justify-between` row: readouts LEFT (connection
dot, version click-to-copy) and a quiet status/hints slot RIGHT (empty at
rest; the update-available hint is unit-tested in `sidebar/index.test.tsx`).
The connection dot keeps its semantics (`role="status"`,
`aria-label="Connected"/"Disconnected"`), which is also what keeps
`_ready.ts`'s readiness gate working. The gear/menu-row behavior itself is
e2e-covered in `top-bar-overflow.spec.ts` and `settings-dialog.spec.ts`.

## Shared setup

- Real isolated tmux server (`rk-test-e2e`, port 3020 via `just test-e2e`),
  default desktop viewport — the sidebar is open by default, so the footer is
  directly visible. `gotoServerReady` (from `_ready.ts`) navigates to
  `/${TMUX_SERVER}` and waits for the `Connected` dot.
- All footer locators are scoped to `navigation[name='Sessions']` (the Sidebar
  nav) so they can never match top-bar elements.

## Tests

### `hosts the connection dot (left readout) — and the top bar carries none`

**What it proves:** the connection dot lives in the sidebar footer (the
`[aria-label='Connected']` element `_ready.ts` gates on resolves inside the
sidebar), and the top-bar right cell contains zero `role="status"` elements.

**Steps:**
1. `gotoServerReady` (waits for the Connected dot).
2. Assert `[aria-label='Connected']` is visible INSIDE the sidebar nav.
3. Assert the top-bar right cell (`data-testid="top-bar-right"`) has no
   `role="status"` element.

### `the four action chips are GONE from the footer (relocated to the top bar)`

**What it proves:** the footer's action cluster is removed — no Help link, no
Keyboard shortcuts button, no theme button, and no Settings gear render
anywhere in the sidebar nav.

**Steps:**
1. `gotoServerReady`.
2. Assert zero matches inside the sidebar nav for the Help link, the
   `Keyboard shortcuts` button, any `* theme` button, and the `Open settings`
   button.

### `version readout copies the displayed version form`

**What it proves:** the footer version line (left readout) renders once the
daemon reports a version and click-copies exactly the displayed form
(`v0.9.3`, or the bare `dev` sentinel on a dev daemon).

**Steps:**
1. Grant clipboard permissions; `gotoServerReady`.
2. Wait for the `RunKit … (copy)` button in the sidebar; read its text.
3. Click it and assert the clipboard equals the displayed text.
