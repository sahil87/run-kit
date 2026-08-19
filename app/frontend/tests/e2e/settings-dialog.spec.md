# settings-dialog.spec.ts

Validates the VS Code-style settings dialog (260723-o7q8; desktop
preference-pane layout + Notifications row 260724-6j1v; TABBED in
260818-bncw — General / Appearance / Shortcuts on one `role="tablist"`: a
left rail ≥480px, a horizontal strip under the title below, riding the
fixed-height `size="xl"` Dialog variant): mounted once at
`AppLayout` so it opens on every route (server routes AND `/board/$name`,
which renders no AppShell), triggered from the command palette and the
top-bar gear, with a visible This-host/This-device persistence-scope
split INSIDE each tab, and host-scoped edits persisting through
`/api/settings/*`.

Control-level behavior (input commit/cancel semantics, inline errors, theme
selects, font stepper, accent popover, roving-tabindex arrow nav) is
exercised deterministically by unit
tests (`settings-dialog.test.tsx`, `settings-dialog-context.test.tsx`,
`instance-name-context.test.tsx`); these e2e tests focus on the mount-point,
trigger, layout, and persistence contracts that unit tests can't cover.

## Shared setup

- `beforeAll` snapshots the developer's REAL `~/.rk/settings.yaml` (raw
  bytes) — `scripts/test-e2e.sh` isolates the tmux server/port but NOT
  `$HOME`, and the instance-name test writes through the live API. `afterAll`
  restores the snapshot verbatim (or deletes the file if it did not exist),
  the `board-list-reorder.spec.ts` pattern.
- `beforeAll` creates an `e2e-settings-<timestamp>` tmux session on
  `rk-test-e2e` with one named window (`win-a`); `afterAll` kills it.
- A unique board name (`set<digits>`) and instance name
  (`e2e-name-<digits>`) are used per run so reruns don't collide.
- `openPaletteSettings` RETRIES the `Meta+K` hotkey (toPass, 15s budget): a
  keypress fired before the global keydown listener attaches (cold dev-server
  first navigation) is dropped forever, so a single long wait on the palette
  input could never recover.

## Tests

### `palette opens the dialog on the General tab; the Appearance tab carries the rest (260818-bncw)`

**What it proves:** The "Settings: Open" palette action opens the single
AppLayout-mounted dialog on a server route ON THE GENERAL TAB (the tab-less
default), the General tab shows its scope-split controls (instance name, SSH
host, notifications), clicking the Appearance tab reveals its controls
(accent color, the inline theme picker — a trigger naming the active theme
that opens a search-field popover listing themes with both preferred slots
checked — and terminal font), and Escape is layered: with the theme popover
open it closes only the popover; a second Escape closes the dialog
(keyboard-first contract).

**Steps:**

1. Navigate to `/rk-test-e2e` and wait for the Connected indicator.
2. `Meta+K` → type `Settings: Open` → Enter.
3. Assert the `Settings` dialog is visible with the General tab
   `aria-selected`.
4. Assert "This host" and "This device" section labels render, plus the
   Instance name input, SSH host input, and the `Notifications` label.
5. Click the Appearance tab; assert the `Set instance color` button and the
   theme trigger render while the Themes listbox stays hidden (collapsed at
   rest); click the trigger and assert the search combobox and listbox open
   with exactly two `Current theme` checks (the dark and light preferred
   slots); assert the `Increase terminal font` button renders.
6. Press Escape; assert the theme popover closed while the dialog stayed
   open; press Escape again and assert the dialog is gone.

### `tabbed preference-pane layout with the Notifications row (260724-6j1v, 260818-bncw)`

