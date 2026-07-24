# settings-dialog.spec.ts

Validates the VS Code-style settings dialog (260723-o7q8; desktop
preference-pane layout + Notifications row 260724-6j1v): mounted once at
`AppLayout` so it opens on every route (server routes AND `/board/$name`,
which renders no AppShell), triggered from the command palette and the
sidebar-footer gear, with a visible This-host/This-device persistence-scope
split, and host-scoped edits persisting through `/api/settings/*`.

Control-level behavior (input commit/cancel semantics, inline errors, theme
selects, font stepper, accent popover) is exercised deterministically by unit
tests (`settings-dialog.test.tsx`, `settings-dialog-context.test.tsx`,
`instance-name-context.test.tsx`); these e2e tests focus on the mount-point,
trigger, and persistence contracts that unit tests can't cover.

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

### `palette opens the dialog on a server route with the This-host/This-device split`

**What it proves:** The "Settings: Open" palette action opens the single
AppLayout-mounted dialog on a server route, both persistence-scope sections
render with their controls (instance name, SSH host, accent color, theme
pair, terminal font), and Escape closes it (keyboard-first contract).

**Steps:**

1. Navigate to `/rk-test-e2e` and wait for the Connected indicator.
2. `Meta+K` → type `Settings: Open` → Enter.
3. Assert the `Settings` dialog is visible.
4. Assert "This host" and "This device" section labels render.
5. Assert the Instance name input, SSH host input, `Set instance color`
   button, Dark theme select, and `Increase terminal font` button render.
6. Press Escape; assert the dialog is gone.

### `desktop preference-pane layout with the Notifications row (260724-6j1v)`

**What it proves:** The dialog uses the wide `lg` Dialog variant (`max-w-2xl`,
not the phone-card `max-w-sm`); each setting is a preference row — a
`min-[480px]:grid-cols-[190px_1fr]` grid (label column left, control column
right); and the Notifications row (moved from the retired top-bar bell) renders
under This device with its test-send button and setup-guide link. Status text
varies by browser permission state, so only state-independent contents are
asserted here (state-by-state behavior is unit-tested).

**Steps:**

1. Navigate to `/rk-test-e2e` and wait for the Connected indicator.
2. Open the dialog via the palette (`Settings: Open`).
3. Assert the dialog panel's class carries `max-w-2xl` and not `max-w-sm`.
4. Resolve the Instance-name input's closest `.grid` ancestor and assert its
   class contains `min-[480px]:grid-cols-[190px_1fr]`.
5. Assert the `Notifications` label, the `Send test notification` button, and
   the `Setup & troubleshooting guide` link (GitHub notifications doc, new
   tab) are visible.
6. Press Escape; assert the dialog is gone.

### `short viewport (375x667): the dialog fits and its last row is reachable by scroll (260724-6j1v)`

**What it proves:** On a short viewport the (taller, `lg`) settings dialog
does not clip off-screen with no scroll path: the panel's border box fits
entirely inside the viewport, the panel itself is the scroll container
(`scrollHeight > clientHeight`), and the last row's control (the
Notifications setup-guide link) is reachable by scrolling within it. Guards
the rework finding M1 regression class. The `Connected` readiness gate is
deliberately not used — at a mobile viewport the sidebar (which hosts the
dot) is an unmounted drawer, so the top-bar chevron is the readiness signal.

**Steps:**

1. Set the viewport to 375×667 and navigate to `/rk-test-e2e`; wait for the
   top-bar `More controls` chevron.
2. Open the dialog via the palette (`Settings: Open`).
3. Assert the dialog `boundingBox()` lies fully within `[0,0]–[375,667]`.
4. Assert `scrollHeight > clientHeight` on the dialog panel (content
   overflows into a scroll path).
5. `scrollIntoViewIfNeeded()` the `Setup & troubleshooting guide` link;
   assert it is visible and its box sits inside the viewport.

### `palette opens the same dialog on /board/$name (no AppShell there)`

**What it proves:** The dialog is reachable on the board route — the whole
point of the AppLayout mount, since `/board/$name` does not render AppShell
and mounts its own palette (`boardRouteActions`).

**Steps:**

1. Read `win-a`'s `#{window_id}` via `tmux list-windows -F` and
   `POST /api/boards/<name>/pin` so the board exists.
2. Navigate to `/board/<name>` (`domcontentloaded`); wait for the `win-a`
   pane header.
3. `Meta+K` → type `Settings: Open` → Enter.
4. Assert the `Settings` dialog is visible with both scope sections.
5. Finally: `POST /api/boards/<name>/unpin` so the board does not outlive
   the run.

### `sidebar footer gear opens the dialog (Tip-named, no native title)`

**What it proves:** The sidebar-footer gear is a working trigger on server
routes, named by `aria-label` + the tier-1 `Tip` system — it carries NO
native `title=` attribute.

**Steps:**

1. Navigate to `/rk-test-e2e` and wait for the Connected indicator.
2. Locate the `Open settings` button; assert it is visible and has no
   `title` attribute.
3. Click it; assert the `Settings` dialog is visible.

### `editing the instance name persists a host-scoped value (and clears)`

**What it proves:** A This-host edit round-trips through the live backend:
committing the Instance name input POSTs `/api/settings/instance-name`, the
stored setting reflects the value, the HOST panel hostname line prefers the
override live (no reload), and clearing the field clears the setting.

**Steps:**

1. Navigate to `/rk-test-e2e`; open the dialog via the sidebar gear.
2. Fill the Instance name input with the unique test name; press Enter.
3. Poll `GET /api/settings/instance-name` until it returns the test name.
4. Assert the sidebar (HOST panel hostname line) shows the test name.
5. Clear the input; press Enter.
6. Poll `GET /api/settings/instance-name` until it returns `null`.
