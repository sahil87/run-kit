# sidebar-footer.spec.ts

Verifies the **sidebar footer global-chrome row** (260724-6j1v): the app-global
chrome that moved down from the top bar. The footer is `justify-between` —
passive readouts LEFT (connection dot, version click-to-copy) and actions RIGHT
(**Help · Theme · Gear**, all in the gear's borderless icon idiom). The
connection dot keeps its top-bar semantics (`role="status"`,
`aria-label="Connected"/"Disconnected"`), which is also what keeps `_ready.ts`'s
readiness gate working.

## Shared setup

- Real isolated tmux server (`rk-test-e2e`, port 3020 via `just test-e2e`),
  default desktop viewport — the sidebar is open by default, so the footer is
  directly visible. `gotoServerReady` (from `_ready.ts`) navigates to
  `/${TMUX_SERVER}` and waits for the `Connected` dot.
- All footer locators are scoped to `navigation[name='Sessions']` (the Sidebar
  nav) so they can never match top-bar remnants.

## Tests

### `hosts the connection dot (left readout) — and the top bar carries none`

**What it proves:** the connection dot now lives in the sidebar footer (the
`[aria-label='Connected']` element `_ready.ts` gates on resolves inside the
sidebar), and the top-bar right cell contains zero `role="status"` elements.

**Steps:**
1. `gotoServerReady` (waits for the Connected dot).
2. Assert `[aria-label='Connected']` is visible INSIDE the sidebar nav.
3. Assert the top-bar right cell (`data-testid="top-bar-right"`) has no
   `role="status"` element.

### `renders Help · Theme · Gear as borderless right-cluster actions`

**What it proves:** the footer's action cluster carries the moved Help anchor
(same `HELP_URL`, `target="_blank"`, `rel="noopener noreferrer"`, Tip-named —
no native `title`), the moved theme toggle (mode-labeled button), and the
existing settings gear.

**Steps:**
1. `gotoServerReady`.
2. Assert the `Help — run-kit docs` link's href/target/rel attributes and the
   absence of a native `title`.
3. Assert a `* theme` button and the `Open settings` gear are visible in the
   sidebar.

### `theme button cycles the mode from the footer`

**What it proves:** the footer theme button keeps the retired top-bar toggle's
cycle behavior — clicking steps system → light → dark → system, reflected in
its `aria-label`.

**Steps:**
1. `gotoServerReady`; read the theme button's `aria-label`.
2. Click it and poll until the `aria-label` changes.
3. Click twice more and assert the label returns to the original (full cycle —
   restores the pre-test preference).

### `version readout copies the displayed version form`

**What it proves:** the footer version line (NEW, left readout) renders once
the daemon reports a version and click-copies exactly the displayed form
(`v0.9.3`, or the bare `dev` sentinel on a dev daemon).

**Steps:**
1. Grant clipboard permissions; `gotoServerReady`.
2. Wait for the `RunKit … (copy)` button in the sidebar; read its text.
3. Click it and assert the clipboard equals the displayed text.

### `gear opens the settings dialog from the footer`

**What it proves:** the gear (the row's original occupant, o7q8) still opens
the settings dialog after the footer rework.

**Steps:**
1. `gotoServerReady`.
2. Click `Open settings` in the sidebar.
3. Assert the `Settings` dialog is visible.