**What it proves:** The dialog uses the `xl` Dialog variant (`max-w-4xl` +
fixed height, not the phone-card `max-w-sm`); the ONE tablist markup renders
with roving tabindex (the active tab is the list's only Tab stop); each
setting is a preference row — a `min-[480px]:grid-cols-[190px_1fr]` grid
(label column left, control column right); and the Notifications row (moved
from the retired top-bar bell) renders under This device on the General tab
with its test-send button and setup-guide link. Status text varies by browser
permission state, so only state-independent contents are asserted here
(state-by-state behavior is unit-tested).

**Steps:**

1. Navigate to `/rk-test-e2e` and wait for the Connected indicator.
2. Open the dialog via the palette (`Settings: Open`).
3. Assert the dialog panel's class carries `max-w-4xl` and not `max-w-sm`.
4. Assert the tablist (`Settings sections`) renders and the General tab has
   `tabindex="0"` while Appearance has `tabindex="-1"`.
5. Resolve the Instance-name input's closest `.grid` ancestor and assert its
   class contains `min-[480px]:grid-cols-[190px_1fr]`.
6. Assert the `Notifications` label, the `Send test notification` button, and
   the `Setup & troubleshooting guide` link (GitHub notifications doc, new
   tab) are visible.
7. Press Escape; assert the dialog is gone.

### `short viewport (375x667): the tab strip fits and the tall Shortcuts panel scrolls internally (260724-6j1v, 260818-bncw)`

**What it proves:** On a short mobile viewport the fixed-height xl dialog
does not clip: the panel's border box fits entirely inside the viewport; the
SAME tablist markup renders as the horizontal strip under the title with all
three tabs reachable; the page gains no horizontal overflow; and the tall
Shortcuts tab's PANEL (not the dialog) is the scroll container
(`scrollHeight > clientHeight` on the tabpanel), with its last element (the
reset-all footer) reachable by scrolling within it. The `Connected`
readiness gate is deliberately not used — at a mobile viewport the sidebar
(which hosts the dot) is an unmounted drawer, so the top-bar chevron is the
readiness signal.

**Steps:**

1. Set the viewport to 375×667 and navigate to `/rk-test-e2e`; wait for the
   top-bar `More controls` chevron.
2. Open the dialog via the palette (`Settings: Open`).
3. Assert the dialog `boundingBox()` lies fully within `[0,0]–[375,667]`.
4. Assert all three tabs (General / Appearance / Shortcuts) are visible in
   the strip, and `document.documentElement` has no horizontal overflow.
5. Click the Shortcuts tab; assert `settings-shortcuts-panel` is visible and
   the tabpanel's `scrollHeight > clientHeight`.
6. `scrollIntoViewIfNeeded()` the `reset all` button; assert it is visible
   and its box sits inside the viewport.

### `palette opens the same dialog on /board/$name (no AppShell there)`

**What it proves:** The dialog is reachable on the board route — the whole
point of the AppLayout mount, since `/board/$name` does not render AppShell
and mounts its own palette (`boardRouteActions`) — and the BOARD shell's
`shortcuts-overlay` chord handler resolves the same layout-global entry:
⇧Ctrl+/ switches the open dialog to the Shortcuts tab and re-firing closes
it. On the sessionless board route the macro add flow stays gated off and
the TMUX section renders its "No tmux server running" empty state.

**Steps:**

1. Read `win-a`'s `#{window_id}` via `tmux list-windows -F` and
   `POST /api/boards/<name>/pin` so the board exists.
2. Navigate to `/board/<name>` (`domcontentloaded`); wait for the `win-a`
   pane header.
3. `Meta+K` → type `Settings: Open` → Enter.
4. Assert the `Settings` dialog is visible with both scope sections.
5. Press Shift+Ctrl+/ → the dialog stays open on the Shortcuts tab
   (`settings-shortcuts-panel` visible); assert the add-flow button is
   absent and the TMUX empty state renders.
6. Press Shift+Ctrl+/ again → the dialog closes.
7. Finally: `POST /api/boards/<name>/unpin` so the board does not outlive
   the run.

### `top-bar gear opens the dialog (Tip-named, no native title)`

**What it proves:** The top-bar right-cluster gear (relocated from the sidebar
footer in 260812-d1at) is a working trigger on server routes, named by
`aria-label` + the tier-1 `Tip` system — it carries NO native `title=`
attribute.

**Steps:**

1. Navigate to `/rk-test-e2e` and wait for the Connected indicator.
2. Locate the `Open settings` button (the in-bar top-bar gear); assert it is
   visible and has no `title` attribute.
3. Click it; assert the `Settings` dialog is visible.

### `editing the instance name persists a host-scoped value (and clears)`

**What it proves:** A This-host edit round-trips through the live backend:
committing the Instance name input POSTs `/api/settings/instance-name`, the
stored setting reflects the value, the status bar's host segment prefers the
override live (no reload — the desktop hostname home since the HOST panel went
drawer-only, 260814-ldbs), and clearing the field clears the setting.

**Steps:**

1. Navigate to `/rk-test-e2e`; open the dialog via the top-bar gear.
2. Fill the Instance name input with the unique test name; press Enter.
3. Poll `GET /api/settings/instance-name` until it returns the test name.
4. Assert the status bar's host segment (`status-bar-host`) shows the test name.
5. Clear the input; press Enter.
6. Poll `GET /api/settings/instance-name` until it returns `null`.
